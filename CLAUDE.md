# Fragmint — Development Rules for AI Agents

> **For AI agents**: Read this file at the start of every session. It defines the architecture, patterns, and conventions for this project.

## What is Fragmint?

Fragmint is a **sovereign AI-assisted documentation system**: a fragment library with Git versioning, semantic search (Milvus), and document composition (docx/xlsx/slides). It runs locally (Ollama) or remotely (ai.linagora.com).

Three core flows:
- **SEARCH**: query → embed → Milvus cosine similarity → re-rank → fragments
- **COMPOSE**: template YAML → resolve fragment slots (SQL) → render document
- **HARVEST**: upload → Pandoc → LLM segment → LLM classify → human validation

---

## Repository Structure

```
fragmint/                         # pnpm workspace monorepo
├── packages/
│   ├── server/src/               # Fastify 5 API + all business logic
│   │   ├── config.ts             # All env var defaults
│   │   ├── index.ts              # Server bootstrap
│   │   ├── auth/                 # Token auth middleware
│   │   ├── db/                   # Drizzle ORM + SQLite schema
│   │   ├── routes/               # Fastify route files (one per resource)
│   │   ├── services/             # Business logic services
│   │   ├── search/               # Embedding + Milvus search
│   │   └── schema/               # Zod schemas for validation/typing
│   ├── web/src/                  # React 19 + shadcn/ui + Tailwind frontend
│   │   ├── components/           # Shared UI components
│   │   └── ...
│   ├── mcp/src/                  # MCP server (9 tools over stdin/stdout)
│   └── cli/src/                  # CLI tooling
├── example-vault/                # Git-managed fragment store (dev/demo)
├── e2e/                          # Playwright end-to-end tests
└── docker-compose.yml            # Milvus + etcd + minio services
```

---

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20+ |
| Server framework | Fastify 5 |
| ORM | Drizzle (SQLite via better-sqlite3) |
| Vector DB | Milvus 2.4 (optional, `milvus_enabled: false` by default) |
| Embeddings | Ollama `nomic-embed-text-v2-moe` (768D) or ai.linagora.com |
| LLM | Ollama `mistral-nemo:12b` or ai.linagora.com |
| Frontend | React 19 + shadcn/ui + Tailwind CSS |
| Package manager | pnpm (workspace) |
| Testing | Vitest (unit), Playwright (e2e) |
| Validation | Zod |
| Git management | simple-git |

---

## Validation Commands

Run these before every commit:

```bash
# Type check (server)
pnpm --filter @fragmint/server typecheck

# Type check (web)
pnpm --filter @fragmint/web typecheck

# Lint (all packages)
pnpm lint

# Unit tests
pnpm test

# Full build
pnpm build

# End-to-end tests (requires running server + Ollama)
pnpm e2e
```

---

## Local Development Workflow

Full Docker stack with hot reload — server restarts automatically on code changes, no rebuild needed.

```bash
# First time only — build the dev image
docker compose -f docker/docker-compose.dev.yml build

# Start everything (Milvus + server with hot reload)
docker compose -f docker/docker-compose.dev.yml up

# Frontend (separate terminal — Vite HMR on port 5173)
pnpm --filter @fragmint/web dev
```

- Server: http://localhost:3210
- Frontend (Vite): http://localhost:5173

Only `packages/server/src/` is mounted — node_modules stays intact inside the image (Linux binaries compiled for Alpine). Changes to `src/` files trigger automatic server restart via tsx watch.

If you add a new dependency (`pnpm add ...`), rebuild the image:
```bash
docker compose -f docker/docker-compose.dev.yml build --no-cache
```

---

## Key Service Patterns

### Fastify Route Registration

```typescript
// packages/server/src/routes/fragments.ts
import type { FastifyInstance } from 'fastify';

export async function fragmentRoutes(app: FastifyInstance) {
  app.get('/v1/fragments', {
    schema: { querystring: ListFragmentsSchema },
  }, async (req, reply) => {
    const results = await req.server.fragmentService.list(req.query);
    return reply.send(results);
  });
}
```

Routes are registered in `index.ts` via `app.register(fragmentRoutes)`. Services are attached to `app` as decorators.

### Service Pattern

Services are class-based, injected as Fastify decorators. Dependencies are passed in constructors:

