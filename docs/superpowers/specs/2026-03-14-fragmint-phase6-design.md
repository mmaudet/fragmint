# Fragmint Phase 6 — Hardening & Multilingual

**Date:** 2026-03-14
**Phase:** 6 of 9
**Duration:** 2 weeks
**Status:** Design approved

## Scope

Harden the application for deployment: security headers, rate limiting, Docker containerisation, i18n (FR/EN), dark mode, and E2E tests covering critical user paths.

### In scope

- Security: rate limiting, CORS strict, Helmet headers
- Docker: Dockerfile + docker-compose (fragmint + milvus + ollama)
- i18n: constants file FR/EN with hook and language toggle
- Dark mode: Tailwind `dark` class with toggle and localStorage persistence
- E2E tests: 5 Playwright tests covering critical paths

### Out of scope

- UX fixes (deferred to a dedicated pass)
- Responsive/mobile layout (backlog)
- CI/CD pipeline (backlog)
- Production TLS/nginx reverse proxy (future)

## Security

### Rate limiting

Install `@fastify/rate-limit`. Configure per-route limits:

| Scope | Limit | Window |
|-------|-------|--------|
| `POST /v1/auth/login` | 5 requests | 1 minute per IP |
| All other endpoints | 100 requests | 1 minute per IP |

Register as a global plugin with the default limit, then override on the login route.

### CORS

Replace permissive `@fastify/cors` config with strict origin control:

```typescript
await app.register(fastifyCors, {
  origin: config.cors_origin ?? ['http://localhost:3210', 'http://localhost:5173'],
  credentials: true,
});
```

Add `FRAGMINT_CORS_ORIGIN` env var (comma-separated list of allowed origins).

### Security headers

Install `@fastify/helmet` with sensible defaults:

```typescript
await app.register(fastifyHelmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],  // needed for Tailwind
      imgSrc: ["'self'", 'data:'],
    },
  },
});
```

### Config changes

Add to `packages/server/src/config.ts`:
- `cors_origin`: `string[]` (from `FRAGMINT_CORS_ORIGIN`, default `['http://localhost:3210', 'http://localhost:5173']`)

## Docker

### Dockerfile

Location: `Dockerfile` (project root)

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile
COPY packages/server/ packages/server/
COPY packages/web/ packages/web/
RUN pnpm --filter @fragmint/web build

FROM node:20-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile --prod
COPY packages/server/ packages/server/
COPY --from=builder /app/packages/web/dist packages/web/dist
EXPOSE 3210
CMD ["node", "--import", "tsx", "packages/server/src/index.ts"]
```

Note: Uses `tsx` for TypeScript execution at runtime. Alternative: compile server to JS in builder stage.

### docker-compose.yml

Location: `docker-compose.yml` (project root)

```yaml
services:
  fragmint:
    build: .
    ports:
      - "3210:3210"
    volumes:
      - ./data/vault:/data/vault
    environment:
      NODE_ENV: production
      FRAGMINT_STORE_PATH: /data/vault
      FRAGMINT_JWT_SECRET: ${JWT_SECRET:-changeme-in-production}
      FRAGMINT_MILVUS_ENABLED: "true"
      FRAGMINT_MILVUS_ADDRESS: milvus:19530
      FRAGMINT_EMBEDDING_ENDPOINT: http://ollama:11434
      FRAGMINT_CORS_ORIGIN: http://localhost:3210
    depends_on:
      - milvus
      - ollama

  milvus:
    image: milvusdb/milvus:v2.4-latest
    ports:
      - "19530:19530"
    volumes:
      - milvus-data:/var/lib/milvus

  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ollama-data:/root/.ollama

volumes:
  milvus-data:
  ollama-data:
```

### .dockerignore

```
node_modules
.git
*.md
packages/web/dist
packages/web/node_modules
packages/server/node_modules
.superpowers
docs
```

### Air-gap deployment

For air-gap environments:
1. `docker save fragmint milvusdb/milvus:v2.4-latest ollama/ollama:latest > fragmint-stack.tar`
2. Transfer tar to target machine
3. `docker load < fragmint-stack.tar`
4. Pre-load Ollama model: `docker compose run ollama ollama pull nomic-embed-text-v2-moe`
5. `docker compose up -d`

## i18n

### Architecture

Single constants file approach — no external i18n library.

**Files:**
- `packages/web/src/lib/i18n.ts` — translations object + I18nContext + useI18n hook
- Modify: sidebar to add language toggle

### Translation file structure

```typescript
type Lang = 'fr' | 'en';

