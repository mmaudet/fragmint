# Fragmint Phase 0 — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a functional Git-backed content fragment store with Core API, CLI, and SQLite indexation.

**Architecture:** Bottom-up — Zod schemas define types, Drizzle manages SQLite, Git module handles versioning, services contain business logic, Fastify routes expose the API, CLI is a thin HTTP client.

**Tech Stack:** Node.js 24.x, pnpm workspaces, Fastify 5, Drizzle ORM + better-sqlite3, Zod, Vitest, commander, gray-matter, AGPL-3.0

**Spec:** `docs/superpowers/specs/2026-03-14-fragmint-phase0-design.md`

---

## Chunk 1: Scaffolding and Data Model

### Task 1: Monorepo scaffolding

**Files:**
- Create: `package.json` (root)
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `LICENSE`
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/mcp/package.json`
- Create: `packages/mcp/README.md`
- Create: `packages/obsidian/package.json`
- Create: `packages/obsidian/README.md`
- Create: `frontend/package.json`
- Create: `frontend/README.md`
- Create: `scripts/indexer/README.md`
- Create: `vitest.workspace.ts`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "fragmint",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24.0.0" },
  "scripts": {
    "build": "pnpm -r build",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit -p packages/server/tsconfig.json && tsc --noEmit -p packages/cli/tsconfig.json"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "vitest": "^3.1.0"
  },
  "license": "AGPL-3.0-only"
}
```

- [ ] **Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
  - "packages/*"
  - "frontend"
```

- [ ] **Step 3: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "Node16",
    "moduleResolution": "Node16",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  }
}
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
dist/
*.db
*.sqlite
.env
.DS_Store
```

- [ ] **Step 5: Create LICENSE (AGPL-3.0)**

Standard AGPL-3.0 text with `Copyright (c) 2026 LINAGORA`.

- [ ] **Step 6: Create packages/server/package.json**

```json
{
  "name": "@fragmint/server",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts"
  },
  "dependencies": {
    "fastify": "^5.3.0",
    "@fastify/jwt": "^9.0.0",
    "@fastify/cors": "^11.0.0",
    "@fastify/swagger": "^9.0.0",
    "@fastify/swagger-ui": "^5.0.0",
    "drizzle-orm": "^0.39.0",
    "better-sqlite3": "^11.8.0",
    "zod": "^3.24.0",
    "zod-to-json-schema": "^3.24.0",
    "gray-matter": "^4.0.3",
    "js-yaml": "^4.1.0",
    "uuid": "^11.1.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/js-yaml": "^4.0.0",
    "@types/uuid": "^10.0.0",
    "drizzle-kit": "^0.30.0",
    "tsx": "^4.19.0"
  },
  "license": "AGPL-3.0-only"
}
```

- [ ] **Step 7: Create packages/server/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 8: Create packages/cli/package.json**

```json
{
  "name": "@fragmint/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": { "fragmint": "./dist/index.js" },
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "commander": "^13.1.0",
    "js-yaml": "^4.1.0",
    "@fragmint/server": "workspace:*"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.0"
  },
  "license": "AGPL-3.0-only"
}
```

- [ ] **Step 9: Create packages/cli/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 10: Create placeholder packages**

For `packages/mcp/`, `packages/obsidian/`, `frontend/`, `scripts/indexer/`: create minimal `package.json` (name + version) and `README.md` with one line describing the future purpose.

- [ ] **Step 11: Create vitest.workspace.ts**

```typescript
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'server',
      root: './packages/server',
      include: ['src/**/*.test.ts'],
      exclude: ['src/**/*.integration.test.ts'],
    },
  },
  {
    test: {
      name: 'server-integration',
      root: './packages/server',
      include: ['src/**/*.integration.test.ts'],
    },
  },
  {
    test: {
      name: 'cli',
      root: './packages/cli',
      include: ['src/**/*.test.ts'],
    },
  },
]);
```

- [ ] **Step 12: Install dependencies**

Run: `pnpm install`

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "chore: scaffold monorepo with pnpm workspaces"
```

---

### Task 2: Zod schemas

**Files:**
- Create: `packages/server/src/schema/fragment.ts`
- Create: `packages/server/src/schema/api.ts`
- Create: `packages/server/src/schema/index.ts`
- Test: `packages/server/src/schema/fragment.test.ts`

- [ ] **Step 1: Write fragment schema tests**

```typescript
// packages/server/src/schema/fragment.test.ts
import { describe, it, expect } from 'vitest';
import { fragmentFrontmatterSchema, QUALITY_TRANSITIONS } from './fragment.js';

