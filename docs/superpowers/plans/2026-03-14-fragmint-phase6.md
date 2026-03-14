# Phase 6: Hardening & Multilingual Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Fragmint for deployment with security, Docker, i18n (FR/EN), dark mode, and E2E tests.

**Architecture:** 4 independent workstreams: server security (rate-limit + helmet + CORS), Docker (Dockerfile + compose), frontend i18n + dark mode, and Playwright E2E tests. Each can be implemented and tested independently.

**Tech Stack:** @fastify/rate-limit, @fastify/helmet, Docker + Compose, Playwright, Tailwind dark mode

**Spec:** `docs/superpowers/specs/2026-03-14-fragmint-phase6-design.md`

---

## Chunk 1: Server Security

### Task 1: Add rate limiting, Helmet, and strict CORS

**Files:**
- Modify: `packages/server/package.json`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/config.ts` (if it exists, otherwise modify config loading in index.ts)

- [ ] **Step 1: Install security dependencies**

```bash
cd /Users/mmaudet/work/fragmint/packages/server
pnpm add @fastify/rate-limit @fastify/helmet
```

- [ ] **Step 2: Read existing server setup**

Read `packages/server/src/index.ts` to understand:
- Where plugins are registered (after Fastify creation)
- How config is loaded (loadConfig or env vars)
- Where CORS is registered

Read `packages/server/src/config.ts` (if exists) to understand config structure.

- [ ] **Step 3: Add config for CORS origins**

Add `cors_origin` to config loading. Read from `FRAGMINT_CORS_ORIGIN` env var (comma-separated). Default: `['http://localhost:3210', 'http://localhost:5173']`.

- [ ] **Step 4: Register @fastify/helmet**

After CORS registration in index.ts, add:

```typescript
import fastifyHelmet from '@fastify/helmet';

await app.register(fastifyHelmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
    },
  },
});
```

- [ ] **Step 5: Register @fastify/rate-limit**

```typescript
import fastifyRateLimit from '@fastify/rate-limit';

await app.register(fastifyRateLimit, {
  max: 100,
  timeWindow: '1 minute',
});
```

Then on the login route, add route-level override:

```typescript
app.post('/v1/auth/login', {
  config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
}, async (request, reply) => { ... });
```

Note: Read the existing auth-routes.ts to see how login is registered. You may need to pass the rate limit config into the route registration function. The exact approach depends on whether auth routes use the inline handler or a separate function.

- [ ] **Step 6: Update CORS config**

Replace the existing permissive CORS with:

```typescript
await app.register(fastifyCors, {
  origin: config.cors_origin ?? ['http://localhost:3210', 'http://localhost:5173'],
  credentials: true,
});
```

- [ ] **Step 7: Verify server starts and existing tests pass**

```bash
cd /Users/mmaudet/work/fragmint/packages/server && npx vitest run
```
Expected: All 96 tests pass.

Also verify the server starts:
```bash
npx tsx src/index.ts &
sleep 3
curl -s http://localhost:3210/v1/fragments -H "Authorization: Bearer test" | head -1
kill %1
```

- [ ] **Step 8: Commit**

```bash
git add packages/server/
git commit -m "feat(server): add rate limiting, Helmet security headers, and strict CORS"
```

---

## Chunk 2: Docker

### Task 2: Create Dockerfile and docker-compose.yml

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`

- [ ] **Step 1: Create .dockerignore**

```
node_modules
.git
*.md
packages/web/dist
packages/web/node_modules
packages/server/node_modules
.superpowers
docs
data
e2e
```

- [ ] **Step 2: Create Dockerfile**

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install dependencies first (cache layer)
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile

# Copy source and build frontend
COPY packages/server/ packages/server/
COPY packages/web/ packages/web/
RUN pnpm --filter @fragmint/web build

# Production image
FROM node:20-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile --prod

COPY packages/server/ packages/server/
COPY --from=builder /app/packages/web/dist packages/web/dist

# Create vault directory
RUN mkdir -p /data/vault

