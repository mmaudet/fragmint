# Fragmint Phase 0 — Foundations Design Spec

**Date:** 2026-03-14
**Status:** Approved
**PRD Reference:** Fragmint PRD v0.5 — Phase 0 (Fondations, ~3 semaines)

## Summary

Phase 0 initializes the Fragmint monorepo and delivers a functional content fragment store with Git-backed versioning, a Core API (Fastify), a CLI client, and SQLite-based indexing. This is the foundation on which all subsequent phases (semantic search, MCP, composition, frontend, Obsidian) build.

## Tech Stack Decisions

| Component | Choice | Rationale |
|---|---|---|
| Runtime | Node.js 24.x | Latest version, user preference (PRD says 22, overridden) |
| Monorepo | pnpm workspaces | Lightweight, no extra tooling overhead |
| Core API | Fastify 5 + TypeScript | Fast, schema-first (PRD says Fastify 4, upgraded) |
| Database | Drizzle ORM + better-sqlite3 | Type-safe, migrations, zero-dep DB |
| Password/token hashing | scrypt (node:crypto) | Zero native deps, air-gap friendly |
| Validation | Zod + JSON Schema export | Type inference + interoperability |
| Testing | Vitest | Fast, TS-native, unified across monorepo |
| CLI parser | commander | Standard, lightweight |
| Frontmatter parsing | gray-matter | Standard Markdown frontmatter parser |
| License | AGPL-3.0 | PRD requirement |

## 1. Monorepo Structure

```
fragmint/
├── packages/
│   ├── server/          # Core API Fastify — Phase 0
│   │   └── src/
│   │       ├── schema/          # Zod schemas (frontmatter, API payloads)
│   │       ├── db/              # Drizzle schema, migrations, connection
│   │       ├── git/             # Git operations (commit, log, diff)
│   │       ├── routes/          # Fastify routes (/fragments/*, /auth/*, /admin/*)
│   │       ├── auth/            # JWT, API tokens, auth middleware
│   │       ├── services/        # Business logic (fragment, user, token, audit)
│   │       └── index.ts         # Server entry point
│   ├── cli/             # CLI fragmint — Phase 0
│   │   └── src/
│   │       ├── commands/        # Commands (serve, add, get, search, token...)
│   │       └── index.ts
│   ├── mcp/             # Phase 2 — placeholder
│   └── obsidian/        # Phase 5 — placeholder
├── frontend/            # Phase 4 — placeholder
├── scripts/indexer/     # Phase 1 — placeholder
├── docker/
│   └── docker-compose.yml
├── docs/
│   └── schema/          # JSON Schema exported from Zod
├── example-vault/
│   ├── fragments/
│   │   ├── commercial/
│   │   └── juridique/
│   └── templates/
├── package.json         # Workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── vitest.workspace.ts
```

Placeholder packages (mcp, obsidian, frontend, scripts/indexer) contain a minimal `package.json` and a README reserving their place in the tree.

## 2. Data Model

### Fragment Frontmatter (Zod)

Faithful to PRD section 6. Schema defined in `packages/server/src/schema/fragment.ts`.

```typescript
const fragmentFrontmatterSchema = z.object({
  id: z.string().regex(/^frag-[a-f0-9-]+$/),
  type: z.enum(['introduction', 'argument', 'pricing', 'clause', 'faq', 'conclusion', 'bio', 'témoignage']),
  domain: z.string(),
  tags: z.array(z.string()),
  lang: z.string().regex(/^[a-z]{2}$/),
  translation_of: z.string().nullable(),
  translations: z.record(z.string(), z.string().nullable()).optional(),
  quality: z.enum(['draft', 'reviewed', 'approved', 'deprecated']),
  author: z.string(),
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
```

Types inferred via `z.infer<>`, no duplication.

### Quality Transition State Machine

Enforced in the service layer, not the schema:

```
draft → reviewed → approved → deprecated
                        ↓
                   deprecated
```

