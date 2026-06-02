# Template Marp Upload + Template List MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre depuis OpenCode (via MCP) de lister les templates existants, uploader un template Marp (`.md`) pour générer des slides/PPTX, et retrouver ses templates d'une session à l'autre.

**Architecture:** On ajoute une méthode `createMarp()` au `TemplateService` + un endpoint `POST /v1/templates/marp`. Côté MCP, deux tools : `template_list` (appelle le `GET /v1/templates` déjà existant) et extension de `template_upload` pour accepter `kind: 'marp'` (route vers le nouvel endpoint).

**Tech Stack:** Fastify 5, Drizzle/SQLite, `@marp-team/marp-core`, Vitest, MCP SDK.

---

## Carte des fichiers

| Fichier | Changement |
|---------|-----------|
| `packages/server/src/services/template-service.ts` | Ajouter méthode `createMarp()` |
| `packages/server/src/routes/template-routes.ts` | Ajouter `POST /v1/templates/marp` |
| `packages/mcp/src/tools/template-list.ts` | Créer outil `template_list` |
| `packages/mcp/src/tools/template-upload.ts` | Ajouter paramètre `kind` + routage vers `/marp` |
| `packages/mcp/src/index.ts` | Enregistrer `template_list` |

---

## Contexte architecture

### Table `templates` (db/schema.ts:59-72)
```
id, name, description, output_format, version,
template_path, yaml_path, author, created_at, updated_at, git_hash,
kind  -- 'composer' | 'style_reference' | 'marp'
```

### Méthode existante `createStyleReference()` (template-service.ts:98-150)
C'est le pattern exact à reproduire pour `createMarp()` — même structure, `kind: 'marp'`, `output_format: 'slides'`.

### Endpoint list existant (template-routes.ts:39-52)
`GET /v1/templates?kind=marp&output_format=slides` — déjà implémenté, filtre par `kind` et `output_format`.

---

### Task 1: Méthode `TemplateService.createMarp()`

**Files:**
- Modify: `packages/server/src/services/template-service.ts` (après `createStyleReference()`, ~ligne 150)

- [ ] **Step 1: Écrire le test qui échoue**

Ouvrir `packages/server/src/services/template-service.test.ts` (créer s'il n'existe pas). Ajouter :

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { templates } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { TemplateService } from './template-service.js';
import { AuditService } from './audit-service.js';

// Mock GitRepository pour éviter les appels git en tests unitaires
vi.mock('../git/git-repository.js', () => ({
  GitRepository: class {
    async commitFiles(_files: string[], _msg: string) { return 'mock-hash'; }
    async rmFiles(_files: string[], _msg: string) { return 'mock-hash'; }
  },
}));