describe('fragmentFrontmatterSchema', () => {
  const validFragment = {
    id: 'frag-a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    type: 'introduction',
    domain: 'souveraineté',
    tags: ['souveraineté', 'europe'],
    lang: 'fr',
    translation_of: null,
    quality: 'draft',
    author: 'mmaudet',
    reviewed_by: null,
    approved_by: null,
    created_at: '2026-03-14',
    updated_at: '2026-03-14',
    valid_from: null,
    valid_until: null,
    parent_id: null,
    generation: 0,
    uses: 0,
    last_used: null,
    access: { read: ['*'], write: ['contributor', 'admin'], approve: ['expert', 'admin'] },
  };

  it('validates a correct fragment', () => {
    const result = fragmentFrontmatterSchema.safeParse(validFragment);
    expect(result.success).toBe(true);
  });

  it('rejects invalid id format', () => {
    const result = fragmentFrontmatterSchema.safeParse({ ...validFragment, id: 'bad-id' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid lang (not ISO 639-1)', () => {
    const result = fragmentFrontmatterSchema.safeParse({ ...validFragment, lang: 'fra' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown type', () => {
    const result = fragmentFrontmatterSchema.safeParse({ ...validFragment, type: 'unknown' });
    expect(result.success).toBe(false);
  });

  it('rejects negative generation', () => {
    const result = fragmentFrontmatterSchema.safeParse({ ...validFragment, generation: -1 });
    expect(result.success).toBe(false);
  });

  it('defaults origin to manual', () => {
    const result = fragmentFrontmatterSchema.parse(validFragment);
    expect(result.origin).toBe('manual');
  });
});

describe('QUALITY_TRANSITIONS', () => {
  it('allows draft -> reviewed', () => {
    expect(QUALITY_TRANSITIONS.draft).toContain('reviewed');
  });

  it('allows reviewed -> approved', () => {
    expect(QUALITY_TRANSITIONS.reviewed).toContain('approved');
  });

  it('allows approved -> deprecated', () => {
    expect(QUALITY_TRANSITIONS.approved).toContain('deprecated');
  });

  it('does not allow draft -> approved', () => {
    expect(QUALITY_TRANSITIONS.draft).not.toContain('approved');
  });

  it('deprecated is terminal', () => {
    expect(QUALITY_TRANSITIONS.deprecated).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `pnpm vitest run --project server`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement fragment schema**

```typescript
// packages/server/src/schema/fragment.ts
import { z } from 'zod';

export const FRAGMENT_TYPES = [
  'introduction', 'argument', 'pricing', 'clause',
  'faq', 'conclusion', 'bio', 'témoignage',
] as const;

export const QUALITY_VALUES = ['draft', 'reviewed', 'approved', 'deprecated'] as const;

// User-initiated transitions only. The approved→reviewed desync is
// handled as a special case in FragmentService, not exposed here.
export const QUALITY_TRANSITIONS: Record<string, string[]> = {
  draft: ['reviewed'],
  reviewed: ['approved'],
  approved: ['deprecated'],
  deprecated: [],
};

export const ROLES = ['reader', 'contributor', 'expert', 'admin'] as const;

export const ROLE_HIERARCHY: Record<string, number> = {
  reader: 0,
  contributor: 1,
  expert: 2,
  admin: 3,
};

export const fragmentFrontmatterSchema = z.object({
  id: z.string().regex(/^frag-[a-f0-9-]+$/),
  type: z.enum(FRAGMENT_TYPES),
  domain: z.string().min(1),
  tags: z.array(z.string()),
  lang: z.string().regex(/^[a-z]{2}$/),
  translation_of: z.string().nullable(),
  translations: z.record(z.string(), z.string().nullable()).optional(),
  quality: z.enum(QUALITY_VALUES),
  author: z.string().min(1),
  reviewed_by: z.string().nullable(),
  approved_by: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  valid_from: z.string().nullable(),
  valid_until: z.string().nullable(),
  parent_id: z.string().nullable(),
  generation: z.number().int().min(0),
  uses: z.number().int().default(0),
  last_used: z.string().nullable(),
  contexts: z.array(z.string()).optional(),
  origin: z.enum(['manual', 'harvested', 'generated']).default('manual'),
  origin_source: z.string().nullable().optional(),
  origin_page: z.number().nullable().optional(),
  harvest_confidence: z.number().min(0).max(1).nullable().optional(),
  access: z.object({
    read: z.array(z.string()),
    write: z.array(z.string()),
    approve: z.array(z.string()),
  }),
});

export type FragmentFrontmatter = z.infer<typeof fragmentFrontmatterSchema>;

// Schema for creating a fragment (id, dates, uses are generated server-side)
export const createFragmentSchema = z.object({
  type: z.enum(FRAGMENT_TYPES),
  domain: z.string().min(1),
  tags: z.array(z.string()).default([]),
  lang: z.string().regex(/^[a-z]{2}$/),
  body: z.string().min(1),
  translation_of: z.string().nullable().default(null),
  parent_id: z.string().nullable().default(null),
  generation: z.number().int().min(0).default(0),
  origin: z.enum(['manual', 'harvested', 'generated']).default('manual'),
  access: z.object({
    read: z.array(z.string()),
    write: z.array(z.string()),
    approve: z.array(z.string()),
  }).default({ read: ['*'], write: ['contributor', 'admin'], approve: ['expert', 'admin'] }),
});

export type CreateFragmentInput = z.infer<typeof createFragmentSchema>;

// Schema for updating a fragment
export const updateFragmentSchema = z.object({
  body: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  domain: z.string().min(1).optional(),
  quality: z.enum(QUALITY_VALUES).optional(),
  access: z.object({
    read: z.array(z.string()),
    write: z.array(z.string()),
    approve: z.array(z.string()),
  }).optional(),
});

export type UpdateFragmentInput = z.infer<typeof updateFragmentSchema>;
```

- [ ] **Step 4: Create API schema and index**

```typescript
// packages/server/src/schema/api.ts
import { z } from 'zod';

export const searchQuerySchema = z.object({
  query: z.string().min(1),
  filters: z.object({
    type: z.array(z.string()).optional(),
    domain: z.array(z.string()).optional(),
    lang: z.string().optional(),
    quality_min: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }).optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export const inventoryQuerySchema = z.object({
  topic: z.string().optional(),
  lang: z.string().optional(),
});

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const createUserSchema = z.object({
  login: z.string().min(1),
  password: z.string().min(6),
  display_name: z.string().min(1),
  role: z.enum(['reader', 'contributor', 'expert', 'admin']),
});

export const createTokenSchema = z.object({
  name: z.string().min(1),
  role: z.enum(['reader', 'contributor', 'expert', 'admin']),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type InventoryQuery = z.infer<typeof inventoryQuerySchema>;
```

```typescript
// packages/server/src/schema/index.ts
export * from './fragment.js';
export * from './api.js';
```

- [ ] **Step 5: Run tests — verify they pass**

Run: `pnpm vitest run --project server`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/schema/
git commit -m "feat(schema): add Zod schemas for fragment frontmatter and API payloads"
```

---

### Task 3: Drizzle database schema

**Files:**
- Create: `packages/server/src/db/schema.ts`
- Create: `packages/server/src/db/connection.ts`
- Create: `packages/server/src/db/index.ts`
- Create: `packages/server/drizzle.config.ts`

- [ ] **Step 1: Create Drizzle schema**

```typescript
// packages/server/src/db/schema.ts
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const fragments = sqliteTable('fragments', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  domain: text('domain').notNull(),
  lang: text('lang').notNull(),
  quality: text('quality').notNull().default('draft'),
  author: text('author').notNull(),
  title: text('title'),
  body_excerpt: text('body_excerpt'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
  uses: integer('uses').notNull().default(0),
  parent_id: text('parent_id'),
  translation_of: text('translation_of'),
  file_path: text('file_path').notNull(),
  git_hash: text('git_hash'),
  origin: text('origin').notNull().default('manual'),
  origin_source: text('origin_source'),
  origin_page: integer('origin_page'),
  harvest_confidence: real('harvest_confidence'),
});

export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timestamp: text('timestamp').notNull(),
  user_id: text('user_id').notNull(),
  role: text('role').notNull(),
  action: text('action').notNull(),
  fragment_id: text('fragment_id'),
  diff_summary: text('diff_summary'),
  ip_source: text('ip_source'),
});

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  login: text('login').notNull().unique(),
  display_name: text('display_name').notNull(),
  role: text('role').notNull(),
  password_hash: text('password_hash').notNull(),
  created_at: text('created_at').notNull(),
  last_login: text('last_login'),
  active: integer('active').notNull().default(1),
});

export const apiTokens = sqliteTable('api_tokens', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  token_hash: text('token_hash').notNull(),         // scrypt hash for verification
  token_lookup: text('token_lookup').notNull(),      // SHA-256 for fast lookup
  role: text('role').notNull(),
  owner: text('owner').notNull(),
  created_at: text('created_at').notNull(),
  last_used: text('last_used'),
  active: integer('active').notNull().default(1),
});
```

- [ ] **Step 2: Create database connection helper**

```typescript
// packages/server/src/db/connection.ts
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export type FragmintDb = ReturnType<typeof createDb>;

export function createDb(path: string | ':memory:') {
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // Create tables on the same connection (critical for :memory: mode)
  initTables(sqlite);

  const db = drizzle(sqlite, { schema });
  return db;
}

function initTables(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS fragments (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      domain TEXT NOT NULL,
      lang TEXT NOT NULL,
      quality TEXT NOT NULL DEFAULT 'draft',
      author TEXT NOT NULL,
      title TEXT,
      body_excerpt TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      uses INTEGER NOT NULL DEFAULT 0,
      parent_id TEXT,
      translation_of TEXT,
      file_path TEXT NOT NULL,
      git_hash TEXT,
      origin TEXT NOT NULL DEFAULT 'manual',
      origin_source TEXT,
      origin_page INTEGER,
      harvest_confidence REAL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      action TEXT NOT NULL,
      fragment_id TEXT,
      diff_summary TEXT,
      ip_source TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      login TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_login TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      token_lookup TEXT NOT NULL,
      role TEXT NOT NULL,
      owner TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );
  `);
}
```

```typescript
// packages/server/src/db/index.ts
export { createDb, type FragmintDb } from './connection.js';
export * from './schema.js';
```

- [ ] **Step 3: Create drizzle config**

```typescript
// packages/server/drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
});
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/db/ packages/server/drizzle.config.ts
git commit -m "feat(db): add Drizzle schema and SQLite connection for fragments, users, tokens, audit"
```

---

### Task 4: Git operations module

**Files:**
- Create: `packages/server/src/git/git-repository.ts`
- Create: `packages/server/src/git/fragment-file.ts`
- Create: `packages/server/src/git/commit-message.ts`
- Create: `packages/server/src/git/index.ts`
- Test: `packages/server/src/git/fragment-file.test.ts`
- Test: `packages/server/src/git/commit-message.test.ts`
- Test: `packages/server/src/git/git-repository.test.ts`

- [ ] **Step 1: Write fragment-file tests**

```typescript
// packages/server/src/git/fragment-file.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFragment, writeFragment, generateId, deriveTitle } from './fragment-file.js';

describe('generateId', () => {
  it('returns a string starting with frag-', () => {
    const id = generateId();
    expect(id).toMatch(/^frag-[a-f0-9-]+$/);
  });
});

describe('deriveTitle', () => {
  it('extracts first heading', () => {
    expect(deriveTitle('# My Title\n\nSome body')).toBe('My Title');
  });

  it('falls back to first non-empty line', () => {
    expect(deriveTitle('Just a paragraph')).toBe('Just a paragraph');
  });

  it('handles empty body', () => {
    expect(deriveTitle('')).toBe('Untitled');
  });
});

describe('readFragment / writeFragment', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fragmint-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true });
  });

  it('writes and reads a fragment round-trip', () => {
    const frontmatter = {
      id: 'frag-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      type: 'introduction' as const,
      domain: 'souveraineté',
      tags: ['europe'],
      lang: 'fr',
      translation_of: null,
      quality: 'draft' as const,
      author: 'mmaudet',
      reviewed_by: null,
      approved_by: null,
      created_at: '2026-03-14',
      updated_at: '2026-03-14',
      valid_from: null,
      valid_until: null,
      parent_id: null,
      generation: 0,
      uses: 0,
      last_used: null,
      access: { read: ['*'], write: ['contributor'], approve: ['expert'] },
    };
    const body = '# Introduction\n\nSome content here.';

    const filePath = writeFragment(dir, frontmatter, body);
    expect(filePath).toMatch(/introduction-souverainete-fr-[a-f0-9]{8}\.md/);

    const result = readFragment(filePath);
    expect(result.frontmatter.id).toBe(frontmatter.id);
    expect(result.frontmatter.type).toBe('introduction');
    expect(result.body).toBe(body);
  });

  it('generates kebab-case filename', () => {
    const frontmatter = {
      id: 'frag-11111111-2222-3333-4444-555555555555',
      type: 'argument' as const,
      domain: 'openrag',
      tags: [],
      lang: 'en',
      translation_of: null,
      quality: 'draft' as const,
      author: 'test',
      reviewed_by: null,
      approved_by: null,
      created_at: '2026-03-14',
      updated_at: '2026-03-14',
      valid_from: null,
      valid_until: null,
      parent_id: null,
      generation: 0,
      uses: 0,
      last_used: null,
      access: { read: ['*'], write: ['contributor'], approve: ['expert'] },
    };

    const filePath = writeFragment(dir, frontmatter, 'body');
    expect(filePath).toMatch(/argument-openrag-en-[a-f0-9]{8}\.md/);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `pnpm vitest run --project server`
Expected: FAIL

- [ ] **Step 3: Implement fragment-file.ts**

```typescript
// packages/server/src/git/fragment-file.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { v4 as uuidv4 } from 'uuid';
import { fragmentFrontmatterSchema, type FragmentFrontmatter } from '../schema/fragment.js';

export function generateId(): string {
  return `frag-${uuidv4()}`;
}

export function deriveTitle(body: string): string {
  if (!body.trim()) return 'Untitled';
  const headingMatch = body.match(/^#\s+(.+)$/m);
  if (headingMatch) return headingMatch[1].trim();
  const firstLine = body.trim().split('\n')[0].trim();
  return firstLine || 'Untitled';
}

function toKebabCase(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // remove accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function writeFragment(
  dirPath: string,
  frontmatter: FragmentFrontmatter,
  body: string,
): string {
  // Append short id suffix to avoid collisions when type+domain+lang are identical
  const idSuffix = frontmatter.id.slice(-8);
  const filename = `${toKebabCase(frontmatter.type)}-${toKebabCase(frontmatter.domain)}-${frontmatter.lang}-${idSuffix}.md`;
  const filePath = join(dirPath, filename);
  const content = matter.stringify(body, frontmatter);
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

export interface ParsedFragment {
  frontmatter: FragmentFrontmatter;
  body: string;
}

export function readFragment(filePath: string): ParsedFragment {
  const raw = readFileSync(filePath, 'utf-8');
  const { data, content } = matter(raw);
  const frontmatter = fragmentFrontmatterSchema.parse(data);
  return { frontmatter, body: content.trim() };
}
```

- [ ] **Step 4: Write commit-message tests**

```typescript
// packages/server/src/git/commit-message.test.ts
import { describe, it, expect } from 'vitest';
import { buildCommitMessage } from './commit-message.js';

describe('buildCommitMessage', () => {
  it('formats a create message', () => {
    const msg = buildCommitMessage({
      action: 'create',
      type: 'introduction',
      domain: 'souveraineté',
      description: 'premier draft introduction fr',
      author: 'mmaudet',
      fragmentId: 'frag-abc123',
      qualityTransition: 'draft',
    });
    expect(msg).toContain('create(introduction/souveraineté): premier draft introduction fr');
    expect(msg).toContain('Author: mmaudet');
    expect(msg).toContain('Fragment-Id: frag-abc123');
  });

  it('includes quality transition when provided', () => {
    const msg = buildCommitMessage({
      action: 'approve',
      type: 'pricing',
      domain: 'twake',
      description: 'validated pricing',
      author: 'mmaudet',
      fragmentId: 'frag-xyz',
      qualityTransition: 'reviewed → approved',
    });
    expect(msg).toContain('Quality-Transition: reviewed → approved');
  });
});
```

- [ ] **Step 5: Run commit-message test — verify it fails**

Run: `pnpm vitest run --project server`
Expected: FAIL — module not found

- [ ] **Step 6: Implement commit-message.ts**

```typescript
// packages/server/src/git/commit-message.ts
export interface CommitMessageParams {
  action: 'create' | 'update' | 'approve' | 'deprecate' | 'translate' | 'generate' | 'harvest';
  type: string;
  domain: string;
  description: string;
  author: string;
  fragmentId: string;
  qualityTransition?: string;
}

export function buildCommitMessage(params: CommitMessageParams): string {
  const lines = [
    `${params.action}(${params.type}/${params.domain}): ${params.description}`,
    '',
    `Author: ${params.author}`,
    `Fragment-Id: ${params.fragmentId}`,
  ];

  if (params.qualityTransition) {
    lines.push(`Quality-Transition: ${params.qualityTransition}`);
  }

  return lines.join('\n');
}
```

- [ ] **Step 7: Write git-repository test (BEFORE implementation)**

```typescript
// packages/server/src/git/git-repository.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GitRepository } from './git-repository.js';

describe('GitRepository', () => {
  let dir: string;
  let repo: GitRepository;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fragmint-git-'));
    repo = new GitRepository(dir);
    await repo.init();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true });
  });

  it('commits a file and returns hash', async () => {
    const file = join(dir, 'test.md');
    writeFileSync(file, '# Hello\n');
    const hash = await repo.commit(file, 'initial commit');
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });

  it('returns log entries', async () => {
    const file = join(dir, 'test.md');
    writeFileSync(file, '# v1\n');
    await repo.commit(file, 'first');
    writeFileSync(file, '# v2\n');
    await repo.commit(file, 'second');

    const log = await repo.log(file);
    expect(log.length).toBe(2);
    expect(log[0].message).toBe('second');
  });

  it('diffs between commits', async () => {
    const file = join(dir, 'test.md');
    writeFileSync(file, '# v1\n');
    await repo.commit(file, 'first');
    const hash1 = await repo.getHead();
    writeFileSync(file, '# v2\n');
    await repo.commit(file, 'second');
    const hash2 = await repo.getHead();

    const diff = await repo.diff(hash1, hash2, file);
    expect(diff).toContain('-# v1');
    expect(diff).toContain('+# v2');
  });
});
```

- [ ] **Step 8: Run git-repository test — verify it fails**

Run: `pnpm vitest run --project server`
Expected: FAIL — module not found

- [ ] **Step 9: Implement git-repository.ts**

```typescript
// packages/server/src/git/git-repository.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface GitLogEntry {
  commit: string;
  author: string;
  date: string;
  message: string;
}

export class GitRepository {
  constructor(private readonly repoPath: string) {}

  async init(): Promise<void> {
    await this.exec('init');
    await this.exec('config', 'user.email', 'fragmint@localhost');
    await this.exec('config', 'user.name', 'Fragmint');
  }

  async commit(filePath: string, message: string): Promise<string> {
    await this.exec('add', filePath);
    const { stdout } = await this.exec('commit', '-m', message);
    const match = stdout.match(/\[[\w/.-]+ ([a-f0-9]+)\]/);
    return match ? match[1] : '';
  }

  async log(filePath?: string, limit = 20): Promise<GitLogEntry[]> {
    // Use NUL byte as record separator to avoid delimiter collisions
    const SEP = '%x00';
    const args = ['log', `--max-count=${limit}`, `--format=%H%n%an%n%ai%n%s${SEP}`];
    if (filePath) args.push('--follow', '--', filePath);
    const { stdout } = await this.exec(...args);
    if (!stdout.trim()) return [];

    return stdout.trim().split('\0').filter(Boolean).map((block) => {
      const [commit, author, date, ...messageParts] = block.trim().split('\n');
      return { commit, author, date, message: messageParts.join('\n') };
    });
  }

  async diff(commit1: string, commit2: string, filePath?: string): Promise<string> {
    const args = ['diff', commit1, commit2];
    if (filePath) args.push('--', filePath);
    const { stdout } = await this.exec(...args);
    return stdout;
  }

  async show(commit: string, filePath: string): Promise<string> {
    const { stdout } = await this.exec('show', `${commit}:${filePath}`);
    return stdout;
  }

  async restore(commit: string, filePath: string): Promise<void> {
    await this.exec('checkout', commit, '--', filePath);
  }

  async getHead(): Promise<string> {
    const { stdout } = await this.exec('rev-parse', 'HEAD');
    return stdout.trim();
  }

  async getModifiedFiles(sinceCommit?: string): Promise<string[]> {
    const ref = sinceCommit || 'HEAD~1';
    try {
      const { stdout } = await this.exec('diff', '--name-only', ref, 'HEAD');
      return stdout.trim().split('\n').filter(Boolean);
    } catch {
      const { stdout } = await this.exec('ls-files');
      return stdout.trim().split('\n').filter(Boolean);
    }
  }

  private async exec(...args: string[]) {
    return execFileAsync('git', args, { cwd: this.repoPath });
  }
}
```

- [ ] **Step 10: Create index**

```typescript
// packages/server/src/git/index.ts
export { GitRepository, type GitLogEntry } from './git-repository.js';
export { readFragment, writeFragment, generateId, deriveTitle, type ParsedFragment } from './fragment-file.js';
export { buildCommitMessage, type CommitMessageParams } from './commit-message.js';
```

- [ ] **Step 11: Run all tests — verify they pass**

Run: `pnpm vitest run --project server`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add packages/server/src/git/
git commit -m "feat(git): add Git operations module, fragment file parser, commit message builder"
```

---

## Chunk 2: Auth, Services, and Config

### Task 5: Auth module

**Files:**
- Create: `packages/server/src/auth/hash.ts`
- Create: `packages/server/src/auth/middleware.ts`
- Create: `packages/server/src/auth/index.ts`
- Test: `packages/server/src/auth/hash.test.ts`

- [ ] **Step 1: Write hash tests**

```typescript
// packages/server/src/auth/hash.test.ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, hashTokenScrypt, verifyTokenScrypt, hashTokenSha256 } from './hash.js';

describe('password hashing', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('my-secret');
    expect(hash).not.toBe('my-secret');
    expect(await verifyPassword('my-secret', hash)).toBe(true);
  });

  it('rejects wrong password', async () => {
    const hash = await hashPassword('my-secret');
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
});

describe('token hashing', () => {
  it('SHA-256 is deterministic', () => {
    const h1 = hashTokenSha256('frag_tok_abc123');
    const h2 = hashTokenSha256('frag_tok_abc123');
    expect(h1).toBe(h2);
  });

  it('scrypt hashes and verifies a token', async () => {
    const hash = await hashTokenScrypt('frag_tok_abc123');
    expect(await verifyTokenScrypt('frag_tok_abc123', hash)).toBe(true);
  });

  it('rejects wrong token with scrypt', async () => {
    const hash = await hashTokenScrypt('frag_tok_abc123');
    expect(await verifyTokenScrypt('frag_tok_wrong', hash)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

- [ ] **Step 3: Implement hash.ts**

```typescript
// packages/server/src/auth/hash.ts
import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const SCRYPT_KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, key] = hash.split(':');
  const derived = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return timingSafeEqual(Buffer.from(key, 'hex'), derived);
}

