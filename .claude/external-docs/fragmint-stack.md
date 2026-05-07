# Fragmint Stack Reference

Technical reference for Fragmint's dependencies and patterns. Read when implementing features that touch any of these technologies.

---

## Fastify 5

### Plugin Registration

```typescript
// index.ts — services as Fastify decorators
app.decorate('fragmentService', new FragmentService(db, config.store_path));

// Declare type augmentation
declare module 'fastify' {
  interface FastifyInstance {
    fragmentService: FragmentService;
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

// Route files register themselves
app.register(fragmentRoutes);
```

### Route Schema Validation

Fastify validates + types request data via JSON Schema or Zod-to-JSON-Schema:

```typescript
app.get('/v1/fragments', {
  schema: { querystring: ListFragmentsSchema },
}, async (req, reply) => {
  // req.query is typed as z.infer<typeof ListFragmentsSchema>
});
```

### Auth Hook

```typescript
app.post('/v1/fragments', {
  preHandler: [app.authenticate],  // verifies Bearer token
}, async (req, reply) => {
  const { role, collection_slug } = req.user;  // set by middleware
});
```

### Error Responses

Fastify auto-formats validation errors. For custom errors:

```typescript
return reply.code(404).send({ error: 'Fragment not found', id });
return reply.code(400).send({ error: 'Invalid request', detail: message });
return reply.code(403).send({ error: 'Insufficient permissions' });
```

### Logging

```typescript
req.log.info({ fragment_id: id, action: 'created' }, 'Fragment created');
req.log.warn({ slot: slot.key }, 'Slot skipped');
req.log.error({ err }, 'Unexpected error in harvest');
```

Never use `console.log` in server code.

---

## Drizzle ORM + SQLite

### Schema Definition

```typescript
// packages/server/src/db/schema.ts
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const fragments = sqliteTable('fragments', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  domain: text('domain').notNull(),
  lang: text('lang').notNull(),
  quality: text('quality').notNull().default('draft'),
  body: text('body').notNull(),
  collection_slug: text('collection_slug').notNull().default('common'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});
```

### Queries

```typescript
import { db } from '../db/index.js';
import { fragments } from '../db/schema.js';
import { eq, and, gte, like, or, sql } from 'drizzle-orm';

// Select with filter
const results = await db.select()
  .from(fragments)
  .where(and(
    eq(fragments.type, type),
    eq(fragments.lang, lang),
    eq(fragments.quality, 'approved'),
    gte(fragments.created_at, since),
  ))
  .limit(20);

// Insert
await db.insert(fragments).values({ id, type, domain, ... });

// Update
await db.update(fragments)
  .set({ quality: 'approved', updated_at: now })
  .where(eq(fragments.id, id));

// Delete
await db.delete(fragments).where(eq(fragments.id, id));

// Full-text search via LIKE
const rows = await db.select().from(fragments)
  .where(or(
    like(fragments.body, `%${term}%`),
    like(fragments.type, `%${term}%`),
  ))
  .limit(limit);
```

### DB Access

Database is initialized in `packages/server/src/db/index.ts` and passed to services via constructor. Never import `db` directly from route files.

---

## Zod Schemas

### Location

All schemas in `packages/server/src/schema/`. One file per resource.

### Patterns

```typescript
import { z } from 'zod';

// Query params (GET): use .coerce for numbers from query string
export const ListFragmentsSchema = z.object({
  type: z.string().optional(),
  lang: z.enum(['fr', 'en', 'de']).optional(),
  quality: z.enum(['draft', 'reviewed', 'approved']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  valid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// Body (POST/PATCH): no coerce needed (JSON is already parsed)
export const CreateFragmentSchema = z.object({
  type: z.string().min(1),
  domain: z.string().min(1),
  lang: z.string().min(1).max(5),
  body: z.string().min(1),
  quality: z.enum(['draft', 'reviewed', 'approved']).default('draft'),
  tags: z.array(z.string()).optional().default([]),
});

// Always export the inferred type
export type ListFragmentsQuery = z.infer<typeof ListFragmentsSchema>;
export type CreateFragmentBody = z.infer<typeof CreateFragmentSchema>;
```

---

## Milvus Vector DB

### Connection Pattern

```typescript
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

const milvus = new MilvusClient({ address: config.milvus_address });
```

### Always Guard with `milvus_enabled`

```typescript
if (!config.milvus_enabled) {
  return [];  // graceful degradation to SQLite search
}
```

### Collection & Partition Names

Collections map to Milvus partitions:
```typescript
import { toMilvusPartition } from '../db/schema.js';
// toMilvusPartition('common') → 'col_common'
// toMilvusPartition('my-team') → 'col_my_team'
```

### Search Pattern