EXPOSE 3210
ENV NODE_ENV=production
ENV FRAGMINT_STORE_PATH=/data/vault

CMD ["npx", "tsx", "packages/server/src/index.ts"]
```

- [ ] **Step 3: Create docker-compose.yml**

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

- [ ] **Step 4: Verify Docker build works**

```bash
docker build -t fragmint:dev .
```
Expected: Build succeeds (may take a few minutes first time).

Note: Don't test docker compose up (requires Milvus/Ollama images which are large). Just verify the Dockerfile builds.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml .dockerignore
git commit -m "feat(docker): add Dockerfile and docker-compose for deployment"
```

---

## Chunk 3: i18n + Dark Mode

### Task 3: Implement i18n system

**Files:**
- Create: `packages/web/src/lib/i18n.tsx`

- [ ] **Step 1: Create i18n.tsx with translations, context, and hook**

The file should export:
- `type Lang = 'fr' | 'en'`
- `translations` object with all FR and EN strings (copy from spec)
- `I18nProvider` component that wraps children with context, reads localStorage `fragmint-lang` for initial value
- `useI18n()` hook returning `{ lang, setLang, t }` where `t(section, key)` returns the translated string

```typescript
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export type Lang = 'fr' | 'en';

const translations: Record<Lang, Record<string, Record<string, string>>> = {
  fr: {
    common: {
      search: 'Rechercher...',
      approve: 'Approuver',
      review: 'Marquer reviewed',
      modify: 'Modifier',
      cancel: 'Annuler',
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
    nav: {
      library: 'Bibliothèque',
      inventory: 'Inventaire',
      composer: 'Compositeur',
      validation: 'Validation',
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
      allLanguages: 'Toutes langues',
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
    nav: {
      library: 'Library',
      inventory: 'Inventory',
      composer: 'Composer',
      validation: 'Validation',
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
      allLanguages: 'All languages',
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

interface I18nContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (section: string, key: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const stored = localStorage.getItem('fragmint-lang');
    return (stored === 'en' ? 'en' : 'fr') as Lang;
  });

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    localStorage.setItem('fragmint-lang', l);
  }, []);

  const t = useCallback((section: string, key: string): string => {
    return translations[lang]?.[section]?.[key] ?? key;
  }, [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
```

- [ ] **Step 2: Wrap App with I18nProvider**

In `packages/web/src/App.tsx`, import `I18nProvider` and wrap inside `AuthProvider`:
```tsx
<AuthProvider>
  <I18nProvider>
    <BrowserRouter ...>
```

- [ ] **Step 3: Replace hardcoded strings in all 5 pages + layout**

For each page file (login.tsx, fragments.tsx, inventory.tsx, compose.tsx, validation.tsx) and app-layout.tsx:
- Add `const { t } = useI18n()` at the top of the component
- Replace hardcoded French strings with `t('section', 'key')` calls
- Example: `"Bibliothèque"` → `t('fragments', 'title')`, `"Rechercher..."` → `t('common', 'search')`

This is mechanical work — go file by file. Don't change logic, only strings.

- [ ] **Step 4: Add language toggle to sidebar**

In `packages/web/src/layouts/app-layout.tsx`, add a FR/EN toggle button in the sidebar footer (next to user dropdown). Use `useI18n()` to get `lang` and `setLang`. Render as two small buttons or a dropdown.

- [ ] **Step 5: Verify build + existing tests pass**

```bash
cd /Users/mmaudet/work/fragmint/packages/web
npx vitest run
pnpm build
```

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/
git commit -m "feat(web): add i18n system with FR/EN translations and language toggle"
```

### Task 4: Implement dark mode

**Files:**
- Modify: `packages/web/src/index.css`
- Create: `packages/web/src/components/theme-toggle.tsx`
- Modify: `packages/web/src/layouts/app-layout.tsx`

- [ ] **Step 1: Add dark CSS variables to index.css**

Add after the existing `:root` block:

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

- [ ] **Step 2: Create ThemeToggle component**

```tsx
// packages/web/src/components/theme-toggle.tsx
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Sun, Moon } from 'lucide-react';