export function hashTokenSha256(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function hashTokenScrypt(token: string): Promise<string> {
  return hashPassword(token);
}

export async function verifyTokenScrypt(token: string, hash: string): Promise<boolean> {
  return verifyPassword(token, hash);
}
```

- [ ] **Step 4: Implement auth middleware**

```typescript
// packages/server/src/auth/middleware.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { apiTokens, users } from '../db/schema.js';
import { hashTokenSha256, verifyTokenScrypt } from './hash.js';
import { ROLE_HIERARCHY } from '../schema/fragment.js';
import type { FragmintDb } from '../db/connection.js';

export interface AuthUser {
  id: string;
  login: string;
  role: string;
  display_name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser;
  }
}

export function hasRole(userRole: string, requiredRole: string): boolean {
  return (ROLE_HIERARCHY[userRole] ?? -1) >= (ROLE_HIERARCHY[requiredRole] ?? 999);
}

export function buildAuthMiddleware(db: FragmintDb) {
  return async function authenticate(request: FastifyRequest, reply: FastifyReply) {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ data: null, meta: null, error: 'Missing authorization header' });
    }

    const token = authHeader.slice(7);

    // API token path
    if (token.startsWith('frag_tok_')) {
      const lookup = hashTokenSha256(token);
      const rows = await db.select().from(apiTokens).where(eq(apiTokens.token_lookup, lookup)).limit(1);
      if (rows.length === 0 || !rows[0].active) {
        return reply.status(401).send({ data: null, meta: null, error: 'Invalid API token' });
      }

      const row = rows[0];
      const valid = await verifyTokenScrypt(token, row.token_hash);
      if (!valid) {
        return reply.status(401).send({ data: null, meta: null, error: 'Invalid API token' });
      }

      // Update last_used
      await db.update(apiTokens)
        .set({ last_used: new Date().toISOString() })
        .where(eq(apiTokens.id, row.id));

      request.user = {
        id: row.owner,
        login: row.name,
        role: row.role,
        display_name: row.name,
      };
      return;
    }

    // JWT path
    try {
      const decoded = await request.jwtVerify<{ sub: string; role: string; display_name: string }>();
      request.user = {
        id: decoded.sub,
        login: decoded.sub,
        role: decoded.role,
        display_name: decoded.display_name,
      };
    } catch {
      return reply.status(401).send({ data: null, meta: null, error: 'Invalid or expired JWT' });
    }
  };
}