- `draft → reviewed` — any contributor+ can trigger (via `PUT /v1/fragments/:id` setting quality to `reviewed`, or via `POST /v1/fragments/:id/review`)
- `reviewed → approved` — expert+ only (via `POST /v1/fragments/:id/approve`)
- `approved → deprecated` — admin only (via `POST /v1/fragments/:id/deprecate`)
- `approved → reviewed` — automatic when a source fragment is modified and this is a translation (PRD section 9, desynchronization). Not a user action.
- All other transitions are rejected.
- `deprecated` is a terminal state — no transition out.

### Fragment `title`

The frontmatter schema has no `title` field. During indexation, `title` is derived from the first line of the Markdown body (first `# heading` or first non-empty line). Stored in the `fragments` SQLite table for search and display. Not written back to the frontmatter.

### Wildcard in `access`

The value `"*"` in `access.read`, `access.write`, or `access.approve` is a reserved wildcard meaning "all authenticated users." It is not a role name.

### Drizzle SQLite Tables

Four tables per PRD section 12: `fragments`, `audit_log`, `users`, `api_tokens`. The `fragments` table also includes `origin`, `origin_source`, `origin_page`, and `harvest_confidence` columns (defined from Phase 0 per PRD to avoid future migration, defaulting to `manual`/null). The `title` column stores the derived title (see above).

## 3. Git Operations

Module `packages/server/src/git/` encapsulates all Git interactions.

### git-repository.ts

Wraps `child_process.execFile('git', ...)` — no shell execution, prevents command injection.

- `commit(filePath, message)` — `git add <file> && git commit`
- `log(filePath, limit?)` — `git log --follow -- <file>`, structured parse
- `diff(commit1, commit2, filePath?)` — `git diff`
- `show(commit, filePath)` — `git show <commit>:<file>`
- `restore(commit, filePath)` — restore a previous version

### fragment-file.ts

- `readFragment(filePath)` — parse YAML frontmatter + Markdown body, validate via Zod
- `writeFragment(dirPath, frontmatter, body)` — generate kebab-case filename (`type-domain-lang.md`), write frontmatter YAML + body
- `generateId()` — UUID v4 prefixed `frag-`

### commit-message.ts

Generates normalized commit messages per PRD section 10:

```
<action>(<type>/<domain>): <description>

Author: <user_id>
Fragment-Id: <frag-id>
Quality-Transition: <transition>
```

### Configuration

- Store path via `FRAGMINT_STORE_PATH` environment variable
- Frontmatter parsing via `gray-matter` (npm)

### Server Configuration (`fragmint.yaml`)

Minimal Phase 0 config:

```yaml
port: 3210
store_path: ./example-vault        # path to Git-backed fragment store
jwt_secret: <generated>            # auto-generated on first run if absent
jwt_ttl: 8h
log_level: info                    # debug | info | warn | error
trust_proxy: false                 # set true behind reverse proxy
```

All values are overridable via environment variables (`FRAGMINT_PORT`, `FRAGMINT_STORE_PATH`, `FRAGMINT_JWT_SECRET`, etc.).

## 4. Core API

### Server Setup

- Fastify 5, port 3210 (default, configurable)
- Plugins: `@fastify/jwt`, `@fastify/cors`, `@fastify/swagger`
- Configuration via environment variables or `fragmint.yaml`

### Authentication (PRD section 8)

Two modes, unified middleware:

**API token** — `Authorization: Bearer frag_tok_xxx`. Token stored with two hashes in `api_tokens` table: a SHA-256 fast hash for lookup, and a scrypt hash for verification. On each request, SHA-256 of the token is computed for O(1) lookup, then scrypt verifies the match. This avoids O(N) scrypt evaluations per request.

