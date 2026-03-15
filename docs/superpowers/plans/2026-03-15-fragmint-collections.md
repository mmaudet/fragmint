# Collections Feature Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Fragmint from single-tenant to multi-team with isolated collections (Git repos + Milvus partitions), per-collection roles via DB lookup, and cross-collection composition.

**Architecture:** New `collections` and `collection_memberships` tables. `CollectionService` manages lifecycle (create, members, tokens). Auth middleware does per-request DB lookup instead of JWT-embedded roles. All fragment/template/harvest routes prefixed with `/v1/collections/:slug/`. Existing `/v1/fragments` redirects to `/v1/collections/common/fragments`. Auto-migration at startup creates `common` from existing vault.

**Tech Stack:** Drizzle ORM (SQLite), Fastify routes, React Context (collection selector), MCP tools extension

**Spec:** `docs/superpowers/specs/2026-03-15-fragmint-collections-design.md`

---

## Chunk 1: Schema + Config + Migration

### Task 1: Add collections tables, config, and auto-migration

**Files:**
- Modify: `packages/server/src/db/schema.ts`
- Modify: `packages/server/src/db/connection.ts`
- Modify: `packages/server/src/config.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Read existing schema.ts, connection.ts, config.ts, and index.ts**

Understand existing patterns for table definitions, CREATE TABLE statements, config loading, and server startup.

- [ ] **Step 2: Add tables to schema.ts**

Add `collections` and `collectionMemberships` tables (as defined in spec). Add `collection_slug` column to existing `apiTokens` table.

- [ ] **Step 3: Add CREATE TABLE statements in connection.ts**

Follow existing pattern. Add for `collections`, `collection_memberships`, and `ALTER TABLE api_tokens ADD COLUMN collection_slug TEXT` (use `try/catch` since column may already exist).

- [ ] **Step 4: Add config fields**

In `config.ts`, add:
- `collections_path`: from `FRAGMINT_COLLECTIONS_PATH`. Fallback: if `FRAGMINT_REPO_PATH` set, use `dirname(REPO_PATH)`. Default: `'./data/collections'`
- Log warning if `FRAGMINT_REPO_PATH` is used: `"FRAGMINT_REPO_PATH is deprecated, use FRAGMINT_COLLECTIONS_PATH"`

- [ ] **Step 5: Add auto-migration logic in index.ts**

After DB creation but before service initialization, add a function `ensureCollections(db, config)`:

```typescript
async function ensureCollections(db, config) {
  // Check if collections table is empty
  const existing = await db.select().from(collections).limit(1);
  if (existing.length > 0) return; // Already migrated

  console.log('Migration: creating common collection from existing vault...');

  // Determine git_path for common
  const commonGitPath = config.store_path; // existing vault path

  // Create common collection
  const commonId = `col-${randomUUID()}`;
  await db.insert(collections).values({
    id: commonId,
    slug: 'common',
    name: 'Common',
    type: 'system',
    read_only: 0,
    auto_assign: 1,
    git_path: commonGitPath,
    milvus_partition: 'col_common',
    owner_id: null,
    description: 'Fragments partagés dans toute l\'organisation',
    tags: JSON.stringify([]),
    created_at: new Date().toISOString(),
    created_by: 'system',
  });

  // Assign all existing users to common
  const users = await db.select().from(usersTable);
  for (const user of users) {
    await db.insert(collectionMemberships).values({
      id: `cmb-${randomUUID()}`,
      collection_id: commonId,
      user_id: user.id,
      token_id: null,
      role: user.role === 'admin' ? 'expert' : 'reader',
      granted_by: 'system',
      granted_at: new Date().toISOString(),
      expires_at: null,
    });
  }

  console.log(`Migration: common collection created, ${users.length} users assigned`);
}
```

Call `await ensureCollections(db, config)` in `createServer()` after DB init.

- [ ] **Step 6: Add `toMilvusPartition` helper**

Create a shared helper (can live in a utils file or in schema.ts):
```typescript
export function toMilvusPartition(slug: string): string {
  return 'col_' + slug.replace(/-/g, '_');
}
```

- [ ] **Step 7: Run existing tests to verify nothing breaks**

```bash
cd /Users/mmaudet/work/fragmint/packages/server && npx vitest run
```

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/
git commit -m "feat(db): add collections and memberships tables, config, auto-migration"
```

---

## Chunk 2: CollectionService + Auth Middleware

### Task 2: Implement CollectionService

**Files:**
- Create: `packages/server/src/services/collection-service.ts`
- Create: `packages/server/src/services/collection-service.test.ts`

- [ ] **Step 1: Read existing service patterns**

