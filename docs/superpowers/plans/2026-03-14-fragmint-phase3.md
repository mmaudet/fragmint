# Phase 3: Templates & Composition Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Carbone-based DOCX generation from templates populated with resolved fragments.

**Architecture:** Two new services (TemplateService for CRUD, ComposerService for resolution + rendering) added to the existing Fastify server. Templates are stored as .docx + .fragmint.yaml in Git with a SQLite index. Composition resolves fragment slots via FragmentService, builds a JSON payload, and renders via Carbone.

**Tech Stack:** Carbone ^4, @fastify/multipart, Fastify 5, Drizzle ORM, Zod, Vitest

**Spec:** `docs/superpowers/specs/2026-03-14-fragmint-phase3-design.md`

---

## Chunk 1: Data Model & Schemas

### Task 1: Add `templates` table to Drizzle schema

**Files:**
- Modify: `packages/server/src/db/schema.ts`

- [ ] **Step 1: Add the templates table definition**

```typescript
export const templates = sqliteTable('templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  output_format: text('output_format').notNull(),
  version: text('version').notNull(),
  template_path: text('template_path').notNull(),
  yaml_path: text('yaml_path').notNull(),
  author: text('author').notNull(),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
  git_hash: text('git_hash'),
});
```

- [ ] **Step 2: Verify the server still starts**

Run: `cd packages/server && npx tsx src/index.ts &` then `curl http://localhost:3210/v1/fragments` then kill the process.
Expected: Server starts, fragments endpoint responds.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/db/schema.ts
git commit -m "feat(db): add templates table to Drizzle schema"
```

### Task 2: Create Zod schemas for templates and composition

**Files:**
- Create: `packages/server/src/schema/template.ts`
- Create: `packages/server/src/schema/template.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import {
  TemplateYamlSchema,
  ComposeRequestSchema,
  ComposeResponseSchema,
} from './template.js';

describe('TemplateYamlSchema', () => {
  const validYaml = {
    id: 'tpl-a1b2c3d4',
    name: 'Proposition commerciale',
    output_format: 'docx',
    carbone_template: 'proposition-commerciale.docx',
    version: '1.0',
    fragments: [
      {
        key: 'introduction',
        type: 'introduction',
        domain: 'souveraineté',
        lang: '{{context.lang}}',
        quality_min: 'reviewed',
        required: true,
        fallback: 'error',
        count: 1,
      },
    ],
  };

  it('validates a correct template YAML', () => {
    const result = TemplateYamlSchema.safeParse(validYaml);
    expect(result.success).toBe(true);
  });

  it('rejects invalid id prefix', () => {
    const result = TemplateYamlSchema.safeParse({ ...validYaml, id: 'bad-id' });
    expect(result.success).toBe(false);
  });

  it('rejects missing fragments array', () => {
    const { fragments, ...noFragments } = validYaml;
    const result = TemplateYamlSchema.safeParse(noFragments);
    expect(result.success).toBe(false);
  });

  it('applies defaults for optional fields', () => {
    const minimal = {
      ...validYaml,
      fragments: [{ key: 'intro', type: 'introduction', domain: 'test', lang: 'fr' }],
    };
    const result = TemplateYamlSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fragments[0].quality_min).toBe('draft');
      expect(result.data.fragments[0].fallback).toBe('error');
      expect(result.data.fragments[0].count).toBe(1);
      expect(result.data.fragments[0].required).toBe(true);
    }
  });

  it('accepts description and author as optional', () => {
    const withOptionals = {
      ...validYaml,
      description: 'Template standard',
      author: 'mmaudet',
    };
    const result = TemplateYamlSchema.safeParse(withOptionals);
    expect(result.success).toBe(true);
  });
});