export function requireRole(role: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!hasRole(request.user.role, role)) {
      return reply.status(403).send({ data: null, meta: null, error: `Role '${role}' or higher required` });
    }
  };
}
```

```typescript
// packages/server/src/auth/index.ts
export { hashPassword, verifyPassword, hashTokenSha256, hashTokenScrypt, verifyTokenScrypt } from './hash.js';
export { buildAuthMiddleware, requireRole, hasRole, type AuthUser } from './middleware.js';
```

- [ ] **Step 5: Run tests — verify they pass**

Run: `pnpm vitest run --project server`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/auth/
git commit -m "feat(auth): add password/token hashing and auth middleware with role hierarchy"
```

---

### Task 6: Config module

**Files:**
- Create: `packages/server/src/config.ts`

- [ ] **Step 1: Implement config.ts**

```typescript
// packages/server/src/config.ts
import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import yaml from 'js-yaml';

export interface FragmintConfig {
  port: number;
  store_path: string;
  jwt_secret: string;
  jwt_ttl: string;
  log_level: string;
  trust_proxy: boolean;
  dev: boolean;
}

export function loadConfig(configPath?: string, dev = false): FragmintConfig {
  let fileConfig: Partial<FragmintConfig> = {};

  if (configPath && existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf-8');
    fileConfig = yaml.load(raw) as Partial<FragmintConfig>;
  }

  return {
    port: toNumber(process.env.FRAGMINT_PORT) ?? fileConfig.port ?? 3210,
    store_path: process.env.FRAGMINT_STORE_PATH ?? fileConfig.store_path ?? './example-vault',
    jwt_secret: process.env.FRAGMINT_JWT_SECRET ?? fileConfig.jwt_secret ?? randomBytes(32).toString('hex'),
    jwt_ttl: process.env.FRAGMINT_JWT_TTL ?? fileConfig.jwt_ttl ?? '8h',
    log_level: process.env.FRAGMINT_LOG_LEVEL ?? fileConfig.log_level ?? 'info',
    trust_proxy: process.env.FRAGMINT_TRUST_PROXY === 'true' || fileConfig.trust_proxy === true,
    dev,
  };
}

function toNumber(val?: string): number | undefined {
  if (!val) return undefined;
  const n = parseInt(val, 10);
  return isNaN(n) ? undefined : n;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/config.ts
git commit -m "feat(config): add configuration loader with env vars and YAML file support"
```

---

### Task 7: Services — user, token, audit

**Files:**
- Create: `packages/server/src/services/user-service.ts`
- Create: `packages/server/src/services/token-service.ts`
- Create: `packages/server/src/services/audit-service.ts`
- Create: `packages/server/src/services/index.ts`

- [ ] **Step 1: Implement user-service.ts**

```typescript
// packages/server/src/services/user-service.ts
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import type { FragmintDb } from '../db/connection.js';
import { users } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../auth/hash.js';

export class UserService {
  constructor(private db: FragmintDb) {}

  async create(login: string, password: string, displayName: string, role: string) {
    const id = uuidv4();
    const password_hash = await hashPassword(password);
    const now = new Date().toISOString();

    await this.db.insert(users).values({
      id, login, display_name: displayName, role,
      password_hash, created_at: now,
    });

    return { id, login, display_name: displayName, role, created_at: now };
  }

  async authenticate(login: string, password: string) {
    const rows = await this.db.select().from(users)
      .where(eq(users.login, login)).limit(1);

    if (rows.length === 0 || !rows[0].active) return null;

    const valid = await verifyPassword(password, rows[0].password_hash);
    if (!valid) return null;

    await this.db.update(users)
      .set({ last_login: new Date().toISOString() })
      .where(eq(users.id, rows[0].id));

    return {
      id: rows[0].id,
      login: rows[0].login,
      role: rows[0].role,
      display_name: rows[0].display_name,
    };
  }

  async list() {
    const rows = await this.db.select({
      id: users.id, login: users.login,
      display_name: users.display_name, role: users.role,
      created_at: users.created_at, last_login: users.last_login,
      active: users.active,
    }).from(users);
    return rows;
  }

  async exists(login: string): Promise<boolean> {
    const rows = await this.db.select({ id: users.id })
      .from(users).where(eq(users.login, login)).limit(1);
    return rows.length > 0;
  }
}
```

- [ ] **Step 2: Implement token-service.ts**

```typescript
// packages/server/src/services/token-service.ts
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type { FragmintDb } from '../db/connection.js';
import { apiTokens } from '../db/schema.js';
import { hashTokenSha256, hashTokenScrypt } from '../auth/hash.js';

export class TokenService {
  constructor(private db: FragmintDb) {}

  async create(name: string, role: string, owner: string) {
    const id = uuidv4();
    const rawToken = `frag_tok_${randomBytes(24).toString('hex')}`;
    const token_lookup = hashTokenSha256(rawToken);
    const token_hash = await hashTokenScrypt(rawToken);
    const now = new Date().toISOString();

    await this.db.insert(apiTokens).values({
      id, name, token_hash, token_lookup, role, owner, created_at: now,
    });

    // Return raw token only once — never stored in plain text
    return { id, name, role, token: rawToken, created_at: now };
  }

  async list() {
    const rows = await this.db.select({
      id: apiTokens.id, name: apiTokens.name, role: apiTokens.role,
      owner: apiTokens.owner, created_at: apiTokens.created_at,
      last_used: apiTokens.last_used, active: apiTokens.active,
    }).from(apiTokens);
    return rows;
  }

  async revoke(id: string): Promise<boolean> {
    const result = await this.db.update(apiTokens)
      .set({ active: 0 })
      .where(eq(apiTokens.id, id));
    return true;
  }
}
```

- [ ] **Step 3: Implement audit-service.ts**