Read `fragment-service.ts` for constructor, DB, Git patterns.

- [ ] **Step 2: Implement CollectionService**

Constructor: `(db, config)`

Methods:
- `create(params: { slug, name, type, description?, tags?, ownerId? }, createdBy: string)` — validate slug (lowercase, alphanum + hyphens, unique), insert in DB, `git init` the repo at `${config.collections_path}/${slug}`, create Milvus partition if available. If type=personal, add owner as member with role 'owner'. If type=system and auto_assign, add all existing users.
- `listForUser(userId: string)` — join collections + memberships, return `{ ...collection, role }[]`
- `getBySlug(slug: string)` — query by slug, return collection or null
- `addMember(collectionSlug, userId, role, grantedBy)` — validate role hierarchy (granter must have strictly higher role), insert membership
- `removeMember(collectionSlug, userId)` — delete membership (cannot remove owner)
- `createExternalToken(collectionSlug, role, name, expiresAt?)` — create API token with `collection_slug` set
- `checkAccess(userId, tokenId, collectionSlug, minRole)` — lookup membership, check role hierarchy
- `ensurePersonalCollection(userId, login)` — create `personal-{login}` if not exists, return collection
- `assignSystemCollections(userId)` — insert memberships for all system collections with auto_assign
- `delete(collectionSlug, force)` — if empty or force: delete memberships, delete collection, rm repo dir. Error if not empty and not force.
- `getAccessibleSlugs(userId)` — return all collection slugs the user has access to (for cross-collection search)

- [ ] **Step 3: Write tests**

5-6 tests:
1. `create()` creates a team collection with Git repo
2. `listForUser()` returns collections with roles
3. `addMember()` inserts membership
4. `checkAccess()` returns true for valid membership
5. `checkAccess()` returns false for no membership
6. `ensurePersonalCollection()` creates collection on first call, returns existing on second

Setup: in-memory DB, mock config with temp directory for collections_path.

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/services/collection-service.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/collection-service.*
git commit -m "feat(server): add CollectionService with CRUD, members, and access control"
```

### Task 3: Update auth middleware for per-collection access

**Files:**
- Modify: `packages/server/src/auth/middleware.ts`

- [ ] **Step 1: Read existing auth middleware**

Understand `buildAuthMiddleware`, `requireRole`, `hasRole`, and how `request.user` is populated.

- [ ] **Step 2: Add collection role helper and middleware**

Add to the auth module:

```typescript
// Role hierarchy for collections (includes manager and owner)
const COLLECTION_ROLE_HIERARCHY: Record<string, number> = {
  reader: 0, contributor: 1, expert: 2, manager: 3, owner: 4,
};

export function hasCollectionRole(userRole: string, requiredRole: string): boolean {
  return (COLLECTION_ROLE_HIERARCHY[userRole] ?? -1) >= (COLLECTION_ROLE_HIERARCHY[requiredRole] ?? 999);
}

export function requireCollectionRole(minRole: string, collectionService: CollectionService) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { slug } = request.params as { slug: string };
    if (!slug) {
      return reply.status(400).send({ data: null, meta: null, error: 'Collection slug required' });
    }

    const collection = await collectionService.getBySlug(slug);
    if (!collection) {
      return reply.status(404).send({ data: null, meta: null, error: 'Collection not found' });
    }

    // Check access
    let role: string | null = null;

    // Admin global has full access to all collections
    if (request.user.role === 'admin') {
      role = 'owner';
    } else if (request.user.tokenCollectionSlug) {
      // External token scoped to a collection
      if (request.user.tokenCollectionSlug === slug) {
        role = request.user.tokenRole;
      }
    } else {
      // DB lookup for user membership
      const hasAccess = await collectionService.checkAccess(
        request.user.id, null, slug, minRole
      );
      if (hasAccess) {
        // Get actual role
        const memberships = await collectionService.listForUser(request.user.id);
        const membership = memberships.find(m => m.slug === slug);
        role = membership?.role ?? null;
      }
    }

    if (!role || !hasCollectionRole(role, minRole)) {
      return reply.status(403).send({ data: null, meta: null, error: 'Collection access denied' });
    }

    // Attach to request for downstream use
    (request as any).collection = collection;
    (request as any).collectionRole = role;
  };
}
```

Also update the existing `authenticate` middleware to handle external tokens with `collection_slug`:
- When token starts with `frag_tok_`, check if the token has `collection_slug` in the DB
- If yes, set `request.user.tokenCollectionSlug` and `request.user.tokenRole`

- [ ] **Step 3: Run existing tests**

```bash
npx vitest run
```
All existing tests must still pass.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/auth/
git commit -m "feat(auth): add per-collection role middleware with DB lookup"
```

