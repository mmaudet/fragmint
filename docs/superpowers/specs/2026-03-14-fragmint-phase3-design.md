# Fragmint Phase 3 — Templates & Composition (Carbone)

**Date:** 2026-03-14
**Phase:** 3 of 9
**Duration:** 2 weeks
**Status:** Design approved

## Scope

Integrate Carbone v4 into the Core API to generate DOCX documents from templates populated with resolved fragments. XLSX and PPTX are out of scope for this phase but the architecture supports them without refactoring.

### In scope

- Template data model (Git + SQLite index)
- `.fragmint.yaml` schema (Zod-validated)
- TemplateService (CRUD, Git commit, SQLite sync)
- ComposerService (fragment resolution, JSON build, Carbone render)
- 7 API endpoints (6 templates + 1 outputs)
- CLI commands (`templates list/get/add`, `compose`)
- Temporary output storage with TTL
- Composition report with fragment traceability

### Out of scope

- Fallback `generate` (LLM-based fragment generation) — deferred
- Automatic Carbone tag detection from .docx XML — deferred
- XLSX / PPTX support — deferred
- PDF conversion (requires LibreOffice) — deferred

## Architecture

```
POST /templates/{id}/compose
         │
         ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│ Template Service │────▶│ Composer Service │────▶│   Carbone   │
│  (CRUD + YAML)  │     │  (resolution +   │     │  (render    │
│                 │     │   build JSON)    │     │   .docx)    │
└────────┬────────┘     └────────┬─────────┘     └─────────────┘
         │                       │
         ▼                       ▼
    Git + SQLite          Fragment Service
    (templates/)          (search fragments)
```

**Separation of concerns:**

- **TemplateService** — CRUD for templates (.docx + .fragmint.yaml files), Git storage + SQLite index
- **ComposerService** — resolves fragments per YAML slots, builds Carbone JSON, calls Carbone, produces composition report
- **Carbone** — pure rendering engine, receives a .docx template + JSON data, outputs the final document

ComposerService is read-only on fragments (no side effects). Generated documents are stored temporarily in `outputs/` (outside Git, cleaned periodically).

## Data Model

### SQLite table `templates`

```sql
CREATE TABLE templates (
  id            TEXT PRIMARY KEY,   -- "tpl-<uuid>"
  name          TEXT NOT NULL,
  output_format TEXT NOT NULL,      -- "docx"
  version       TEXT NOT NULL,      -- "1.0"
  template_path TEXT NOT NULL,      -- relative path to .docx in vault
  yaml_path     TEXT NOT NULL,      -- relative path to .fragmint.yaml
  author        TEXT NOT NULL,
  created_at    TEXT NOT NULL,      -- ISO 8601
  updated_at    TEXT NOT NULL,
  git_hash      TEXT
);
```

### `.fragmint.yaml` schema

```yaml
id: tpl-<uuid>
name: Proposition commerciale
output_format: docx
carbone_template: proposition-commerciale.docx
version: "1.0"

fragments:
  - key: introduction
    type: introduction
    domain: souveraineté
    lang: "{{context.lang}}"
    quality_min: reviewed        # draft | reviewed | approved
    required: true
    fallback: error              # skip | error (generate deferred)
    count: 1                     # number of fragments to resolve

structured_data:
  - key: lignes
    source: context
    schema:
      label: string
      qte: number
      pu: number
      total: number

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

**Key points:**

- The `.fragmint.yaml` is the semantic source of truth; the SQLite table is an index
- `lang: "{{context.lang}}"` is resolved dynamically at composition time
- `count > 1` resolves multiple fragments for a single slot (e.g., multiple arguments in a Carbone loop)
- `fallback: generate` is accepted in the schema but returns an error at runtime ("generate fallback not yet supported")

### Zod schema (TypeScript)

```typescript
const FragmentSlotSchema = z.object({
  key: z.string(),
  type: z.string(),
  domain: z.string(),
  lang: z.string(),                    // may contain {{context.*}}
  quality_min: z.enum(['draft', 'reviewed', 'approved']).default('draft'),
  required: z.boolean().default(true),
  fallback: z.enum(['skip', 'error', 'generate']).default('error'),
  count: z.number().int().positive().default(1),
});

const StructuredDataSchema = z.object({
  key: z.string(),
  source: z.enum(['context']),
  schema: z.record(z.string()),
});

const ContextFieldSchema = z.object({
  type: z.enum(['string', 'number', 'date']),
  required: z.boolean().default(false),
  default: z.any().optional(),
  enum: z.array(z.string()).optional(),
});

const TemplateYamlSchema = z.object({
  id: z.string().startsWith('tpl-'),
  name: z.string(),
  output_format: z.enum(['docx']),     // extensible later
  carbone_template: z.string(),
  version: z.string(),
  fragments: z.array(FragmentSlotSchema),
  structured_data: z.array(StructuredDataSchema).optional(),
  context_schema: z.record(ContextFieldSchema).optional(),
});
```

## Composition Engine

### Flow for `POST /templates/{id}/compose`

```
1. Validate context against template's context_schema
2. For each slot in fragments[]:
   a. Resolve {{context.*}} in filters (lang, domain...)
   b. If override provided for this key → use directly (FragmentService.getById)
   c. Else → FragmentService.search(type, domain, lang, quality >= quality_min)
   d. Select top N results (N = count) by score
   e. If no results:
      - fallback: skip → empty string
      - fallback: error → 400 with slot detail
      - fallback: generate → 400 "generate fallback not yet supported"
   f. Record in report: key → fragment_id, score, quality
