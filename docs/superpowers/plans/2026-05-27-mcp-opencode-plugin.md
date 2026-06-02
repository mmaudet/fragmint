# MCP Server + Plugin OpenCode (Fragmint Piste A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exposer Fragmint comme un serveur MCP avec 7 skills workflow-level (`fragmint_list_collections`, `fragmint_get_index`, `fragmint_search_fragments`, `fragmint_generate_plan`, `fragmint_compose_section`, `fragmint_generate_document`, `fragmint_sync_cache`, `fragmint_upload_context_doc`) + créer un plugin OpenCode avec cache local SQLite et commande `/fragmint compose`.

**Architecture:** Nouveau package `packages/mcp-server/` — appelle le backend Fragmint via HTTP (pattern identique à `packages/mcp/`). Nouveau package `packages/opencode-plugin/` — cache SQLite `~/.fragmint/cache.db` + `FragmintMCPClient` + commandes slash. Le serveur backend reçoit des endpoints supplémentaires pour sync-cache et context-docs.

**Tech Stack:** Node.js 20, TypeScript, `@modelcontextprotocol/sdk`, `better-sqlite3`, `mammoth` (docx), `pdf-parse` (pdf), Vitest, pnpm workspace.

---

## File Structure

### Nouveau package `packages/mcp-server/`

| Action | Fichier | Responsabilité |
|--------|---------|----------------|
| Create | `packages/mcp-server/package.json` | Config npm avec deps MCP SDK |
| Create | `packages/mcp-server/tsconfig.json` | TypeScript config |
| Create | `packages/mcp-server/src/index.ts` | Entry point MCP, enregistrement skills |
| Create | `packages/mcp-server/src/client.ts` | HTTP client vers Fragmint backend (type-safe) |
| Create | `packages/mcp-server/src/skills/list-collections.ts` | Skill fragmint_list_collections |
| Create | `packages/mcp-server/src/skills/get-index.ts` | Skill fragmint_get_index |
| Create | `packages/mcp-server/src/skills/search-fragments.ts` | Skill fragmint_search_fragments |
| Create | `packages/mcp-server/src/skills/generate-plan.ts` | Skill fragmint_generate_plan |
| Create | `packages/mcp-server/src/skills/compose-section.ts` | Skill fragmint_compose_section |
| Create | `packages/mcp-server/src/skills/generate-document.ts` | Skill fragmint_generate_document |
| Create | `packages/mcp-server/src/skills/sync-cache.ts` | Skill fragmint_sync_cache |
| Create | `packages/mcp-server/src/skills/upload-context-doc.ts` | Skill fragmint_upload_context_doc |
| Create | `packages/mcp-server/src/skills/index.ts` | Barrel export de toutes les skills |
| Create | `packages/mcp-server/src/__tests__/skills.test.ts` | Tests unitaires des skills |

### Modifications backend `packages/server/`

| Action | Fichier | Responsabilité |
|--------|---------|----------------|
| Create | `packages/server/src/routes/mcp-sync-routes.ts` | `GET /v1/mcp/sync-cache` — delta fragments depuis timestamp |
| Create | `packages/server/src/routes/mcp-context-routes.ts` | `POST /v1/mcp/context-docs` + `DELETE /v1/mcp/context-docs/:id` |
| Create | `packages/server/src/services/context-doc-service.ts` | Upload, extraction texte, TTL, cleanup |
| Modify | `packages/server/src/index.ts` | Enregistrer les 2 nouvelles routes |

### Nouveau package `packages/opencode-plugin/`

| Action | Fichier | Responsabilité |
|--------|---------|----------------|
| Create | `packages/opencode-plugin/package.json` | Config npm |
| Create | `packages/opencode-plugin/tsconfig.json` | TypeScript config |
| Create | `packages/opencode-plugin/src/cache.ts` | FragmintCache — SQLite `~/.fragmint/cache.db` |
| Create | `packages/opencode-plugin/src/mcp-client.ts` | FragmintMCPClient — appels stdio vers mcp-server |
| Create | `packages/opencode-plugin/src/commands/compose.ts` | Workflow `/fragmint compose` |
| Create | `packages/opencode-plugin/src/commands/sync.ts` | Commande `/fragmint sync` |
| Create | `packages/opencode-plugin/src/commands/search.ts` | Commande `/fragmint search` |
| Create | `packages/opencode-plugin/src/index.ts` | Entry point plugin, registration des commandes |
| Create | `packages/opencode-plugin/src/__tests__/cache.test.ts` | Tests SQLite cache |

---

## Phase 1 — Serveur MCP

---

## Task 1: Bootstrap du package mcp-server

**Files:**
- Create: `packages/mcp-server/package.json`
- Create: `packages/mcp-server/tsconfig.json`
- Create: `packages/mcp-server/src/index.ts` (skeleton)

- [ ] **Step 1: Créer la structure du package**

```bash
mkdir -p packages/mcp-server/src/skills packages/mcp-server/src/__tests__
```

- [ ] **Step 2: Créer `packages/mcp-server/package.json`**

```json
{
  "name": "@fragmint/mcp-server",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.0",
    "mammoth": "^1.7.0",
    "pdf-parse": "^1.1.1"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/pdf-parse": "^1.1.4",
    "tsx": "^4.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 3: Créer `packages/mcp-server/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  },
  "include": ["src/**/*"]
}
```

Si `tsconfig.base.json` n'existe pas à la racine, créer un tsconfig standalone:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Créer le client HTTP `packages/mcp-server/src/client.ts`**

```typescript
// packages/mcp-server/src/client.ts

export interface FragmintClientConfig {
  baseUrl: string;
  token: string;
}

