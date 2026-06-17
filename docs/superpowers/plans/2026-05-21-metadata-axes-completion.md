# Metadata Axes Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Propagate `function_type`, `audience`, and `maturity` through all layers — frontmatter Git, fragment service read/write, Milvus schema/index, search filters, and update path — so no data is lost on resync and all axes are searchable.

**Architecture:** Three axes (`function_type`, `audience`, `maturity`) exist in DB and are extracted by the harvester, but are not written to Git frontmatter, not indexed in Milvus, and not exposed as search filters. This plan completes those four missing layers in order: frontmatter schema → service create/update → Milvus schema → search filters.

**Tech Stack:** Node.js, Fastify 5, Drizzle ORM (SQLite), Zod, Milvus 2.4 (`@zilliz/milvus2-sdk-node`), TypeScript

---

## File Map

| File | Change |
|------|--------|
| `packages/server/src/schema/fragment.ts` | Add `function_type`, `audience`, `maturity` to `fragmentFrontmatterSchema` |
| `packages/server/src/services/fragment-service.ts` | Write axes to frontmatter on create; update DB + frontmatter + Milvus on update |
| `packages/server/src/search/search-service.ts` | Add axes to `FragmentMetadata`; pass to Milvus upsert |
| `packages/server/src/search/milvus-client.ts` | Add axes to `MilvusFragment`, collection fields, inverted indexes, filter builder |
| `packages/server/src/routes/fragment-routes.ts` | Add `function_type`, `audience`, `maturity` to list/search query schema + filter pass-through |

---

## Task 1: Add axes to `fragmentFrontmatterSchema`

**Files:**
- Modify: `packages/server/src/schema/fragment.ts`

These fields must be optional with defaults so existing `.md` files without them still parse correctly.

- [ ] **Step 1: Open the file and find `fragmentFrontmatterSchema`**

It is at line 38. The schema currently ends at `valid_from`/`valid_until`. Add three fields after `last_used`:

```typescript
// packages/server/src/schema/fragment.ts — inside fragmentFrontmatterSchema
function_type: z.string().nullable().optional().default(null),
audience: z.array(z.string()).optional().default([]),
maturity: z.string().nullable().optional().default(null),
```

Add after `last_used: z.string().nullable()` (line 57).

- [ ] **Step 2: Verify TypeScript — no errors expected**

```bash
pnpm --filter @fragmint/server exec tsc --noEmit
```

Expected: no output (zero errors).

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/schema/fragment.ts
git commit -m "feat(schema): add function_type, audience, maturity to frontmatter schema"
```

---

## Task 2: Write axes to frontmatter on fragment create

**Files:**
- Modify: `packages/server/src/services/fragment-service.ts` (lines 75–96, the `frontmatter` object)

Currently `frontmatter` is built without `function_type`, `audience`, `maturity`. They are stored in SQLite but NOT written to the `.md` file.

- [ ] **Step 1: Add the three fields to the frontmatter object**

In `fragment-service.ts`, find the `frontmatter` object (around line 75). Add after `origin: input.origin`:

```typescript
const frontmatter = {
  id,
  type: input.type,
  domain: input.domain,
  tags: input.tags,
  lang: input.lang,
  translation_of: input.translation_of,
  quality: 'draft' as const,
  author,
  reviewed_by: null,
  approved_by: null,
  created_at: now,
  updated_at: now,
  valid_from: input.valid_from ?? null,
  valid_until: input.valid_until ?? null,
  parent_id: input.parent_id,
  generation: input.generation,
  uses: 0,
  last_used: null,
  access: input.access,
  origin: input.origin,
  function_type: (input as any).function_type ?? null,
  audience: (input as any).audience ?? [],
  maturity: (input as any).maturity ?? null,
};
```

- [ ] **Step 2: TypeScript check**

```bash
pnpm --filter @fragmint/server exec tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/services/fragment-service.ts
git commit -m "feat(service): write function_type, audience, maturity to Git frontmatter on create"
```

---

## Task 3: Propagate axes through fragment update

**Files:**
- Modify: `packages/server/src/services/fragment-service.ts` (update method ~line 288)

The update path reads frontmatter, applies changes, writes back — but doesn't handle the three new axes.

- [ ] **Step 1: Update the `update` method**

Find the block around line 291 where fields are conditionally applied to `updatedFrontmatter`. Add after `if (input.access) updatedFrontmatter.access = input.access;`:

```typescript
const inp = input as any;
if (inp.function_type !== undefined) (updatedFrontmatter as any).function_type = inp.function_type;
if (inp.audience !== undefined) (updatedFrontmatter as any).audience = inp.audience;
if (inp.maturity !== undefined) (updatedFrontmatter as any).maturity = inp.maturity;
```

- [ ] **Step 2: Update the SQLite `db.update().set()` call (~line 332)**

Add the three fields to the `.set({...})` object:

```typescript
await this.db
  .update(fragments)
  .set({
    type: updatedFrontmatter.type,
    domain: updatedFrontmatter.domain,
    lang: updatedFrontmatter.lang,
    quality: updatedFrontmatter.quality,
    tags: JSON.stringify(updatedFrontmatter.tags ?? []),
    updated_at: updatedFrontmatter.updated_at,
    title: deriveTitle(newBody),
    body_excerpt: newBody.slice(0, 200),
    git_hash: commitHash,
    file_path: newRelPath,
    function_type: (updatedFrontmatter as any).function_type ?? null,
    audience: (updatedFrontmatter as any).audience
      ? JSON.stringify((updatedFrontmatter as any).audience)
      : null,
    maturity: (updatedFrontmatter as any).maturity ?? null,
  })
  .where(eq(fragments.id, id));