```typescript
// packages/server/src/services/audit-service.ts
import { desc, and, gte, lte } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { auditLog } from '../db/schema.js';

export class AuditService {
  constructor(private db: FragmintDb) {}

  async log(params: {
    user_id: string;
    role: string;
    action: string;
    fragment_id?: string;
    diff_summary?: string;
    ip_source?: string;
  }) {
    await this.db.insert(auditLog).values({
      timestamp: new Date().toISOString(),
      user_id: params.user_id,
      role: params.role,
      action: params.action,
      fragment_id: params.fragment_id ?? null,
      diff_summary: params.diff_summary ?? null,
      ip_source: params.ip_source ?? null,
    });
  }

  async query(options?: { from?: string; to?: string; limit?: number }) {
    const limit = options?.limit ?? 100;
    const conditions = [];

    if (options?.from) conditions.push(gte(auditLog.timestamp, options.from));
    if (options?.to) conditions.push(lte(auditLog.timestamp, options.to));

    const rows = await this.db.select().from(auditLog)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditLog.id))
      .limit(limit);

    return rows;
  }
}
```

```typescript
// packages/server/src/services/index.ts
export { UserService } from './user-service.js';
export { TokenService } from './token-service.js';
export { AuditService } from './audit-service.js';
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/
git commit -m "feat(services): add user, token, and audit services"
```

---

### Task 8: Fragment service

**Files:**
- Create: `packages/server/src/services/fragment-service.ts`
- Modify: `packages/server/src/services/index.ts`

- [ ] **Step 1: Implement fragment-service.ts**

```typescript
// packages/server/src/services/fragment-service.ts
import { eq, like, and, or, desc, sql } from 'drizzle-orm';
import { join, relative } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import type { FragmintDb } from '../db/connection.js';
import { fragments } from '../db/schema.js';
import { GitRepository } from '../git/git-repository.js';
import {
  readFragment, writeFragment, generateId, deriveTitle,
} from '../git/fragment-file.js';
import { buildCommitMessage } from '../git/commit-message.js';
import {
  QUALITY_TRANSITIONS, type CreateFragmentInput, type UpdateFragmentInput,
} from '../schema/fragment.js';
import { AuditService } from './audit-service.js';
import { hasRole } from '../auth/index.js';

export class FragmentService {
  private git: GitRepository;

  constructor(
    private db: FragmintDb,
    private storePath: string,
    private audit: AuditService,
  ) {
    this.git = new GitRepository(storePath);
  }

  getGit(): GitRepository {
    return this.git;
  }

  async create(input: CreateFragmentInput, author: string, ip?: string) {
    const id = generateId();
    const now = new Date().toISOString();
    const fragmentsDir = join(this.storePath, 'fragments', input.domain);

    // Ensure domain directory exists
    const { mkdirSync } = await import('node:fs');
    mkdirSync(fragmentsDir, { recursive: true });

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
      valid_from: null,
      valid_until: null,
      parent_id: input.parent_id,
      generation: input.generation,
      uses: 0,
      last_used: null,
      access: input.access,
      origin: input.origin,
    };

    const filePath = writeFragment(fragmentsDir, frontmatter, input.body);
    const relPath = relative(this.storePath, filePath);

    const commitMsg = buildCommitMessage({
      action: 'create',
      type: input.type,
      domain: input.domain,
      description: `new ${input.type} fragment`,
      author,
      fragmentId: id,
      qualityTransition: 'draft',
    });

    const commitHash = await this.git.commit(relPath, commitMsg);

    // Index in SQLite
    const title = deriveTitle(input.body);
    await this.db.insert(fragments).values({
      id, type: input.type, domain: input.domain, lang: input.lang,
      quality: 'draft', author, title,
      body_excerpt: input.body.slice(0, 200),
      created_at: now, updated_at: now,
      file_path: relPath, git_hash: commitHash,
      origin: input.origin,
      parent_id: input.parent_id ?? null,
      translation_of: input.translation_of ?? null,
    });

    await this.audit.log({
      user_id: author, role: 'contributor', action: 'create',
      fragment_id: id, ip_source: ip,
    });

    return { id, file_path: relPath, commit_hash: commitHash, quality: 'draft' };
  }

  async getById(id: string) {
    const rows = await this.db.select().from(fragments).where(eq(fragments.id, id)).limit(1);
    if (rows.length === 0) return null;

    const row = rows[0];
    const filePath = join(this.storePath, row.file_path);
    const { frontmatter, body } = readFragment(filePath);

    return { ...row, frontmatter, body };
  }

  async list(filters?: {
    type?: string;
    domain?: string;
    lang?: string;
    quality?: string;
    limit?: number;
    offset?: number;
  }) {
    const conditions = [];
    if (filters?.type) conditions.push(eq(fragments.type, filters.type));
    if (filters?.domain) conditions.push(eq(fragments.domain, filters.domain));
    if (filters?.lang) conditions.push(eq(fragments.lang, filters.lang));
    if (filters?.quality) conditions.push(eq(fragments.quality, filters.quality));

    const limit = filters?.limit ?? 50;
    const offset = filters?.offset ?? 0;

    const rows = await this.db.select().from(fragments)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(fragments.updated_at))
      .limit(limit)
      .offset(offset);

    return rows;
  }

  async search(query: string, filters?: {
    type?: string[];
    domain?: string[];
    lang?: string;
    quality_min?: string;
  }, limit = 20) {
    const conditions = [];
    const q = `%${query}%`;
    conditions.push(or(like(fragments.title, q), like(fragments.body_excerpt, q)));

    if (filters?.type?.length) {
      conditions.push(sql`${fragments.type} IN (${sql.join(filters.type.map(t => sql`${t}`), sql`, `)})`);
    }
    if (filters?.lang) conditions.push(eq(fragments.lang, filters.lang));

    const rows = await this.db.select().from(fragments)
      .where(and(...conditions))
      .orderBy(desc(fragments.uses))
      .limit(limit);

    return rows;
  }

  async update(id: string, input: UpdateFragmentInput, userId: string, userRole: string, ip?: string) {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Fragment not found');

    // Check write permission
    if (existing.quality === 'approved' && !hasRole(userRole, 'expert')) {
      throw new Error('Only expert+ can modify approved fragments');
    }

    // Quality transition validation
    if (input.quality && input.quality !== existing.quality) {
      const allowed = QUALITY_TRANSITIONS[existing.quality] || [];
      if (!allowed.includes(input.quality)) {
        throw new Error(`Transition ${existing.quality} → ${input.quality} not allowed`);
      }
      if (input.quality === 'approved') {
        throw new Error('Use the approve endpoint for reviewed → approved');
      }
    }

    const filePath = join(this.storePath, existing.file_path);
    const { frontmatter, body } = readFragment(filePath);

    const updatedFrontmatter = { ...frontmatter };
    const newBody = input.body ?? body;

    if (input.tags) updatedFrontmatter.tags = input.tags;
    if (input.domain) updatedFrontmatter.domain = input.domain;
    if (input.quality) updatedFrontmatter.quality = input.quality;
    if (input.access) updatedFrontmatter.access = input.access;
    updatedFrontmatter.updated_at = new Date().toISOString();

    writeFragment(join(this.storePath, 'fragments', updatedFrontmatter.domain), updatedFrontmatter, newBody);

    const commitMsg = buildCommitMessage({
      action: 'update', type: updatedFrontmatter.type,
      domain: updatedFrontmatter.domain,
      description: 'updated fragment',
      author: userId, fragmentId: id,
      qualityTransition: input.quality ? `${existing.quality} → ${input.quality}` : undefined,
    });

    const commitHash = await this.git.commit(existing.file_path, commitMsg);

    await this.db.update(fragments).set({
      domain: updatedFrontmatter.domain,
      quality: updatedFrontmatter.quality,
      updated_at: updatedFrontmatter.updated_at,
      title: deriveTitle(newBody),
      body_excerpt: newBody.slice(0, 200),
      git_hash: commitHash,
    }).where(eq(fragments.id, id));

    await this.audit.log({
      user_id: userId, role: userRole, action: 'update',
      fragment_id: id, ip_source: ip,
    });

    return { id, commit_hash: commitHash };
  }

  async approve(id: string, userId: string, ip?: string) {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Fragment not found');
    if (existing.quality !== 'reviewed') {
      throw new Error(`Cannot approve: current quality is '${existing.quality}', must be 'reviewed'`);
    }

    const filePath = join(this.storePath, existing.file_path);
    const { frontmatter, body } = readFragment(filePath);

    frontmatter.quality = 'approved';
    frontmatter.approved_by = userId;
    frontmatter.updated_at = new Date().toISOString();

    writeFragment(join(this.storePath, 'fragments', frontmatter.domain), frontmatter, body);

    const commitMsg = buildCommitMessage({
      action: 'approve', type: frontmatter.type,
      domain: frontmatter.domain,
      description: `approved by ${userId}`,
      author: userId, fragmentId: id,
      qualityTransition: 'reviewed → approved',
    });

    const commitHash = await this.git.commit(existing.file_path, commitMsg);

    await this.db.update(fragments).set({
      quality: 'approved', updated_at: frontmatter.updated_at, git_hash: commitHash,
    }).where(eq(fragments.id, id));

    await this.audit.log({
      user_id: userId, role: 'expert', action: 'approve',
      fragment_id: id, ip_source: ip,
    });

    return { id, commit_hash: commitHash, quality: 'approved' };
  }

  async deprecate(id: string, userId: string, ip?: string) {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Fragment not found');
    if (existing.quality === 'deprecated') {
      throw new Error('Fragment is already deprecated');
    }

    const filePath = join(this.storePath, existing.file_path);
    const { frontmatter, body } = readFragment(filePath);

    const oldQuality = frontmatter.quality;
    frontmatter.quality = 'deprecated';
    frontmatter.updated_at = new Date().toISOString();

    writeFragment(join(this.storePath, 'fragments', frontmatter.domain), frontmatter, body);

    const commitMsg = buildCommitMessage({
      action: 'deprecate', type: frontmatter.type,
      domain: frontmatter.domain,
      description: `deprecated by ${userId}`,
      author: userId, fragmentId: id,
      qualityTransition: `${oldQuality} → deprecated`,
    });

    const commitHash = await this.git.commit(existing.file_path, commitMsg);

    await this.db.update(fragments).set({
      quality: 'deprecated', updated_at: frontmatter.updated_at, git_hash: commitHash,
    }).where(eq(fragments.id, id));

    await this.audit.log({
      user_id: userId, role: 'admin', action: 'deprecate',
      fragment_id: id, ip_source: ip,
    });

    return { id, commit_hash: commitHash, quality: 'deprecated' };
  }

  async history(id: string) {
    const rows = await this.db.select({ file_path: fragments.file_path })
      .from(fragments).where(eq(fragments.id, id)).limit(1);
    if (rows.length === 0) throw new Error('Fragment not found');
    return this.git.log(rows[0].file_path);
  }

  async inventory(topic?: string, lang?: string) {
    const allFragments = await this.db.select({
      type: fragments.type,
      domain: fragments.domain,
      lang: fragments.lang,
      quality: fragments.quality,
    }).from(fragments);

    const filtered = topic
      ? allFragments.filter(f => f.domain.toLowerCase().includes(topic.toLowerCase()))
      : allFragments;

    const byType: Record<string, number> = {};
    const byQuality: Record<string, number> = {};
    const byLang: Record<string, Record<string, number>> = {};

    for (const f of filtered) {
      byType[f.type] = (byType[f.type] || 0) + 1;
      byQuality[f.quality] = (byQuality[f.quality] || 0) + 1;

      if (!byLang[f.lang]) byLang[f.lang] = {};
      byLang[f.lang][f.quality] = (byLang[f.lang][f.quality] || 0) + 1;
    }

    return {
      total: filtered.length,
      by_type: byType,
      by_quality: byQuality,
      by_lang: byLang,
    };
  }

  async lineage(id: string) {
    const row = await this.db.select().from(fragments).where(eq(fragments.id, id)).limit(1);
    if (row.length === 0) throw new Error('Fragment not found');
    const frag = row[0];

    const children = await this.db.select().from(fragments)
      .where(eq(fragments.parent_id, id));
    const translations = await this.db.select().from(fragments)
      .where(eq(fragments.translation_of, id));

    return { root: frag, children, translations };
  }

  async reindex() {
    const fragmentsDir = join(this.storePath, 'fragments');
    const files = this.walkDir(fragmentsDir).filter(f => f.endsWith('.md'));
    let indexed = 0;

    for (const absPath of files) {
      try {
        const { frontmatter, body } = readFragment(absPath);
        const relPath = relative(this.storePath, absPath);
        const title = deriveTitle(body);

        await this.db.insert(fragments).values({
          id: frontmatter.id,
          type: frontmatter.type,
          domain: frontmatter.domain,
          lang: frontmatter.lang,
          quality: frontmatter.quality,
          author: frontmatter.author,
          title,
          body_excerpt: body.slice(0, 200),
          created_at: frontmatter.created_at,
          updated_at: frontmatter.updated_at,
          file_path: relPath,
          origin: frontmatter.origin ?? 'manual',
          parent_id: frontmatter.parent_id ?? null,
          translation_of: frontmatter.translation_of ?? null,
        }).onConflictDoUpdate({
          target: fragments.id,
          set: {
            quality: frontmatter.quality,
            updated_at: frontmatter.updated_at,
            title,
            body_excerpt: body.slice(0, 200),
            file_path: relPath,
          },
        });
        indexed++;
      } catch (err) {
        console.error(`Failed to index ${absPath}:`, err);
      }
    }

    return { indexed, total: files.length };
  }

  private walkDir(dir: string): string[] {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      return entries.flatMap(e =>
        e.isDirectory() ? this.walkDir(join(dir, e.name)) : [join(dir, e.name)]
      );
    } catch {
      return [];
    }
  }
}
```

