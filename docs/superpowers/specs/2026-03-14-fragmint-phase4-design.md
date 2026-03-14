# Fragmint Phase 4 — Frontend Web

**Date:** 2026-03-14
**Phase:** 4 of 9
**Duration:** 3 weeks
**Status:** Design approved

## Scope

Build a React SPA served by the Core API on `/ui` for managing fragments, inventorying coverage, composing documents, and validating content. Compatible air-gap deployment (zero external CDN).

### In scope

- 5 pages: Login, Bibliothèque, Inventaire, Compositeur, Validation
- Sidebar layout with drawer detail panel
- Auth via JWT (session memory, not localStorage)
- Real-time fragment slot preview in Compositeur
- shadcn/ui component library (Radix + Tailwind)
- Served by Fastify via @fastify/static
- ~20-25 frontend tests

### Out of scope

- Vue Graphe (Phase 8 — GraphRAG)
- Vue Ingestion/Harvester (Phase 7)
- Vue Administration / Config LLM (Phase 6+)
- E2E tests Playwright/Cypress (Phase 6 — Hardening)
- Mode sombre (backlog)
- Notifications Twake (backlog)

## Architecture

```
packages/web/
├── src/
│   ├── main.tsx                 # Entry point, React root
│   ├── App.tsx                  # BrowserRouter + routes + AuthProvider
│   ├── api/
│   │   ├── client.ts            # Fetch wrapper with JWT injection
│   │   ├── hooks/
│   │   │   ├── use-fragments.ts # useFragments, useFragment, useSearchFragments
│   │   │   ├── use-inventory.ts # useInventory
│   │   │   ├── use-templates.ts # useTemplates, useTemplate
│   │   │   ├── use-compose.ts   # useCompose mutation
│   │   │   └── use-auth.ts      # useLogin mutation
│   │   └── types.ts             # API response types
│   ├── components/
│   │   ├── ui/                  # shadcn/ui components (Button, Input, Badge, etc.)
│   │   ├── fragment-card.tsx
│   │   ├── fragment-detail.tsx
│   │   ├── quality-badge.tsx
│   │   ├── slot-preview.tsx
│   │   ├── coverage-bar.tsx
│   │   └── search-input.tsx
│   ├── layouts/
│   │   └── app-layout.tsx       # Sidebar + main content area
│   ├── pages/
│   │   ├── login.tsx
│   │   ├── fragments.tsx
│   │   ├── inventory.tsx
│   │   ├── compose.tsx
│   │   └── validation.tsx
│   └── lib/
│       ├── auth-context.tsx     # AuthProvider, useAuth hook
│       └── utils.ts             # cn() helper, formatters
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── components.json              # shadcn/ui config
└── package.json
```

**Build:** Vite produces static HTML/JS/CSS in `dist/`. Fastify serves it on `/ui` via `@fastify/static` with SPA fallback (all `/ui/*` routes return `index.html`).

**Dev mode:** `vite dev` on port 5173, proxies `/v1/*` to `localhost:3210`.

## Tech Stack

| Dependency | Version | Purpose |
|------------|---------|---------|
| React | 19 | UI framework |
| TypeScript | ^5 | Type safety |
| Vite | ^6 | Build tool + dev server |
| React Router | ^7 | Client-side routing |
| TanStack Query | ^5 | Data fetching, caching, mutations |
| shadcn/ui | latest | Component library (Radix + Tailwind) |
| Tailwind CSS | ^4 | Utility-first styling |
| Lucide React | latest | Icons |
| @fastify/static | latest | Serve built frontend from API server |

## Pages

### 1. LoginPage (`/login`)

Simple centered form: username + password + submit button. On success, stores JWT in AuthContext (session memory only, not localStorage per PRD). Redirects to `/fragments`.

On 401 from any API call, redirect to `/login`.

### 2. FragmentsPage (`/fragments`) — Bibliothèque

**Main area:**
- Filter bar: type, domain, language, quality (shadcn Select components)
- Search input with debounce (semantic search via `POST /v1/fragments/search`)
- Paginated fragment list as cards (FragmentCard components)
- Button "+ Nouveau" opens creation dialog

**FragmentCard:**
- Title (derived from body heading)
- Badges: type, lang, quality (QualityBadge)
- Body excerpt (first 100 chars)
- "Sans traduction EN" badge when applicable

**Drawer (Sheet) — right panel on fragment click:**
- Full markdown body content
- Frontmatter metadata table (domain, tags, author, dates, uses, origin)
- Git history timeline (`GET /fragments/:id/history`)
- Actions based on quality state:
  - `draft` → button "Marquer reviewed"
  - `reviewed` → button "Approuver"
  - Any state → button "Modifier"

### 3. InventoryPage (`/inventory`)

**Top metrics row (Cards):**
- Total fragments count
- By quality: approved / reviewed / draft (with QualityBadge)

**Coverage section:**
- Per domain: CoverageBar showing fr/en fragment counts as horizontal stacked bars
- Progress toward full coverage (approved fragments ratio)

**Gaps table:**
- List of detected gaps from `POST /v1/fragments/inventory`
- Columns: type, domain, lang, status (no_approved / missing_translation)
- Each gap row clickable → navigates to FragmentsPage with pre-filled filters

### 4. ComposePage (`/compose`) — Compositeur

**Step 1 — Template selection:**
- Dropdown of available templates (`GET /v1/templates`)
- On select: display template description and fragment slots

**Step 2 — Context form:**
- Dynamic fields based on template's `context_schema`
- Required fields marked, defaults pre-filled
- Enum fields rendered as Select components