describe('ComposeRequestSchema', () => {
  it('validates a complete compose request', () => {
    const result = ComposeRequestSchema.safeParse({
      context: { lang: 'fr', product: 'twake' },
      overrides: { pricing: 'frag-123' },
      structured_data: { lignes: [{ label: 'Item', qte: 1, pu: 10, total: 10 }] },
      output: { format: 'docx', filename: 'test.docx' },
    });
    expect(result.success).toBe(true);
  });

  it('validates a minimal compose request', () => {
    const result = ComposeRequestSchema.safeParse({
      context: { lang: 'fr' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects unsupported output format', () => {
    const result = ComposeRequestSchema.safeParse({
      context: { lang: 'fr' },
      output: { format: 'xlsx' },
    });
    expect(result.success).toBe(false);
  });
});

describe('ComposeResponseSchema', () => {
  it('validates a complete compose response', () => {
    const result = ComposeResponseSchema.safeParse({
      document_url: '/v1/outputs/test.docx',
      expires_at: '2026-03-14T15:00:00Z',
      template: { id: 'tpl-123', name: 'Test', version: '1.0' },
      context: { lang: 'fr' },
      resolved: [{ key: 'intro', fragment_id: 'frag-123', score: 0.9, quality: 'approved' }],
      skipped: [],
      generated: [],
      warnings: [],
      render_ms: 12,
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/server && npx vitest run src/schema/template.test.ts`
Expected: FAIL — module './template.js' not found

- [ ] **Step 3: Write the Zod schemas**

Create `packages/server/src/schema/template.ts`:

```typescript
import { z } from 'zod';

export const FragmentSlotSchema = z.object({
  key: z.string(),
  type: z.string(),
  domain: z.string(),
  lang: z.string(),
  quality_min: z.enum(['draft', 'reviewed', 'approved']).default('draft'),
  required: z.boolean().default(true),
  fallback: z.enum(['skip', 'error', 'generate']).default('error'),
  count: z.number().int().positive().default(1),
});

export const StructuredDataDefSchema = z.object({
  key: z.string(),
  source: z.enum(['context']),
  schema: z.record(z.string()),
});

export const ContextFieldSchema = z.object({
  type: z.enum(['string', 'number', 'date']),
  required: z.boolean().default(false),
  default: z.any().optional(),
  enum: z.array(z.string()).optional(),
});

export const TemplateYamlSchema = z.object({
  id: z.string().startsWith('tpl-'),
  name: z.string(),
  description: z.string().optional(),
  output_format: z.enum(['docx']),
  author: z.string().optional(),
  carbone_template: z.string(),
  version: z.string(),
  fragments: z.array(FragmentSlotSchema),
  structured_data: z.array(StructuredDataDefSchema).optional(),
  context_schema: z.record(ContextFieldSchema).optional(),
});

export type TemplateYaml = z.infer<typeof TemplateYamlSchema>;
export type FragmentSlot = z.infer<typeof FragmentSlotSchema>;

export const ComposeRequestSchema = z.object({
  context: z.record(z.any()),
  overrides: z.record(z.string()).optional(),
  structured_data: z.record(z.any()).optional(),
  output: z.object({
    format: z.enum(['docx']),
    filename: z.string().optional(),
  }).optional(),
});

export type ComposeRequest = z.infer<typeof ComposeRequestSchema>;

export const ResolvedFragmentSchema = z.object({
  key: z.string(),
  fragment_id: z.string(),
  score: z.number(),
  quality: z.string(),
});

export const ComposeResponseSchema = z.object({
  document_url: z.string(),
  expires_at: z.string(),
  template: z.object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
  }),
  context: z.record(z.any()),
  resolved: z.array(ResolvedFragmentSchema),
  skipped: z.array(z.string()),
  generated: z.array(z.any()),
  structured_data: z.record(z.any()).optional(),
  warnings: z.array(z.string()),
  render_ms: z.number(),
});

export type ComposeResponse = z.infer<typeof ComposeResponseSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run src/schema/template.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/schema/template.ts packages/server/src/schema/template.test.ts
git commit -m "feat(schema): add Zod schemas for templates and composition"
```

---

## Chunk 2: TemplateService

### Task 3: Install dependencies

**Files:**
- Modify: `packages/server/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Install carbone and @fastify/multipart**

Run: `cd packages/server && pnpm add carbone @fastify/multipart`

- [ ] **Step 2: Install carbone type stubs if needed**

Run: `cd packages/server && pnpm add -D @types/carbone` (if it exists, otherwise we'll create a local declaration)

- [ ] **Step 3: Commit**

```bash
git add packages/server/package.json pnpm-lock.yaml
git commit -m "chore(deps): add carbone and @fastify/multipart"
```

### Task 4: Implement TemplateService

**Files:**
- Create: `packages/server/src/services/template-service.ts`
- Create: `packages/server/src/services/template-service.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDb } from '../db/index.js';
import { AuditService } from './audit-service.js';
import { TemplateService } from './template-service.js';
import { GitRepository } from '../git/git-repository.js';

describe('TemplateService', () => {
  let service: TemplateService;
  let storePath: string;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    storePath = mkdtempSync(join(tmpdir(), 'fragmint-tpl-test-'));
    mkdirSync(join(storePath, 'templates'), { recursive: true });
    const git = new GitRepository(storePath);
    await git.init();

    db = createDb(':memory:');
    const audit = new AuditService(db);
    service = new TemplateService(db, storePath, audit);
  });

  it('creates a template from .docx and .yaml files', async () => {
    // Create fixture files
    const docxContent = Buffer.from('PK mock docx');
    const yamlContent = `
id: tpl-test-001
name: Test template
output_format: docx
carbone_template: test.docx
version: "1.0"
fragments:
  - key: introduction
    type: introduction
    domain: test
    lang: fr
    quality_min: draft
    required: true
    fallback: error
    count: 1
`;
    const result = await service.create(
      docxContent,
      yamlContent,
      'test.docx',
      'mmaudet',
      'expert',
    );

    expect(result.id).toBe('tpl-test-001');
    expect(result.quality).toBeUndefined(); // templates don't have quality
  });

  it('lists templates', async () => {
    const rows = await service.list();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].name).toBe('Test template');
  });

  it('gets a template by id with parsed YAML', async () => {
    const tpl = await service.getById('tpl-test-001');
    expect(tpl).not.toBeNull();
    expect(tpl!.name).toBe('Test template');
    expect(tpl!.yaml.fragments).toHaveLength(1);
    expect(tpl!.yaml.fragments[0].key).toBe('introduction');
  });

  it('returns null for unknown id', async () => {
    const tpl = await service.getById('tpl-unknown');
    expect(tpl).toBeNull();
  });

  it('deletes a template', async () => {
    await service.delete('tpl-test-001', 'mmaudet', 'admin');
    const tpl = await service.getById('tpl-test-001');
    expect(tpl).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/server && npx vitest run src/services/template-service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement TemplateService**

Create `packages/server/src/services/template-service.ts`:

```typescript
import { eq, desc } from 'drizzle-orm';
import { join, relative } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import yaml from 'js-yaml';
import type { FragmintDb } from '../db/connection.js';
import { templates } from '../db/schema.js';
import { GitRepository } from '../git/git-repository.js';
import { AuditService } from './audit-service.js';
import { TemplateYamlSchema, type TemplateYaml } from '../schema/template.js';

export class TemplateService {
  private git: GitRepository;

  constructor(
    private db: FragmintDb,
    private storePath: string,
    private audit: AuditService,
  ) {
    this.git = new GitRepository(storePath);
  }

  async create(
    docxBuffer: Buffer,
    yamlContent: string,
    docxFilename: string,
    author: string,
    authorRole: string,
    ip?: string,
  ) {
    const parsed = TemplateYamlSchema.parse(yaml.load(yamlContent));
    const now = new Date().toISOString();
    const tplDir = join(this.storePath, 'templates');
    mkdirSync(tplDir, { recursive: true });

    // Write files
    const docxPath = join(tplDir, parsed.carbone_template);
    const yamlFilename = parsed.carbone_template.replace(/\.\w+$/, '.fragmint.yaml');
    const yamlPath = join(tplDir, yamlFilename);

    writeFileSync(docxPath, docxBuffer);
    writeFileSync(yamlPath, yamlContent, 'utf-8');

    const relDocx = relative(this.storePath, docxPath);
    const relYaml = relative(this.storePath, yamlPath);

    // Git commit
    await this.git.exec_public('add', relDocx, relYaml);
    const commitResult = await this.git.commit_multi(
      [relDocx, relYaml],
      `create(template): ${parsed.name}\n\nTemplate-Id: ${parsed.id}\nAuthor: ${author}`,
    );

    // SQLite index
    await this.db.insert(templates).values({
      id: parsed.id,
      name: parsed.name,
      description: parsed.description ?? null,
      output_format: parsed.output_format,
      version: parsed.version,
      template_path: relDocx,
      yaml_path: relYaml,
      author: parsed.author ?? author,
      created_at: now,
      updated_at: now,
      git_hash: commitResult,
    });

    await this.audit.log({
      user_id: author,
      role: authorRole,
      action: 'create_template',
      fragment_id: parsed.id,
      ip_source: ip,
    });

    return { id: parsed.id, file_path: relDocx, commit_hash: commitResult };
  }

  async list(filters?: { output_format?: string }) {
    const conditions = [];
    if (filters?.output_format) conditions.push(eq(templates.output_format, filters.output_format));

    const rows = await this.db.select().from(templates)
      .where(conditions.length ? conditions[0] : undefined)
      .orderBy(desc(templates.updated_at));

    return rows;
  }

  async getById(id: string): Promise<{ name: string; yaml: TemplateYaml; row: typeof templates.$inferSelect } | null> {
    const rows = await this.db.select().from(templates).where(eq(templates.id, id)).limit(1);
    if (rows.length === 0) return null;

    const row = rows[0];
    const yamlPath = join(this.storePath, row.yaml_path);
    const yamlContent = readFileSync(yamlPath, 'utf-8');
    const yamlData = TemplateYamlSchema.parse(yaml.load(yamlContent));

    return { name: row.name, yaml: yamlData, row };
  }

  async update(
    id: string,
    docxBuffer: Buffer | null,
    yamlContent: string | null,
    author: string,
    authorRole: string,
    ip?: string,
  ) {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Template not found');

    const now = new Date().toISOString();
    const filesToCommit: string[] = [];

    if (docxBuffer) {
      const docxPath = join(this.storePath, existing.row.template_path);
      writeFileSync(docxPath, docxBuffer);
      filesToCommit.push(existing.row.template_path);
    }

    let updatedYaml = existing.yaml;
    if (yamlContent) {
      updatedYaml = TemplateYamlSchema.parse(yaml.load(yamlContent));
      const yamlPath = join(this.storePath, existing.row.yaml_path);
      writeFileSync(yamlPath, yamlContent, 'utf-8');
      filesToCommit.push(existing.row.yaml_path);
    }

    if (filesToCommit.length > 0) {
      await this.git.exec_public('add', ...filesToCommit);
      await this.git.commit_multi(
        filesToCommit,
        `update(template): ${updatedYaml.name}\n\nTemplate-Id: ${id}\nAuthor: ${author}`,
      );
    }

    await this.db.update(templates).set({
      name: updatedYaml.name,
      description: updatedYaml.description ?? null,
      version: updatedYaml.version,
      updated_at: now,
    }).where(eq(templates.id, id));

    await this.audit.log({
      user_id: author, role: authorRole, action: 'update_template',
      fragment_id: id, ip_source: ip,
    });

    return { id };
  }

  async delete(id: string, author: string, authorRole: string, ip?: string) {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Template not found');

    // Remove files
    const docxPath = join(this.storePath, existing.row.template_path);
    const yamlPath = join(this.storePath, existing.row.yaml_path);
    if (existsSync(docxPath)) unlinkSync(docxPath);
    if (existsSync(yamlPath)) unlinkSync(yamlPath);

    // Git commit deletion
    await this.git.exec_public('add', existing.row.template_path, existing.row.yaml_path);
    await this.git.commit_multi(
      [existing.row.template_path, existing.row.yaml_path],
      `delete(template): ${existing.name}\n\nTemplate-Id: ${id}\nAuthor: ${author}`,
    );

    // Remove from SQLite
    await this.db.delete(templates).where(eq(templates.id, id));

    await this.audit.log({
      user_id: author, role: authorRole, action: 'delete_template',
      fragment_id: id, ip_source: ip,
    });
  }
}
```

Note: The `GitRepository` class may need `exec_public` and `commit_multi` methods added. Check the existing implementation. If `commit` only accepts a single file, add a `commitMulti` method that stages multiple files then commits. Adapt the method names to match the actual API.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run src/services/template-service.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/template-service.ts packages/server/src/services/template-service.test.ts
git commit -m "feat(service): add TemplateService with CRUD, Git, and SQLite"
```

---

## Chunk 3: ComposerService

### Task 5: Implement ComposerService

**Files:**
- Create: `packages/server/src/services/composer-service.ts`
- Create: `packages/server/src/services/composer-service.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { ComposerService } from './composer-service.js';

describe('ComposerService', () => {
  describe('resolveContextVariables', () => {
    it('replaces {{context.lang}} with context value', () => {
      const result = ComposerService.resolveContextVars('{{context.lang}}', { lang: 'fr' });
      expect(result).toBe('fr');
    });

    it('leaves literal strings unchanged', () => {
      const result = ComposerService.resolveContextVars('souveraineté', { lang: 'fr' });
      expect(result).toBe('souveraineté');
    });
  });

  describe('buildCarboneJson', () => {
    it('builds JSON with single-count fragments', () => {
      const resolved = new Map([
        ['introduction', [{ id: 'frag-1', body: '# Intro\n\nContent', quality: 'approved', score: 0.9 }]],
      ]);
      const context = { lang: 'fr', client: 'Test' };
      const json = ComposerService.buildCarboneJson(resolved, context, {});

      expect(json.fragments.introduction).toEqual({
        body: '# Intro\n\nContent',
        id: 'frag-1',
        quality: 'approved',
      });
      expect(json.metadata.lang).toBe('fr');
      expect(json.metadata.generated_at).toBeDefined();
    });

    it('builds JSON with multi-count fragments as arrays', () => {
      const resolved = new Map([
        ['argument', [
          { id: 'frag-1', body: 'Arg 1', quality: 'approved', score: 0.9 },
          { id: 'frag-2', body: 'Arg 2', quality: 'reviewed', score: 0.8 },
        ]],
      ]);
      const json = ComposerService.buildCarboneJson(resolved, {}, {});

      expect(Array.isArray(json.fragments.argument)).toBe(true);
      expect(json.fragments.argument).toHaveLength(2);
    });

    it('injects structured_data at top level', () => {
      const resolved = new Map();
      const structuredData = { lignes: [{ label: 'Item', total: 100 }] };
      const json = ComposerService.buildCarboneJson(resolved, {}, structuredData);

      expect(json.lignes).toEqual([{ label: 'Item', total: 100 }]);
    });
  });

  describe('validateContext', () => {
    it('passes with valid required fields', () => {
      const schema = {
        lang: { type: 'string' as const, required: true },
        product: { type: 'string' as const, required: true },
      };
      expect(() => ComposerService.validateContext({ lang: 'fr', product: 'twake' }, schema)).not.toThrow();
    });

    it('throws on missing required field', () => {
      const schema = {
        lang: { type: 'string' as const, required: true },
      };
      expect(() => ComposerService.validateContext({}, schema)).toThrow(/lang/);
    });

    it('applies default values', () => {
      const schema = {
        date: { type: 'date' as const, required: false, default: 'today' },
      };
      const ctx = {};
      ComposerService.validateContext(ctx, schema);
      expect(ctx).toHaveProperty('date');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/server && npx vitest run src/services/composer-service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ComposerService**

Create `packages/server/src/services/composer-service.ts`:

```typescript
import { join } from 'node:path';
import { mkdirSync, writeFileSync, existsSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { FragmentService } from './fragment-service.js';
import type { TemplateService } from './template-service.js';
import type { TemplateYaml, FragmentSlot, ComposeRequest, ComposeResponse } from '../schema/template.js';

let carbone: any;

async function loadCarbone() {
  if (!carbone) {
    carbone = await import('carbone');
    if (carbone.default) carbone = carbone.default;
  }
  return carbone;
}

const OUTPUT_TTL_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export class ComposerService {
  private outputDir: string;

  constructor(
    private storePath: string,
    private templateService: TemplateService,
    private fragmentService: FragmentService,
  ) {
    this.outputDir = join(storePath, 'outputs');
    mkdirSync(this.outputDir, { recursive: true });
  }

  static resolveContextVars(value: string, context: Record<string, any>): string {
    return value.replace(/\{\{context\.(\w+)\}\}/g, (_match, key) => {
      return context[key]?.toString() ?? '';
    });
  }

  static validateContext(
    context: Record<string, any>,
    schema: Record<string, { type: string; required?: boolean; default?: any; enum?: string[] }>,
  ): void {
    for (const [key, def] of Object.entries(schema)) {
      if (def.required && !(key in context)) {
        throw new Error(`Missing required context field: ${key}`);
      }
      if (!(key in context) && def.default !== undefined) {
        context[key] = def.default === 'today' ? new Date().toISOString().slice(0, 10) : def.default;
      }
      if (def.enum && key in context && !def.enum.includes(context[key])) {
        throw new Error(`Invalid value for ${key}: ${context[key]}. Allowed: ${def.enum.join(', ')}`);
      }
    }
  }

  static buildCarboneJson(
    resolved: Map<string, Array<{ id: string; body: string; quality: string; score: number }>>,
    context: Record<string, any>,
    structuredData: Record<string, any>,
  ) {
    const fragments: Record<string, any> = {};

    for (const [key, frags] of resolved) {
      if (frags.length === 1) {
        fragments[key] = { body: frags[0].body, id: frags[0].id, quality: frags[0].quality };
      } else {
        fragments[key] = frags.map(f => ({ body: f.body, id: f.id, quality: f.quality }));
      }
    }

    return {
      fragments,
      metadata: { ...context, generated_at: new Date().toISOString() },
      ...structuredData,
    };
  }

  async compose(
    templateId: string,
    request: ComposeRequest,
    callerRole: string,
  ): Promise<ComposeResponse> {
    const startTime = Date.now();

    // 1. Load template
    const tpl = await this.templateService.getById(templateId);
    if (!tpl) throw new Error('Template not found');

    const yamlData = tpl.yaml;

    // Validate output format
    if (request.output?.format && request.output.format !== yamlData.output_format) {
      throw new Error(`Output format mismatch: requested ${request.output.format}, template is ${yamlData.output_format}`);
    }

    // 2. Validate context
    const context = { ...request.context };
    if (yamlData.context_schema) {
      ComposerService.validateContext(context, yamlData.context_schema as any);
    }

    // 3. Resolve fragments
    const resolved = new Map<string, Array<{ id: string; body: string; quality: string; score: number }>>();
    const resolvedReport: Array<{ key: string; fragment_id: string; score: number; quality: string }> = [];
    const skipped: string[] = [];
    const warnings: string[] = [];

    for (const slot of yamlData.fragments) {
      const resolvedLang = ComposerService.resolveContextVars(slot.lang, context);
      const resolvedDomain = ComposerService.resolveContextVars(slot.domain, context);

      // Check override
      if (request.overrides?.[slot.key]) {
        const frag = await this.fragmentService.getById(request.overrides[slot.key]);
        if (frag) {
          resolved.set(slot.key, [{ id: frag.id, body: frag.body, quality: frag.frontmatter.quality, score: 1 }]);
          resolvedReport.push({ key: slot.key, fragment_id: frag.id, score: 1, quality: frag.frontmatter.quality });
          continue;
        }
        warnings.push(`Override fragment ${request.overrides[slot.key]} not found for key "${slot.key}", falling back to search`);
      }

      // Search
      const searchResults = await this.fragmentService.search({
        query: slot.key,
        type: slot.type,
        domain: resolvedDomain,
        lang: resolvedLang,
        quality_min: slot.quality_min,
        limit: slot.count,
      });

      if (searchResults.length === 0) {
        if (slot.fallback === 'skip') {
          skipped.push(slot.key);
          resolved.set(slot.key, [{ id: '', body: '', quality: '', score: 0 }]);
        } else if (slot.fallback === 'generate') {
          throw new Error(`Generate fallback not yet supported (slot: ${slot.key})`);
        } else {
          throw new Error(`No fragment found for required slot "${slot.key}" (type: ${slot.type}, domain: ${resolvedDomain}, lang: ${resolvedLang})`);
        }
      } else {
        const fragments = [];
        for (const sr of searchResults) {
          const frag = await this.fragmentService.getById(sr.id);
          if (frag) {
            fragments.push({ id: frag.id, body: frag.body, quality: frag.frontmatter.quality, score: sr.score ?? 0 });
            resolvedReport.push({ key: slot.key, fragment_id: frag.id, score: sr.score ?? 0, quality: frag.frontmatter.quality });
          }
        }
        resolved.set(slot.key, fragments);
      }
    }

    // 4. Build JSON
    const carboneJson = ComposerService.buildCarboneJson(
      resolved,
      context,
      request.structured_data ?? {},
    );

    // 5. Render with Carbone
    const cb = await loadCarbone();
    const templatePath = join(this.storePath, tpl.row.template_path);
    const renderAsync = promisify(cb.render);
    const resultBuffer = await renderAsync(templatePath, carboneJson) as Buffer;

    // 6. Save output
    const outputFilename = request.output?.filename ?? `${templateId}-${randomUUID().slice(0, 8)}.docx`;
    const outputPath = join(this.outputDir, outputFilename);
    writeFileSync(outputPath, resultBuffer);

    const renderMs = Date.now() - startTime;
    const expiresAt = new Date(Date.now() + OUTPUT_TTL_MS).toISOString();

    return {
      document_url: `/v1/outputs/${outputFilename}`,
      expires_at: expiresAt,
      template: { id: yamlData.id, name: yamlData.name, version: yamlData.version },
      context,
      resolved: resolvedReport,
      skipped,
      generated: [],
      warnings,
      render_ms: renderMs,
    };
  }

  /** Purge expired output files. Called by setInterval in Fastify onReady hook. */
  cleanupOutputs(): number {
    if (!existsSync(this.outputDir)) return 0;
    const now = Date.now();
    let removed = 0;
    for (const file of readdirSync(this.outputDir)) {
      const filePath = join(this.outputDir, file);
      const stat = statSync(filePath);
      if (now - stat.mtimeMs > OUTPUT_TTL_MS) {
        unlinkSync(filePath);
        removed++;
      }
    }
    return removed;
  }

  getOutputPath(filename: string): string | null {
    const filePath = join(this.outputDir, filename);
    if (!existsSync(filePath)) return null;
    return filePath;
  }

  startCleanupTimer(): NodeJS.Timeout {
    return setInterval(() => this.cleanupOutputs(), CLEANUP_INTERVAL_MS);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run src/services/composer-service.test.ts`
Expected: All 7 tests PASS (static methods only, no Carbone needed)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/composer-service.ts packages/server/src/services/composer-service.test.ts
git commit -m "feat(service): add ComposerService with resolution engine and Carbone rendering"
```

---

## Chunk 4: API Routes

### Task 6: Implement template routes

**Files:**
- Create: `packages/server/src/routes/template-routes.ts`

- [ ] **Step 1: Implement all 7 endpoints**

```typescript
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { join } from 'node:path';
import { createReadStream } from 'node:fs';
import { requireRole } from '../auth/middleware.js';
import type { TemplateService } from '../services/template-service.js';
import type { ComposerService } from '../services/composer-service.js';
import { ComposeRequestSchema } from '../schema/template.js';

export function templateRoutes(
  app: FastifyInstance,
  templateService: TemplateService,
  composerService: ComposerService,
  authenticate: any,
) {
  // GET /v1/templates
  app.get('/v1/templates', {
    preHandler: [authenticate, requireRole('reader')],
  }, async (request) => {
    const query = request.query as Record<string, string>;
    const rows = await templateService.list({
      output_format: query.output_format,
    });
    return { data: rows, meta: { count: rows.length }, error: null };
  });

  // GET /v1/templates/:id
  app.get('/v1/templates/:id', {
    preHandler: [authenticate, requireRole('reader')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const tpl = await templateService.getById(id);
    if (!tpl) return reply.status(404).send({ data: null, meta: null, error: 'Template not found' });
    return { data: { ...tpl.row, fragments: tpl.yaml.fragments, context_schema: tpl.yaml.context_schema }, meta: null, error: null };
  });

  // POST /v1/templates (multipart)
  app.post('/v1/templates', {
    preHandler: [authenticate, requireRole('expert')],
  }, async (request, reply) => {
    const parts = request.parts();
    let docxBuffer: Buffer | null = null;
    let yamlContent: string | null = null;
    let docxFilename = 'template.docx';

    for await (const part of parts) {
      if (part.type === 'file') {
        const bufs: Buffer[] = [];
        for await (const chunk of part.file) bufs.push(chunk);
        const buf = Buffer.concat(bufs);

        if (part.filename?.endsWith('.docx')) {
          docxBuffer = buf;
          docxFilename = part.filename;
        } else if (part.filename?.endsWith('.yaml') || part.filename?.endsWith('.yml')) {
          yamlContent = buf.toString('utf-8');
        }
      }
    }

    if (!docxBuffer || !yamlContent) {
      return reply.status(400).send({ data: null, meta: null, error: 'Both .docx and .yaml files are required' });
    }

    const result = await templateService.create(docxBuffer, yamlContent, docxFilename, request.user.login, request.user.role, request.ip);
    return reply.status(201).send({ data: result, meta: null, error: null });
  });

  // PUT /v1/templates/:id (multipart)
  app.put('/v1/templates/:id', {
    preHandler: [authenticate, requireRole('expert')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parts = request.parts();
    let docxBuffer: Buffer | null = null;
    let yamlContent: string | null = null;

    for await (const part of parts) {
      if (part.type === 'file') {
        const bufs: Buffer[] = [];
        for await (const chunk of part.file) bufs.push(chunk);
        const buf = Buffer.concat(bufs);

        if (part.filename?.endsWith('.docx')) docxBuffer = buf;
        else if (part.filename?.endsWith('.yaml') || part.filename?.endsWith('.yml')) yamlContent = buf.toString('utf-8');
      }
    }

    const result = await templateService.update(id, docxBuffer, yamlContent, request.user.login, request.user.role, request.ip);
    return { data: result, meta: null, error: null };
  });

  // DELETE /v1/templates/:id
  app.delete('/v1/templates/:id', {
    preHandler: [authenticate, requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await templateService.delete(id, request.user.login, request.user.role, request.ip);
    return { data: { deleted: true }, meta: null, error: null };
  });

  // POST /v1/templates/:id/compose
  app.post('/v1/templates/:id/compose', {
    preHandler: [authenticate, requireRole('reader')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ComposeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    }

    try {
      const result = await composerService.compose(id, parsed.data, request.user.role);
      return { data: result, meta: null, error: null };
    } catch (err: any) {
      const status = err.message.includes('not found') ? 404 : 400;
      return reply.status(status).send({ data: null, meta: null, error: err.message });
    }
  });

  // GET /v1/outputs/:filename
  app.get('/v1/outputs/:filename', {
    preHandler: [authenticate, requireRole('reader')],
  }, async (request, reply) => {
    const { filename } = request.params as { filename: string };

    // Prevent path traversal
    if (filename.includes('..') || filename.includes('/')) {
      return reply.status(400).send({ data: null, meta: null, error: 'Invalid filename' });
    }

    const filePath = composerService.getOutputPath(filename);
    if (!filePath) {
      return reply.status(404).send({ data: null, meta: null, error: 'Output file not found or expired' });
    }

    return reply
      .type('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(createReadStream(filePath));
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/routes/template-routes.ts
git commit -m "feat(routes): add 7 template and output API endpoints"
```

### Task 7: Wire TemplateService and routes into server

**Files:**
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Add imports, service creation, route registration, multipart plugin, and cleanup timer**

Add to imports:
```typescript
import multipart from '@fastify/multipart';
import { TemplateService } from './services/template-service.js';
import { ComposerService } from './services/composer-service.js';
import { templateRoutes } from './routes/template-routes.js';
```

After `await app.register(fastifyCors);` add:
```typescript
await app.register(multipart);
```

After fragmentService creation add:
```typescript
const templateService = new TemplateService(db, storePath, auditService);
const composerService = new ComposerService(storePath, templateService, fragmentService);
```

After route registrations add:
```typescript
templateRoutes(app, templateService, composerService, authenticate);
```

After error handler or in onReady hook:
```typescript
app.addHook('onReady', async () => {
  composerService.startCleanupTimer();
});
```

- [ ] **Step 2: Verify the server starts**

Run: `cd packages/server && npx tsx src/index.ts &` then `curl http://localhost:3210/v1/templates -H "Authorization: Bearer $TOKEN"` then kill.
Expected: `{ "data": [], "meta": { "count": 0 }, "error": null }`

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat(server): wire TemplateService, ComposerService, and template routes"
```

---

## Chunk 5: Integration Tests

### Task 8: Write integration tests for template routes

**Files:**
- Create: `packages/server/src/routes/templates.integration.test.ts`

- [ ] **Step 1: Write integration tests**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestServer, getAuthToken } from '../test-helpers.js';

describe('Template routes', () => {
  let server: any;
  let token: string;

  beforeAll(async () => {
    server = await createTestServer();
    token = await getAuthToken(server.app);
  });

  afterAll(async () => {
    await server.app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('GET /v1/templates returns empty list initially', async () => {
    const res = await server.app.inject({
      method: 'GET', url: '/v1/templates', headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toEqual([]);
  });

  it('POST /v1/templates creates a template via multipart', async () => {
    const boundary = '----TestBoundary';
    const yamlContent = `
id: tpl-integ-test-001
name: Integration test template
output_format: docx
carbone_template: test-template.docx
version: "1.0"
fragments:
  - key: introduction
    type: introduction
    domain: test
    lang: fr
`;
    const docxContent = Buffer.from('PK mock docx content');

    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="docx"; filename="test-template.docx"',
      'Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '',
      docxContent.toString('binary'),
      `--${boundary}`,
      'Content-Disposition: form-data; name="yaml"; filename="test-template.fragmint.yaml"',
      'Content-Type: text/yaml',
      '',
      yamlContent,
      `--${boundary}--`,
    ].join('\r\n');

    const res = await server.app.inject({
      method: 'POST',
      url: '/v1/templates',
      headers: {
        ...auth(),
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.id).toBe('tpl-integ-test-001');
  });

  it('GET /v1/templates lists created template', async () => {
    const res = await server.app.inject({
      method: 'GET', url: '/v1/templates', headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe('Integration test template');
  });

  it('GET /v1/templates/:id returns template detail with slots', async () => {
    const res = await server.app.inject({
      method: 'GET', url: '/v1/templates/tpl-integ-test-001', headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.fragments).toHaveLength(1);
    expect(body.data.fragments[0].key).toBe('introduction');
  });

  it('GET /v1/templates/:id returns 404 for unknown id', async () => {
    const res = await server.app.inject({
      method: 'GET', url: '/v1/templates/tpl-unknown', headers: auth(),
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /v1/templates/:id removes the template', async () => {
    const res = await server.app.inject({
      method: 'DELETE', url: '/v1/templates/tpl-integ-test-001', headers: auth(),
    });
    expect(res.statusCode).toBe(200);

    const check = await server.app.inject({
      method: 'GET', url: '/v1/templates/tpl-integ-test-001', headers: auth(),
    });
    expect(check.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `cd packages/server && npx vitest run src/routes/templates.integration.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/routes/templates.integration.test.ts
git commit -m "test(integration): add template routes integration tests"
```

---

## Chunk 6: CLI Commands

### Task 9: Add CLI template and compose commands

**Files:**
- Create: `packages/cli/src/commands/templates.ts`
- Create: `packages/cli/src/commands/compose.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Implement templates CLI commands**

Create `packages/cli/src/commands/templates.ts`:

```typescript
import type { Command } from 'commander';
import { readFileSync } from 'node:fs';
import type { FragmintClient } from '../client.js';

export function registerTemplateCommands(program: Command, getClient: () => FragmintClient) {
  const tpl = program.command('templates').description('Template operations');

  tpl
    .command('list')
    .description('List all templates')
    .option('--format <format>', 'Filter by output format')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const client = getClient();
      const params = new URLSearchParams();
      if (opts.format) params.set('output_format', opts.format);
      const results = await client.request<any[]>('GET', `/v1/templates?${params}`);
      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        if (results.length === 0) { console.log('No templates found.'); return; }
        for (const t of results) {
          console.log(`[${t.id}] ${t.name} (${t.output_format} v${t.version})`);
        }
      }
    });

  tpl
    .command('get <id>')
    .description('Get template detail')
    .action(async (id) => {
      const client = getClient();
      const result = await client.request<any>('GET', `/v1/templates/${id}`);
      console.log(JSON.stringify(result, null, 2));
    });

  tpl
    .command('add <docx> <yaml>')
    .description('Create a template from .docx and .yaml files')
    .action(async (docxPath, yamlPath) => {
      const client = getClient();
      const result = await client.uploadTemplate(docxPath, yamlPath);
      console.log(`Template created: ${result.id}`);
    });
}
```

Note: `FragmintClient` needs an `uploadTemplate` method for multipart upload. Add it:

```typescript
async uploadTemplate(docxPath: string, yamlPath: string): Promise<{ id: string }> {
  const FormData = (await import('undici')).FormData;
  const { Blob } = await import('node:buffer');
  const { readFileSync } = await import('node:fs');
  const { basename } = await import('node:path');

  const form = new FormData();
  const docxBuf = readFileSync(docxPath);
  const yamlBuf = readFileSync(yamlPath);

  form.append('docx', new Blob([docxBuf]), basename(docxPath));
  form.append('yaml', new Blob([yamlBuf]), basename(yamlPath));

  const headers: Record<string, string> = {};
  if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

  const res = await fetch(`${this.baseUrl}/v1/templates`, {
    method: 'POST',
    headers,
    body: form as any,
  });

  const json = await res.json() as { data: { id: string }; error: string | null };
  if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.data;
}
```

- [ ] **Step 2: Implement compose CLI command**

Create `packages/cli/src/commands/compose.ts`:

```typescript
import type { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import type { FragmintClient } from '../client.js';

export function registerComposeCommand(program: Command, getClient: () => FragmintClient) {
  program
    .command('compose <template-id>')
    .description('Compose a document from a template')
    .requiredOption('--context <json>', 'Context as JSON string')
    .option('--overrides <json>', 'Fragment overrides as JSON')
    .option('--structured-data <json>', 'Structured data as JSON')
    .option('--output <path>', 'Output file path')
    .action(async (templateId, opts) => {
      const client = getClient();
      const body: Record<string, any> = {
        context: JSON.parse(opts.context),
      };
      if (opts.overrides) body.overrides = JSON.parse(opts.overrides);
      if (opts.structuredData) body.structured_data = JSON.parse(opts.structuredData);

      const result = await client.request<any>('POST', `/v1/templates/${templateId}/compose`, body);

      console.log(`Document generated: ${result.document_url}`);
      console.log(`Resolved: ${result.resolved.length} fragments`);
      if (result.skipped.length) console.log(`Skipped: ${result.skipped.join(', ')}`);
      if (result.warnings.length) console.log(`Warnings: ${result.warnings.join(', ')}`);
      console.log(`Render time: ${result.render_ms}ms`);

      if (opts.output) {
        // Download the file
        const buffer = await client.download(result.document_url);
        writeFileSync(opts.output, buffer);
        console.log(`Saved to: ${opts.output}`);
      }
    });
}
```

Add download method to `FragmintClient`:

```typescript
async download(path: string): Promise<Buffer> {
  const headers: Record<string, string> = {};
  if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

  const res = await fetch(`${this.baseUrl}${path}`, { headers });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
```

- [ ] **Step 3: Register commands in CLI index**

Add to `packages/cli/src/index.ts`:
```typescript
import { registerTemplateCommands } from './commands/templates.js';
import { registerComposeCommand } from './commands/compose.js';

// After existing command registrations:
registerTemplateCommands(program, getClient);
registerComposeCommand(program, getClient);
```

- [ ] **Step 4: Verify CLI commands show up**

Run: `cd packages/cli && npx tsx src/index.ts templates --help`
Expected: Shows `list`, `get`, `add` subcommands

Run: `cd packages/cli && npx tsx src/index.ts compose --help`
Expected: Shows `--context`, `--output` options

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/templates.ts packages/cli/src/commands/compose.ts packages/cli/src/index.ts packages/cli/src/client.ts
git commit -m "feat(cli): add templates and compose CLI commands"
```

---

## Chunk 7: Example Template & Final Verification

### Task 10: Create example template fixture

**Files:**
- Create: `example-vault/templates/proposition-commerciale.fragmint.yaml`

Note: The .docx file needs to be created manually with Carbone tags (e.g., in LibreOffice). For now, create a minimal YAML and document this requirement.

- [ ] **Step 1: Create the YAML definition**

```yaml
id: tpl-proposition-commerciale-001
name: Proposition commerciale souveraineté
description: "Template standard pour propositions commerciales axées souveraineté numérique"
output_format: docx
carbone_template: proposition-commerciale.docx
version: "1.0"

fragments:
  - key: introduction
    type: introduction
    domain: souveraineté
    lang: "{{context.lang}}"
    quality_min: approved
    required: true
    fallback: error
    count: 1

  - key: arguments
    type: argument
    domain: "{{context.product}}"
    lang: "{{context.lang}}"
    quality_min: reviewed
    required: false
    fallback: skip
    count: 3

  - key: conclusion
    type: conclusion
    domain: souveraineté
    lang: "{{context.lang}}"
    quality_min: reviewed
    required: false
    fallback: skip
    count: 1

context_schema:
  lang:
    type: string
    enum: [fr, en]
    required: true
  product:
    type: string
    required: true
  client:
    type: string
    required: false
  date:
    type: date
    default: today
```

- [ ] **Step 2: Commit**

```bash
git add example-vault/templates/proposition-commerciale.fragmint.yaml
git commit -m "feat(example): add proposition commerciale template definition"
```

### Task 11: Run full test suite

- [ ] **Step 1: Run all tests**

Run: `cd packages/server && npx vitest run`
Expected: All tests pass (~75-80 total)

- [ ] **Step 2: Fix any failures and commit fixes**

---

## Task Dependencies

```
Task 1 (DB schema) → Task 2 (Zod schemas)
Task 3 (dependencies) → Task 4 (TemplateService) → Task 5 (ComposerService)
Task 4 + Task 5 → Task 6 (routes) → Task 7 (wiring)
Task 7 → Task 8 (integration tests)
Task 7 → Task 9 (CLI)
Task 7 → Task 10 (example)
All → Task 11 (final verification)
```