const translations: Record<Lang, Record<string, Record<string, string>>> = {
  fr: {
    common: {
      search: 'Rechercher...',
      approve: 'Approuver',
      review: 'Marquer reviewed',
      modify: 'Modifier',
      cancel: 'Annuler',
      save: 'Enregistrer',
      delete: 'Supprimer',
      download: 'Télécharger',
      loading: 'Chargement...',
      noResults: 'Aucun résultat',
      previous: 'Précédent',
      next: 'Suivant',
      page: 'Page',
      logout: 'Déconnexion',
    },
    login: {
      title: 'Fragmint',
      username: "Nom d'utilisateur",
      password: 'Mot de passe',
      submit: 'Se connecter',
      connecting: 'Connexion...',
      error: 'Échec de connexion',
    },
    fragments: {
      title: 'Bibliothèque',
      new: '+ Nouveau',
      noFragments: 'Aucun fragment trouvé',
      noTitle: 'Sans titre',
      allTypes: 'Tous les types',
      allQualities: 'Toutes les qualités',
      allLanguages: 'Toutes les langues',
      content: 'Contenu',
      metadata: 'Métadonnées',
      history: 'Historique',
      author: 'Auteur',
      domain: 'Domaine',
      type: 'Type',
      language: 'Langue',
      createdAt: 'Créé le',
      updatedAt: 'Mis à jour',
    },
    inventory: {
      title: 'Inventaire',
      total: 'Total fragments',
      coverage: 'Couverture par domaine',
      gaps: 'Lacunes détectées',
      noGaps: 'Aucune lacune détectée',
    },
    compose: {
      title: 'Compositeur',
      selectTemplate: 'Choix du template',
      choosePlaceholder: 'Choisir un template...',
      context: 'Contexte',
      contextDesc: 'Renseignez les variables de contexte',
      slots: 'Slots du template',
      slotsDesc: 'Fragments résolus pour chaque slot',
      composeBtn: 'Composer le document',
      composing: 'Composition en cours...',
      done: 'Composition terminée',
      resolved: 'Fragments résolus',
      skipped: 'Slots ignorés',
      warnings: 'Avertissements',
      noFragment: 'Aucun fragment',
      requiredSlots: 'Tous les slots requis doivent avoir au moins un fragment.',
    },
    validation: {
      title: 'Validation',
      subtitle: "Fragments en attente d'approbation",
      noQueue: 'Aucun fragment en attente de validation',
      read: 'Lire',
      requestChange: 'Demander modification',
      approved: 'Fragment approuvé',
      changeRequested: 'Demande de modification envoyée',
      approveError: "Erreur lors de l'approbation",
    },
  },
  en: {
    common: {
      search: 'Search...',
      approve: 'Approve',
      review: 'Mark reviewed',
      modify: 'Edit',
      cancel: 'Cancel',
      save: 'Save',
      delete: 'Delete',
      download: 'Download',
      loading: 'Loading...',
      noResults: 'No results',
      previous: 'Previous',
      next: 'Next',
      page: 'Page',
      logout: 'Sign out',
    },
    login: {
      title: 'Fragmint',
      username: 'Username',
      password: 'Password',
      submit: 'Sign in',
      connecting: 'Signing in...',
      error: 'Login failed',
    },
    fragments: {
      title: 'Library',
      new: '+ New',
      noFragments: 'No fragments found',
      noTitle: 'Untitled',
      allTypes: 'All types',
      allQualities: 'All qualities',
      allLanguages: 'All languages',
      content: 'Content',
      metadata: 'Metadata',
      history: 'History',
      author: 'Author',
      domain: 'Domain',
      type: 'Type',
      language: 'Language',
      createdAt: 'Created',
      updatedAt: 'Updated',
    },
    inventory: {
      title: 'Inventory',
      total: 'Total fragments',
      coverage: 'Coverage by domain',
      gaps: 'Detected gaps',
      noGaps: 'No gaps detected',
    },
    compose: {
      title: 'Composer',
      selectTemplate: 'Template selection',
      choosePlaceholder: 'Choose a template...',
      context: 'Context',
      contextDesc: 'Fill in the context variables',
      slots: 'Template slots',
      slotsDesc: 'Resolved fragments for each slot',
      composeBtn: 'Compose document',
      composing: 'Composing...',
      done: 'Composition complete',
      resolved: 'Resolved fragments',
      skipped: 'Skipped slots',
      warnings: 'Warnings',
      noFragment: 'No fragment',
      requiredSlots: 'All required slots must have at least one fragment.',
    },
    validation: {
      title: 'Validation',
      subtitle: 'Fragments awaiting approval',
      noQueue: 'No fragments awaiting validation',
      read: 'Read',
      requestChange: 'Request changes',
      approved: 'Fragment approved',
      changeRequested: 'Change request sent',
      approveError: 'Error approving fragment',
    },
  },
};
```

### Hook

```typescript
const I18nContext = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (section: string, key: string) => string }>(...);