```typescript
// packages/server/src/services/fragment-service.ts
export class FragmentService {
  constructor(
    private db: DrizzleDb,
    private searchService: SearchService,
    private basePath: string,
  ) {}

  async list(params: ListParams): Promise<Fragment[]> { ... }
  async getById(id: string): Promise<Fragment | null> { ... }
}
```

### Drizzle Query Pattern

```typescript
import { db } from '../db/index.js';
import { fragments } from '../db/schema.js';
import { eq, and, gte } from 'drizzle-orm';

const results = await db
  .select()
  .from(fragments)
  .where(
    and(
      eq(fragments.type, type),
      eq(fragments.lang, lang),
      gte(fragments.created_at, since),
    )
  )
  .limit(limit);
```

### Zod Schema Pattern

```typescript
// packages/server/src/schema/fragment.ts
import { z } from 'zod';

export const ListFragmentsSchema = z.object({
  type: z.string().optional(),
  lang: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListFragmentsQuery = z.infer<typeof ListFragmentsSchema>;
```

---

## Fragment Storage Model

- **Git** = source of truth for history and content (`.md` files with YAML frontmatter)
- **SQLite** = production read source (Drizzle ORM, synced from Git on startup)
- **Milvus** = derived vector index (rebuilt via `reindex()`, optional)

Fragment files live in `<vault>/fragments/<collection>/<slug>.md`. Format:

```markdown
---
id: abc-123
type: introduction
domain: cloud
lang: fr
quality: reviewed
tags: ["produit:Twake Workplace", "pu:4.50"]
valid_from: 2024-01-01
valid_until: 2025-12-31
---

Fragment body content here.
```

---

## Auth Model

API tokens: `frag_tok_<48-hex-chars>`. Stored as SHA256 hash + scrypt-verified secret.

```typescript
// Auth middleware reads Authorization: Bearer <token>
// Sets req.user = { role, collection_slug? }
// Roles: reader | contributor | expert | admin (global)
//        reader | contributor | expert | manager | owner (per collection)
```

Collections: `common` (default), slugs map to Milvus partitions via `toMilvusPartition(slug)` = `'col_' + slug.replace(/-/g, '_')`.

---

## AI/Embedding Patterns

### EmbeddingClient

```typescript
// Uses OpenAI-compatible format: input is ARRAY, not string
await embeddingClient.embed(['text to embed']);
// Returns: number[] (single embedding from data[0])
```

### Search Re-ranking

Quality multipliers applied AFTER Milvus cosine similarity:
- `approved` → ×1.0
- `reviewed` → ×0.95
- `draft` → ×0.80

Plus freshness boost and usage momentum (see `search-service.ts`).

### LLM Client

```typescript
// Calls /v1/chat/completions (OpenAI-compatible)
await llmClient.complete([
  { role: 'system', content: systemPrompt },
  { role: 'user', content: userContent },
]);
// Default timeout: 60s (FRAGMINT_LLM_TIMEOUT)
```

---

## Scoring Architecture

Three scoring systems — each has a specific algorithm:

| System | File | Algorithm |
|--------|------|-----------|
| Retrieval hybrid | `retrieval/hybrid-retriever.ts` | RRF (Cormack 2009), k=60 |
| Retrieval vector-only | `retrieval/vector-retriever.ts` | Milvus cosine + quality re-rank |
| Duplicate detection | `services/harvester-pipeline.ts` | Cascade: hash → shingles (0.70, configurable) → cosine (0.65) |
| Supersedure pre-filter | `services/supersedure-detector.ts` | Jaccard shingles k=3, threshold 0.20 |

Key invariants:
- SQLite LIKE fallback → `score: null` (never a fake constant)
- Vector scores capped at 1.0 (re-ranking can exceed 1.0)
- `score_breakdown` is always optional — old plan state JSON without it is backward-compat
- Shingles utility lives in `services/dedupe/shingles.ts` (zero npm deps)
- Full docs: `docs/scoring.md`

---

## Template Syntax (docx-templates)

**NOT Handlebars.** Use docx-templates syntax in Word files:

```
{name}                           ← simple variable
+++FOR row IN lignes+++          ← loop start
  {row.description}
+++END-FOR row+++                ← loop end
+++IF condition+++               ← conditional
+++END-IF+++
```