describe('TemplateService.createMarp', () => {
  let storePath: string;
  let service: TemplateService;
  let db: ReturnType<typeof drizzle>;

  beforeAll(() => {
    storePath = mkdtempSync(join(tmpdir(), 'fragmint-tpl-test-'));
    const sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        output_format TEXT NOT NULL,
        version TEXT NOT NULL,
        template_path TEXT NOT NULL,
        yaml_path TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        git_hash TEXT,
        kind TEXT NOT NULL DEFAULT 'composer'
      )
    `);
    sqlite.exec(`
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        action TEXT NOT NULL,
        fragment_id TEXT,
        diff_summary TEXT,
        ip_source TEXT,
        entity_type TEXT,
        entity_id TEXT
      )
    `);
    db = drizzle(sqlite);
    const audit = new AuditService(db);
    service = new TemplateService(db as any, storePath, audit);
  });

  afterAll(() => {
    rmSync(storePath, { recursive: true, force: true });
  });

  it('insère un template marp avec kind=marp et output_format=slides', async () => {
    const mdBuffer = Buffer.from('---\nmarp: true\n---\n# Slide 1\n');
    const result = await service.createMarp(
      mdBuffer,
      'deck.md',
      'Test Deck',
      'Un deck de test',
      'alice',
      'expert',
    );

    expect(result.id).toMatch(/^tpl_marp_/);
    expect(result.template_path).toMatch(/templates\//);

    const rows = await db.select().from(templates).where(eq(templates.id, result.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('marp');
    expect(rows[0].output_format).toBe('slides');
    expect(rows[0].name).toBe('Test Deck');
    expect(rows[0].description).toBe('Un deck de test');
    expect(rows[0].version).toBe('1.0.0');
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
pnpm --filter @fragmint/server test packages/server/src/services/template-service.test.ts
```

Expected: FAIL — `service.createMarp is not a function`

- [ ] **Step 3: Implémenter `createMarp()` dans `template-service.ts`**

Ajouter après la méthode `createStyleReference()` (ligne ~150), avant `syncFromVault()` :

```typescript
async createMarp(
  mdBuffer: Buffer,
  mdFilename: string,
  name: string,
  description: string | null,
  author: string,
  authorRole: string,
  ip?: string,
) {
  if (mdFilename.includes('..') || mdFilename.includes('/')) {
    throw new Error('Invalid filename: must not contain ".." or "/"');
  }

  const id = `tpl_marp_${randomUUID()}`;
  const now = new Date().toISOString();
  const templatesDir = join(this.storePath, 'templates');
  mkdirSync(templatesDir, { recursive: true });

  const safeName = `${id}-${mdFilename}`;
  const mdPath = join(templatesDir, safeName);
  writeFileSync(mdPath, mdBuffer);
  const relMdPath = relative(this.storePath, mdPath);

  const commitHash = await this.git.commitFiles(
    [relMdPath],
    `template: create marp ${name} (${id})`,
  );

  await this.db.insert(templates).values({
    id,
    name,
    description,
    output_format: 'slides',
    version: '1.0.0',
    template_path: relMdPath,
    yaml_path: '',
    author,
    created_at: now,
    updated_at: now,
    git_hash: commitHash,
    kind: 'marp',
  });

  await this.audit.log({
    user_id: author,
    role: authorRole,
    action: 'template:create_marp',
    fragment_id: id,
    ip_source: ip,
  });

  return { id, template_path: relMdPath };
}
```

- [ ] **Step 4: Relancer le test**

```bash
pnpm --filter @fragmint/server test packages/server/src/services/template-service.test.ts
```

Expected: PASS

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors

---

### Task 2: Route `POST /v1/templates/marp`

**Files:**
- Modify: `packages/server/src/routes/template-routes.ts` (après le bloc `style-reference`, ~ligne 151)

- [ ] **Step 1: Écrire le test d'intégration**

Créer `packages/server/src/routes/template-routes.integration.test.ts` :

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { createTestServer, getAuthToken } from '../test-helpers.js';

describe('Template routes - marp upload', () => {
  let server: any;
  let token: string;

  beforeAll(async () => {
    server = await createTestServer();
    token = await getAuthToken(server.app);
  });

  it('POST /v1/templates/marp crée un template marp', async () => {
    const boundary = '----TestBoundaryMarp';
    const mdContent = '---\nmarp: true\n---\n# Slide 1\n\n---\n# Slide 2\n';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="presentation.md"',
      'Content-Type: text/markdown',
      '',
      mdContent,
      `--${boundary}`,
      'Content-Disposition: form-data; name="name"',
      '',
      'Présentation Test',
      `--${boundary}`,
      'Content-Disposition: form-data; name="description"',
      '',
      'Un deck de test',
      `--${boundary}--`,
    ].join('\r\n');

    const res = await server.app.inject({
      method: 'POST',
      url: '/v1/templates/marp',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.from(body),
    });

    expect(res.statusCode).toBe(201);
    const parsed = JSON.parse(res.body);
    expect(parsed.data.id).toMatch(/^tpl_marp_/);
    expect(parsed.data.template_path).toMatch(/\.md$/);
  });

  it('POST /v1/templates/marp rejette un fichier non-.md', async () => {
    const boundary = '----TestBoundaryMarpBad';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="presentation.docx"',
      'Content-Type: application/octet-stream',
      '',
      'fake docx content',
      `--${boundary}`,
      'Content-Disposition: form-data; name="name"',
      '',
      'Mauvais template',
      `--${boundary}--`,
    ].join('\r\n');

    const res = await server.app.inject({
      method: 'POST',
      url: '/v1/templates/marp',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.from(body),
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/\.md/);
  });

  it('GET /v1/templates?kind=marp liste les templates marp', async () => {
    // D'abord, uploader un template marp
    const boundary = '----TestBoundaryMarpList';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="list-test.md"',
      'Content-Type: text/markdown',
      '',
      '---\nmarp: true\n---\n# Test',
      `--${boundary}`,
      'Content-Disposition: form-data; name="name"',
      '',
      'List Test Deck',
      `--${boundary}--`,
    ].join('\r\n');

    await server.app.inject({
      method: 'POST',
      url: '/v1/templates/marp',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.from(body),
    });

    const res = await server.app.inject({
      method: 'GET',
      url: '/v1/templates?kind=marp',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.data.length).toBeGreaterThanOrEqual(1);
    expect(parsed.data.every((t: any) => t.kind === 'marp')).toBe(true);
  });
});
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

```bash
pnpm --filter @fragmint/server test packages/server/src/routes/template-routes.integration.test.ts
```

Expected: FAIL — `404 Not Found` (endpoint pas encore créé)

- [ ] **Step 3: Ajouter la route dans `template-routes.ts`**

Après le bloc `style-reference` (~ligne 151), ajouter :

```typescript
// Upload Marp template (.md file + name + optional description)
app.post(
  `${prefix}/templates/marp`,
  { preHandler: expertHandlers },
  async (request, reply) => {
    let fileBuf: Buffer | null = null;
    let filename = '';
    let name = '';
    let description: string | null = null;

    for await (const part of request.parts()) {
      if (part.type === 'file' && part.fieldname === 'file') {
        const chunks: Buffer[] = [];
        for await (const c of part.file) chunks.push(c);
        fileBuf = Buffer.concat(chunks);
        filename = part.filename;
      } else if (part.type === 'field') {
        const val = part.value as string;
        if (part.fieldname === 'name') name = val;
        if (part.fieldname === 'description') description = val;
      }
    }

    if (!fileBuf || !filename) {
      return reply.status(400).send({ data: null, meta: null, error: 'Missing file part' });
    }
    if (!name) {
      return reply.status(400).send({ data: null, meta: null, error: 'Missing name field' });
    }
    if (!filename.endsWith('.md')) {
      return reply
        .status(400)
        .send({ data: null, meta: null, error: 'File must be a .md Marp template' });
    }

    const result = await templateService.createMarp(
      fileBuf,
      filename,
      name,
      description,
      request.user.login,
      request.user.role,
      request.ip,
    );

    return reply.status(201).send({ data: result, meta: null, error: null });
  },
);
```

- [ ] **Step 4: Relancer les tests**

```bash
pnpm --filter @fragmint/server test packages/server/src/routes/template-routes.integration.test.ts
```

Expected: 3/3 PASS

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors

---

### Task 3: Outil MCP `template_list`

**Files:**
- Create: `packages/mcp/src/tools/template-list.ts`
- Modify: `packages/mcp/src/index.ts`

- [ ] **Step 1: Créer `packages/mcp/src/tools/template-list.ts`**

```typescript
// packages/mcp/src/tools/template-list.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';

export const templateListDefinition: ToolDefinition = {
  name: 'template_list',
  description:
    'List available templates in Fragmint. Use before document_compose or plan_export to discover template IDs. ' +
    'Kinds: "composer" (DOCX/XLSX with slot definitions), "marp" (Marp slide decks → slides/PPTX), ' +
    '"style_reference" (DOCX style guides for Word output).',
  inputSchema: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        description:
          'Filter by template kind: "composer", "marp", or "style_reference". Omit for all.',
      },
      output_format: {
        type: 'string',
        description: 'Filter by output format: "docx", "xlsx", "slides", "pptx". Omit for all.',
      },
    },
    required: [],
  },
};

export function templateListHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const { kind, output_format } = args as {
        kind?: string;
        output_format?: string;
      };

      const params = new URLSearchParams();
      if (kind) params.set('kind', kind);
      if (output_format) params.set('output_format', output_format);
      const qs = params.toString();

      const result = await client.get<
        Array<{
          id: string;
          name: string;
          description: string | null;
          output_format: string;
          kind: string;
          version: string;
          author: string;
          created_at: string;
          updated_at: string;
        }>
      >(`/v1/templates${qs ? `?${qs}` : ''}`);

      return toolSuccess({
        count: result.length,
        templates: result.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          output_format: t.output_format,
          kind: t.kind,
          version: t.version,
          author: t.author,
          updated_at: t.updated_at,
        })),
      });
    } catch (err) {
      return toolError(
        `Template list failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
}
```

- [ ] **Step 2: Enregistrer dans `packages/mcp/src/index.ts`**

Ajouter l'import avec les autres imports :
```typescript
import { templateListDefinition, templateListHandler } from './tools/template-list.js';
```

Ajouter dans le tableau `tools` (après `templateUploadHandler`) :
```typescript
{ definition: templateListDefinition, handler: templateListHandler(client) },
```

- [ ] **Step 3: Build et vérifier**

```bash
pnpm --filter @fragmint/mcp build
```

Expected: sortie `tsc` sans erreurs

---

### Task 4: Étendre `template_upload` pour Marp

**Files:**
- Modify: `packages/mcp/src/tools/template-upload.ts`

L'outil actuel pointe uniquement vers `/v1/templates/style-reference`. On ajoute un paramètre `kind` (default: `'style_reference'`) pour router vers `/v1/templates/marp` si besoin.

- [ ] **Step 1: Remplacer le contenu de `packages/mcp/src/tools/template-upload.ts`**

```typescript
// packages/mcp/src/tools/template-upload.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';