**Step 3 — Slot preview (real-time):**
- For each fragment slot in the template:
  - Resolve `{{context.*}}` in lang/domain filters
  - Call `POST /v1/fragments/search` with resolved filters
  - Display result: SlotPreview component
    - Green: fragment found — show title, quality, score
    - Red: no match — show "Aucun fragment trouvé" with fallback indication (skip/error)
    - Click on a slot → Dialog to override with a specific fragment (search + select)
- Debounced: re-resolves on context field changes

**Step 4 — Compose:**
- Button "Composer" (disabled if any required slot is red)
- Calls `POST /v1/templates/:id/compose` with context + overrides + structured_data
- Shows loading spinner during render
- On success: composition report (resolved fragments, skipped, warnings, render time)
- Download button for the generated .docx

### 5. ValidationPage (`/validation`)

**Queue list:**
- Fragments with quality `reviewed` (filtered via `GET /v1/fragments?quality=reviewed`)
- Sorted by updated_at desc (newest first)
- Each item shows: title, type, domain, author, date

**Review panel (on click → drawer):**
- Full fragment content
- Diff with previous version if available (`GET /fragments/:id/diff`)
- Actions:
  - "Approuver" → `POST /fragments/:id/approve` → moves to approved, removes from queue
  - "Demander modification" → toast notification (no API action, manual workflow for MVP)

## State Management

### Auth (React Context)

```typescript
interface AuthState {
  user: { login: string; role: string; display_name: string } | null;
  token: string | null;
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}
```

JWT stored in memory only. All API calls inject `Authorization: Bearer` header via the fetch wrapper.

### TanStack Query Hooks

**Queries:**

| Hook | Endpoint | Key |
|------|----------|-----|
| `useFragments(filters)` | `GET /v1/fragments` | `['fragments', filters]` |
| `useFragment(id)` | `GET /v1/fragments/:id` | `['fragment', id]` |
| `useFragmentHistory(id)` | `GET /v1/fragments/:id/history` | `['fragment-history', id]` |
| `useSearchFragments(query, filters)` | `POST /v1/fragments/search` | `['fragment-search', query, filters]` |
| `useInventory(topic?)` | `POST /v1/fragments/inventory` | `['inventory', topic]` |
| `useTemplates()` | `GET /v1/templates` | `['templates']` |
| `useTemplate(id)` | `GET /v1/templates/:id` | `['template', id]` |

**Mutations:**

| Hook | Endpoint | Invalidates |
|------|----------|-------------|
| `useCreateFragment()` | `POST /v1/fragments` | `['fragments']` |
| `useUpdateFragment()` | `PUT /v1/fragments/:id` | `['fragments'], ['fragment', id]` |
| `useReviewFragment()` | `POST /v1/fragments/:id/review` | `['fragments'], ['fragment', id]` |
| `useApproveFragment()` | `POST /v1/fragments/:id/approve` | `['fragments'], ['fragment', id]` |
| `useCompose()` | `POST /v1/templates/:id/compose` | none |

### Compositeur Preview Flow

1. Template selected → `useTemplate(id)` loads slots + context_schema
2. Context fields filled → for each slot, resolve `{{context.*}}` vars
3. Debounced search per slot → `useSearchFragments(type, {domain, lang, quality_min})`
4. Results populate SlotPreview components (green/red)
5. User can override any slot via search Dialog
6. Compose button → `useCompose()` mutation → download result

## Server Integration

### Fastify static serving

Add to `packages/server/src/index.ts`:

```typescript
import fastifyStatic from '@fastify/static';

// After all API routes
await app.register(fastifyStatic, {
  root: resolve(import.meta.dirname, '../../web/dist'),
  prefix: '/ui/',
});

// SPA fallback: all /ui/* return index.html
app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/ui')) {
    return reply.sendFile('index.html');
  }
  reply.status(404).send({ data: null, meta: null, error: 'Not found' });
});
```

### Vite dev proxy

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/v1': 'http://localhost:3210',
    },
  },
  base: '/ui/',
});
```

## Testing Strategy

| Layer | Tool | Tests |
|-------|------|-------|
| Components | Vitest + @testing-library/react | FragmentCard, QualityBadge, SlotPreview, CoverageBar rendering |
| Hooks | Vitest + MSW | TanStack Query hooks with mocked HTTP responses |
| Pages | Vitest + @testing-library/react | Login flow, fragment filtering, compose workflow |

**Test fixture:** MSW handlers returning fixture data matching the existing example-vault fragments.

**Target:** ~20-25 tests.

No E2E tests (Playwright/Cypress) for MVP — deferred to Phase 6 (Hardening).

## shadcn/ui Components Used

| Component | Where |
|-----------|-------|
| `Button` | All pages — actions, submit |
| `Input` | Login, search, context form |
| `Select` | Filters, template selection, context enums |
| `Badge` | Quality states, fragment type, lang |
| `Card` | Inventory metrics, fragment cards |
| `Sheet` | Fragment detail drawer (right panel) |
| `Dialog` | Create fragment, override slot, confirm actions |
| `Table` | Inventory gaps, fragment metadata |
| `Skeleton` | Loading states for all data |
| `Toast` | Success/error notifications |
| `DropdownMenu` | User menu in sidebar |
| `Command` | Semantic search overlay |
| `Separator` | Section dividers |

## Deliverables

1. Package `packages/web/` scaffolded (Vite + React 19 + TypeScript + Tailwind + shadcn/ui)
2. API client + TanStack Query hooks
3. AuthContext + LoginPage
4. AppLayout (sidebar navigation)
5. FragmentsPage (list + filters + search + drawer detail + actions)
6. InventoryPage (metrics + coverage bars + gaps table)
7. ComposePage (template select + context form + slot preview + compose + download)
8. ValidationPage (reviewed queue + approve/reject)
9. Fastify static serving (`@fastify/static` on `/ui`)
10. Tests (~20-25)