export class FragmintClient {
  constructor(private config: FragmintClientConfig) {}

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async postFormData<T>(path: string, form: FormData): Promise<T> {
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.token}` },
      body: form,
    });
    const json = (await res.json()) as { data: T; error: string | null };
    if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json.data;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    };
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json()) as { data: T; error: string | null };
    if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json.data;
  }
}
```

- [ ] **Step 5: Créer le fichier barrel `packages/mcp-server/src/skills/index.ts` (vide pour l'instant)**

```typescript
// packages/mcp-server/src/skills/index.ts
export {};
```

- [ ] **Step 6: Créer le skeleton `packages/mcp-server/src/index.ts`**

```typescript
// packages/mcp-server/src/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { FragmintClient } from './client.js';

const FRAGMINT_URL = process.env.FRAGMINT_URL ?? 'http://localhost:3210';
const FRAGMINT_TOKEN = process.env.FRAGMINT_TOKEN ?? '';

if (!FRAGMINT_TOKEN) {
  console.error('[fragmint-mcp] FRAGMINT_TOKEN is required');
  process.exit(1);
}

export const client = new FragmintClient({ baseUrl: FRAGMINT_URL, token: FRAGMINT_TOKEN });

const server = new Server(
  { name: 'fragmint-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

// Skills will be registered here as we implement them
const SKILLS: Map<string, { schema: object; handler: (args: unknown) => Promise<unknown> }> = new Map();

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Array.from(SKILLS.values()).map((s) => s.schema),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const skill = SKILLS.get(request.params.name);
  if (!skill) throw new Error(`Unknown skill: ${request.params.name}`);
  const result = await skill.handler(request.params.arguments ?? {});
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[fragmint-mcp] Server started on stdio');
```

- [ ] **Step 7: Installer les dépendances**

```bash
pnpm install
```

- [ ] **Step 8: Typecheck du skeleton**

```bash
cd packages/mcp-server && pnpm typecheck 2>&1 | head -20
```

Attendu: 0 erreur TypeScript (le skeleton compile).

---

## Task 2: Skills fragmint_list_collections et fragmint_get_index

**Files:**
- Create: `packages/mcp-server/src/skills/list-collections.ts`
- Create: `packages/mcp-server/src/skills/get-index.ts`
- Modify: `packages/mcp-server/src/skills/index.ts`
- Modify: `packages/mcp-server/src/index.ts`
- Create: `packages/mcp-server/src/__tests__/skills.test.ts`

- [ ] **Step 1: Écrire les tests**

```typescript
// packages/mcp-server/src/__tests__/skills.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FragmintClient } from '../client.js';

// Mock du client HTTP
function makeClient(mockData: Record<string, unknown>): FragmintClient {
  return {
    get: vi.fn(async (path: string) => {
      const key = path.replace(/\?.*$/, ''); // strip query string
      return mockData[key] ?? [];
    }),
    post: vi.fn(async () => ({})),
    postFormData: vi.fn(async () => ({})),
  } as unknown as FragmintClient;
}

describe('fragmint_list_collections', () => {
  it('returns list of collections from /v1/collections', async () => {
    const mockCollections = [
      { id: 'common', name: 'Common', fragment_count: 42, updated_at: '2026-01-01' },
    ];
    const client = makeClient({ '/v1/collections': mockCollections });

    const { listCollectionsHandler } = await import('../skills/list-collections.js');
    const result = await listCollectionsHandler(client, {});

    expect(result).toEqual(mockCollections);
    expect(vi.mocked(client.get)).toHaveBeenCalledWith('/v1/collections');
  });
});

describe('fragmint_get_index', () => {
  it('returns markdown index for a collection', async () => {
    const mockIndex = { markdown: '# Index\n- fragment 1', fragment_count: 1, last_updated: '2026-01-01' };
    const client = makeClient({ '/v1/index': mockIndex });

    const { getIndexHandler } = await import('../skills/get-index.js');
    const result = await getIndexHandler(client, { collection_id: 'common' });

    expect(result).toMatchObject({ markdown: expect.stringContaining('Index') });
  });

  it('appends since parameter when provided', async () => {
    const client = makeClient({ '/v1/index': { markdown: '', fragment_count: 0, last_updated: '' } });

    const { getIndexHandler } = await import('../skills/get-index.js');
    await getIndexHandler(client, { collection_id: 'common', since: '2026-01-01T00:00:00Z' });

    const callPath = vi.mocked(client.get).mock.calls[0]?.[0];
    expect(callPath).toContain('since=');
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir fail**

```bash
cd packages/mcp-server && pnpm test 2>&1 | tail -15
```

- [ ] **Step 3: Créer `packages/mcp-server/src/skills/list-collections.ts`**

```typescript
// packages/mcp-server/src/skills/list-collections.ts
import { z } from 'zod';
import type { FragmintClient } from '../client.js';

const InputSchema = z.object({});

interface Collection {
  id: string;
  name: string;
  fragment_count: number;
  updated_at: string;
}

export async function listCollectionsHandler(
  client: FragmintClient,
  _args: unknown,
): Promise<Collection[]> {
  return client.get<Collection[]>('/v1/collections');
}

export const listCollectionsSkill = {
  schema: {
    name: 'fragmint_list_collections',
    description: 'List all available Fragmint collections (e.g., "ira", "twake-docs", "lincloud")',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  makeHandler: (client: FragmintClient) => async (args: unknown) => {
    InputSchema.parse(args);
    return listCollectionsHandler(client, args);
  },
};
```

- [ ] **Step 4: Créer `packages/mcp-server/src/skills/get-index.ts`**

```typescript
// packages/mcp-server/src/skills/get-index.ts
import { z } from 'zod';
import type { FragmintClient } from '../client.js';

const InputSchema = z.object({
  collection_id: z.string(),
  since: z.string().optional(),
});

interface IndexResult {
  markdown: string;
  fragment_count: number;
  last_updated: string;
}

export async function getIndexHandler(
  client: FragmintClient,
  args: unknown,
): Promise<IndexResult> {
  const { collection_id, since } = InputSchema.parse(args);
  const qs = new URLSearchParams({ collection: collection_id });
  if (since) qs.set('since', since);
  return client.get<IndexResult>(`/v1/index?${qs.toString()}`);
}

export const getIndexSkill = {
  schema: {
    name: 'fragmint_get_index',
    description:
      'Get the Markdown index (table of contents) of a Fragmint collection. Use "since" to get only changes since a timestamp.',
    inputSchema: {
      type: 'object',
      properties: {
        collection_id: { type: 'string' },
        since: { type: 'string', description: 'ISO timestamp, returns delta only' },
      },
      required: ['collection_id'],
    },
  },
  makeHandler: (client: FragmintClient) => async (args: unknown) => getIndexHandler(client, args),
};
```

- [ ] **Step 5: Mettre à jour le barrel `packages/mcp-server/src/skills/index.ts`**

```typescript
// packages/mcp-server/src/skills/index.ts
export { listCollectionsSkill } from './list-collections.js';
export { getIndexSkill } from './get-index.js';
```

- [ ] **Step 6: Enregistrer les skills dans `packages/mcp-server/src/index.ts`**

Remplacer le commentaire `// Skills will be registered here` par:

```typescript
import { listCollectionsSkill, getIndexSkill } from './skills/index.js';

// Register skills
for (const skill of [listCollectionsSkill, getIndexSkill]) {
  SKILLS.set(skill.schema.name, {
    schema: skill.schema,
    handler: skill.makeHandler(client),
  });
}
```

- [ ] **Step 7: Lancer les tests**

```bash
cd packages/mcp-server && pnpm test 2>&1 | tail -20
```

Attendu: 3 tests PASS.

- [ ] **Step 8: Typecheck**

```bash
cd packages/mcp-server && pnpm typecheck 2>&1 | head -10
```

---

## Task 3: Skills fragmint_search_fragments et fragmint_sync_cache

**Files:**
- Create: `packages/mcp-server/src/skills/search-fragments.ts`
- Create: `packages/mcp-server/src/skills/sync-cache.ts`
- Create: `packages/server/src/routes/mcp-sync-routes.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Écrire les tests**

Ajouter dans `packages/mcp-server/src/__tests__/skills.test.ts`:

```typescript
describe('fragmint_search_fragments', () => {
  it('passes query and filters to /v1/search', async () => {
    const mockFragments = [{ id: 'f1', title: 'Test', score: 0.9 }];
    const client = makeClient({ '/v1/search': mockFragments });

    const { searchFragmentsHandler } = await import('../skills/search-fragments.js');
    const result = await searchFragmentsHandler(client, {
      query: 'souveraineté',
      filters: { lang: 'fr', domain: 'cloud' },
    });

    expect(result).toEqual(mockFragments);
    const callPath = vi.mocked(client.get).mock.calls[0]?.[0];
    expect(callPath).toContain('q=souverainet');
    expect(callPath).toContain('lang=fr');
  });
});

describe('fragmint_sync_cache', () => {
  it('calls /v1/mcp/sync-cache with collection_id and last_sync', async () => {
    const mockDelta = {
      added: [{ id: 'new-frag' }],
      modified: [],
      deleted: ['old-frag-id'],
      new_sync_timestamp: '2026-05-27T12:00:00Z',
    };
    const client = makeClient({ '/v1/mcp/sync-cache': mockDelta });

    const { syncCacheHandler } = await import('../skills/sync-cache.js');
    const result = await syncCacheHandler(client, {
      collection_id: 'common',
      last_sync: '2026-05-20T00:00:00Z',
    });

    expect(result.new_sync_timestamp).toBe('2026-05-27T12:00:00Z');
    expect(result.deleted).toContain('old-frag-id');
  });
});
```

- [ ] **Step 2: Créer `packages/mcp-server/src/skills/search-fragments.ts`**

```typescript
// packages/mcp-server/src/skills/search-fragments.ts
import { z } from 'zod';
import type { FragmintClient } from '../client.js';

const InputSchema = z.object({
  query: z.string(),
  filters: z
    .object({
      lang: z.string().optional(),
      domain: z.string().optional(),
      type: z.string().optional(),
      collection_id: z.string().optional(),
    })
    .optional(),
  mode: z.enum(['vector-only', 'hybrid', 'agentic-only']).optional(),
  limit: z.number().int().min(1).max(20).default(5),
});

export async function searchFragmentsHandler(client: FragmintClient, args: unknown) {
  const { query, filters, limit } = InputSchema.parse(args);
  const qs = new URLSearchParams({ q: query, limit: String(limit) });
  if (filters?.lang) qs.set('lang', filters.lang);
  if (filters?.domain) qs.set('domain', filters.domain);
  if (filters?.type) qs.set('type', filters.type);
  if (filters?.collection_id) qs.set('collection', filters.collection_id);
  return client.get(`/v1/search?${qs.toString()}`);
}

export const searchFragmentsSkill = {
  schema: {
    name: 'fragmint_search_fragments',
    description:
      'Search fragments in the Fragmint corpus using semantic search. Returns ranked list of fragments.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        filters: {
          type: 'object',
          properties: {
            lang: { type: 'string' },
            domain: { type: 'string' },
            type: { type: 'string' },
            collection_id: { type: 'string' },
          },
        },
        limit: { type: 'number', default: 5 },
      },
      required: ['query'],
    },
  },
  makeHandler: (client: FragmintClient) => async (args: unknown) =>
    searchFragmentsHandler(client, args),
};
```

- [ ] **Step 3: Créer le backend route `/v1/mcp/sync-cache`**

```typescript
// packages/server/src/routes/mcp-sync-routes.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fragments } from '../db/schema.js';
import { gte, eq } from 'drizzle-orm';