export function useI18n() {
  return useContext(I18nContext);
}
```

`t('fragments', 'title')` returns `'Bibliothèque'` or `'Library'` depending on current lang.

Language preference stored in `localStorage` key `fragmint-lang`. Default: `fr`.

### Sidebar integration

Add a language toggle button (FR/EN) next to the theme toggle in the sidebar footer.

## Dark Mode

### CSS variables

Add to `packages/web/src/index.css`:

```css
@layer base {
  .dark {
    --background: 220 13% 10%;
    --foreground: 40 6% 90%;
    --card: 220 13% 12%;
    --card-foreground: 40 6% 90%;
    --popover: 220 13% 12%;
    --popover-foreground: 40 6% 90%;
    --primary: 211 75% 50%;
    --primary-foreground: 0 0% 100%;
    --secondary: 220 13% 18%;
    --secondary-foreground: 40 6% 80%;
    --muted: 220 13% 18%;
    --muted-foreground: 40 6% 55%;
    --accent: 220 13% 18%;
    --accent-foreground: 40 6% 80%;
    --destructive: 0 62% 55%;
    --destructive-foreground: 0 0% 100%;
    --border: 220 13% 20%;
    --input: 220 13% 20%;
    --ring: 211 75% 50%;
  }
}
```

### ThemeToggle component

`packages/web/src/components/theme-toggle.tsx`:
- Button with Sun/Moon icon (Lucide)
- Reads initial state from localStorage `fragmint-theme` or `prefers-color-scheme`
- On click: toggles `dark` class on `<html>`, saves to localStorage
- Placed in sidebar footer, next to language toggle

## Tests E2E

### Setup

- Install `@playwright/test` in `packages/web/`
- `packages/web/playwright.config.ts` with:
  - `baseURL: 'http://localhost:3210/ui'`
  - `webServer`: starts fragmint server before tests (`npx tsx packages/server/src/index.ts`)
  - Browser: chromium only for speed
  - Timeout: 30s per test

### 5 test files

**`packages/web/e2e/login.spec.ts`:**
- Navigate to `/login`
- Fill username `mmaudet`, password `fragmint-dev`
- Click submit
- Expect redirect to `/fragments`
- Expect sidebar visible with "Bibliothèque" active

**`packages/web/e2e/fragments.spec.ts`:**
- Login first (helper)
- Expect fragment list with at least 1 card
- Click first card
- Expect drawer opens with fragment title visible
- Close drawer

**`packages/web/e2e/inventory.spec.ts`:**
- Login first
- Navigate to `/inventory`
- Expect "Total fragments" metric card visible with a number > 0
- Expect gaps table visible

**`packages/web/e2e/compose.spec.ts`:**
- Login first
- Navigate to `/compose`
- Select template from dropdown
- Fill required context fields
- Click "Composer le document"
- Expect composition report visible with "Composition terminée"
- Expect download button visible

**`packages/web/e2e/validation.spec.ts`:**
- Login first
- Navigate to `/validation`
- If reviewed fragments exist: click first, expect drawer with "Approuver" button

### Login helper

```typescript
async function login(page: Page) {
  await page.goto('/login');
  await page.fill('input[placeholder*="utilisateur"]', 'mmaudet');
  await page.fill('input[type="password"]', 'fragmint-dev');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/fragments');
}
```

## Files Summary

### Create
- `Dockerfile`
- `docker-compose.yml`
- `.dockerignore`
- `packages/web/src/lib/i18n.ts`
- `packages/web/src/components/theme-toggle.tsx`
- `packages/web/playwright.config.ts`
- `packages/web/e2e/login.spec.ts`
- `packages/web/e2e/fragments.spec.ts`
- `packages/web/e2e/inventory.spec.ts`
- `packages/web/e2e/compose.spec.ts`
- `packages/web/e2e/validation.spec.ts`

### Modify
- `packages/server/package.json` (add @fastify/rate-limit, @fastify/helmet)
- `packages/server/src/index.ts` (register rate-limit, helmet, CORS config)
- `packages/server/src/config.ts` (add cors_origin)
- `packages/web/src/index.css` (add .dark CSS variables)
- `packages/web/src/layouts/app-layout.tsx` (add ThemeToggle + language toggle)
- `packages/web/src/App.tsx` (wrap with I18nProvider)
- `packages/web/package.json` (add @playwright/test)
- All 5 page files (replace hardcoded strings with `t()` calls)

## Deliverables

1. Security: @fastify/rate-limit + @fastify/helmet + CORS strict
2. Docker: Dockerfile + docker-compose.yml + .dockerignore
3. i18n: translations FR/EN + useI18n hook + language toggle
4. Dark mode: CSS variables + ThemeToggle + localStorage
5. E2E tests: 5 Playwright tests covering critical paths
6. Target: ~121 tests total (116 existing + 5 E2E)