```typescript
const results = await milvus.search({
  collection_name: 'fragments',
  partition_names: [toMilvusPartition(collectionSlug)],
  data: [embedding],
  anns_field: 'embedding',
  params: { nprobe: 10 },
  limit: 20,
  output_fields: ['id', 'quality'],
});
```

### IVF_FLAT Index

Fragmint uses `IVF_FLAT` with cosine distance, 768-dimensional embeddings (nomic-embed-text-v2-moe).

---

## Embedding Client

### API

```typescript
// packages/server/src/search/embedding-client.ts
const embeddings = await embeddingClient.embed(['text to embed']);
// Returns: number[][] — one array per input string

const single = embeddings[0];  // number[] of length 768
```

### Prefixes

SearchService applies prefixes BEFORE embedding:
- Documents: `search_document: {text}` (at index time)
- Queries: `search_query: {text}` (at search time)

EmbeddingClient itself is prefix-agnostic.

---

## LLM Client

```typescript
// packages/server/src/services/llm-client.ts
const response = await llmClient.complete([
  { role: 'system', content: 'You are a document classifier.' },
  { role: 'user', content: documentText },
]);
// Returns: string (LLM response content)
```

Default timeout: 60s. Configure via `FRAGMINT_LLM_TIMEOUT` (ms).

---

## React + shadcn/ui (Web Package)

### Component Pattern

```typescript
// packages/web/src/components/fragment-list.tsx
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function FragmentList() {
  const [fragments, setFragments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/v1/fragments')
      .then(r => r.json())
      .then(data => setFragments(data.fragments ?? []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading...</div>;
  return <ul>{fragments.map(f => <li key={f.id}>{f.body}</li>)}</ul>;
}
```

### API Base URL

The web dev server proxies `/v1/` to the Fastify server. Never hardcode `http://localhost:3333`.

---

## docx-templates Syntax

**Critical**: This is NOT Handlebars. Use `+++` syntax in Word `.docx` files:

| Operation | Syntax |
|-----------|--------|
| Variable | `{variableName}` |
| Object property | `{object.property}` |
| Loop start | `+++FOR item IN items+++` |
| Loop end | `+++END-FOR item+++` |
| Conditional | `+++IF condition+++` |
| Conditional end | `+++END-IF+++` |
| Exec block | `+++EXEC result = expr+++` |

Template data structure passed by ComposerService:
```typescript
{
  fragments: {
    slotKey: { body, id, quality, ...structuredTags },
    // or array if count > 1
  },
  metadata: {
    ...context,
    generated_at: ISO string,
    total_ht?: "1 234,50",   // if pricing
    tva?: "246,90",
    total_ttc?: "1 481,40",
  },
  ...structuredData,  // lignes, etc.
}
```

---

## Fragment Lifecycle

```
draft → reviewed → approved → deprecated
```

- `draft`: contributor can create/edit
- `reviewed`: expert has reviewed (read-only for contributor)
- `approved`: ready for production use (read-only for expert)
- `deprecated`: no longer recommended (shown with warning)

Quality affects re-ranking score in search:
- `approved` → ×1.0 (full score)
- `reviewed` → ×0.95
- `draft` → ×0.80

---

## Git-SQLite Sync

Fragments are stored as `.md` files with YAML frontmatter in the vault Git repo. SQLite is rebuilt from Git on server startup.

```
<vault>/fragments/<collection>/<slug>.md
```

The `fragment_service.ts` handles Git operations (create commit, read history) via `simple-git`.

When writing to a fragment:
1. Write `.md` file to vault
2. Git commit
3. Update SQLite record
4. Trigger Milvus re-index (if enabled)

---

## MCP Server (packages/mcp)

9 tools served over stdin/stdout (JSON-RPC):

| Tool | Description |
|------|-------------|
| `collection_list` | List available collections |
| `fragment_inventory` | List fragments with filters |
| `fragment_search` | Semantic or text search |
| `fragment_get` | Get fragment by ID |
| `fragment_create` | Create new fragment |
| `fragment_update` | Update existing fragment |
| `fragment_lineage` | Get Git history for a fragment |
| `document_compose` | Compose document from template |
| `fragment_harvest` | Extract fragments from document |

MCP tools call the Fragmint HTTP API. Configure via `FRAGMINT_API_URL`.

---

## pnpm Workspace Commands

```bash
# Run in specific package
pnpm --filter @fragmint/server <command>
pnpm --filter @fragmint/web <command>
pnpm --filter @fragmint/mcp <command>

# Run in all packages
pnpm -r <command>

# Install dependency in server package
pnpm --filter @fragmint/server add <package>

# Development
pnpm --filter @fragmint/server dev    # server on :3333
pnpm --filter @fragmint/web dev       # web on :5173

# Validation
pnpm --filter @fragmint/server typecheck
pnpm lint
pnpm test
pnpm build
pnpm e2e
```