---

## Chunk 3: Collection Routes + Fragment Route Prefixing

### Task 4: Add collection CRUD routes and prefix fragment routes

**Files:**
- Create: `packages/server/src/routes/collection-routes.ts`
- Modify: `packages/server/src/routes/fragment-routes.ts`
- Modify: `packages/server/src/routes/template-routes.ts`
- Modify: `packages/server/src/routes/harvest-routes.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Create collection-routes.ts**

8 endpoints:
- `GET /v1/collections` — list accessible collections for authenticated user
- `POST /v1/collections` — create collection (admin for system, any user for team)
- `GET /v1/collections/:slug` — get collection detail
- `PUT /v1/collections/:slug` — update (owner+)
- `DELETE /v1/collections/:slug` — delete (owner+, admin for force)
- `POST /v1/collections/:slug/members` — add member (manager+)
- `DELETE /v1/collections/:slug/members/:userId` — remove member (manager+)
- `POST /v1/collections/:slug/tokens` — create external token (manager+)

Follow existing route patterns (authenticate preHandler, response envelope).

- [ ] **Step 2: Update fragment-routes.ts**

The route registration function must accept `collectionService` parameter. Each route must:
1. Read `(request as any).collection` (set by `requireCollectionRole` middleware)
2. Pass `collection.git_path` to `FragmentService` instead of the global `storePath`
3. Pass `collection.milvus_partition` to `SearchService`

This requires refactoring `FragmentService` methods to accept a `collection` parameter. The simplest approach: pass `collection.git_path` as the storePath argument. Read the existing FragmentService to see how `storePath` is used.

**Important:** Don't rewrite FragmentService entirely. The minimal change is to make `storePath` overridable per-call. One approach:
- Add a `withCollection(collection)` method that returns a scoped service
- Or pass `gitPath` as an optional parameter to each method

Choose the approach that requires the least changes to existing code.

- [ ] **Step 3: Add compatibility routes**

Register the old `/v1/fragments/*` routes that redirect to `/v1/collections/common/fragments/*`:

```typescript
// Compatibility: /v1/fragments → /v1/collections/common/fragments
app.get('/v1/fragments', { preHandler: [authenticate, requireRole('reader')] }, async (request, reply) => {
  // Internally delegate to the collection-scoped handler
  const collection = await collectionService.getBySlug('common');
  (request as any).collection = collection;
  // ... call the same handler
});
```

Or simpler: register the same route handlers twice (once under `/v1/collections/:slug/fragments` and once under `/v1/fragments` with hardcoded `common`).

- [ ] **Step 4: Wire in index.ts**

- Create `CollectionService` after DB init
- Call `ensureCollections()` (from Task 1)
- Register `collectionRoutes`
- Register fragment routes under `/v1/collections/:slug/fragments`
- Register compatibility routes under `/v1/fragments` (delegating to `common`)
- Same for templates and harvest

- [ ] **Step 5: Test manually**

```bash
npx tsx src/index.ts &
TOKEN=$(curl -s -X POST localhost:3210/v1/auth/login ...)

# Test collections endpoint
curl localhost:3210/v1/collections -H "Authorization: Bearer $TOKEN"
# Should return [{ slug: 'common', ... }]

# Test compatibility
curl localhost:3210/v1/fragments -H "Authorization: Bearer $TOKEN"
# Should return fragments from common

# Test new prefixed route
curl localhost:3210/v1/collections/common/fragments -H "Authorization: Bearer $TOKEN"
# Should return same fragments
```

- [ ] **Step 6: Run all tests, fix any failures**

The existing integration tests use `/v1/fragments`. They should still pass via the compatibility routes. If they break due to middleware changes, fix them.

```bash
npx vitest run
```

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/
git commit -m "feat(server): add collection routes, prefix fragment/template/harvest routes, add compatibility layer"
```

### Task 5: Integration tests for collections

**Files:**
- Create: `packages/server/src/routes/collections.integration.test.ts`

- [ ] **Step 1: Write integration tests**

6 tests:
1. `GET /v1/collections` returns `common` after auto-migration
2. `POST /v1/collections` creates a team collection
3. `POST /v1/collections/:slug/members` adds a member
4. `GET /v1/collections/:slug/fragments` returns fragments for authorized user
5. `GET /v1/collections/:slug/fragments` returns 403 for unauthorized user
6. `/v1/fragments` compatibility returns fragments from `common`

- [ ] **Step 2: Run tests**

```bash
npx vitest run src/routes/collections.integration.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/routes/collections.integration.test.ts
git commit -m "test(server): add collections integration tests"
```

---

## Chunk 4: Search + Composition Cross-Collection

### Task 6: Update SearchService for multi-partition queries

**Files:**
- Modify: `packages/server/src/search/search-service.ts` (or equivalent)

- [ ] **Step 1: Read existing SearchService**

Understand how Milvus queries are made, how the partition is currently hardcoded.

- [ ] **Step 2: Add partition_names parameter to search method**

The `search()` method must accept an optional `partitionNames: string[]` parameter. If provided, pass it to the Milvus query. If not provided (for compatibility), use the default partition.

```typescript
async search(query: string, filters?: SearchFilters, limit?: number, partitionNames?: string[]): Promise<SearchResult[]> {
  // ... existing code
  if (this.milvusClient) {
    const results = await this.milvusClient.search(
      query,
      filters,
      limit,
      partitionNames, // NEW: pass to Milvus search
    );
  }
}
```

Also update `indexFragment` to accept a `partitionName: string` parameter for indexing into the correct partition.

- [ ] **Step 3: Update MilvusClient if needed**

If the Milvus client wrapper doesn't support `partition_names`, add it.

- [ ] **Step 4: Run existing tests**

```bash
npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/search/
git commit -m "feat(search): add multi-partition support for cross-collection queries"
```

### Task 7: Update ComposerService for cross-collection resolution

**Files:**
- Modify: `packages/server/src/services/composer-service.ts`

- [ ] **Step 1: Read existing ComposerService.compose()**

Understand how slots are resolved, how FragmentService.search is called.

- [ ] **Step 2: Add cross-collection resolution**

The `compose()` method must:
1. Accept a new parameter: `accessibleCollections: Collection[]` (or slugs)
2. For each slot, determine which partitions to search:
   - If slot has `collection:` → single partition
   - If slot has `collections:` → listed partitions (intersected with accessible)
   - If template has `collections:` → use those (intersected with accessible)
   - Otherwise → all accessible partitions
3. Pass `partitionNames` to the search call

Update `resolveSlot()` to accept and pass partition names.

- [ ] **Step 3: Update TemplateYamlSchema**

In `packages/server/src/schema/template.ts`, add optional fields:
```typescript
// In TemplateYamlSchema
collections: z.array(z.string()).optional(),

// In FragmentSlotSchema
collection: z.string().optional(),
collections: z.array(z.string()).optional(),
```

- [ ] **Step 4: Run all tests**

```bash
npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/composer-service.ts packages/server/src/schema/template.ts
git commit -m "feat(compose): add cross-collection fragment resolution with hybrid restriction"
```

---

## Chunk 5: MCP + CLI + Frontend

### Task 8: MCP collection-aware tools

**Files:**
- Create: `packages/mcp/src/tools/collection-list.ts`
- Modify: `packages/mcp/src/index.ts`
- Modify: `packages/mcp/src/tools/fragment-search.ts` (or equivalent)
- Modify: other tool files that need `collection_slug` parameter

- [ ] **Step 1: Create `collection_list` tool**

9th MCP tool. Calls `GET /v1/collections`, returns list with slug, name, type, role, description, tags.

- [ ] **Step 2: Add `collection_slug` or `collection_slugs` parameter to existing tools**

For each tool that operates on fragments:
- `fragment_search` → add `collection_slugs` param (string[] | "all", default "all")
- `fragment_inventory` → add `collection_slugs` param
- `fragment_create` → add `collection_slug` param (default: personal collection)
- `fragment_get`, `fragment_update` → add `collection_slug` param (required — to know which collection's API to call)
- `fragment_lineage` → add `collection_slug` param
- `document_compose` → add `collection_slug` param (for template location)
- `fragment_harvest` → add `collection_slug` param (for target collection)

Update the API calls to use `/v1/collections/${slug}/fragments/...` instead of `/v1/fragments/...`.

For tools where `collection_slug` is optional and defaults to `common`: use `'common'` as default.

- [ ] **Step 3: Run MCP tests**

```bash
cd /Users/mmaudet/work/fragmint/packages/mcp && npx vitest run
```

- [ ] **Step 4: Commit**

```bash
git add packages/mcp/
git commit -m "feat(mcp): add collection_list tool and collection-aware parameters to all tools"
```

### Task 9: CLI collection support

**Files:**
- Modify: `packages/cli/src/commands/fragments.ts`
- Modify: `packages/cli/src/commands/templates.ts`
- Modify: `packages/cli/src/commands/compose.ts`
- Modify: `packages/cli/src/commands/harvest.ts`
- Create: `packages/cli/src/commands/collections.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Add `collections` CLI command**

```bash
fragmint collections list
fragmint collections create <slug> --name "Team Name" --type team
fragmint collections members <slug>
fragmint collections add-member <slug> <userId> --role contributor
```

- [ ] **Step 2: Add `--collection` flag to existing commands**

All existing commands get `--collection <slug>` option (default: `common`):
```bash
fragmint fragment search "souveraineté" --collection anfsi
fragmint compose tpl-xxx --context '...' --collection common
fragmint harvest file.docx --collection personal-mmaudet
```

Update the API calls to use `/v1/collections/${collection}/...`.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/
git commit -m "feat(cli): add collections commands and --collection flag to all commands"
```

### Task 10: Frontend collection selector

**Files:**
- Create: `packages/web/src/lib/collection-context.tsx`
- Create: `packages/web/src/api/hooks/use-collections.ts`
- Modify: `packages/web/src/api/client.ts`
- Modify: `packages/web/src/api/types.ts`
- Modify: `packages/web/src/layouts/app-layout.tsx`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/lib/i18n.tsx`
- Modify: all page files and hooks to use collection-prefixed URLs

- [ ] **Step 1: Add collection types**

In `types.ts`:
```typescript
export interface CollectionWithRole {
  id: string;
  slug: string;
  name: string;
  type: 'system' | 'team' | 'personal';
  role: string;
  read_only: boolean;
  description: string | null;
}
```

- [ ] **Step 2: Create collection context**

```typescript
// collection-context.tsx
interface CollectionContextValue {
  activeCollection: string;
  collections: CollectionWithRole[];
  setActiveCollection: (slug: string) => void;
  isReadOnly: boolean;
}
```

Load collections at login via `GET /v1/collections`. Default to `common`. Store active in localStorage.

- [ ] **Step 3: Create useCollections hook**

```typescript
export function useCollections() {
  return useQuery({
    queryKey: ['collections'],
    queryFn: () => apiRequest<CollectionWithRole[]>('GET', '/v1/collections'),
  });
}
```

- [ ] **Step 4: Update API client to prefix with collection**

Add a helper or modify the hooks to use collection-aware URLs:

```typescript
function collectionUrl(slug: string, path: string): string {
  return `/v1/collections/${slug}${path}`;
}
```

Update all hooks in `use-fragments.ts`, `use-templates.ts`, `use-inventory.ts`, `use-harvest.ts`, `use-compose.ts` to accept the active collection slug and build URLs with it.

- [ ] **Step 5: Add collection selector to sidebar**

In `app-layout.tsx`, add a Select dropdown above the nav items showing the list of collections. Changing it updates `activeCollection` in context.

Show a lock icon and badge `lecture seule` if `isReadOnly`.

- [ ] **Step 6: Add i18n keys**

Add `collections` section to i18n with: title, common, personal, team, readOnly, selectCollection.

- [ ] **Step 7: Build and verify**

```bash
cd /Users/mmaudet/work/fragmint/packages/web && pnpm build
```

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/
git commit -m "feat(web): add collection selector, context, and collection-aware API calls"
```

---

## Chunk 6: Final Verification

### Task 11: Run all tests and verify

- [ ] **Step 1: Server tests**

```bash
cd /Users/mmaudet/work/fragmint/packages/server && npx vitest run
```

- [ ] **Step 2: MCP tests**

```bash
cd /Users/mmaudet/work/fragmint/packages/mcp && npx vitest run
```

- [ ] **Step 3: Frontend tests**

```bash
cd /Users/mmaudet/work/fragmint/packages/web && npx vitest run
```

- [ ] **Step 4: Build frontend**

```bash
cd /Users/mmaudet/work/fragmint/packages/web && pnpm build
```

- [ ] **Step 5: Manual E2E test**

Start server, login, verify:
- Collections endpoint returns `common`
- Fragment list works via both `/v1/fragments` and `/v1/collections/common/fragments`
- Frontend shows collection selector
- Switching collections changes visible fragments

- [ ] **Step 6: Fix any failures and commit**

---

## Task Dependencies

```
Task 1 (schema + config + migration)
    ↓
Task 2 (CollectionService)  ←→  Task 3 (auth middleware)   ← parallèle
    ↓
Task 4 (routes + prefixing)
    ↓
Task 5 (integration tests)
    ↓
Task 6 (search multi-partition)  ←→  Task 7 (composer cross-collection)  ← parallèle
    ↓
Task 8 (MCP)  ←→  Task 9 (CLI)  ←→  Task 10 (frontend)   ← parallèle
    ↓
Task 11 (final verification)
```