const SyncQuerySchema = z.object({
  collection_id: z.string(),
  last_sync: z.string().datetime().optional(),
});

export async function mcpSyncRoutes(app: FastifyInstance) {
  app.get('/v1/mcp/sync-cache', {
    schema: { querystring: SyncQuerySchema },
  }, async (req) => {
    const { collection_id, last_sync } = req.query as z.infer<typeof SyncQuerySchema>;

    const conditions = [eq(fragments.collection_slug, collection_id)];
    if (last_sync) {
      conditions.push(gte(fragments.updated_at, last_sync));
    }

    const rows = await req.server.db
      .select({
        id: fragments.id,
        title: fragments.title,
        body: fragments.body,
        domain: fragments.domain,
        type: fragments.type,
        lang: fragments.lang,
        tags: fragments.tags,
        quality: fragments.quality,
        updated_at: fragments.updated_at,
      })
      .from(fragments)
      .where(conditions.length === 1 ? conditions[0] : undefined)
      // Note: Pour AND multiple conditions, utiliser `and()` de drizzle-orm
      .limit(500);

    // Simplification V1: on retourne tous les fragments comme "added"
    // (une vraie delta sync comparerait updated_at et un champ deleted_at)
    return reply.send({
      added: rows,
      modified: [],
      deleted: [],
      new_sync_timestamp: new Date().toISOString(),
    });
  });
}
```

**Note:** Le handler ci-dessus est simplifié. Pour une vraie delta-sync, il faudrait un champ `deleted_at` dans le schema. Pour la V1, on retourne simplement tous les fragments mis à jour depuis `last_sync`.

Code corrigé avec `and()`:

```typescript
import { and, gte, eq } from 'drizzle-orm';

// Dans le handler:
const whereClause = last_sync
  ? and(eq(fragments.collection_slug, collection_id), gte(fragments.updated_at, last_sync))
  : eq(fragments.collection_slug, collection_id);

const rows = await req.server.db
  .select({ id: fragments.id, title: fragments.title, body: fragments.body,
    domain: fragments.domain, type: fragments.type, lang: fragments.lang,
    tags: fragments.tags, quality: fragments.quality, updated_at: fragments.updated_at })
  .from(fragments)
  .where(whereClause)
  .limit(500);

return { added: rows, modified: [], deleted: [], new_sync_timestamp: new Date().toISOString() };
```

- [ ] **Step 4: Créer `packages/mcp-server/src/skills/sync-cache.ts`**

```typescript
// packages/mcp-server/src/skills/sync-cache.ts
import { z } from 'zod';
import type { FragmintClient } from '../client.js';

const InputSchema = z.object({
  collection_id: z.string(),
  last_sync: z.string().optional(),
});

interface SyncDelta {
  added: unknown[];
  modified: unknown[];
  deleted: string[];
  new_sync_timestamp: string;
}

export async function syncCacheHandler(client: FragmintClient, args: unknown): Promise<SyncDelta> {
  const { collection_id, last_sync } = InputSchema.parse(args);
  const qs = new URLSearchParams({ collection_id });
  if (last_sync) qs.set('last_sync', last_sync);
  return client.get<SyncDelta>(`/v1/mcp/sync-cache?${qs.toString()}`);
}

export const syncCacheSkill = {
  schema: {
    name: 'fragmint_sync_cache',
    description:
      'Sync the local cache with the Fragmint server. Returns delta of changes since last sync.',
    inputSchema: {
      type: 'object',
      properties: {
        collection_id: { type: 'string' },
        last_sync: { type: 'string', description: 'ISO timestamp of last sync' },
      },
      required: ['collection_id'],
    },
  },
  makeHandler: (client: FragmintClient) => async (args: unknown) =>
    syncCacheHandler(client, args),
};
```

- [ ] **Step 5: Enregistrer la route dans le serveur Fastify**

Dans `packages/server/src/index.ts`, ajouter:

```typescript
import { mcpSyncRoutes } from './routes/mcp-sync-routes.js';

// Dans le setup des routes:
await app.register(mcpSyncRoutes);
```

- [ ] **Step 6: Mettre à jour le barrel skills**

```typescript
// packages/mcp-server/src/skills/index.ts
export { listCollectionsSkill } from './list-collections.js';
export { getIndexSkill } from './get-index.js';
export { searchFragmentsSkill } from './search-fragments.js';
export { syncCacheSkill } from './sync-cache.js';
```

- [ ] **Step 7: Lancer les tests**

```bash
cd packages/mcp-server && pnpm test 2>&1 | tail -20
```

- [ ] **Step 8: Typecheck serveur**

```bash
pnpm --filter @fragmint/server typecheck 2>&1 | head -15
```

---

## Task 4: Skills fragmint_generate_plan et fragmint_compose_section

**Files:**
- Create: `packages/mcp-server/src/skills/generate-plan.ts`
- Create: `packages/mcp-server/src/skills/compose-section.ts`

Ces skills appellent les endpoints existants `/v1/plans` (POST pour créer) et `/v1/plans/:id/generate-plan` (POST pour générer les sections), ainsi que `/v1/plans/:id/assemble` (POST pour assembler les fragments).

- [ ] **Step 1: Vérifier les endpoints plan existants**

```bash
grep -n "app\." packages/server/src/routes/plan-routes.ts | head -20
```

Endpoints confirmés:
- `POST /v1/plans` → crée un plan (titre, collection)
- `POST /v1/plans/:id/generate-plan` → génère les sections du plan via LLM
- `POST /v1/plans/:id/assemble` → sélectionne les fragments pour toutes les sections

- [ ] **Step 2: Écrire les tests**

Ajouter dans `packages/mcp-server/src/__tests__/skills.test.ts`:

```typescript
describe('fragmint_generate_plan', () => {
  it('creates and generates a plan, returns plan_id + sections', async () => {
    const client = {
      get: vi.fn(),
      post: vi.fn()
        .mockResolvedValueOnce({ id: 'plan-123', title: 'Propale CNB', sections: [] }) // POST /v1/plans
        .mockResolvedValueOnce({ sections: [
          { idx: 0, title: 'Contexte client', description: 'Présentation CNB' },
          { idx: 1, title: 'Architecture', description: 'Stack technique' },
        ]}) // POST /v1/plans/:id/generate-plan
      ,
      postFormData: vi.fn(),
    } as unknown as FragmintClient;

    const { generatePlanHandler } = await import('../skills/generate-plan.js');
    const result = await generatePlanHandler(client, {
      query: 'propale CNB Twake Mail',
      collection_id: 'common',
    });

    expect(result.plan_id).toBe('plan-123');
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].title).toBe('Contexte client');
    expect(vi.mocked(client.post)).toHaveBeenCalledTimes(2);
  });
});

describe('fragmint_compose_section', () => {
  it('calls /v1/plans/:id/assemble and returns fragments for the section', async () => {
    const mockFragments = [
      { id: 'f1', title: 'Fragment 1', score: 0.9, justification: 'relevant' },
    ];
    const client = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue({ sections: [{ idx: 0, fragments: mockFragments }] }),
      postFormData: vi.fn(),
    } as unknown as FragmintClient;

    const { composeSectionHandler } = await import('../skills/compose-section.js');
    const result = await composeSectionHandler(client, { plan_id: 'plan-123', section_idx: 0 });

    expect(result.section_idx).toBe(0);
    expect(result.fragments).toHaveLength(1);
    expect(result.fragments[0].id).toBe('f1');
  });
});
```

- [ ] **Step 3: Créer `packages/mcp-server/src/skills/generate-plan.ts`**

```typescript
// packages/mcp-server/src/skills/generate-plan.ts
import { z } from 'zod';
import type { FragmintClient } from '../client.js';

const InputSchema = z.object({
  query: z.string(),
  collection_id: z.string(),
  context_docs: z.array(z.string()).optional(),
});

interface PlanSection {
  idx: number;
  title: string;
  description: string;
}

interface PlanResult {
  plan_id: string;
  title: string;
  sections: PlanSection[];
}