- [ ] **Step 2: Export from services index**

Add `export { FragmentService } from './fragment-service.js';` to `packages/server/src/services/index.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/services/
git commit -m "feat(services): add fragment service with CRUD, quality transitions, search, inventory"
```

---

## Chunk 3: Routes, Server, CLI, Example Vault

### Task 9: Fastify routes

**Files:**
- Create: `packages/server/src/routes/auth-routes.ts`
- Create: `packages/server/src/routes/fragment-routes.ts`
- Create: `packages/server/src/routes/admin-routes.ts`
- Create: `packages/server/src/routes/index.ts`

- [ ] **Step 1: Implement auth-routes.ts**

```typescript
// packages/server/src/routes/auth-routes.ts
import type { FastifyInstance } from 'fastify';
import { loginSchema } from '../schema/api.js';
import { UserService } from '../services/user-service.js';

export function authRoutes(app: FastifyInstance, userService: UserService) {
  app.post('/v1/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    }

    const user = await userService.authenticate(parsed.data.username, parsed.data.password);
    if (!user) {
      return reply.status(401).send({ data: null, meta: null, error: 'Invalid credentials' });
    }

    const token = app.jwt.sign(
      { sub: user.login, role: user.role, display_name: user.display_name },
    );

    return { data: { token, user }, meta: null, error: null };
  });
}
```

- [ ] **Step 2: Implement fragment-routes.ts**

```typescript
// packages/server/src/routes/fragment-routes.ts
import type { FastifyInstance } from 'fastify';
import { requireRole } from '../auth/middleware.js';
import { FragmentService } from '../services/fragment-service.js';
import { createFragmentSchema, updateFragmentSchema } from '../schema/fragment.js';
import { searchQuerySchema, inventoryQuerySchema } from '../schema/api.js';

export function fragmentRoutes(
  app: FastifyInstance,
  fragmentService: FragmentService,
  authenticate: ReturnType<typeof import('../auth/middleware.js').buildAuthMiddleware>,
) {
  // List fragments
  app.get('/v1/fragments', { preHandler: [authenticate, requireRole('reader')] }, async (request) => {
    const query = request.query as Record<string, string>;
    const rows = await fragmentService.list({
      type: query.type, domain: query.domain, lang: query.lang, quality: query.quality,
      limit: query.limit ? parseInt(query.limit) : undefined,
    });
    return { data: rows, meta: { count: rows.length }, error: null };
  });

  // Get fragment by ID
  app.get('/v1/fragments/:id', { preHandler: [authenticate, requireRole('reader')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const frag = await fragmentService.getById(id);
    if (!frag) return reply.status(404).send({ data: null, meta: null, error: 'Fragment not found' });
    return { data: frag, meta: null, error: null };
  });

  // Git history
  app.get('/v1/fragments/:id/history', { preHandler: [authenticate, requireRole('reader')] }, async (request) => {
    const { id } = request.params as { id: string };
    const history = await fragmentService.history(id);
    return { data: history, meta: null, error: null };
  });

  // Diff
  app.get('/v1/fragments/:id/diff/:c1/:c2', { preHandler: [authenticate, requireRole('reader')] }, async (request) => {
    const { id, c1, c2 } = request.params as { id: string; c1: string; c2: string };
    const frag = await fragmentService.getById(id);
    if (!frag) throw new Error('Fragment not found');
    const diff = await fragmentService.getGit().diff(c1, c2, frag.file_path);
    return { data: { diff }, meta: null, error: null };
  });

  // Version at commit
  app.get('/v1/fragments/:id/version/:commit', { preHandler: [authenticate, requireRole('reader')] }, async (request) => {
    const { id, commit } = request.params as { id: string; commit: string };
    const frag = await fragmentService.getById(id);
    if (!frag) throw new Error('Fragment not found');
    const content = await fragmentService.getGit().show(commit, frag.file_path);
    return { data: { content, commit }, meta: null, error: null };
  });

  // Search
  app.post('/v1/fragments/search', { preHandler: [authenticate, requireRole('reader')] }, async (request) => {
    const parsed = searchQuerySchema.safeParse(request.body);
    if (!parsed.success) return { data: null, meta: null, error: parsed.error.message };
    const results = await fragmentService.search(parsed.data.query, parsed.data.filters, parsed.data.limit);
    return { data: results, meta: { count: results.length }, error: null };
  });

  // Inventory
  app.post('/v1/fragments/inventory', { preHandler: [authenticate, requireRole('reader')] }, async (request) => {
    const parsed = inventoryQuerySchema.safeParse(request.body);
    if (!parsed.success) return { data: null, meta: null, error: parsed.error.message };
    const inventory = await fragmentService.inventory(parsed.data?.topic, parsed.data?.lang);
    return { data: inventory, meta: null, error: null };
  });

  // Create
  app.post('/v1/fragments', { preHandler: [authenticate, requireRole('contributor')] }, async (request, reply) => {
    const parsed = createFragmentSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    const result = await fragmentService.create(parsed.data, request.user.login, request.ip);
    return reply.status(201).send({ data: result, meta: null, error: null });
  });

  // Update
  app.put('/v1/fragments/:id', { preHandler: [authenticate, requireRole('contributor')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateFragmentSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    const result = await fragmentService.update(id, parsed.data, request.user.login, request.user.role, request.ip);
    return { data: result, meta: null, error: null };
  });

  // Review
  app.post('/v1/fragments/:id/review', { preHandler: [authenticate, requireRole('contributor')] }, async (request) => {
    const { id } = request.params as { id: string };
    const result = await fragmentService.update(id, { quality: 'reviewed' }, request.user.login, request.user.role, request.ip);
    return { data: result, meta: null, error: null };
  });

  // Approve
  app.post('/v1/fragments/:id/approve', { preHandler: [authenticate, requireRole('expert')] }, async (request) => {
    const { id } = request.params as { id: string };
    const result = await fragmentService.approve(id, request.user.login, request.ip);
    return { data: result, meta: null, error: null };
  });

  // Deprecate
  app.post('/v1/fragments/:id/deprecate', { preHandler: [authenticate, requireRole('admin')] }, async (request) => {
    const { id } = request.params as { id: string };
    const result = await fragmentService.deprecate(id, request.user.login, request.ip);
    return { data: result, meta: null, error: null };
  });

  // Lineage
  app.get('/v1/fragments/:id/lineage', { preHandler: [authenticate, requireRole('reader')] }, async (request) => {
    const { id } = request.params as { id: string };
    const lineage = await fragmentService.lineage(id);
    return { data: lineage, meta: null, error: null };
  });

  // Restore
  app.post('/v1/fragments/:id/restore/:commit', { preHandler: [authenticate, requireRole('admin')] }, async (request) => {
    const { id, commit } = request.params as { id: string; commit: string };
    const frag = await fragmentService.getById(id);
    if (!frag) throw new Error('Fragment not found');
    await fragmentService.getGit().restore(commit, frag.file_path);
    return { data: { restored: true, commit }, meta: null, error: null };
  });
}
```