export function ThemeToggle() {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('fragmint-theme');
    if (stored) return stored === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('fragmint-theme', dark ? 'dark' : 'light');
  }, [dark]);

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setDark(d => !d)}
      className="h-8 w-8 text-slate-300 hover:text-white hover:bg-slate-800"
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
```

- [ ] **Step 3: Add ThemeToggle to sidebar footer**

In `packages/web/src/layouts/app-layout.tsx`, import and place `ThemeToggle` in the sidebar footer area, next to the language toggle.

- [ ] **Step 4: Verify dark mode works**

```bash
pnpm build
```
Then test visually: toggle should switch between light and dark themes.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/
git commit -m "feat(web): add dark mode with ThemeToggle and CSS variables"
```

---

## Chunk 4: E2E Tests

### Task 5: Setup Playwright and write E2E tests

**Files:**
- Modify: `packages/web/package.json`
- Create: `packages/web/playwright.config.ts`
- Create: `packages/web/e2e/login.spec.ts`
- Create: `packages/web/e2e/fragments.spec.ts`
- Create: `packages/web/e2e/inventory.spec.ts`
- Create: `packages/web/e2e/compose.spec.ts`
- Create: `packages/web/e2e/validation.spec.ts`
- Create: `packages/web/e2e/helpers.ts`

- [ ] **Step 1: Install Playwright**

```bash
cd /Users/mmaudet/work/fragmint/packages/web
pnpm add -D @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: Create playwright.config.ts**

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:3210/ui',
    headless: true,
  },
  webServer: {
    command: 'cd ../.. && npx tsx packages/server/src/index.ts',
    port: 3210,
    reuseExistingServer: true,
    timeout: 15000,
  },
});
```

- [ ] **Step 3: Create login helper**

```typescript
// e2e/helpers.ts
import type { Page } from '@playwright/test';

export async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder(/utilisateur|username/i).fill('mmaudet');
  await page.getByPlaceholder(/mot de passe|password/i).fill('fragmint-dev');
  await page.getByRole('button', { name: /connecter|sign in/i }).click();
  await page.waitForURL('**/fragments');
}
```

- [ ] **Step 4: Write login.spec.ts**

```typescript
import { test, expect } from '@playwright/test';

test('login and redirect to fragments', async ({ page }) => {
  await page.goto('/login');
  await page.getByPlaceholder(/utilisateur|username/i).fill('mmaudet');
  await page.getByPlaceholder(/mot de passe|password/i).fill('fragmint-dev');
  await page.getByRole('button', { name: /connecter|sign in/i }).click();
  await page.waitForURL('**/fragments');
  await expect(page.locator('nav')).toBeVisible();
});
```

- [ ] **Step 5: Write fragments.spec.ts**

```typescript
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('view fragments and open detail', async ({ page }) => {
  await login(page);
  // Wait for fragment list to load
  await expect(page.locator('[data-testid="fragment-card"]').or(page.getByText(/introduction|argument|pricing/i)).first()).toBeVisible({ timeout: 10000 });
  // Click first fragment card
  await page.locator('[data-testid="fragment-card"]').first().or(page.getByText(/introduction souveraineté/i)).first().click();
  // Expect detail drawer/sheet to appear
  await expect(page.getByText(/contenu|content|métadonnées|metadata/i).first()).toBeVisible({ timeout: 5000 });
});
```

Note: The selectors depend on how FragmentCard and FragmentDetail are structured. Read the actual component code and adjust selectors. Use `data-testid` attributes if text-based selectors are fragile. You may need to add `data-testid="fragment-card"` to FragmentCard component.

- [ ] **Step 6: Write inventory.spec.ts**

```typescript
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('view inventory metrics and gaps', async ({ page }) => {
  await login(page);
  await page.getByText(/inventaire|inventory/i).first().click();
  await page.waitForURL('**/inventory');
  // Expect metrics to be visible
  await expect(page.getByText(/total fragments/i)).toBeVisible({ timeout: 10000 });
  // Expect gaps table
  await expect(page.getByText(/lacunes|gaps/i).first()).toBeVisible();
});
```