export async function generatePlanHandler(
  client: FragmintClient,
  args: unknown,
): Promise<PlanResult> {
  const { query, collection_id, context_docs } = InputSchema.parse(args);

  // 1. Créer le plan vide
  const created = await client.post<{ id: string; title: string }>('/v1/plans', {
    title: query.slice(0, 80),
    collection_slug: collection_id,
  });

  // 2. Générer les sections via LLM
  const generated = await client.post<{ sections: PlanSection[] }>(
    `/v1/plans/${created.id}/generate-plan`,
    {
      query,
      context_docs: context_docs ?? [],
    },
  );

  console.error(
    `[fragmint-mcp][generate-plan] plan=${created.id} sections=${generated.sections.length} ` +
      `context_docs=${context_docs?.length ?? 0}`,
  );

  return {
    plan_id: created.id,
    title: created.title,
    sections: generated.sections.map((s, i) => ({
      idx: i,
      title: s.title,
      description: s.description ?? '',
    })),
  };
}

export const generatePlanSkill = {
  schema: {
    name: 'fragmint_generate_plan',
    description:
      'Generate a structured plan from a user query. The plan contains sections to be filled with fragments.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language query (e.g., "Propale CNB Twake Mail")' },
        collection_id: { type: 'string' },
        context_docs: { type: 'array', items: { type: 'string' }, description: 'Optional context doc IDs' },
      },
      required: ['query', 'collection_id'],
    },
  },
  makeHandler: (client: FragmintClient) => async (args: unknown) =>
    generatePlanHandler(client, args),
};
```

- [ ] **Step 4: Créer `packages/mcp-server/src/skills/compose-section.ts`**

```typescript
// packages/mcp-server/src/skills/compose-section.ts
import { z } from 'zod';
import type { FragmintClient } from '../client.js';

const InputSchema = z.object({
  plan_id: z.string(),
  section_idx: z.number().int().min(0),
  manual_selections: z.array(z.string()).optional(),
  context_docs: z.array(z.string()).optional(),
});

interface SectionFragment {
  id: string;
  title: string | null;
  body_excerpt: string | null;
  score: number;
  justification?: string;
}

interface ComposeSectionResult {
  section_idx: number;
  fragments: SectionFragment[];
}

export async function composeSectionHandler(
  client: FragmintClient,
  args: unknown,
): Promise<ComposeSectionResult> {
  const { plan_id, section_idx, manual_selections, context_docs } = InputSchema.parse(args);

  // Appel à l'endpoint d'assemblage des fragments pour une section
  const result = await client.post<{ sections: Array<{ idx: number; fragments: SectionFragment[] }> }>(
    `/v1/plans/${plan_id}/assemble`,
    {
      section_idx,
      manual_selections: manual_selections ?? [],
      context_docs: context_docs ?? [],
    },
  );

  const section = result.sections.find((s) => s.idx === section_idx);
  const sectionFragments = section?.fragments ?? [];

  console.error(
    `[fragmint-mcp][compose-section] plan=${plan_id} section=${section_idx} ` +
      `fragments=${sectionFragments.length}`,
  );

  return { section_idx, fragments: sectionFragments };
}

export const composeSectionSkill = {
  schema: {
    name: 'fragmint_compose_section',
    description:
      'Select the best fragments for a specific section of a plan. Uses the current retrieval mode (vector/hybrid/agentic).',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        section_idx: { type: 'number' },
        manual_selections: { type: 'array', items: { type: 'string' }, description: 'UUIDs to force-include' },
        context_docs: { type: 'array', items: { type: 'string' }, description: 'Context doc IDs for reranking' },
      },
      required: ['plan_id', 'section_idx'],
    },
  },
  makeHandler: (client: FragmintClient) => async (args: unknown) =>
    composeSectionHandler(client, args),
};
```

- [ ] **Step 5: Mettre à jour le barrel**

```typescript
// packages/mcp-server/src/skills/index.ts
export { listCollectionsSkill } from './list-collections.js';
export { getIndexSkill } from './get-index.js';
export { searchFragmentsSkill } from './search-fragments.js';
export { syncCacheSkill } from './sync-cache.js';
export { generatePlanSkill } from './generate-plan.js';
export { composeSectionSkill } from './compose-section.js';
```

- [ ] **Step 6: Lancer les tests**

```bash
cd packages/mcp-server && pnpm test 2>&1 | tail -20
```

Attendu: tous les tests PASS.

---

## Task 5: Skills fragmint_generate_document et fragmint_upload_context_doc

**Files:**
- Create: `packages/mcp-server/src/skills/generate-document.ts`
- Create: `packages/mcp-server/src/skills/upload-context-doc.ts`
- Create: `packages/server/src/routes/mcp-context-routes.ts`
- Create: `packages/server/src/services/context-doc-service.ts`

- [ ] **Step 1: Créer `packages/mcp-server/src/skills/generate-document.ts`**

```typescript
// packages/mcp-server/src/skills/generate-document.ts
import { z } from 'zod';
import type { FragmintClient } from '../client.js';

const InputSchema = z.object({
  plan_id: z.string(),
  format: z.enum(['docx', 'pptx', 'xlsx', 'md']).default('docx'),
  template_id: z.string().optional(),
});

interface DocumentResult {
  file_url: string;
  format: string;
}

export async function generateDocumentHandler(
  client: FragmintClient,
  args: unknown,
): Promise<DocumentResult> {
  const { plan_id, format, template_id } = InputSchema.parse(args);

  const result = await client.post<DocumentResult>(`/v1/plans/${plan_id}/export`, {
    format,
    template_id: template_id ?? null,
  });

  console.error(`[fragmint-mcp][generate-document] plan=${plan_id} format=${format} → ${result.file_url}`);

  return result;
}

export const generateDocumentSkill = {
  schema: {
    name: 'fragmint_generate_document',
    description: 'Generate the final document (pptx, docx, etc.) from a validated plan.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        format: { type: 'string', enum: ['docx', 'pptx', 'xlsx', 'md'], default: 'docx' },
        template_id: { type: 'string' },
      },
      required: ['plan_id'],
    },
  },
  makeHandler: (client: FragmintClient) => async (args: unknown) =>
    generateDocumentHandler(client, args),
};
```

- [ ] **Step 2: Créer le service de context-docs côté backend**

```typescript
// packages/server/src/services/context-doc-service.ts
import { randomUUID } from 'crypto';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';

const CONTEXT_DOCS_DIR = join(tmpdir(), 'fragmint-context-docs');
const DEFAULT_TTL_SECONDS = 3600; // 1 heure
const MAX_EXTRACTED_CHARS = 50_000;

interface ContextDocMeta {
  doc_id: string;
  session_id: string;
  filename: string;
  format: string;
  size: number;
  created_at: string;
  expires_at: string;
}

mkdirSync(CONTEXT_DOCS_DIR, { recursive: true });

export class ContextDocService {
  getDocDir(sessionId: string, docId: string): string {
    return join(CONTEXT_DOCS_DIR, sessionId, docId);
  }

  async upload(params: {
    sessionId: string;
    filename: string;
    buffer: Buffer;
    format: string;
    ephemeral: boolean;
  }): Promise<{ doc_id: string; ttl_seconds: number }> {
    const docId = `ctx-${randomUUID().slice(0, 8)}`;
    const docDir = this.getDocDir(params.sessionId, docId);
    mkdirSync(docDir, { recursive: true });

    // Sauvegarder le fichier original
    writeFileSync(join(docDir, `original.${params.format}`), params.buffer);

    // Extraire le texte
    const extracted = await this.extractText(params.buffer, params.format);
    const truncated = extracted.slice(0, MAX_EXTRACTED_CHARS);
    writeFileSync(join(docDir, 'extracted.txt'), truncated);

    // Sauvegarder les metadata
    const expiresAt = new Date(Date.now() + DEFAULT_TTL_SECONDS * 1000).toISOString();
    const meta: ContextDocMeta = {
      doc_id: docId,
      session_id: params.sessionId,
      filename: params.filename,
      format: params.format,
      size: extracted.length,
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
    };
    writeFileSync(join(docDir, 'meta.json'), JSON.stringify(meta));

    console.log(
      `[context-doc] Uploaded "${params.filename}" → doc_id=${docId} ` +
        `size=${truncated.length} chars ttl=${DEFAULT_TTL_SECONDS}s`,
    );

    return { doc_id: docId, ttl_seconds: DEFAULT_TTL_SECONDS };
  }

