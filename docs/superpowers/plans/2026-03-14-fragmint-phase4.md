# Phase 4: Frontend Web Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a React SPA with shadcn/ui served by the Core API, covering 5 views: Login, Bibliothèque, Inventaire, Compositeur, Validation.

**Architecture:** Vite + React 19 SPA in `packages/web/`. API client with TanStack Query hooks consuming the existing Fastify REST API. shadcn/ui components (Radix + Tailwind). Built to `dist/` and served by Fastify via @fastify/static on `/ui`.

**Tech Stack:** React 19, TypeScript, Vite 6, React Router 7 (library mode), TanStack Query 5, shadcn/ui, Tailwind CSS 3.4, Vitest, Testing Library, MSW

**Spec:** `docs/superpowers/specs/2026-03-14-fragmint-phase4-design.md`

---

## Chunk 1: Project Scaffolding

### Task 1: Scaffold Vite + React + TypeScript project

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/index.html`
- Create: `packages/web/vite.config.ts`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/tsconfig.app.json`
- Create: `packages/web/src/main.tsx`
- Create: `packages/web/src/App.tsx`
- Create: `packages/web/src/vite-env.d.ts`
- Modify: `pnpm-workspace.yaml` (ensure `packages/*` covers it)
- Delete: `frontend/` (old empty scaffold — move package name)

- [ ] **Step 1: Remove old frontend/ directory**

```bash
rm -rf frontend/
```

- [ ] **Step 2: Scaffold with Vite**

```bash
cd /Users/mmaudet/work/fragmint
pnpm create vite packages/web --template react-ts
```

- [ ] **Step 3: Update packages/web/package.json**

Set name to `@fragmint/web`, license to `AGPL-3.0-only`, update scripts. Keep the Vite-generated dependencies.

- [ ] **Step 4: Install dependencies**

```bash
cd packages/web
pnpm add react-router-dom @tanstack/react-query lucide-react
pnpm add -D @testing-library/react @testing-library/jest-dom jsdom msw @types/react @types/react-dom
```

- [ ] **Step 5: Configure Vite proxy**

Update `vite.config.ts`:
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: '/ui/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/v1': 'http://localhost:3210',
    },
  },
})
```

- [ ] **Step 6: Create minimal App.tsx**

```tsx
export default function App() {
  return <div>Fragmint</div>
}
```

- [ ] **Step 7: Verify dev server starts**

```bash
cd packages/web && pnpm dev
```
Open http://localhost:5173/ui/ — should show "Fragmint".

- [ ] **Step 8: Commit**

```bash
git add packages/web/ pnpm-workspace.yaml pnpm-lock.yaml
git rm -r frontend/ 2>/dev/null || true
git commit -m "feat(web): scaffold Vite + React 19 + TypeScript project"
```

### Task 2: Setup Tailwind CSS + shadcn/ui

**Files:**
- Modify: `packages/web/package.json`
- Create: `packages/web/tailwind.config.ts`
- Create: `packages/web/postcss.config.js`
- Create: `packages/web/src/index.css`
- Create: `packages/web/components.json`
- Create: `packages/web/src/lib/utils.ts`

- [ ] **Step 1: Install Tailwind and dependencies**

```bash
cd packages/web
pnpm add -D tailwindcss@3 postcss autoprefixer
npx tailwindcss init -p --ts
```

- [ ] **Step 2: Configure tailwind.config.ts**

Follow shadcn/ui installation guide for Vite: https://ui.shadcn.com/docs/installation/vite
- Configure content paths, theme extensions for shadcn
- Add CSS variables for colors matching the Fragmint mockup design system

- [ ] **Step 3: Setup src/index.css with Tailwind directives and CSS variables**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 40 6% 10%;
    --primary: 211 75% 37%;
    --primary-foreground: 0 0% 100%;
    /* ... shadcn/ui CSS variable pattern */
  }
}
```

- [ ] **Step 4: Create lib/utils.ts with cn() helper**