- [ ] **Step 3: Implement admin-routes.ts**

```typescript
// packages/server/src/routes/admin-routes.ts
import type { FastifyInstance } from 'fastify';
import { requireRole } from '../auth/middleware.js';
import { UserService } from '../services/user-service.js';
import { TokenService } from '../services/token-service.js';
import { AuditService } from '../services/audit-service.js';
import { FragmentService } from '../services/fragment-service.js';
import { createUserSchema, createTokenSchema } from '../schema/api.js';

export function adminRoutes(
  app: FastifyInstance,
  userService: UserService,
  tokenService: TokenService,
  auditService: AuditService,
  fragmentService: FragmentService,
  authenticate: ReturnType<typeof import('../auth/middleware.js').buildAuthMiddleware>,
) {
  // Users
  app.get('/v1/users', { preHandler: [authenticate, requireRole('admin')] }, async () => {
    const users = await userService.list();
    return { data: users, meta: { count: users.length }, error: null };
  });

  app.post('/v1/users', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    const user = await userService.create(parsed.data.login, parsed.data.password, parsed.data.display_name, parsed.data.role);
    return reply.status(201).send({ data: user, meta: null, error: null });
  });

  // Tokens
  app.get('/v1/tokens', { preHandler: [authenticate, requireRole('admin')] }, async () => {
    const tokens = await tokenService.list();
    return { data: tokens, meta: { count: tokens.length }, error: null };
  });

  app.post('/v1/tokens', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const parsed = createTokenSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    const token = await tokenService.create(parsed.data.name, parsed.data.role, request.user.login);
    return reply.status(201).send({ data: token, meta: null, error: null });
  });

  app.delete('/v1/tokens/:id', { preHandler: [authenticate, requireRole('admin')] }, async (request) => {
    const { id } = request.params as { id: string };
    await tokenService.revoke(id);
    return { data: { revoked: true }, meta: null, error: null };
  });

  // Audit
  app.get('/v1/audit', { preHandler: [authenticate, requireRole('admin')] }, async (request) => {
    const query = request.query as Record<string, string>;
    const logs = await auditService.query({ from: query.from, to: query.to });
    return { data: logs, meta: { count: logs.length }, error: null };
  });

  // Index
  app.post('/v1/index/trigger', { preHandler: [authenticate, requireRole('admin')] }, async () => {
    const result = await fragmentService.reindex();
    return { data: result, meta: null, error: null };
  });

  app.get('/v1/index/status', { preHandler: [authenticate, requireRole('admin')] }, async () => {
    return { data: { status: 'ok', last_run: new Date().toISOString() }, meta: null, error: null };
  });
}
```

```typescript
// packages/server/src/routes/index.ts
export { authRoutes } from './auth-routes.js';
export { fragmentRoutes } from './fragment-routes.js';
export { adminRoutes } from './admin-routes.js';
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/
git commit -m "feat(routes): add auth, fragment, and admin Fastify routes"
```

---

### Task 10: Server entry point

**Files:**
- Create: `packages/server/src/index.ts`

- [ ] **Step 1: Implement server entry point**

```typescript
// packages/server/src/index.ts
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCors from '@fastify/cors';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, type FragmintConfig } from './config.js';
import { createDb, type FragmintDb } from './db/index.js';
import { buildAuthMiddleware } from './auth/middleware.js';
import { UserService, TokenService, AuditService, FragmentService } from './services/index.js';
import { authRoutes } from './routes/auth-routes.js';
import { fragmentRoutes } from './routes/fragment-routes.js';
import { adminRoutes } from './routes/admin-routes.js';
import { GitRepository } from './git/git-repository.js';

export interface FragmintServer {
  app: ReturnType<typeof Fastify>;
  config: FragmintConfig;
  db: FragmintDb;
}

export async function createServer(options?: {
  configPath?: string;
  dev?: boolean;
  dbPath?: string;
}): Promise<FragmintServer> {
  const config = loadConfig(options?.configPath, options?.dev ?? false);
  const storePath = resolve(config.store_path);

  // Database
  // createDb handles table creation on the same connection (critical for :memory:)
  const dbPath = options?.dbPath ?? (config.dev ? ':memory:' : resolve(storePath, '.fragmint.db'));
  const db = createDb(dbPath);

  // Git init if needed
  const git = new GitRepository(storePath);
  if (!existsSync(resolve(storePath, '.git'))) {
    await git.init();
  }

  // Fastify
  const app = Fastify({ logger: { level: config.log_level }, trustProxy: config.trust_proxy });

  await app.register(fastifyJwt, { secret: config.jwt_secret, sign: { expiresIn: config.jwt_ttl } });
  await app.register(fastifyCors);

  // Services
  const auditService = new AuditService(db);
  const userService = new UserService(db);
  const tokenService = new TokenService(db);
  const fragmentService = new FragmentService(db, storePath, auditService);

  // Auth middleware
  const authenticate = buildAuthMiddleware(db);

  // Routes
  authRoutes(app, userService);
  fragmentRoutes(app, fragmentService, authenticate);
  adminRoutes(app, userService, tokenService, auditService, fragmentService, authenticate);

  // Error handler
  app.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    reply.status(statusCode).send({
      data: null,
      meta: null,
      error: error.message,
    });
  });

  // Seed dev data
  if (config.dev) {
    const exists = await userService.exists('mmaudet');
    if (!exists) {
      await userService.create('mmaudet', 'fragmint-dev', 'Michel-Marie Maudet', 'admin');
      console.log('Dev user created: mmaudet / fragmint-dev');
    }
  }

  // Reindex on startup if empty
  const result = await fragmentService.reindex();
  if (result.indexed > 0) {
    console.log(`Indexed ${result.indexed} fragments on startup`);
  }

  return { app, config, db };
}

export async function startServer(options?: {
  configPath?: string;
  dev?: boolean;
}) {
  const { app, config } = await createServer(options);
  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`Fragmint server listening on http://localhost:${config.port}`);
  return app;
}