  getExtractedText(sessionId: string, docId: string): string | null {
    const path = join(this.getDocDir(sessionId, docId), 'extracted.txt');
    if (!existsSync(path)) return null;
    return readFileSync(path, 'utf-8');
  }

  cleanup(): void {
    // Supprimer les docs expirés
    const now = Date.now();
    let deleted = 0;
    try {
      const { readdirSync } = require('fs');
      for (const sessionId of readdirSync(CONTEXT_DOCS_DIR)) {
        const sessionDir = join(CONTEXT_DOCS_DIR, sessionId);
        for (const docId of readdirSync(sessionDir)) {
          const metaPath = join(sessionDir, docId, 'meta.json');
          if (!existsSync(metaPath)) continue;
          const meta: ContextDocMeta = JSON.parse(readFileSync(metaPath, 'utf-8'));
          if (new Date(meta.expires_at).getTime() < now) {
            rmSync(join(sessionDir, docId), { recursive: true });
            deleted++;
          }
        }
      }
      if (deleted > 0) console.log(`[context-doc][cleanup] Deleted ${deleted} expired docs`);
    } catch {
      // Silent — cleanup failure is non-critical
    }
  }

  private async extractText(buffer: Buffer, format: string): Promise<string> {
    if (format === 'txt' || format === 'md') {
      return buffer.toString('utf-8');
    }
    if (format === 'docx') {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }
    if (format === 'pdf') {
      const pdfParse = await import('pdf-parse');
      const data = await pdfParse.default(buffer);
      return data.text;
    }
    throw new Error(`Unsupported format: ${format}. Supported: txt, md, docx, pdf`);
  }
}

export const contextDocService = new ContextDocService();
```

- [ ] **Step 3: Créer les routes context-docs**

```typescript
// packages/server/src/routes/mcp-context-routes.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { contextDocService } from '../services/context-doc-service.js';

const SUPPORTED_FORMATS = ['txt', 'md', 'docx', 'pdf'] as const;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export async function mcpContextRoutes(app: FastifyInstance) {
  // Upload un doc de contexte éphémère
  app.post('/v1/mcp/context-docs', async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'No file provided' });

    const ext = (data.filename.split('.').pop() ?? '').toLowerCase();
    if (!SUPPORTED_FORMATS.includes(ext as typeof SUPPORTED_FORMATS[number])) {
      return reply.code(400).send({
        error: `Unsupported format: .${ext}. Supported: ${SUPPORTED_FORMATS.join(', ')}`,
      });
    }

    const buffer = await data.toBuffer();
    if (buffer.length > MAX_FILE_SIZE) {
      return reply.code(400).send({ error: 'File too large (max 10MB)' });
    }

    // session_id = token hash (isolation par utilisateur)
    const sessionId = req.user?.id ?? 'anonymous';

    const result = await contextDocService.upload({
      sessionId,
      filename: data.filename,
      buffer,
      format: ext,
      ephemeral: true,
    });

    return reply.send(result);
  });

  // Supprimer un doc de contexte (fin de session)
  app.delete('/v1/mcp/context-docs/:doc_id', async (req, reply) => {
    const { doc_id } = req.params as { doc_id: string };
    const sessionId = req.user?.id ?? 'anonymous';
    const { rmSync, existsSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const docDir = join(tmpdir(), 'fragmint-context-docs', sessionId, doc_id);
    if (existsSync(docDir)) rmSync(docDir, { recursive: true });
    return reply.send({ deleted: true });
  });
}
```

- [ ] **Step 4: Créer `packages/mcp-server/src/skills/upload-context-doc.ts`**

```typescript
// packages/mcp-server/src/skills/upload-context-doc.ts
import { z } from 'zod';
import { createReadStream } from 'fs';
import { basename } from 'path';
import type { FragmintClient } from '../client.js';

const InputSchema = z.object({
  file_path: z.string(),
  ephemeral: z.boolean().default(true),
});

interface UploadResult {
  doc_id: string;
  ttl_seconds: number;
}

export async function uploadContextDocHandler(
  client: FragmintClient,
  args: unknown,
): Promise<UploadResult> {
  const { file_path } = InputSchema.parse(args);

  const filename = basename(file_path);
  const { statSync } = await import('fs');
  statSync(file_path); // throws if file doesn't exist

  // Utiliser FormData pour l'upload multipart
  const form = new FormData();
  const blob = new Blob([await import('fs').then((fs) => fs.readFileSync(file_path))]);
  form.append('file', blob, filename);

  const result = await client.postFormData<UploadResult>('/v1/mcp/context-docs', form);

  console.error(
    `[fragmint-mcp][upload-context-doc] "${filename}" → doc_id=${result.doc_id} ttl=${result.ttl_seconds}s`,
  );

  return result;
}

export const uploadContextDocSkill = {
  schema: {
    name: 'fragmint_upload_context_doc',
    description:
      'Upload a document as ephemeral context for the current conversation. Not added to the permanent corpus. Supported formats: .txt, .md, .docx, .pdf',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the local file' },
        ephemeral: { type: 'boolean', default: true, description: 'If true, auto-deleted after 1h' },
      },
      required: ['file_path'],
    },
  },
  makeHandler: (client: FragmintClient) => async (args: unknown) =>
    uploadContextDocHandler(client, args),
};
```

- [ ] **Step 5: Enregistrer les routes dans le serveur**

Dans `packages/server/src/index.ts`:

```typescript
import { mcpContextRoutes } from './routes/mcp-context-routes.js';

// Dans le setup:
await app.register(mcpContextRoutes);
```

- [ ] **Step 6: Configurer le cleanup cron (toutes les 15 min)**

Dans `packages/server/src/index.ts`, ajouter après le démarrage du serveur:

```typescript
import { contextDocService } from './services/context-doc-service.js';

// Cleanup cron: toutes les 15 minutes
setInterval(() => {
  contextDocService.cleanup();
}, 15 * 60 * 1000);
```

- [ ] **Step 7: Mettre à jour le barrel et index.ts du MCP server**

```typescript
// packages/mcp-server/src/skills/index.ts — ajouter:
export { generateDocumentSkill } from './generate-document.js';
export { uploadContextDocSkill } from './upload-context-doc.js';
```

Dans `packages/mcp-server/src/index.ts`, importer et enregistrer toutes les skills:

```typescript
import {
  listCollectionsSkill,
  getIndexSkill,
  searchFragmentsSkill,
  syncCacheSkill,
  generatePlanSkill,
  composeSectionSkill,
  generateDocumentSkill,
  uploadContextDocSkill,
} from './skills/index.js';

const ALL_SKILLS = [
  listCollectionsSkill,
  getIndexSkill,
  searchFragmentsSkill,
  syncCacheSkill,
  generatePlanSkill,
  composeSectionSkill,
  generateDocumentSkill,
  uploadContextDocSkill,
];

for (const skill of ALL_SKILLS) {
  SKILLS.set(skill.schema.name, {
    schema: skill.schema,
    handler: skill.makeHandler(client),
  });
}
```

- [ ] **Step 8: Typecheck final Phase 1**

```bash
cd packages/mcp-server && pnpm typecheck 2>&1 | head -20
pnpm --filter @fragmint/server typecheck 2>&1 | head -20
```

- [ ] **Step 9: Tester le serveur MCP en stdio**

```bash
# Lancer le serveur (dans un terminal)
cd packages/mcp-server
FRAGMINT_URL=http://localhost:3210 FRAGMINT_TOKEN=frag_tok_XXX node -e "
  import('./src/index.js').then(() => {
    // Envoyer une requête MCP tools/list
    process.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}}) + '\n');
  });