```typescript
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

Install: `pnpm add clsx tailwind-merge`

- [ ] **Step 5: Initialize shadcn/ui**

```bash
npx shadcn@latest init
```
Select: TypeScript, default style, CSS variables, `@/` alias.

- [ ] **Step 6: Add core shadcn components**

```bash
npx shadcn@latest add button input badge card sheet dialog table select skeleton toast dropdown-menu command separator
```

- [ ] **Step 7: Verify build works**

```bash
pnpm build
```

- [ ] **Step 8: Commit**

```bash
git add packages/web/
git commit -m "feat(web): setup Tailwind CSS + shadcn/ui components"
```

---

## Chunk 2: API Client & Auth

### Task 3: Create API client with JWT handling

**Files:**
- Create: `packages/web/src/api/client.ts`
- Create: `packages/web/src/api/types.ts`

- [ ] **Step 1: Create API types**

```typescript
// types.ts
export interface ApiResponse<T> {
  data: T | null;
  meta: { count?: number } | null;
  error: string | null;
}

export interface Fragment {
  id: string;
  type: string;
  domain: string;
  lang: string;
  quality: 'draft' | 'reviewed' | 'approved' | 'deprecated';
  author: string;
  title: string | null;
  body_excerpt: string | null;
  body?: string;
  created_at: string;
  updated_at: string;
  uses: number;
  file_path: string;
  tags?: string[];
  frontmatter?: Record<string, any>;
}

export interface Template {
  id: string;
  name: string;
  description: string | null;
  output_format: string;
  version: string;
  author: string;
  created_at: string;
  updated_at: string;
  fragments?: Array<{
    key: string;
    type: string;
    domain: string;
    lang: string;
    quality_min: string;
    required: boolean;
    fallback: string;
    count: number;
  }>;
  context_schema?: Record<string, any>;
}

export interface ComposeResponse {
  document_url: string;
  expires_at: string;
  template: { id: string; name: string; version: string };
  context: Record<string, any>;
  resolved: Array<{ key: string; fragment_id: string; score: number; quality: string }>;
  skipped: string[];
  generated: any[];
  warnings: string[];
  render_ms: number;
}

export interface User {
  login: string;
  role: string;
  display_name: string;
}

export interface InventoryResult {
  total: number;
  by_type: Record<string, number>;
  by_quality: Record<string, number>;
  by_lang: Record<string, Record<string, number>>;
  gaps: Array<{ type: string; domain: string; lang: string; status: string }>;
}

export interface GitLogEntry {
  commit: string;
  author: string;
  date: string;
  message: string;
}
```

- [ ] **Step 2: Create API client**

```typescript
// client.ts
import type { ApiResponse } from './types';

let authToken: string | null = null;

export function setToken(token: string | null) {
  authToken = token;
}

export function getToken(): string | null {
  return authToken;
}

export async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    setToken(null);
    window.location.href = '/ui/login';
    throw new Error('Session expired');
  }

  const json = (await res.json()) as ApiResponse<T>;
  if (!res.ok || json.error) {
    throw new Error(json.error ?? `HTTP ${res.status}`);
  }

  return json.data as T;
}