Data is passed as `{ fragments, metadata, ...structuredData }`.

---

## File Size Limits

- **Target**: < 300 lines per file
- **Max**: 400 lines per file
- **Hard limit**: 500 lines (refactor immediately)

---

## Naming Conventions

- `kebab-case.ts` for TypeScript files
- `camelCase` for functions and variables
- `PascalCase` for classes and types
- Services: `*-service.ts` (e.g., `fragment-service.ts`)
- Routes: `*s.ts` (plural, e.g., `fragments.ts`)
- Schemas: in `schema/` directory, named after resource

---

## Testing

- Unit tests: Vitest, co-located or in `__tests__/`
- E2E: Playwright, in `e2e/`
- No mocking of SQLite — use in-memory DB for unit tests
- API tests: test through Fastify's `inject()` method

---

## Git Workflow

Commit message format: `<type>(<scope>): <description>`

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

Examples:
```
feat(search): add quality re-ranking to semantic search
fix(composer): handle missing fragment slot fallback
docs(mcp): update fragment_search tool description
```

Atomic commits — one logical change per commit.

---

## Security Checklist

Before every commit:
- [ ] No hardcoded secrets or API keys
- [ ] Input validated with Zod on all routes
- [ ] Auth middleware applied to protected routes
- [ ] No SQL injection (use Drizzle, never raw SQL with user input)
- [ ] Tokens not logged
- [ ] File paths sanitized (no path traversal)

---

## Environment Configuration

All config in `packages/server/src/config.ts`. Key variables:

```
FRAGMINT_STORE_PATH          # vault path (default: ./example-vault)
FRAGMINT_LLM_ENDPOINT        # LLM base URL (default: http://localhost:11434/v1)
FRAGMINT_EMBEDDING_ENDPOINT  # Embedding base URL (default: http://localhost:11434/v1)
FRAGMINT_LLM_MODEL           # LLM model (default: mistral-nemo:12b)
FRAGMINT_EMBEDDING_MODEL     # Embedding model (default: nomic-embed-text-v2-moe)
FRAGMINT_MILVUS_ENABLED      # Enable Milvus (default: false)
FRAGMINT_PORT                # API port (default: 3333)
```

---

## AI Agent Instructions

### For Code Review Agent
1. Check Zod validation on all route inputs
2. Check auth middleware on protected routes
3. Check file sizes (<300 lines)
4. Check Drizzle query patterns (no raw SQL with user input)
5. Check Fastify plugin/decorator patterns
6. Check service constructor injection (no hidden globals)

### For Coder Agent
1. Read this file + the relevant service file before coding
2. Follow the Fastify route registration pattern
3. Use Drizzle for all DB access
4. Validate inputs with Zod
5. Place new services in `packages/server/src/services/`
6. Place new routes in `packages/server/src/routes/`
7. Export new schemas from `packages/server/src/schema/`

### For Planning Agent
1. Identify which package (server/web/mcp/cli) is affected
2. Check if Milvus or SQLite change is needed
3. Plan for Zod schema changes before route changes
4. Consider fragment lifecycle (draft→reviewed→approved) for data changes

---

## Resources

- Architecture reference: `docs/mission/system-architecture.md` (local only, gitignored)
- System architecture reference: `.claude/external-docs/system-architecture.md` (detailed flows: search, compose, harvest)
- Stack patterns: `.claude/external-docs/fragmint-stack.md`
- API schema: `packages/server/src/schema/`
- DB schema: `packages/server/src/db/schema.ts`
- Config defaults: `packages/server/src/config.ts`
- Mission context: `.claude/mission/MISSION.md` (scope, priorities, decisions log)
- Bug tracking: `.claude/mission/BUGS.md` (all bugs with status — fix ALL before new features)
- Execution plan: `.claude/mission/PLAN.md` (20-day plan, current day status)
- Eval methodology: `.claude/mission/EVALS.md` (golden dataset + LLM-as-a-judge patterns)
- LLM Wiki pattern: `.claude/external-docs/llm-wiki-karpathy.md` (Karpathy — fondation conceptuelle : fragments=wiki pages, harvest=ingest, search=query, Git=log)

---

**Last Updated**: 2026-05-03
**Mission**: 20-day Linagora internship — sovereign AI-assisted document management