"
```

Attendu: réponse JSON avec les 8 skills listées.

---

## Phase 2 — Cache local + Plugin OpenCode

---

## Task 6: Bootstrap du package opencode-plugin + FragmintCache

**Files:**
- Create: `packages/opencode-plugin/package.json`
- Create: `packages/opencode-plugin/tsconfig.json`
- Create: `packages/opencode-plugin/src/cache.ts`
- Create: `packages/opencode-plugin/src/__tests__/cache.test.ts`

- [ ] **Step 1: Créer la structure**

```bash
mkdir -p packages/opencode-plugin/src/commands packages/opencode-plugin/src/__tests__
```

- [ ] **Step 2: Créer `packages/opencode-plugin/package.json`**

```json
{
  "name": "@fragmint/opencode-plugin",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 3: Écrire les tests du cache**

```typescript
// packages/opencode-plugin/src/__tests__/cache.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FragmintCache } from '../cache.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync, existsSync } from 'fs';

const TEST_DB_PATH = join(tmpdir(), `fragmint-test-${Date.now()}.db`);

describe('FragmintCache', () => {
  let cache: FragmintCache;

  beforeEach(() => {
    cache = new FragmintCache(TEST_DB_PATH);
  });

  afterEach(() => {
    cache.close();
    if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  });

  it('initializes schema without error', () => {
    expect(() => new FragmintCache(TEST_DB_PATH)).not.toThrow();
  });

  it('returns null for unknown fragment', () => {
    expect(cache.getFragment('unknown-id')).toBeNull();
  });

  it('applies delta: added fragments are stored', () => {
    cache.applyDelta('common', {
      added: [{ id: 'f1', title: 'Test', body: 'Body', domain: 'cloud', type: 'argument',
                 lang: 'fr', tags: '["tag1"]', quality: 'approved', updated_at: '2026-01-01' }],
      modified: [],
      deleted: [],
      new_sync_timestamp: '2026-01-01T00:00:00Z',
    });

    const fragment = cache.getFragment('f1');
    expect(fragment).not.toBeNull();
    expect(fragment?.title).toBe('Test');
  });

  it('applies delta: deleted fragments are removed', () => {
    cache.applyDelta('common', {
      added: [{ id: 'f2', title: 'Del', body: '', domain: '', type: '', lang: 'fr',
                tags: '[]', quality: 'draft', updated_at: '2026-01-01' }],
      modified: [],
      deleted: [],
      new_sync_timestamp: '2026-01-01T00:00:00Z',
    });

    cache.applyDelta('common', {
      added: [],
      modified: [],
      deleted: ['f2'],
      new_sync_timestamp: '2026-01-02T00:00:00Z',
    });

    expect(cache.getFragment('f2')).toBeNull();
  });

  it('getLastSync returns null before first sync', () => {
    expect(cache.getLastSync('common')).toBeNull();
  });

  it('getLastSync returns timestamp after sync', () => {
    cache.applyDelta('common', {
      added: [], modified: [], deleted: [],
      new_sync_timestamp: '2026-05-01T00:00:00Z',
    });
    expect(cache.getLastSync('common')).toBe('2026-05-01T00:00:00Z');
  });

  it('getIndexMarkdown returns empty string when not cached', () => {
    expect(cache.getIndexMarkdown('common')).toBe('');
  });

  it('setIndexMarkdown then getIndexMarkdown returns stored value', () => {
    cache.setIndexMarkdown('common', '# Index\n- fragment 1');
    expect(cache.getIndexMarkdown('common')).toBe('# Index\n- fragment 1');
  });
});
```

- [ ] **Step 4: Lancer les tests pour les voir fail**

```bash
cd packages/opencode-plugin && pnpm test 2>&1 | tail -10
```

- [ ] **Step 5: Créer `packages/opencode-plugin/src/cache.ts`**

```typescript
// packages/opencode-plugin/src/cache.ts
import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync } from 'fs';

const DEFAULT_CACHE_DIR = join(homedir(), '.fragmint');
const DEFAULT_CACHE_PATH = join(DEFAULT_CACHE_DIR, 'cache.db');

export interface CachedFragment {
  id: string;
  collection_id: string;
  title: string | null;
  body: string | null;
  domain: string | null;
  type: string | null;
  lang: string | null;
  tags: string | null; // JSON string
  quality: string;
  updated_at: string;
  cached_at: string;
}

export interface SyncDelta {
  added: Omit<CachedFragment, 'collection_id' | 'cached_at'>[];
  modified: Omit<CachedFragment, 'collection_id' | 'cached_at'>[];
  deleted: string[];
  new_sync_timestamp: string;
}

export class FragmintCache {
  private db: Database.Database;

  constructor(dbPath: string = DEFAULT_CACHE_PATH) {
    if (dbPath === DEFAULT_CACHE_PATH) {
      mkdirSync(DEFAULT_CACHE_DIR, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS collections (
        id TEXT PRIMARY KEY,
        name TEXT,
        last_sync TEXT,
        fragment_count INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS fragments (
        id TEXT PRIMARY KEY,
        collection_id TEXT REFERENCES collections(id),
        title TEXT,
        body TEXT,
        domain TEXT,
        type TEXT,
        lang TEXT,
        tags TEXT,
        quality TEXT,
        updated_at TEXT,
        cached_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_fragments_collection ON fragments(collection_id);
      CREATE INDEX IF NOT EXISTS idx_fragments_domain ON fragments(domain);

      CREATE TABLE IF NOT EXISTS index_markdown (
        collection_id TEXT PRIMARY KEY REFERENCES collections(id),
        markdown TEXT,
        generated_at TEXT DEFAULT (datetime('now'))
      );
    `);
  }

  applyDelta(collectionId: string, delta: SyncDelta): void {
    const insertCollection = this.db.prepare(`
      INSERT OR IGNORE INTO collections (id, last_sync) VALUES (?, ?)
    `);
    const updateLastSync = this.db.prepare(
      `UPDATE collections SET last_sync = ? WHERE id = ?`,
    );
    const upsertFragment = this.db.prepare(`
      INSERT OR REPLACE INTO fragments
        (id, collection_id, title, body, domain, type, lang, tags, quality, updated_at, cached_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    const deleteFragment = this.db.prepare(`DELETE FROM fragments WHERE id = ?`);

    this.db.transaction(() => {
      insertCollection.run(collectionId, delta.new_sync_timestamp);
      updateLastSync.run(delta.new_sync_timestamp, collectionId);

      for (const f of [...delta.added, ...delta.modified]) {
        upsertFragment.run(
          f.id, collectionId, f.title ?? null, f.body ?? null, f.domain ?? null,
          f.type ?? null, f.lang ?? null, f.tags ?? null, f.quality, f.updated_at,
        );
      }

      for (const id of delta.deleted) {
        deleteFragment.run(id);
      }
    })();
  }

  getFragment(id: string): CachedFragment | null {
    return (
      (this.db
        .prepare('SELECT * FROM fragments WHERE id = ?')
        .get(id) as CachedFragment | undefined) ?? null
    );
  }

  getLastSync(collectionId: string): string | null {
    const row = this.db
      .prepare('SELECT last_sync FROM collections WHERE id = ?')
      .get(collectionId) as { last_sync: string | null } | undefined;
    return row?.last_sync ?? null;
  }

  getIndexMarkdown(collectionId: string): string {
    const row = this.db
      .prepare('SELECT markdown FROM index_markdown WHERE collection_id = ?')
      .get(collectionId) as { markdown: string } | undefined;
    return row?.markdown ?? '';
  }

  setIndexMarkdown(collectionId: string, markdown: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO index_markdown (collection_id, markdown, generated_at)
         VALUES (?, ?, datetime('now'))`,
      )
      .run(collectionId, markdown);
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 6: Lancer les tests**

```bash
cd packages/opencode-plugin && pnpm install && pnpm test 2>&1 | tail -20
```

Attendu: tous les 8 tests du cache PASS.

---

## Task 7: FragmintMCPClient + commande /fragmint compose

**Files:**
- Create: `packages/opencode-plugin/src/mcp-client.ts`
- Create: `packages/opencode-plugin/src/commands/compose.ts`
- Create: `packages/opencode-plugin/src/commands/sync.ts`
- Create: `packages/opencode-plugin/src/index.ts`

- [ ] **Step 1: Créer `packages/opencode-plugin/src/mcp-client.ts`**

Le plugin appelle le MCP server via HTTP (plus simple que stdio en V1 — le serveur peut exposer un endpoint HTTP REST en plus du stdio).

Alternative V1 plus simple : le plugin appelle directement l'API Fragmint HTTP (pas besoin du MCP server). La valeur du MCP server est pour les clients qui utilisent le protocole MCP (OpenCode, Claude Code, Cursor).

```typescript
// packages/opencode-plugin/src/mcp-client.ts
// V1: appel direct à l'API Fragmint (HTTP) — MCP protocol pour les clients externes

export interface FragmintMCPClientConfig {
  baseUrl: string;
  token: string;
}

export class FragmintMCPClient {
  constructor(private config: FragmintMCPClientConfig) {}

  async call<T>(skill: string, args: unknown): Promise<T> {
    const res = await fetch(`${this.config.baseUrl}/v1/mcp/call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.token}`,
      },
      body: JSON.stringify({ skill, args }),
    });
    if (!res.ok) throw new Error(`MCP call failed: ${res.status}`);
    return (await res.json()) as T;
  }
}
```