export async function downloadBlob(path: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const res = await fetch(path, { headers });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return res.blob();
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/api/
git commit -m "feat(web): add API client with types and JWT handling"
```

### Task 4: Create AuthContext and LoginPage

**Files:**
- Create: `packages/web/src/lib/auth-context.tsx`
- Create: `packages/web/src/pages/login.tsx`
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Create AuthContext**

```tsx
// auth-context.tsx
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { apiRequest, setToken } from '@/api/client';
import type { User } from '@/api/types';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(null);

  const login = useCallback(async (username: string, password: string) => {
    const result = await apiRequest<{ token: string; user: User }>(
      'POST', '/v1/auth/login', { username, password },
    );
    setToken(result.token);
    setTokenState(result.token);
    setUser(result.user);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setTokenState(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
```

- [ ] **Step 2: Create LoginPage**

A centered card with username + password fields + submit button using shadcn/ui components (Card, Input, Button). On submit calls `auth.login()`. On success navigates to `/ui/fragments`. Error shown via toast.

- [ ] **Step 3: Setup App.tsx with routing**

```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/lib/auth-context';
import LoginPage from '@/pages/login';

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter basename="/ui">
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<Navigate to="/fragments" replace />} />
            {/* Protected routes added in Task 5 */}
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 4: Verify login page renders**

```bash
cd packages/web && pnpm dev
```
Navigate to http://localhost:5173/ui/login — should see the login form.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/
git commit -m "feat(web): add AuthContext, LoginPage, and routing setup"
```

---

## Chunk 3: Layout & TanStack Query Hooks

### Task 5: Create AppLayout with sidebar

**Files:**
- Create: `packages/web/src/layouts/app-layout.tsx`
- Create: `packages/web/src/components/protected-route.tsx`
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Create ProtectedRoute component**

Wraps children — if `useAuth().user` is null, redirects to `/login`.

- [ ] **Step 2: Create AppLayout**

Fixed sidebar (220px) with:
- Logo/brand top
- Nav items: Bibliothèque (`/fragments`), Inventaire (`/inventory`), Compositeur (`/compose`), Validation (`/validation`)
- Active state via `useLocation()` matching
- User info + logout at bottom
- Main content area to the right (flex-1, overflow-y-auto)

Use shadcn Button for nav items, DropdownMenu for user menu, Separator.

Colors: sidebar `bg-slate-900 text-slate-300`, active item highlighted with primary color.

- [ ] **Step 3: Wire protected routes in App.tsx**

```tsx
<Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
  <Route path="/fragments" element={<FragmentsPage />} />
  <Route path="/inventory" element={<InventoryPage />} />
  <Route path="/compose" element={<ComposePage />} />
  <Route path="/validation" element={<ValidationPage />} />
</Route>
```

Use placeholder pages (`<div>Page name</div>`) for now.

- [ ] **Step 4: Verify layout renders**

Start dev server, login, see sidebar with 4 nav items. Clicking navigates between placeholder pages.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/
git commit -m "feat(web): add AppLayout with sidebar navigation and protected routes"
```

### Task 6: Create TanStack Query hooks

**Files:**
- Create: `packages/web/src/api/hooks/use-fragments.ts`
- Create: `packages/web/src/api/hooks/use-inventory.ts`
- Create: `packages/web/src/api/hooks/use-templates.ts`
- Create: `packages/web/src/api/hooks/use-compose.ts`

- [ ] **Step 1: Create fragment hooks**

```typescript
// use-fragments.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import type { Fragment, GitLogEntry } from '@/api/types';

interface FragmentFilters {
  type?: string;
  domain?: string;
  lang?: string;
  quality?: string;
  limit?: number;
  offset?: number;
}

export function useFragments(filters: FragmentFilters = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined) params.set(k, String(v));
  }
  return useQuery({
    queryKey: ['fragments', filters],
    queryFn: () => apiRequest<Fragment[]>('GET', `/v1/fragments?${params}`),
  });
}

export function useFragment(id: string | null) {
  return useQuery({
    queryKey: ['fragment', id],
    queryFn: () => apiRequest<Fragment>('GET', `/v1/fragments/${id}`),
    enabled: !!id,
  });
}

export function useFragmentHistory(id: string | null) {
  return useQuery({
    queryKey: ['fragment-history', id],
    queryFn: () => apiRequest<GitLogEntry[]>('GET', `/v1/fragments/${id}/history`),
    enabled: !!id,
  });
}

export function useSearchFragments(query: string, filters?: Record<string, any>) {
  return useQuery({
    queryKey: ['fragment-search', query, filters],
    queryFn: () => apiRequest<Fragment[]>('POST', '/v1/fragments/search', { query, filters }),
    enabled: query.length > 0,
  });
}

export function useReviewFragment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest('POST', `/v1/fragments/${id}/review`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fragments'] });
      qc.invalidateQueries({ queryKey: ['fragment'] });
    },
  });
}

export function useApproveFragment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest('POST', `/v1/fragments/${id}/approve`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fragments'] });
      qc.invalidateQueries({ queryKey: ['fragment'] });
    },
  });
}
```

- [ ] **Step 2: Create inventory, template, and compose hooks**

Similar pattern for each. `useInventory(topic?)` calls `POST /v1/fragments/inventory`. `useTemplates()` and `useTemplate(id)` call GET endpoints. `useCompose()` is a mutation calling `POST /v1/templates/:id/compose`.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/api/hooks/
git commit -m "feat(web): add TanStack Query hooks for fragments, inventory, templates, compose"
```

---

## Chunk 4: Shared Components

### Task 7: Create shared UI components

**Files:**
- Create: `packages/web/src/components/quality-badge.tsx`
- Create: `packages/web/src/components/fragment-card.tsx`
- Create: `packages/web/src/components/search-input.tsx`
- Create: `packages/web/src/components/coverage-bar.tsx`

- [ ] **Step 1: Create QualityBadge**

Maps quality → color variant:
- `approved` → green (bg-green-100 text-green-800)
- `reviewed` → amber (bg-amber-100 text-amber-800)
- `draft` → gray (bg-gray-100 text-gray-700)
- `deprecated` → red

Uses shadcn Badge with `variant="outline"` plus color classes.

- [ ] **Step 2: Create FragmentCard**

A clickable card showing: title, type/lang badges, quality badge, body excerpt (100 chars). Uses shadcn Card. Receives `fragment: Fragment` and `onClick` props.

- [ ] **Step 3: Create SearchInput**

Input with search icon (Lucide `Search`), debounced onChange (300ms). Uses shadcn Input.

- [ ] **Step 4: Create CoverageBar**

Horizontal stacked bar showing fr/en counts. Receives `{ fr: number, en: number, total: number }`. Green fill for approved ratio.

- [ ] **Step 5: Write tests for QualityBadge and FragmentCard**

Create `packages/web/src/components/__tests__/quality-badge.test.tsx` and `fragment-card.test.tsx`.

Test QualityBadge renders correct text and color class for each quality level.
Test FragmentCard renders title, badges, excerpt, and calls onClick.

```bash
cd packages/web && npx vitest run src/components/__tests__/
```

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/
git commit -m "feat(web): add shared components — QualityBadge, FragmentCard, SearchInput, CoverageBar"
```

---

## Chunk 5: FragmentsPage

### Task 8: Build FragmentsPage with list and drawer

**Files:**
- Create: `packages/web/src/pages/fragments.tsx`
- Create: `packages/web/src/components/fragment-detail.tsx`

- [ ] **Step 1: Create FragmentDetail drawer component**

Uses shadcn Sheet (side="right"). Receives `fragmentId: string | null` and `onClose`.

When open:
- Fetches full fragment via `useFragment(id)`
- Fetches history via `useFragmentHistory(id)`
- Displays: full body, metadata table (domain, tags, author, dates, uses), git history timeline
- Action buttons based on quality: "Marquer reviewed" (draft), "Approuver" (reviewed), "Modifier" (any)

- [ ] **Step 2: Create FragmentsPage**

Main layout:
- Top bar: SearchInput + "+ Nouveau" button
- Filter row: 4 Select components (type, domain, lang, quality) — populated from fragment data
- Fragment list: map `useFragments(filters)` → FragmentCard components
- Pagination: "Précédent / Suivant" buttons with page indicator (offset/limit = 20)
- On card click: open FragmentDetail drawer with the fragment's id

- [ ] **Step 3: Wire into App.tsx route**

Replace placeholder `FragmentsPage` import with actual page.

- [ ] **Step 4: Test with running server**

Start Fragmint server (`npx tsx packages/server/src/index.ts`), start frontend dev (`cd packages/web && pnpm dev`). Login, see fragment list, click to open detail drawer.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/
git commit -m "feat(web): add FragmentsPage with filter bar, search, pagination, and detail drawer"
```

---

## Chunk 6: InventoryPage

### Task 9: Build InventoryPage

**Files:**
- Create: `packages/web/src/pages/inventory.tsx`

- [ ] **Step 1: Implement InventoryPage**

Layout:
- Top metrics row (4 Cards): total count, approved count, reviewed count, draft count — with QualityBadge
- Coverage section: for each domain, a CoverageBar showing fr/en distribution
- Gaps table (shadcn Table): columns type, domain, lang, status. Each row clickable → navigate to `/fragments?type=X&domain=Y&lang=Z`

Data from `useInventory()`.

- [ ] **Step 2: Wire into route**

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/inventory.tsx
git commit -m "feat(web): add InventoryPage with metrics, coverage bars, and gaps table"
```

---

## Chunk 7: ComposePage

### Task 10: Build ComposePage with slot preview

**Files:**
- Create: `packages/web/src/pages/compose.tsx`
- Create: `packages/web/src/components/slot-preview.tsx`

- [ ] **Step 1: Create SlotPreview component**

Displays a single template slot's resolution status:
- Props: `slot` definition, `resolved: Fragment | null`, `onOverride: () => void`
- Green state: fragment found — show title, quality badge, score
- Red state: no match — show "Aucun fragment" with fallback label (skip/error)
- Clickable: opens override dialog

- [ ] **Step 2: Create ComposePage**

4-step wizard layout:

**Step 1 — Template Select:** shadcn Select populated from `useTemplates()`. On change, loads template detail via `useTemplate(id)`.

**Step 2 — Context Form:** Dynamically generated from `template.context_schema`. For each field: Input (string/date), Select (enum). Required fields marked with asterisk. Defaults pre-filled.

**Step 3 — Slot Preview:** For each slot in `template.fragments`, resolve context vars in lang/domain, search via `useSearchFragments(slot.key, {type, domain, lang})`, display SlotPreview. Override dialog: Command component for searching + selecting a specific fragment.

**Step 4 — Compose:** Button "Composer" (disabled if required slots unresolved). On click: `useCompose()` mutation. Loading spinner. On success: show report (Card with resolved/skipped/warnings/render_ms) + download button. Download: fetch blob from `document_url`, create object URL, trigger download.

- [ ] **Step 3: Wire into route**

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/
git commit -m "feat(web): add ComposePage with template selection, context form, slot preview, and document download"
```

---

## Chunk 8: ValidationPage

### Task 11: Build ValidationPage

**Files:**
- Create: `packages/web/src/pages/validation.tsx`

- [ ] **Step 1: Implement ValidationPage**

Layout:
- List of fragments with quality `reviewed` (from `useFragments({ quality: 'reviewed' })`)
- Each item: FragmentCard
- On click: opens FragmentDetail drawer in validation mode
  - Shows diff if available: fetch history, if ≥2 commits call diff endpoint, display inline diff
  - Actions: "Lire" (navigate to `/fragments` with drawer open), "Approuver" (mutation), "Demander modification" (toast)

- [ ] **Step 2: Wire into route**

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/validation.tsx
git commit -m "feat(web): add ValidationPage with review queue and approve/reject actions"
```

---

## Chunk 9: Server Wiring & Tests

### Task 12: Wire frontend into Fastify server

**Files:**
- Modify: `packages/server/package.json` (add @fastify/static)
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Install @fastify/static**

```bash
cd packages/server && pnpm add @fastify/static
```

- [ ] **Step 2: Add static file serving to index.ts**

After all API routes, register @fastify/static:
```typescript
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';

await app.register(fastifyStatic, {
  root: resolve(import.meta.dirname, '../../web/dist'),
  prefix: '/ui/',
  decorateReply: false,
});

// SPA fallback
app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/ui')) {
    return reply.sendFile('index.html', resolve(import.meta.dirname, '../../web/dist'));
  }
  reply.status(404).send({ data: null, meta: null, error: 'Not found' });
});
```

- [ ] **Step 3: Build frontend and test served from Fastify**

```bash
cd packages/web && pnpm build
cd ../server && npx tsx src/index.ts
```
Open http://localhost:3210/ui/ — should see the Fragmint login page.

- [ ] **Step 4: Commit**

```bash
git add packages/server/
git commit -m "feat(server): serve frontend via @fastify/static on /ui"
```

### Task 13: Write frontend tests

**Files:**
- Create: `packages/web/src/components/__tests__/quality-badge.test.tsx` (if not already from Task 7)
- Create: `packages/web/src/components/__tests__/fragment-card.test.tsx`
- Create: `packages/web/src/components/__tests__/slot-preview.test.tsx`
- Create: `packages/web/src/api/hooks/__tests__/use-fragments.test.tsx`
- Create: `packages/web/src/pages/__tests__/login.test.tsx`
- Create: `packages/web/src/test-setup.ts`
- Create: `packages/web/src/mocks/handlers.ts`
- Create: `packages/web/src/mocks/server.ts`

- [ ] **Step 1: Setup test infrastructure**

Create MSW handlers returning fixture data for:
- `POST /v1/auth/login` → `{ token: 'test-jwt', user: { login: 'mmaudet', role: 'admin', display_name: 'Michel-Marie' } }`
- `GET /v1/fragments` → array of 3 fixture fragments
- `GET /v1/fragments/:id` → single fragment with body
- `POST /v1/fragments/search` → array of results
- `POST /v1/fragments/inventory` → inventory result
- `GET /v1/templates` → array of 1 template

Create `test-setup.ts` with Testing Library jest-dom matchers and MSW server lifecycle.

Configure vitest in `vite.config.ts`:
```typescript
test: {
  globals: true,
  environment: 'jsdom',
  setupFiles: './src/test-setup.ts',
}
```

- [ ] **Step 2: Write component tests**

- QualityBadge: renders correct text and variant for each quality
- FragmentCard: renders title, badges, excerpt; calls onClick
- SlotPreview: renders green state (resolved) and red state (missing)

- [ ] **Step 3: Write hook test**

- useFragments: returns data from API, handles loading state

- [ ] **Step 4: Write login page test**

- Renders form, submits credentials, redirects on success

- [ ] **Step 5: Run all frontend tests**

```bash
cd packages/web && npx vitest run
```
Expected: ~20 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/
git commit -m "test(web): add component, hook, and page tests with MSW fixtures"
```

### Task 14: Run full test suite (server + frontend)

- [ ] **Step 1: Run server tests**

```bash
cd packages/server && npx vitest run
```
Expected: 96 tests pass.

- [ ] **Step 2: Run frontend tests**

```bash
cd packages/web && npx vitest run
```
Expected: ~20 tests pass.

- [ ] **Step 3: Fix any failures**

---

## Task Dependencies

```
Task 1 (scaffold) → Task 2 (tailwind + shadcn)
Task 2 → Task 3 (API client)
Task 3 → Task 4 (auth + login)
Task 4 → Task 5 (layout + routing)
Task 5 → Task 6 (hooks)
Task 2 → Task 7 (shared components)
Task 5 + Task 6 + Task 7 → Task 8 (FragmentsPage)
Task 6 + Task 7 → Task 9 (InventoryPage)
Task 6 + Task 7 → Task 10 (ComposePage)
Task 6 + Task 7 → Task 11 (ValidationPage)
Task 8-11 → Task 12 (server wiring)
Task 8-11 → Task 13 (tests)
Task 12 + Task 13 → Task 14 (full suite)
```