- [ ] **Step 7: Write compose.spec.ts**

```typescript
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('compose a document', async ({ page }) => {
  await login(page);
  await page.getByText(/compositeur|composer/i).first().click();
  await page.waitForURL('**/compose');

  // Select template — click the select trigger, then pick the first option
  await page.getByRole('combobox').first().click();
  await page.getByRole('option').first().click();

  // Wait for context form to appear and fill required fields
  // This depends on the template's context_schema
  await page.waitForTimeout(1000);

  // Fill any visible text inputs (product, client)
  const inputs = page.locator('input[type="text"]');
  const count = await inputs.count();
  for (let i = 0; i < count; i++) {
    const val = await inputs.nth(i).inputValue();
    if (!val) await inputs.nth(i).fill('test');
  }

  // Select any visible select dropdowns (lang)
  const selects = page.getByRole('combobox');
  const selectCount = await selects.count();
  for (let i = 1; i < selectCount; i++) { // skip first (template)
    await selects.nth(i).click();
    const firstOption = page.getByRole('option').first();
    if (await firstOption.isVisible()) await firstOption.click();
  }

  // Click compose
  await page.getByRole('button', { name: /composer|compose/i }).click();

  // Wait for result
  await expect(page.getByText(/terminée|complete/i).first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: /télécharger|download/i })).toBeVisible();
});
```

- [ ] **Step 8: Write validation.spec.ts**

```typescript
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('view validation queue', async ({ page }) => {
  await login(page);
  await page.getByText(/validation/i).first().click();
  await page.waitForURL('**/validation');
  // Page should load without error — either fragments or empty message
  await expect(
    page.getByText(/attente|awaiting/i).first()
      .or(page.getByText(/aucun fragment/i).first())
  ).toBeVisible({ timeout: 10000 });
});
```

- [ ] **Step 9: Add e2e script to package.json**

Add to `packages/web/package.json` scripts:
```json
"e2e": "playwright test"
```

- [ ] **Step 10: Build frontend first, then run E2E tests**

The E2E tests need the frontend built (served by Fastify from dist/):
```bash
cd /Users/mmaudet/work/fragmint/packages/web
pnpm build
npx playwright test
```

Note: If the server is already running on port 3210, Playwright will reuse it (reuseExistingServer: true). If not, the webServer config will start it.

Fix any failing tests by adjusting selectors. E2E tests may need `data-testid` attributes added to components.

Expected: 5 tests pass.

- [ ] **Step 11: Commit**

```bash
git add packages/web/
git commit -m "test(web): add 5 Playwright E2E tests covering critical paths"
```

---

## Chunk 5: Final Verification

### Task 6: Run all tests and verify

- [ ] **Step 1: Run server tests**

```bash
cd /Users/mmaudet/work/fragmint/packages/server && npx vitest run
```
Expected: 96 tests pass.

- [ ] **Step 2: Run frontend unit tests**

```bash
cd /Users/mmaudet/work/fragmint/packages/web && npx vitest run
```
Expected: 20 tests pass.

- [ ] **Step 3: Build and run E2E tests**

```bash
cd /Users/mmaudet/work/fragmint/packages/web
pnpm build
npx playwright test
```
Expected: 5 tests pass.

- [ ] **Step 4: Verify Docker build**

```bash
cd /Users/mmaudet/work/fragmint && docker build -t fragmint:dev .
```
Expected: Build succeeds.

---

## Task Dependencies

```
Task 1 (security) — independent
Task 2 (docker) — independent
Task 3 (i18n) — independent
Task 4 (dark mode) — after Task 3 (shares sidebar modifications)
Task 5 (E2E) — after Tasks 3+4 (tests see i18n strings)
Task 6 (verification) — after all
```

Tasks 1, 2, and 3 can run in parallel.
Task 4 after Task 3 (both modify sidebar).
Task 5 after Task 4 (E2E tests need final UI).
Task 6 after all.