**Note:** Pour que ce client fonctionne, il faut un endpoint HTTP sur le serveur Fragmint qui proxifie les appels MCP. Alternative: le plugin peut appeler directement les endpoints REST existants (ce qui est plus simple et évite le proxy).

Approche V1 recommandée: le plugin appelle directement les endpoints REST de Fragmint (pas de proxy MCP). Le package `mcp-server` est pour les clients MCP externes (OpenCode, Cursor, Claude Code via leur config MCP).

```typescript
// packages/opencode-plugin/src/mcp-client.ts — V1 simplifié (appels REST directs)
import { FragmintCache, type SyncDelta } from './cache.js';

export interface FragmintClientConfig {
  baseUrl: string;
  token: string;
}

export class FragmintMCPClient {
  constructor(
    private config: FragmintClientConfig,
    private cache: FragmintCache,
  ) {}

  async syncCollection(collectionId: string): Promise<void> {
    const lastSync = this.cache.getLastSync(collectionId) ?? undefined;
    const qs = new URLSearchParams({ collection_id: collectionId });
    if (lastSync) qs.set('last_sync', lastSync);

    const delta = await this.get<SyncDelta>(`/v1/mcp/sync-cache?${qs}`);
    this.cache.applyDelta(collectionId, delta);

    // Mettre à jour l'index markdown
    const indexResult = await this.get<{ markdown: string }>(`/v1/index?collection=${collectionId}`);
    this.cache.setIndexMarkdown(collectionId, indexResult.markdown ?? '');

    console.log(`[fragmint-plugin] Synced collection "${collectionId}" — ${delta.added.length} added, ${delta.deleted.length} deleted`);
  }

  async listCollections(): Promise<Array<{ id: string; name: string }>> {
    return this.get('/v1/collections');
  }

  async generatePlan(params: {
    query: string;
    collectionId: string;
    contextDocs?: string[];
  }): Promise<{ plan_id: string; title: string; sections: Array<{ idx: number; title: string; description: string }> }> {
    // Créer + générer le plan
    const created = await this.post<{ id: string; title: string }>('/v1/plans', {
      title: params.query.slice(0, 80),
      collection_slug: params.collectionId,
    });
    const generated = await this.post<{ sections: Array<{ idx: number; title: string; description: string }> }>(
      `/v1/plans/${created.id}/generate-plan`,
      { query: params.query, context_docs: params.contextDocs ?? [] },
    );
    return {
      plan_id: created.id,
      title: created.title,
      sections: generated.sections.map((s, i) => ({ idx: i, title: s.title, description: s.description ?? '' })),
    };
  }

  async composeSection(params: {
    planId: string;
    sectionIdx: number;
    manualSelections?: string[];
  }): Promise<Array<{ id: string; title: string; score: number; justification?: string }>> {
    const result = await this.post<{ sections: Array<{ idx: number; fragments: Array<{ id: string; title: string; score: number; justification?: string }> }> }>(
      `/v1/plans/${params.planId}/assemble`,
      { section_idx: params.sectionIdx, manual_selections: params.manualSelections ?? [] },
    );
    return result.sections.find((s) => s.idx === params.sectionIdx)?.fragments ?? [];
  }

  async generateDocument(params: { planId: string; format: string }): Promise<{ file_url: string }> {
    return this.post(`/v1/plans/${params.planId}/export`, { format: params.format });
  }

  async uploadContextDoc(filePath: string): Promise<{ doc_id: string; ttl_seconds: number }> {
    const { readFileSync, statSync } = await import('fs');
    const { basename } = await import('path');
    statSync(filePath); // throws if not found
    const buffer = readFileSync(filePath);
    const filename = basename(filePath);
    const form = new FormData();
    form.append('file', new Blob([buffer]), filename);
    return this.postForm('/v1/mcp/context-docs', form);
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.config.token}` },
    });
    const json = await res.json() as { data: T; error: string | null };
    if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json.data;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.token}` },
      body: JSON.stringify(body),
    });
    const json = await res.json() as { data: T; error: string | null };
    if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json.data;
  }

  private async postForm<T>(path: string, form: FormData): Promise<T> {
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.token}` },
      body: form,
    });
    const json = await res.json() as { data: T; error: string | null };
    if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json.data;
  }
}
```

- [ ] **Step 2: Créer `packages/opencode-plugin/src/commands/compose.ts`**

```typescript
// packages/opencode-plugin/src/commands/compose.ts
import type { FragmintMCPClient } from '../mcp-client.js';
import type { FragmintCache } from '../cache.js';

export interface CommandContext {
  activeCollection: string;
  askUser: (prompt: string) => Promise<string>;
  log: (message: string) => void;
}

function formatPlan(plan: {
  plan_id: string;
  title: string;
  sections: Array<{ idx: number; title: string; description: string }>;
}): string {
  const lines = [`📋 **${plan.title}**\n`];
  for (const s of plan.sections) {
    lines.push(`${s.idx + 1}. **${s.title}** — ${s.description}`);
  }
  lines.push('\nTu valides ce plan ? (oui/non, ou décris tes modifications)');
  lines.push('Tu peux aussi fournir le chemin d\'un doc de contexte : [path: /chemin/vers/fichier.pdf]');
  return lines.join('\n');
}

function formatSection(
  sectionTitle: string,
  fragments: Array<{ id: string; title: string; score: number; justification?: string }>,
): string {
  const lines = [`\n📝 **Section : ${sectionTitle}**`];
  for (const [i, f] of fragments.entries()) {
    lines.push(`  ${i + 1}. [${f.id.slice(0, 8)}] ${f.title} (score: ${f.score.toFixed(2)})`);
    if (f.justification) lines.push(`     _${f.justification}_`);
  }
  lines.push('\nModifier cette section ? (ex: "ajoute [fragment-id]" ou "ok")');
  return lines.join('\n');
}

export function composeCommand(client: FragmintMCPClient, cache: FragmintCache) {
  return async (args: string[], ctx: CommandContext) => {
    const query = args.join(' ');
    if (!query) return { message: 'Usage: /fragmint compose <description du document>' };

    ctx.log(`[fragmint compose] Generating plan for: "${query}"`);

    // Étape 1 : Sync du cache avant de composer
    await client.syncCollection(ctx.activeCollection);

    // Étape 2 : Générer le plan
    let plan = await client.generatePlan({ query, collectionId: ctx.activeCollection });
    let contextDocs: string[] = [];

    // Étape 3 : Boucle de validation du plan
    let planValidated = false;
    while (!planValidated) {
      const response = await ctx.askUser(formatPlan(plan));

      // Détecter si l'utilisateur joint un fichier [path: ...]
      const pathMatch = response.match(/\[path:\s*(.+?)\]/);
      if (pathMatch) {
        const filePath = pathMatch[1].trim();
        ctx.log(`[fragmint compose] Uploading context doc: ${filePath}`);
        const uploaded = await client.uploadContextDoc(filePath);
        contextDocs.push(uploaded.doc_id);
        ctx.log(`[fragmint compose] Context doc loaded (${uploaded.doc_id}), regenerating plan...`);
        plan = await client.generatePlan({ query, collectionId: ctx.activeCollection, contextDocs });
        continue;
      }

      if (/^(oui|ok|yes|valide)/i.test(response.trim())) {
        planValidated = true;
      } else {
        ctx.log('[fragmint compose] Plan modification requested — updating sections...');
        // Pour la V1, on régénère le plan avec la modification comme nouveau query
        plan = await client.generatePlan({
          query: `${query} — modification: ${response}`,
          collectionId: ctx.activeCollection,
          contextDocs,
        });
      }
    }

    // Étape 4 : Composer chaque section
    ctx.log('[fragmint compose] Composing sections...');
    const composedSections: Array<{
      idx: number;
      title: string;
      fragments: Array<{ id: string; title: string; score: number; justification?: string }>;
    }> = [];

    for (const section of plan.sections) {
      const fragments = await client.composeSection({
        planId: plan.plan_id,
        sectionIdx: section.idx,
      });
      composedSections.push({ idx: section.idx, title: section.title, fragments });
    }

    // Étape 5 : Afficher les sections et demander validation
    let allSectionsValidated = false;
    while (!allSectionsValidated) {
      const sectionsSummary = composedSections
        .map((s) => formatSection(s.title, s.fragments))
        .join('\n');

      const response = await ctx.askUser(
        sectionsSummary + '\n\nTout valider ? (oui) ou modifier une section ?',
      );

      if (/^(oui|ok|yes|valide)/i.test(response.trim())) {
        allSectionsValidated = true;
      } else {
        // Modification d'une section : déterminer laquelle et relancer
        ctx.log('[fragmint compose] Section modification requested...');
        // V1 : re-composer toutes les sections (simplification)
        for (const section of composedSections) {
          const fragments = await client.composeSection({
            planId: plan.plan_id,
            sectionIdx: section.idx,
          });
          section.fragments = fragments;
        }
      }
    }

    // Étape 6 : Générer le document
    const formatResponse = await ctx.askUser('Format de sortie ? (pptx / docx) [défaut: pptx]');
    const format = /docx/i.test(formatResponse) ? 'docx' : 'pptx';

    ctx.log(`[fragmint compose] Generating ${format} document...`);
    const doc = await client.generateDocument({ planId: plan.plan_id, format });

    return {
      message: `✅ Document généré : ${doc.file_url}\nFormat: ${format}`,
    };
  };
}
```

- [ ] **Step 3: Créer `packages/opencode-plugin/src/commands/sync.ts`**

```typescript
// packages/opencode-plugin/src/commands/sync.ts
import type { FragmintMCPClient } from '../mcp-client.js';
import type { FragmintCache } from '../cache.js';