```

- [ ] **Step 3: TypeScript check**

```bash
pnpm --filter @fragmint/server exec tsc --noEmit
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/fragment-service.ts
git commit -m "feat(service): propagate function_type, audience, maturity through fragment update"
```

---

## Task 4: Add axes to Milvus schema and `MilvusFragment`

**Files:**
- Modify: `packages/server/src/search/milvus-client.ts`

Milvus needs schema changes. Because the collection schema is fixed at creation time, the collection will be dropped and recreated if dimensions mismatch — but adding new fields requires an explicit drop. The safest approach: add a schema version check. If the new fields are missing, drop and recreate. In practice for dev: just drop manually or rely on the existing dimension-mismatch drop path.

> **Note:** Adding new fields to an existing Milvus collection requires drop + recreate. Existing vectors will be lost and must be reindexed via `reindex()`. This is acceptable — Milvus is a derived index, Git is source of truth.

- [ ] **Step 1: Extend `MilvusFragment` interface**

```typescript
export interface MilvusFragment {
  id: string;
  vector: number[];
  type: string;
  domain: string;
  lang: string;
  quality: string;
  author: string;
  created_at: number;
  updated_at: number;
  tags: string[];
  access_read: string[];
  community_id: number;
  function_type: string;   // '' when null
  audience: string[];
  maturity: string;         // '' when null
}
```

- [ ] **Step 2: Extend `MilvusFilters` interface**

```typescript
export interface MilvusFilters {
  type?: string[];
  domain?: string[];
  lang?: string;
  quality_min?: string;
  tags?: string[];
  function_type?: string[];
  audience?: string[];
  maturity?: string[];
}
```

- [ ] **Step 3: Add fields to `buildFilterExpr`**

After the `tags` filter block, add:

```typescript
if (filters.function_type?.length) {
  const vals = filters.function_type.map((v) => `"${v}"`).join(', ');
  parts.push(`function_type in [${vals}]`);
}
if (filters.audience?.length) {
  // audience is a JSON array field — use JSON_CONTAINS for each value
  filters.audience.forEach((a) => {
    parts.push(`json_contains(audience, "${a}")`);
  });
}
if (filters.maturity?.length) {
  const vals = filters.maturity.map((v) => `"${v}"`).join(', ');
  parts.push(`maturity in [${vals}]`);
}
```

- [ ] **Step 4: Add fields to `createCollection` call**

Inside `ensureCollection`, add to the `fields` array:

```typescript
{ name: 'function_type', data_type: DataType.VarChar, max_length: 64, default_value: '' },
{ name: 'audience', data_type: DataType.JSON },
{ name: 'maturity', data_type: DataType.VarChar, max_length: 32, default_value: '' },
```

- [ ] **Step 5: Add INVERTED indexes for `function_type` and `maturity`**

After `for (const field of ['domain', 'type', 'lang', 'quality'])`, add:

```typescript
for (const field of ['function_type', 'maturity'] as const) {
  try {
    await this.sdk.createIndex({
      collection_name: this.collectionName,
      field_name: field,
      index_type: 'INVERTED',
    });
  } catch { /* already exists */ }
}
```

- [ ] **Step 6: Add schema version check to force drop when new fields missing**

In `ensureCollection`, after checking dimension mismatch, add:

```typescript
if (exists.value) {
  const desc = await this.sdk.describeCollection({ collection_name: this.collectionName });
  const fieldNames = desc.schema?.fields?.map((f: any) => f.name) ?? [];
  const missingFields = ['function_type', 'audience', 'maturity'].filter(
    (f) => !fieldNames.includes(f),
  );
  if (missingFields.length > 0) {
    console.warn(`[milvus] schema missing fields ${missingFields.join(', ')} — recreating collection`);
    await this.sdk.dropCollection({ collection_name: this.collectionName });
  }
}
```

- [ ] **Step 7: TypeScript check**

```bash
pnpm --filter @fragmint/server exec tsc --noEmit
```

Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/search/milvus-client.ts
git commit -m "feat(milvus): add function_type, audience, maturity to schema and filters"
```