export const templateUploadDefinition: ToolDefinition = {
  name: 'template_upload',
  description:
    'Upload a template to the Fragmint template library. ' +
    'Use kind="style_reference" (default) for DOCX Word style references. ' +
    'Use kind="marp" for Marp slide deck templates (.md files that produce slides/PPTX). ' +
    'Returns the created template record (with id usable in document_compose).',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description:
          'Absolute path to the file to upload. .docx for style_reference, .md for marp.',
      },
      name: {
        type: 'string',
        description: 'Display name for the template (e.g. "Offre commerciale" or "Pitch deck")',
      },
      description: {
        type: 'string',
        description: 'Optional description of the template purpose or usage',
      },
      kind: {
        type: 'string',
        enum: ['style_reference', 'marp'],
        description:
          '"style_reference" (default) for DOCX style guides, "marp" for Marp .md slide decks',
      },
    },
    required: ['file_path', 'name'],
  },
};

export function templateUploadHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const { file_path, name, description, kind = 'style_reference' } = args as {
        file_path: string;
        name: string;
        description?: string;
        kind?: 'style_reference' | 'marp';
      };

      const { readFileSync } = await import('node:fs');
      const { basename } = await import('node:path');

      const form = new FormData();
      form.append('file', new Blob([readFileSync(file_path)]), basename(file_path));
      form.append('name', name);
      if (description) form.append('description', description);

      const endpoint =
        kind === 'marp' ? '/v1/templates/marp' : '/v1/templates/style-reference';

      const result = await client.postMultipart<{
        id: string;
        name?: string;
        template_path: string;
        description?: string | null;
        warnings?: string[];
      }>(endpoint, form);

      return toolSuccess({
        id: result.id,
        name: result.name ?? name,
        template_path: result.template_path,
        description: result.description ?? description ?? null,
        warnings: result.warnings ?? [],
        kind,
      });
    } catch (err) {
      return toolError(
        `Template upload failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
}
```

- [ ] **Step 2: Build**

```bash
pnpm --filter @fragmint/mcp build
```

Expected: sortie `tsc` sans erreurs

- [ ] **Step 3: Vérifier le nombre d'outils**

```bash
node -e "
const { readFileSync } = require('fs');
const src = readFileSync('packages/mcp/dist/index.js', 'utf-8');
const count = (src.match(/definition:/g) || []).length;
console.log('Tools registered:', count);
"
```

Expected: `Tools registered: 24` (23 existants + `template_list`)

---

## Tests finaux

```bash
# Server
pnpm --filter @fragmint/server test
pnpm --filter @fragmint/server typecheck

# MCP
pnpm --filter @fragmint/mcp build

# Lint global
pnpm lint
```

---

## Utilisation dans OpenCode (après redémarrage)

```
# Lister tous les templates disponibles
template_list()

# Lister seulement les templates Marp
template_list(kind: "marp")

# Uploader un template Marp
template_upload(
  file_path: "/chemin/absolu/mon-deck.md",
  name: "Pitch deck LinAgora",
  kind: "marp"
)

# Uploader un template DOCX style-reference (comportement inchangé)
template_upload(
  file_path: "/chemin/absolu/modele.docx",
  name: "Modèle offre commerciale"
)

# Composer un document avec un template listé
document_compose(template_id: "tpl_marp_xxx", context: { title: "Mon pitch" })
```