export function syncCommand(client: FragmintMCPClient, _cache: FragmintCache) {
  return async (args: string[], ctx: { activeCollection: string; log: (m: string) => void }) => {
    const collection = args[0] ?? ctx.activeCollection;
    ctx.log(`[fragmint sync] Syncing collection "${collection}"...`);
    await client.syncCollection(collection);
    return { message: `✅ Collection "${collection}" synced.` };
  };
}
```

- [ ] **Step 4: Créer `packages/opencode-plugin/src/index.ts`**

```typescript
// packages/opencode-plugin/src/index.ts
// Entry point du plugin OpenCode/Claude Code

import { FragmintCache } from './cache.js';
import { FragmintMCPClient } from './mcp-client.js';
import { composeCommand } from './commands/compose.js';
import { syncCommand } from './commands/sync.js';

export interface PluginConfig {
  serverUrl: string;
  token: string;
  activeCollection?: string;
}

export class FragmintPlugin {
  private cache: FragmintCache;
  private client: FragmintMCPClient;
  private activeCollection: string;

  constructor(private config: PluginConfig) {
    this.cache = new FragmintCache();
    this.client = new FragmintMCPClient(
      { baseUrl: config.serverUrl, token: config.token },
      this.cache,
    );
    this.activeCollection = config.activeCollection ?? 'common';
  }

  async activate() {
    // Sync initial au démarrage
    const collections = await this.client.listCollections();
    for (const col of collections) {
      await this.client.syncCollection(col.id);
    }

    const ctx = {
      activeCollection: this.activeCollection,
      log: console.log,
      askUser: async (prompt: string) => {
        // L'intégration askUser dépend du client (OpenCode, Claude Code, etc.)
        // À surcharger selon le contexte
        console.log(prompt);
        return 'oui'; // Valeur par défaut pour les tests
      },
    };

    return {
      commands: {
        '/fragmint compose': composeCommand(this.client, this.cache),
        '/fragmint sync': syncCommand(this.client, this.cache),
      },
    };
  }

  deactivate() {
    this.cache.close();
  }
}

export { FragmintCache, FragmintMCPClient };
```

- [ ] **Step 5: Typecheck du plugin**

```bash
cd packages/opencode-plugin && pnpm typecheck 2>&1 | head -20
```

---

## Task 8: README + Documentation utilisateur

**Files:**
- Create: `packages/mcp-server/README.md`
- Create: `docs/opencode-plugin.md`

- [ ] **Step 1: Créer `packages/mcp-server/README.md`**

```markdown
# Fragmint MCP Server

Expose Fragmint comme un serveur MCP pour OpenCode, Claude Code, Cursor, et tout client MCP-compatible.

## Installation

```bash
pnpm --filter @fragmint/mcp-server build
```

## Configuration

```bash
export FRAGMINT_URL=https://fragmint.linagora.com
export FRAGMINT_TOKEN=frag_tok_XXX
```

## Lancement

```bash
node packages/mcp-server/dist/index.js
```

## Configuration Claude Code

Dans `.claude/mcp-servers.json` :

```json
{
  "fragmint": {
    "command": "node",
    "args": ["/path/to/fragmint/packages/mcp-server/dist/index.js"],
    "env": {
      "FRAGMINT_URL": "http://localhost:3210",
      "FRAGMINT_TOKEN": "frag_tok_XXX"
    }
  }
}
```

## Skills disponibles

| Skill | Description |
|-------|-------------|
| `fragmint_list_collections` | Liste les collections |
| `fragmint_get_index` | Index Markdown d'une collection |
| `fragmint_search_fragments` | Recherche sémantique |
| `fragmint_generate_plan` | Génère un plan structuré |
| `fragmint_compose_section` | Sélectionne les fragments d'une section |
| `fragmint_generate_document` | Génère le document final (pptx/docx) |
| `fragmint_sync_cache` | Sync delta pour cache local |
| `fragmint_upload_context_doc` | Upload doc éphémère pour le contexte |
```

- [ ] **Step 2: Créer `docs/opencode-plugin.md`**

```markdown
# Plugin Fragmint pour OpenCode / Claude Code

## Installation rapide

1. Builder le MCP server :
   ```bash
   pnpm --filter @fragmint/mcp-server build
   ```

2. Configurer le serveur MCP dans Claude Code (`.claude/mcp-servers.json`) :
   ```json
   {
     "fragmint": {
       "command": "node",
       "args": ["packages/mcp-server/dist/index.js"],
       "env": {
         "FRAGMINT_URL": "http://localhost:3210",
         "FRAGMINT_TOKEN": "frag_tok_XXX"
       }
     }
   }
   ```

## Workflow `/fragmint compose`

```
/fragmint compose propale CNB Twake Mail

→ Plan généré (4-6 sections)
→ Validation ou modification du plan
→ Optionnel: joindre un doc de contexte [path: /chemin/vers/brief.pdf]
→ Sélection des fragments par section
→ Génération du document final (pptx/docx)
```

## Tests d'acceptation

1. `fragmint_list_collections` → liste les collections
2. `fragmint_generate_plan` → plan cohérent pour une requête
3. `fragmint_compose_section` → fragments pertinents pour chaque section
4. `fragmint_generate_document` → fichier téléchargeable généré
5. `fragmint_upload_context_doc` → doc chargé, doc_id retourné
6. `fragmint_sync_cache` → delta retourné avec `new_sync_timestamp`
```

- [ ] **Step 3: Validation E2E manuelle**

```bash
# 1. Démarrer le stack
docker compose -f docker/docker-compose.dev.yml up -d

# 2. Lancer le MCP server
cd packages/mcp-server
FRAGMINT_URL=http://localhost:3210 FRAGMINT_TOKEN=<TOKEN> node dist/index.js &

# 3. Appeler tools/list via stdin MCP
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | \
  FRAGMINT_URL=http://localhost:3210 FRAGMINT_TOKEN=<TOKEN> node dist/index.js

# 4. Appeler fragmint_list_collections
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"fragmint_list_collections","arguments":{}}}' | \
  FRAGMINT_URL=http://localhost:3210 FRAGMINT_TOKEN=<TOKEN> node dist/index.js
```

---

## Résumé

### Nouveaux packages
- `packages/mcp-server/` — 8 skills MCP, appels REST vers le backend
- `packages/opencode-plugin/` — cache SQLite + client + commande compose

### Modifications backend
- `packages/server/src/routes/mcp-sync-routes.ts` — endpoint `/v1/mcp/sync-cache`
- `packages/server/src/routes/mcp-context-routes.ts` — endpoints `/v1/mcp/context-docs`
- `packages/server/src/services/context-doc-service.ts` — upload, extraction texte, TTL
- `packages/server/src/index.ts` — enregistrer les nouvelles routes + cron cleanup

### Estimation totale
- Phase 1 (MCP server + backend) : ~1.5 jours
- Phase 2 (plugin + cache) : ~1 jour
- Phase 3 (tests E2E + polish) : ~0.5 jour
- **Total : 3 jours**