---

## Task 5: Pass axes through `FragmentMetadata` and `indexFragment`

**Files:**
- Modify: `packages/server/src/search/search-service.ts`

`FragmentMetadata` and `indexFragment` don't carry the three axes, so they are never upserted to Milvus.

- [ ] **Step 1: Extend `FragmentMetadata`**

```typescript
export interface FragmentMetadata {
  type: string;
  domain: string;
  lang: string;
  quality: string;
  author: string;
  tags: string[];
  access_read: string[];
  created_at: string;
  updated_at: string;
  function_type?: string | null;
  audience?: string[];
  maturity?: string | null;
}
```

- [ ] **Step 2: Pass axes in the `upsert` call inside `indexFragment`**

```typescript
await this.milvusClient.upsert(
  [
    {
      id,
      vector,
      type: metadata.type,
      domain: metadata.domain,
      lang: metadata.lang,
      quality: metadata.quality,
      author: metadata.author,
      created_at: new Date(metadata.created_at).getTime(),
      updated_at: new Date(metadata.updated_at).getTime(),
      tags: metadata.tags,
      access_read: metadata.access_read,
      community_id: 0,
      function_type: metadata.function_type ?? '',
      audience: metadata.audience ?? [],
      maturity: metadata.maturity ?? '',
    },
  ],
  partitionName,
);
```

- [ ] **Step 3: Update all `indexFragment` call sites in `fragment-service.ts`**

There are two call sites: in `create` and in `update`. Both need to pass the axes.

In `create` (~line 142), find `this.searchService.indexFragment(...)` and add the metadata:

```typescript
await this.searchService.indexFragment(id, input.body, {
  type: input.type,
  domain: input.domain,
  lang: input.lang,
  quality: 'draft',
  author,
  tags: input.tags,
  access_read: input.access?.read ?? [],
  created_at: now,
  updated_at: now,
  function_type: (input as any).function_type ?? null,
  audience: (input as any).audience ?? [],
  maturity: (input as any).maturity ?? null,
}, collectionSlug ? toMilvusPartition(collectionSlug) : undefined);
```

In `update` (~line 356), extend the existing call:

```typescript
await this.searchService.indexFragment(id, newBody, {
  type: updatedFrontmatter.type,
  domain: updatedFrontmatter.domain,
  lang: updatedFrontmatter.lang,
  quality: updatedFrontmatter.quality,
  author: updatedFrontmatter.author,
  tags: updatedFrontmatter.tags,
  access_read: updatedFrontmatter.access.read,
  created_at: updatedFrontmatter.created_at,
  updated_at: updatedFrontmatter.updated_at,
  function_type: (updatedFrontmatter as any).function_type ?? null,
  audience: (updatedFrontmatter as any).audience ?? [],
  maturity: (updatedFrontmatter as any).maturity ?? null,
});
```