**JWT** — `POST /v1/auth/login` (username + password) → JWT 8h. Claims: `sub` (user login, maps to PRD's `user_id`), `role`, `display_name`.

The `authenticate` middleware detects token type (prefix `frag_tok_` = API token, else = JWT), resolves user and role, injects `request.user`.

**IP tracking** — `request.ip` (with `trustProxy` configured for reverse proxy setups) is captured for audit log `ip_source`.

### Routes

| Method | Endpoint | Description | Min. Role |
|---|---|---|---|
| POST | `/v1/auth/login` | Login → JWT | public |
| GET | `/v1/fragments` | List with filters | reader |
| GET | `/v1/fragments/:id` | Detail + metadata | reader |
| GET | `/v1/fragments/:id/history` | Git history | reader |
| GET | `/v1/fragments/:id/diff/:c1/:c2` | Diff between commits | reader |
| POST | `/v1/fragments/search` | Fulltext search + filters | reader |
| POST | `/v1/fragments/inventory` | Basic counts by type/domain/lang/quality (Phase 0 simplified — full semantic inventory in Phase 1) | reader |
| POST | `/v1/fragments` | Create fragment | contributor |
| PUT | `/v1/fragments/:id` | Update fragment (can set quality to `reviewed`) | contributor |
| POST | `/v1/fragments/:id/review` | Explicit draft → reviewed transition | contributor |
| POST | `/v1/fragments/:id/approve` | Approve (reviewed → approved) | expert |
| POST | `/v1/fragments/:id/deprecate` | Deprecate | admin |
| GET | `/v1/fragments/:id/lineage` | Derivation tree (parent, children, translations) | reader |
| GET | `/v1/fragments/:id/version/:commit` | Fragment content at a specific commit | reader |
| POST | `/v1/fragments/:id/restore/:commit` | Restore a previous version | admin |
| POST | `/v1/index/trigger` | Trigger reindexation | admin |
| GET | `/v1/index/status` | Indexation status (last run, errors) | admin |
| GET | `/v1/audit` | Audit log | admin |
| GET | `/v1/users` | List users | admin |
| POST | `/v1/users` | Create user | admin |
| POST | `/v1/tokens` | Create API token | admin |
| GET | `/v1/tokens` | List tokens | admin |
| DELETE | `/v1/tokens/:id` | Revoke API token | admin |

### Service Layer

Routes are thin — business logic lives in services:

- `fragment-service.ts` — CRUD + quality transitions + Zod validation + Git commit + SQLite upsert + audit log
- `user-service.ts` — user management, password hashing
- `token-service.ts` — API token creation/revocation
- `audit-service.ts` — audit log write and read

### Response Format

Uniform: `{ data, meta, error }` per PRD.

## 5. CLI

Package `packages/cli/`, executable `fragmint`. Thin HTTP client over the Core API (principle P5).

### Dependencies

- `commander` for command parsing
- Native `fetch` (Node 24) for HTTP calls

### Configuration Resolution

1. CLI arguments (`--url`, `--token`)
2. Environment variables (`FRAGMINT_URL`, `FRAGMINT_TOKEN`)
3. File `~/.fragmintrc.yaml` (optional)

### Commands

```
fragmint serve [--port 3210] [--config ./fragmint.yaml]
    # Exception: starts server directly, imports @fragmint/server
    # --dev flag: SQLite in-memory

fragmint search "query" [--type TYPE] [--lang LANG]
fragmint get <id> [--history]
fragmint add [--interactive]
fragmint add < fragment.md
fragmint approve <id>
fragmint deprecate <id>
fragmint inventory "topic" [--lang LANG] [--json]
fragmint gaps [--domain DOMAIN]
fragmint token create --name NAME --role ROLE
fragmint token list
fragmint token revoke <token-id>
fragmint users list
fragmint audit [--from DATE] [--to DATE]
fragmint index status
```

### Output

Human-readable by default, `--json` flag for machine output (CI/CD).

## 6. Post-commit Hook and SQLite Indexation

### Hook

`scripts/post-commit-hook.sh` — installed automatically by `fragmint serve` as a symlink in `.git/hooks/post-commit`.

Flow:
1. Detects modified `.md` files in `fragments/` via `git diff HEAD~1 --name-only`
2. Calls `POST /v1/index/trigger` on local server with modified file list

### Indexation Pipeline (Phase 0)

Implemented in `fragment-service.ts` (no separate module yet):

1. Read each modified file, parse frontmatter via Zod
2. Validate schema (log errors, skip invalid fragments)
3. Upsert into `fragments` SQLite table
4. Update `git_hash` with current commit

### Search (Phase 0)

`POST /v1/fragments/search` uses SQLite `LIKE` on `title` and `body_excerpt`, combined with structured filters (type, domain, lang, quality). Phase 1 adds Milvus semantic search; structured SQLite filters remain.

### Full Reindexation on Startup

If `fragments` table is empty (first launch or reset), the server scans the entire `fragments/` directory and indexes every `.md` file.

## 7. Example Vault and Seed Data

### Sample Fragments

5 fragments covering different types, domains, languages, and quality states:

| File | Type | Domain | Lang | Quality |
|---|---|---|---|---|
| `commercial/introduction-souverainete-fr.md` | introduction | souveraineté | fr | approved |
| `commercial/argument-openrag-vs-proprietaire-fr.md` | argument | openrag | fr | approved |
| `commercial/pricing-twake-secteur-public-fr.md` | pricing | twake | fr | reviewed |
| `commercial/introduction-sovereignty-en.md` | introduction | souveraineté | en | approved |
| `juridique/clause-donnees-personnelles-rgpd-fr.md` | clause | juridique | fr | draft |

### Seed User (dev mode only)

On first startup with `--dev`, the server creates:
- Admin user: `mmaudet` / `fragmint-dev`
- Reader API token for testing

These credentials are only created in dev mode.

### Git Initialization

`fragmint serve --dev` initializes a Git repo in the vault directory if none exists, and commits existing fragments.

## 8. Testing Strategy

### Unit Tests (`*.test.ts`)

- Zod frontmatter validation (valid cases, missing fields, invalid quality transitions, id/lang regex)
- Fragment file parsing/writing (frontmatter + body, kebab-case naming)
- Normalized commit message generation
- Password and token hashing/verification (scrypt)
- Quality transition logic (draft → reviewed OK, draft → approved KO)

### Integration Tests (`*.integration.test.ts`)

Via `fastify.inject()` (no real HTTP server):

- Full CRUD: create, read, list (filtered), update, approve, deprecate
- Auth: login → JWT, API token, role-based permissions (reader can't create, contributor can't approve)
- Fulltext search with filters
- Inventory and gap detection
- Git history for a fragment
- Audit log

Each integration test uses a temporary directory (Git repo + in-memory SQLite), cleaned up after.

### CLI Tests (`packages/cli/src/**/*.test.ts`)

Lightweight: verify each command calls the correct endpoint with correct parameters. No end-to-end CLI↔server tests in Phase 0.

### Vitest Configuration

`vitest.workspace.ts` at root referencing both packages. Integration tests separated by glob pattern (`*.integration.test.ts`) for independent execution.

## Architectural Principles (from PRD)

- **P1** — Git as single source of truth
- **P2** — One file = one fragment = one TextUnit
- **P3** — Humans remain sovereign (only humans can approve)
- **P5** — Core API is the single source of logic (CLI is a thin client)
- **P6** — Total sovereignty (no cloud dependency, air-gap compatible)

## Out of Scope (Phase 0)

- Milvus / semantic search (Phase 1)
- MCP server (Phase 2)
- Carbone / document composition (Phase 3)
- Frontend React (Phase 4)
- Obsidian plugin (Phase 5)
- Multilingual desynchronization (Phase 6)
- Fragment Harvester (Phase 7)
- GraphRAG integration (Phase 8-9)
- OpenRAG integration (Phase 6+)
- Branches (post-MVP)
- CredOS (post-MVP)

## Roadmap Context

This spec covers Phase 0 only. The full roadmap (Phases 0-9, ~19+ weeks) is documented in the PRD and tracked in project memory.
