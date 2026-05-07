---
name: fragmint-feature
description: Generate a complete Fragmint feature scaffold — Zod schema, Fastify route, service class, and unit test — following project patterns. Use when adding a new resource or API endpoint.
argument-hint: <feature-name>
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
model: inherit
---

# Fragmint Feature Generator

Generate a complete, pattern-compliant feature scaffold for Fragmint's server package.

## Usage

```
/fragmint-feature <feature-name>
```

**Example**: `/fragmint-feature tag-suggestions`

Generates:
```
packages/server/src/
├── schema/{feature-name}.ts          ← Zod schemas
├── services/{feature-name}-service.ts ← Business logic class
├── routes/{feature-name}s.ts         ← Fastify route registration
└── services/{feature-name}-service.test.ts ← Unit tests
```

---

## Step 1: Analyze the Feature Request

Parse `$ARGUMENTS`:
- `{feature-name}` = kebab-case feature name (e.g., `tag-suggestions`)
- Derive:
  - `{FeatureName}` = PascalCase (e.g., `TagSuggestions`)
  - `{featureName}` = camelCase (e.g., `tagSuggestions`)
  - `{feature_name}` = snake_case (e.g., `tag_suggestions`)
  - `{feature-names}` = plural kebab (e.g., `tag-suggestions` stays, `tag` → `tags`)

---

## Step 2: Read Existing Patterns

Before generating, read these files to ensure accurate pattern mirroring:

```bash
cat packages/server/src/routes/fragments.ts
cat packages/server/src/services/fragment-service.ts
cat packages/server/src/schema/template.ts
cat packages/server/src/index.ts | head -80
cat packages/server/src/db/schema.ts
```

---

## Step 3: Generate Schema File

**File**: `packages/server/src/schema/{feature-name}.ts`

```typescript
import { z } from 'zod';

export const List{FeatureName}Schema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type List{FeatureName}Query = z.infer<typeof List{FeatureName}Schema>;

export const Create{FeatureName}Schema = z.object({
  // TODO: define required fields for creation
  name: z.string().min(1).max(200),
});
export type Create{FeatureName}Body = z.infer<typeof Create{FeatureName}Schema>;

export const {FeatureName}ResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  created_at: z.string(),
});
export type {FeatureName}Response = z.infer<typeof {FeatureName}ResponseSchema>;
```

---

## Step 4: Generate Service File

**File**: `packages/server/src/services/{feature-name}-service.ts`

```typescript
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { List{FeatureName}Query, Create{FeatureName}Body, {FeatureName}Response } from '../schema/{feature-name}.js';

export class {FeatureName}Service {
  constructor(
    private db: BetterSQLite3Database<any>,
    private basePath: string,
  ) {}

  async list(params: List{FeatureName}Query): Promise<{FeatureName}Response[]> {
    const { limit, offset } = params;
    // TODO: implement Drizzle query
    // const rows = await this.db.select().from({feature_name}Table).limit(limit).offset(offset);
    return [];
  }

  async getById(id: string): Promise<{FeatureName}Response | null> {
    // TODO: implement Drizzle query
    return null;
  }

  async create(body: Create{FeatureName}Body): Promise<{FeatureName}Response> {
    // TODO: implement
    throw new Error('Not implemented');
  }
}
```

---

## Step 5: Generate Route File

**File**: `packages/server/src/routes/{feature-name}s.ts`

```typescript
import type { FastifyInstance } from 'fastify';
import { List{FeatureName}Schema, Create{FeatureName}Schema } from '../schema/{feature-name}.js';

export async function {featureName}Routes(app: FastifyInstance) {
  // GET /v1/{feature-names} — list
  app.get('/v1/{feature-names}', {
    schema: { querystring: List{FeatureName}Schema },
  }, async (req, reply) => {
    const results = await req.server.{featureName}Service.list(req.query as any);
    return reply.send(results);
  });

  // GET /v1/{feature-names}/:id — get by ID
  app.get('/v1/{feature-names}/:id', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = await req.server.{featureName}Service.getById(id);
    if (!item) return reply.code(404).send({ error: '{FeatureName} not found' });
    return reply.send(item);
  });

  // POST /v1/{feature-names} — create (requires auth)
  app.post('/v1/{feature-names}', {
    schema: { body: Create{FeatureName}Schema },
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const item = await req.server.{featureName}Service.create(req.body as any);
    return reply.code(201).send(item);
  });
}
```

---

## Step 6: Generate Unit Test File

**File**: `packages/server/src/services/{feature-name}-service.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { {FeatureName}Service } from './{feature-name}-service.js';

// Use in-memory DB for tests — mirror pattern from existing tests
describe('{FeatureName}Service', () => {
  let service: {FeatureName}Service;

  beforeEach(() => {
    // TODO: initialize with in-memory Drizzle DB
    // service = new {FeatureName}Service(testDb, '/tmp/test-vault');
  });

  it('list() returns empty array when no items exist', async () => {
    // TODO: implement when service is wired up
    expect(true).toBe(true);
  });

  it('getById() returns null for unknown id', async () => {
    // TODO: implement
    expect(true).toBe(true);
  });

  it('create() creates and returns a new item', async () => {
    // TODO: implement
    expect(true).toBe(true);
  });
});
```

---

## Step 7: Wiring Instructions

Print these instructions to the user — **do not auto-modify `index.ts`**:

```markdown
## Manual Wiring Required

Add to `packages/server/src/index.ts`:

### 1. Import the service (near other service imports):
```typescript
import { {FeatureName}Service } from './services/{feature-name}-service.js';
```

### 2. Declare on FastifyInstance (near other declarations):
```typescript
declare module 'fastify' {
  interface FastifyInstance {
    {featureName}Service: {FeatureName}Service;
  }
}
```

### 3. Instantiate and decorate (near other service setup):
```typescript
const {featureName}Service = new {FeatureName}Service(db, config.store_path);
app.decorate('{featureName}Service', {featureName}Service);
```

### 4. Register routes (near other route registrations):
```typescript
import { {featureName}Routes } from './routes/{feature-name}s.js';
app.register({featureName}Routes);
```
```

---

## Step 8: Validate Generated Code

```bash
pnpm --filter @fragmint/server typecheck
```

If this fails, check:
1. Import paths end with `.js` extension (required for ESM)
2. Zod schemas correctly typed
3. No implicit `any` on function parameters

---

## Output Confirmation

After generating, provide:

1. **Files Created**: List all 4 generated files
2. **Wiring Instructions**: What to add to `index.ts`
3. **TODO Items**: What the developer needs to implement
4. **Validation Command**: `pnpm --filter @fragmint/server typecheck`
5. **Next Steps**: Implement service logic, add DB schema if needed, run tests

---

## Important Notes

- All import paths must end with `.js` (ESM, TypeScript resolves to `.ts` at compile time)
- Service constructor must receive dependencies explicitly (no module-level imports)
- Milvus-dependent operations must be guarded by `milvus_enabled` check from config
- File size target: < 300 lines (generated files are skeletons, implementation may grow)
- Run `pnpm --filter @fragmint/server typecheck` after wiring to catch any issues