- [ ] **Step 4: TypeScript check**

```bash
pnpm --filter @fragmint/server exec tsc --noEmit
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/search/search-service.ts packages/server/src/services/fragment-service.ts
git commit -m "feat(search): pass function_type, audience, maturity through Milvus indexing"
```

---

## Task 6: Expose axes as search/list filters in routes

**Files:**
- Modify: `packages/server/src/routes/fragment-routes.ts`

- [ ] **Step 1: Find the list query schema**

Locate `ListFragmentsSchema` or the inline Zod schema for `GET /fragments`. Add the three filters:

```typescript
function_type: z.string().optional(),
audience: z.string().optional(),   // comma-separated: "technical,decision-maker"
maturity: z.string().optional(),
```

- [ ] **Step 2: Find the search query schema**

Locate the search route schema. Add the same three fields.

- [ ] **Step 3: Pass filters into `SearchFilters` in the route handlers**

In the search handler, extend the filters object passed to `fragmentService.search()`:

```typescript
{
  ...existingFilters,
  function_type: query.function_type ? query.function_type.split(',') : undefined,
  audience: query.audience ? query.audience.split(',') : undefined,
  maturity: query.maturity ? query.maturity.split(',') : undefined,
}
```

- [ ] **Step 4: Extend `SearchFilters` in `search-service.ts`**

```typescript
export interface SearchFilters {
  type?: string[];
  domain?: string[];
  lang?: string;
  quality?: string;
  quality_min?: string;
  tags?: string[];
  collectionSlug?: string;
  valid_at?: string;
  function_type?: string[];
  audience?: string[];
  maturity?: string[];
}
```

- [ ] **Step 5: Pass `function_type`, `audience`, `maturity` into `MilvusFilters` in `search-service.ts`**

In the method that builds `MilvusFilters`, add:

```typescript
function_type: filters.function_type,
audience: filters.audience,
maturity: filters.maturity,
```

- [ ] **Step 6: TypeScript check**

```bash
pnpm --filter @fragmint/server exec tsc --noEmit
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/routes/fragment-routes.ts packages/server/src/search/search-service.ts
git commit -m "feat(routes): expose function_type, audience, maturity as search/list filters"
```

---

## Task 7: Reindex Milvus after schema change

After the Milvus schema is updated (Task 4), existing vectors are gone. Run reindex to rebuild from SQLite + Git.

- [ ] **Step 1: Start the server**

```bash
docker compose -f docker-compose.dev.yml up
```

- [ ] **Step 2: Trigger reindex via API**

```bash
curl -X POST http://localhost:3210/v1/admin/reindex \
  -H "Authorization: Bearer <admin-token>"
```

Or use the admin UI reindex button if available.

- [ ] **Step 3: Verify vectors have the new fields**

```bash
# Check Milvus collection schema
curl http://localhost:3210/v1/admin/milvus/status \
  -H "Authorization: Bearer <admin-token>"
```

Expected: collection fields include `function_type`, `audience`, `maturity`.

- [ ] **Step 4: Final typecheck + lint**

```bash
pnpm --filter @fragmint/server exec tsc --noEmit
pnpm lint
```

Expected: no errors.

---

## Self-Review

**Spec coverage:**
- ✅ `function_type`, `audience`, `maturity` in frontmatter → Task 1 + Task 2
- ✅ Update path → Task 3
- ✅ Milvus schema + indexes → Task 4
- ✅ Milvus upsert payload → Task 5
- ✅ Search/list filter API → Task 6
- ✅ Reindex after schema change → Task 7

**Gaps:**
- `indexBatch` in `search-service.ts` also calls upsert — check it passes the new fields similarly to `indexFragment` (same pattern, add `function_type`/`audience`/`maturity` from each item's metadata)
- The `read` path in `fragment-service.ts` (getById, list) may not return `function_type`/`audience`/`maturity` from SQLite — verify the select includes these columns and they are returned in the API response