// Re-export for CLI and tests
export { loadConfig } from './config.js';
export type { FragmintConfig } from './config.js';
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat(server): add Fastify server entry point with auto-init and dev mode"
```

---

### Task 11: Example vault

**Files:**
- Create: `example-vault/fragments/commercial/introduction-souverainete-fr.md`
- Create: `example-vault/fragments/commercial/argument-openrag-vs-proprietaire-fr.md`
- Create: `example-vault/fragments/commercial/pricing-twake-secteur-public-fr.md`
- Create: `example-vault/fragments/commercial/introduction-sovereignty-en.md`
- Create: `example-vault/fragments/juridique/clause-donnees-personnelles-rgpd-fr.md`
- Create: `example-vault/templates/.gitkeep`

- [ ] **Step 1: Create the 5 example fragments**

Each file follows the PRD frontmatter format with the data from the mockup HTML. Example for `introduction-souverainete-fr.md`:

```markdown
---
id: frag-f1a2b3c4-0001-4000-8000-000000000001
type: introduction
domain: souveraineté
tags: [souveraineté, europe, administrations, cloud-act]
lang: fr
translation_of: null
translations:
  en: frag-f1a2b3c4-0001-4000-8000-000000000004
quality: approved
author: mmaudet
reviewed_by: null
approved_by: mmaudet
created_at: "2026-03-05"
updated_at: "2026-03-10"
valid_from: "2026-01-01"
valid_until: null
parent_id: null
generation: 0
uses: 14
last_used: "2026-03-10"
contexts: [linagora, gendarmerie]
origin: manual
access:
  read: ["*"]
  write: [contributor, admin]
  approve: [expert, admin]
---

# Introduction souveraineté numérique

Dans un contexte où la dépendance aux acteurs technologiques américains et chinois s'accroît, la souveraineté numérique est devenue un enjeu stratégique pour les administrations européennes. Les récentes évolutions réglementaires (Cloud Act, RGPD, directive NIS2) confirment la nécessité de disposer d'alternatives souveraines, auditables et déployables en environnement maîtrisé.
```

Create similar files for the other 4 fragments using data from the PRD/mockup.

- [ ] **Step 2: Create templates/.gitkeep**

Empty file to preserve the directory.

- [ ] **Step 3: Commit**

```bash
git add example-vault/
git commit -m "feat(vault): add example vault with 5 sample fragments"
```

---

### Task 12: CLI package

**Files:**
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/client.ts`
- Create: `packages/cli/src/commands/serve.ts`
- Create: `packages/cli/src/commands/fragments.ts`
- Create: `packages/cli/src/commands/admin.ts`

- [ ] **Step 1: Implement HTTP client helper**

```typescript
// packages/cli/src/client.ts
export class FragmintClient {
  constructor(
    private baseUrl: string,
    private token?: string,
  ) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = await res.json() as { data: T; error: string | null };
    if (!res.ok || json.error) {
      throw new Error(json.error ?? `HTTP ${res.status}`);
    }
    return json.data;
  }
}
```

- [ ] **Step 2: Implement CLI commands**

Create `serve.ts` (imports `startServer` from `@fragmint/server`), `fragments.ts` (search, get, add, approve, deprecate, inventory, gaps), `admin.ts` (token, users, audit, index).

Each command follows the pattern:
```typescript
export function registerFragmentCommands(program: Command, getClient: () => FragmintClient) {
  program.command('search <query>')
    .option('--type <type>')
    .option('--lang <lang>')
    .option('--json', 'JSON output')
    .action(async (query, opts) => {
      const client = getClient();
      const results = await client.request('POST', '/v1/fragments/search', {
        query, filters: { type: opts.type ? [opts.type] : undefined, lang: opts.lang },
      });
      if (opts.json) console.log(JSON.stringify(results, null, 2));
      else // format human-readable output
    });
  // ... other commands
}
```

- [ ] **Step 3: Implement CLI entry point**

```typescript
// packages/cli/src/index.ts
#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import yaml from 'js-yaml';
import { FragmintClient } from './client.js';
import { registerServeCommand } from './commands/serve.js';
import { registerFragmentCommands } from './commands/fragments.js';
import { registerAdminCommands } from './commands/admin.js';

const program = new Command();
program.name('fragmint').version('0.1.0').description('Fragmint CLI');

// Config resolution
let url = process.env.FRAGMINT_URL ?? 'http://localhost:3210';
let token = process.env.FRAGMINT_TOKEN;

const rcPath = join(homedir(), '.fragmintrc.yaml');
if (existsSync(rcPath)) {
  const rc = yaml.load(readFileSync(rcPath, 'utf-8')) as Record<string, string>;
  url = rc.url ?? url;
  token = rc.token ?? token;
}

program.option('--url <url>', 'Server URL').option('--token <token>', 'Auth token');

const getClient = () => {
  const opts = program.opts();
  return new FragmintClient(opts.url ?? url, opts.token ?? token);
};

registerServeCommand(program);
registerFragmentCommands(program, getClient);
registerAdminCommands(program, getClient);

program.parse();
```

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/
git commit -m "feat(cli): add CLI with serve, fragment, and admin commands"
```

---

## Chunk 4: Integration Tests

### Task 13: Integration tests

**Files:**
- Create: `packages/server/src/test-helpers.ts`
- Create: `packages/server/src/routes/fragments.integration.test.ts`
- Create: `packages/server/src/routes/auth.integration.test.ts`

- [ ] **Step 1: Create test helpers**

```typescript
// packages/server/src/test-helpers.ts
import { mkdtempSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type FragmintServer } from './index.js';

export async function createTestServer(): Promise<FragmintServer & { cleanup: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), 'fragmint-test-'));

  // Copy example vault
  cpSync(join(process.cwd(), '../../example-vault'), join(dir, 'vault'), { recursive: true });

  const server = await createServer({
    dev: true,
    dbPath: ':memory:',
    configPath: undefined,
  });

  // Override store path
  // (we need to re-create with the temp dir — this is simplified for the plan)

  return {
    ...server,
    cleanup: () => rmSync(dir, { recursive: true }),
  };
}

export async function getAuthToken(app: FragmintServer['app']): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { username: 'mmaudet', password: 'fragmint-dev' },
  });
  const body = JSON.parse(res.body);
  return body.data.token;
}
```

- [ ] **Step 2: Write auth integration tests**

```typescript
// packages/server/src/routes/auth.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type FragmintServer } from '../index.js';

describe('Auth routes', () => {
  let server: FragmintServer;

  beforeAll(async () => {
    server = await createServer({ dev: true, dbPath: ':memory:' });
  });

  afterAll(async () => {
    await server.app.close();
  });

  it('POST /v1/auth/login returns JWT for valid credentials', async () => {
    const res = await server.app.inject({
      method: 'POST', url: '/v1/auth/login',
      payload: { username: 'mmaudet', password: 'fragmint-dev' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.token).toBeDefined();
    expect(body.data.user.role).toBe('admin');
  });

  it('POST /v1/auth/login rejects invalid password', async () => {
    const res = await server.app.inject({
      method: 'POST', url: '/v1/auth/login',
      payload: { username: 'mmaudet', password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /v1/fragments without auth returns 401', async () => {
    const res = await server.app.inject({ method: 'GET', url: '/v1/fragments' });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 3: Write fragment CRUD integration tests**

```typescript
// packages/server/src/routes/fragments.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type FragmintServer } from '../index.js';

describe('Fragment routes', () => {
  let server: FragmintServer;
  let token: string;

  beforeAll(async () => {
    server = await createServer({ dev: true, dbPath: ':memory:' });

    const res = await server.app.inject({
      method: 'POST', url: '/v1/auth/login',
      payload: { username: 'mmaudet', password: 'fragmint-dev' },
    });
    token = JSON.parse(res.body).data.token;
  });

  afterAll(async () => {
    await server.app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('POST /v1/fragments creates a fragment', async () => {
    const res = await server.app.inject({
      method: 'POST', url: '/v1/fragments',
      headers: auth(),
      payload: {
        type: 'argument', domain: 'test', lang: 'fr',
        body: '# Test argument\n\nThis is a test.', tags: ['test'],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.id).toMatch(/^frag-/);
    expect(body.data.quality).toBe('draft');
  });

  it('GET /v1/fragments lists fragments', async () => {
    const res = await server.app.inject({
      method: 'GET', url: '/v1/fragments', headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('POST /v1/fragments/search returns results', async () => {
    const res = await server.app.inject({
      method: 'POST', url: '/v1/fragments/search',
      headers: auth(),
      payload: { query: 'test' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('POST /v1/fragments/inventory returns counts', async () => {
    const res = await server.app.inject({
      method: 'POST', url: '/v1/fragments/inventory',
      headers: auth(),
      payload: { topic: 'test' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.total).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 4: Run all tests**

Run: `pnpm vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/test-helpers.ts packages/server/src/routes/*.integration.test.ts
git commit -m "test: add integration tests for auth and fragment CRUD"
```

---

### Task 14: Final wiring and smoke test

- [ ] **Step 1: Verify `pnpm build` succeeds**

Run: `pnpm build`
Expected: Both packages compile without errors

- [ ] **Step 2: Verify `pnpm test` passes**

Run: `pnpm test`
Expected: All unit and integration tests pass

- [ ] **Step 3: Manual smoke test**

```bash
cd packages/cli && node dist/index.js serve --dev --port 3210
# In another terminal:
curl -X POST http://localhost:3210/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"mmaudet","password":"fragmint-dev"}'
# Should return a JWT token
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: Phase 0 foundations complete"
```