3. Build Carbone JSON:
   {
     fragments: {
       [key]: { body, id, quality }           // if count == 1
       [key]: [{ body, id, quality }, ...]    // if count > 1
     },
     metadata: { ...context, generated_at }
   }
4. Inject structured_data from context into JSON
5. Call Carbone.render(template.docx, json) → Buffer
6. Save to outputs/ with TTL (1h default)
7. Return composition report + document_url
```

### Composition request

```json
{
  "context": {
    "lang": "fr",
    "product": "twake",
    "client": "Gendarmerie Nationale",
    "date": "2026-03-14"
  },
  "overrides": {
    "pricing": "frag-specific-id"
  },
  "output": {
    "format": "docx",
    "filename": "proposition-gendarmerie-2026-03.docx"
  }
}
```

### Composition report (response)

```json
{
  "document_url": "/v1/outputs/xxx.docx",
  "expires_at": "2026-03-14T15:00:00Z",
  "template": { "id": "tpl-...", "name": "...", "version": "1.0" },
  "context": { "lang": "fr", "product": "twake", "client": "..." },
  "resolved": [
    { "key": "introduction", "fragment_id": "frag-...", "score": 0.92, "quality": "approved" }
  ],
  "skipped": ["testimonial"],
  "warnings": [],
  "render_ms": 12
}
```

## API Endpoints

| Method | Route | Min role | Description |
|--------|-------|----------|-------------|
| GET | `/v1/templates` | reader | List templates (filter: output_format) |
| GET | `/v1/templates/{id}` | reader | Template detail + fragment slots |
| POST | `/v1/templates` | expert | Create (multipart: .docx + .yaml) |
| PUT | `/v1/templates/{id}` | expert | Update template |
| DELETE | `/v1/templates/{id}` | admin | Delete template |
| POST | `/v1/templates/{id}/compose` | reader | Compose a document |
| GET | `/v1/outputs/{filename}` | reader | Download generated document |

**Multipart upload for POST /v1/templates:**

- The .docx and .yaml are sent as `multipart/form-data`
- The server places them in `templates/` in the vault and commits to Git
- The SQLite index is updated

**Response envelope** follows existing pattern: `{ data: T, meta?: {...}, error: null | string }`

## CLI Commands

```bash
# Template management
fragmint templates list                          # list all templates
fragmint templates get <id>                      # template detail
fragmint templates add <file.docx> <file.yaml>   # create a template

# Composition
fragmint compose <template-id> \
  --lang fr --product twake \
  --client "Gendarmerie" \
  --output ./proposition.docx                    # compose and save locally
```

## File Structure

```
packages/server/src/
├── schema/
│   └── template.ts              # Zod schemas (TemplateYaml, compose request/response)
├── db/
│   └── schema.ts                # Add templates table (Drizzle)
├── services/
│   ├── template-service.ts      # CRUD, YAML parsing, Git commit, SQLite sync
│   └── composer-service.ts      # Resolution engine, JSON build, Carbone render
├── routes/
│   └── template-routes.ts       # 7 API endpoints
└── ...

packages/cli/src/
└── commands/
    ├── templates.ts             # templates list/get/add
    └── compose.ts               # compose command

example-vault/
└── templates/
    ├── proposition-commerciale.docx
    └── proposition-commerciale.fragmint.yaml
```

## Testing Strategy

| Layer | Tests | Description |
|-------|-------|-------------|
| Unit | Zod schemas | Validate `.fragmint.yaml`, context input, compose response |
| Unit | ComposerService | Slot resolution (override, search, skip, error), JSON construction |
| Unit | TemplateService | CRUD, YAML read, Git/SQLite sync |
| Integration | Template routes | POST/GET/PUT/DELETE with auth and roles |
| Integration | Composition E2E | Upload template → compose → verify .docx contains correct text |

**Test fixture:**

- A minimal .docx template with tags `{d.fragments.introduction.body}`, `{d.metadata.client}`, `{d.metadata.date}`
- A corresponding `.fragmint.yaml` with 1 slot introduction (required, fallback: error)
- Existing fragments from the example-vault for resolution

**Target:** ~20-25 new tests, bringing total to ~75-80.

## Dependencies

- `carbone` ^4 — document rendering (npm package, CCL license)
- `@fastify/multipart` — file upload handling
- Existing: `fastify`, `drizzle-orm`, `better-sqlite3`, `zod`, `gray-matter`

## Deliverables

1. Drizzle migration: `templates` table
2. Zod schema: `.fragmint.yaml` + compose request/response
3. `TemplateService` — CRUD + Git + SQLite
4. `ComposerService` — resolution + Carbone rendering
5. API routes (7 endpoints)
6. CLI commands (`templates list/get/add`, `compose`)
7. Tests (~20-25 new)
8. Example template in `example-vault/templates/`
