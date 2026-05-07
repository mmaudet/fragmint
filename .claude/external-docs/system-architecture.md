# Fragmint — System Architecture & Complete Flows

**Version 6 — May 7, 2026**

*Sections marked ⚡ Claude Code come from direct source code analysis (file reads, codebase exploration) and are more precise than observations made during testing.*

---

## 0. Mission Context

### Goal

Ingest Linagora documents (pitches, commercial proposals, RFP responses) and automatically generate output documents (presentations, commercial proposals) from the extracted fragments.

### Priority Use Cases

1. Commercial proposal
2. Client presentation
3. RFP response

### Surfaces by Priority

| Priority | Surface | Status |
|----------|---------|--------|
| 1 | **Fragmint Web UI** (React) | Existing, to be improved |
| 2 | **OpenCode + Skills** (terminal) | To be built — skill to compose from the terminal |
| 3 | Obsidian plugin | Out of scope for main mission (Phase 8) |

### AI Infrastructure

- **Local mode**: Ollama on the host machine (`http://host.docker.internal:11434`) — kept
- **Remote mode (target)**: `ai.linagora.com` — OpenAI-compatible endpoint, access provided by Linagora. Provider: open weight LLMs only. Interim: OpenRouter (`https://openrouter.ai`, free models available during ramp-up).

Fragmint is already compatible with any OpenAI-compatible endpoint: changing `FRAGMINT_LLM_ENDPOINT` and `FRAGMINT_EMBEDDING_ENDPOINT` is enough to switch between local Ollama and ai.linagora.com.

### Target Deployment

Docker Compose — portable across machines, deployable on a small Linagora VM for the final demo.

---

## 1. Overview — The 3 Main Flows

```
              ┌─ SEARCH ──→ Embedding (Ollama / ai.linagora.com) ──→ Milvus ──→ Re-rank ──→ Results
              │
User Input ───┼─ COMPOSE ──→ Template YAML ──→ SQLite Slots ──→ Render ──→ DOCX/XLSX/Slides
              │
              └─ HARVEST ──→ Pandoc ──→ LLM Segment ──→ LLM Classify ──→ Human Validation
                                  (Ollama / ai.linagora.com)                      ↓
                                                                        Git + SQLite + Milvus
```

**Key point: the Composer NEVER calls an LLM.** It is purely declarative. Only the Harvester uses the LLM.

---

## 2. AI Components

### 2.1 The AI Engine — Ollama (local) or ai.linagora.com (remote)

Fragmint relies on **any OpenAI-compatible endpoint** for its two AI functions. In local mode, that's Ollama (port 11434, on the host machine). In remote mode, it will be `ai.linagora.com`.

It serves **two distinct functions**:

| Function | Default model | Endpoint | Called by |
|----------|--------------|----------|-----------|
| Embeddings (vectorization) | nomic-embed-text-v2-moe (768D) | POST /v1/embeddings | EmbeddingClient → SearchService |
| LLM inference (generation) | mistral-nemo:12b | POST /v1/chat/completions | LlmClient → HarvesterService |

**Env vars to switch mode:**
```
FRAGMINT_EMBEDDING_ENDPOINT=https://ai.linagora.com/v1
FRAGMINT_LLM_ENDPOINT=https://ai.linagora.com/v1
FRAGMINT_EMBEDDING_MODEL=nomic-embed-text-v2-moe
FRAGMINT_LLM_MODEL=mistral-nemo:12b
```

⚠️ If the AI engine is unreachable: embeddings fail → Milvus cannot index → semantic search is down. The Harvester is also blocked → 0 fragments extracted.

### 2.2 nomic-embed-text-v2-moe — the embedding model

Transforms any text into a vector of **768 floating-point numbers**. Two semantically similar texts produce mathematically close vectors, even if their words differ.

⚡ Claude Code — Fragmint applies task prefixes **in `SearchService`** (not in `EmbeddingClient`, which is generic):

```typescript
// During indexing (search-service.ts line 117)
this.prefixes.document + truncateForEmbedding(rawText, this.maxTokens)
// → "search_document: LinCloud Sovereign Platform..."

// During a user query (search-service.ts line 183)
this.prefixes.query + truncateForEmbedding(query, this.maxTokens)
// → "search_query: sovereign cloud"
```

⚡ Claude Code — Exact payload format (endpoint `/v1/embeddings`, OpenAI-compatible):

```json
// Request — field "input" = array of strings (NOT "prompt")
{ "model": "nomic-embed-text-v2-moe", "input": ["search_query: sovereign cloud"] }

// Response — OpenAI-compatible format, already used by Fragmint
{ "data": [{ "embedding": [0.521, -0.234, 0.891, ...] }] }
```

### 2.3 mistral-nemo:12b — the generation model

Used only by the Harvester. Temperature 0.2 (stable/consistent). Two functions:
- `segment()`: Markdown → `[{title, body, type, lang}]`
- `classify()`: text → `{type, domain, tags, confidence}`

⚠️ Default timeout: 60s (configurable via `FRAGMINT_LLM_TIMEOUT`, e.g. `300000` for large documents). If timeout exceeded → `AbortController.abort()` → `segment()` returns `[]` → 0 candidates, with no visible error in the UI.

### 2.4 Milvus — the vector database

Milvus stores vectors and enables **semantic similarity search** (search by meaning, not keywords).

⚡ Claude Code — Configuration (`config.ts`):

- **Collection**: `fragmint_fragments`
- **Partitions**: one per collection (`col_common`, `col_team_x`...) — multi-tenant isolation
- **Index**: IVF_FLAT, cosine distance, 128 lists
- **`milvus_enabled`**: `false` by default
- **What Milvus stores**: 768D vector + filterable metadata (type, domain, lang, quality, author, tags, timestamps) — allows filtering directly in Milvus without joining SQLite for each result

**Required infrastructure services:**

| Service | Role | If down |
|---------|------|---------|
| etcd | Milvus metadata (indexes, collections, schemas) | Milvus crashes → SQLite fallback |
| minio | Vector index files (serialized vectors) | Vector data lost on restart |

---

## 3. Authentication & Access Control

### 3.1 Authentication — two mechanisms

**JWT (user login):**

```
POST /v1/auth/login { login, password }
      ↓
UserService.authenticate() → verifies scrypt password hash
      ↓
app.jwt.sign({ sub: login, role, display_name })
TTL: config.jwt_ttl (default 8h)
      ↓
HTTP 200 { token: "eyJ..." }
```

Each subsequent request: `Authorization: Bearer eyJ...`
→ middleware verifies via `request.jwtVerify()` → 401 if expired/invalid.

**API Tokens (service accounts):**

Format: `frag_tok_<24-bytes-hex>`

```
POST /v1/tokens { name, role, collection_slug? }   ← admin only
      ↓
Generate token → store in api_tokens:
  token_lookup : SHA256 (fast lookup)
  token_hash   : scrypt (secure verification)
  ⚠️ Plain-text token is shown only once, never retrievable again
```

Token authentication flow:

```
Authorization: Bearer frag_tok_...
      ↓
Middleware detects "frag_tok_" prefix
→ SHA256 → DB lookup → scrypt verification
→ request.user = { id, role, tokenCollectionSlug? }
→ update last_used
```

If `collection_slug` is set on the token → access restricted to that single collection.

### 3.2 Global roles (4 levels)

```
reader (0) → contributor (1) → expert (2) → admin (3)
```

| Role | What it can do |
|------|---------------|
| **reader** | Read and search fragments |
| **contributor** | Create and edit fragments (quality: draft/reviewed) |
| **expert** | Approve fragments (reviewed → approved) |
| **admin** | Everything: user management, tokens, deprecation, system collections |

### 3.3 Collection roles (5 levels)

In addition to the global role, each user has a role **per collection**:

```
reader (0) → contributor (1) → expert (2) → manager (3) → owner (4)
```

| Collection role | Additional permissions |
|----------------|----------------------|
| reader | Read the collection's fragments |
| contributor | Create/edit fragments in the collection |
| expert | Approve fragments in the collection |
| manager | Manage collection members |
| owner | Modify/delete the collection itself |

**Global admins** automatically get the `owner` role on all collections without an explicit membership record.

### 3.4 Full access verification flow

```
HTTP request with Authorization header
      ↓
Auth middleware → validates JWT or API token
→ request.user = { id, login, role, display_name, tokenCollectionSlug? }
      ↓
If collection-scoped endpoint (/v1/collections/:slug/*)
      ↓
Collection middleware → loads collection by slug
→ checks user has membership (or is global admin)
→ checks collection role ≥ required role
→ request.collection, request.collectionRole
      ↓
Route handler executes
```

---

## 4. Collections & Multi-Tenancy

### 4.1 What is a collection?

A collection is an **isolated namespace** grouping:
- Fragments (in a dedicated Git subdirectory)
- A dedicated Milvus partition
- Members with their own roles

**Three types:**

| Type | Created by | Shared with | Use case |
|------|-----------|-------------|----------|
| `system` | Admin | All users (auto-assigned) | Common library `common` |
| `team` | Anyone | Explicitly added members | Project teams |
| `personal` | Auto-created | Owner only (initially) | Private drafts |

### 4.2 Milvus partition naming

⚡ Claude Code — `toMilvusPartition()` function in `db/schema.ts`:

```typescript
'col_' + slug.replace(/-/g, '_')
// Examples:
// 'common'      → 'col_common'
// 'prod-docs'   → 'col_prod_docs'
// 'team-legal'  → 'col_team_legal'
```

### 4.3 Backward compatibility

Routes without a collection prefix (`/v1/fragments`) operate on the `common` collection. All existing fragments have `collection_slug = 'common'`.

### 4.4 Collection routes

```
GET    /v1/collections                    → list accessible collections
POST   /v1/collections                    → create (admin for 'system')
GET    /v1/collections/:slug              → detail (role: reader)
PUT    /v1/collections/:slug              → update (role: owner)
DELETE /v1/collections/:slug              → delete (role: owner)
POST   /v1/collections/:slug/members      → add member (role: manager)
DELETE /v1/collections/:slug/members/:id  → remove member (role: manager)
```

---

## 5. Fragment Lifecycle

### 5.1 States

```
  [Creation]       [Review]         [Approval]        [Retirement]
      │                │                 │                 │
   draft  ──────→  reviewed  ──────→  approved  ──────→  deprecated
      │                │                 │                 │
  Author /         Reviewer /        Expert /          Admin /
  Harvester         Admin             Admin             Author
```

| State | Re-ranking weight | Visible in search |
|-------|------------------|------------------|
| `draft` | ×0.80 | Yes |
| `reviewed` | ×0.95 | Yes |
| `approved` | ×1.00 | Yes |
| `deprecated` | — | No (systematic filter) |

### 5.2 Fragment creation — 6 steps

```
POST /v1/collections/common/fragments
      ↓
[1] Generate ID: frg-{uuid}
[2] Write example-vault/fragments/{domain}/{type}-{domain}-{lang}-{uuid8}.md
    (YAML frontmatter + Markdown body)
[3] git add + git commit
    Message: "create(argument/lincloud): new argument fragment"
[4] INSERT INTO fragments (SQLite)
[5] EmbeddingClient.embed("search_document: " + body)
    → POST .../v1/embeddings → 768D vector
[6] MilvusClient.insert(id, vector, partition='col_common')
      ↓
HTTP 201 { data: { id: 'frg-...', quality: 'draft', git_hash: 'abc123' } }
```

**Failure points at creation:**

| Step | If it fails | Consequence |
|------|------------|-------------|
| 3 — Git commit | Git user not configured | HTTP 500. Nothing created. |
| 5 — Embedding | AI engine down | Fragment in SQLite/Git, absent from Milvus. Invisible to semantic search. |
| 6 — Milvus | Milvus down | Fragment in SQLite/Git, absent from Milvus. Score 0 in search. |

### 5.3 Temporal validity

```yaml
valid_from:  2026-01-01   # excluded from results before this date
valid_until: 2026-12-31   # excluded from results after this date
```

These filters are applied everywhere: Milvus search (SQLite enrichment) and composition (`valid_at: today`).

### 5.4 Derivation and translation

A fragment can be linked to others via three fields:

| Field | Use | Example |
|-------|-----|---------|
| `parent_id` | Derivation: variant of an existing fragment | Marketing version of a technical clause |
| `translation_of` | Translation: same content, different language | FR fragment translated from EN |
| `generation` | Derivation depth (0 = original) | 0 → 1 → 2... |

To view the derivation tree: `GET /v1/fragments/{id}/lineage`
→ returns `{ root, children, translations }`

There is no dedicated "derive" or "translate" endpoint: derivation is created by passing `parent_id` or `translation_of` when creating a fragment.

### 5.5 Complete fragment file structure (.md)

```yaml
---
id: frg-550e8400
type: argument
domain: lincloud
lang: fr
quality: approved
author: mmaudet
reviewed_by: jdupont
approved_by: admin
created_at: 2026-01-15T10:00:00Z
updated_at: 2026-04-20T14:30:00Z
valid_from: 2026-01-01
valid_until: 2026-12-31
parent_id: null
translation_of: null
generation: 0
uses: 12
last_used: 2026-05-01
tags:
  - product:LinShare
  - pu:4.50
origin: manual            # or 'harvested'
access:
  read: ['*']
  write: ['contributor', 'admin']
  approve: ['expert', 'admin']
---

# LinShare — Sovereign File Sharing

LinShare is LINAGORA's sovereign file sharing solution...
```

---

## 6. Flow A — Semantic Search

### 6.1 With Milvus active

```
User types "sovereign cloud"
      ↓
POST /v1/collections/common/fragments/search
Body: { query: 'sovereign cloud', limit: 20, quality_min: 'approved' }
      ↓
[1] EmbeddingClient.embed("search_query: sovereign cloud")
    → POST :11434/v1/embeddings
    → Body: { "model": "nomic-embed-text-v2-moe", "input": ["search_query: sovereign cloud"] }
    → { "data": [{ "embedding": [0.521, -0.234, ...] }] }    // 768 floats
      ↓
[2] MilvusClient.search(vector, top_k=20, metric='COSINE', partition='col_common')
    → [{ id: 'frg-abc', score: 0.91 }, { id: 'frg-ghi', score: 0.54 }, ...]
      ↓
[3] SQLite enrichment:
    SELECT * FROM fragments WHERE id IN (...) AND quality != 'deprecated'
    AND (valid_from IS NULL OR valid_from <= '2026-05-07')
    AND (valid_until IS NULL OR valid_until >= '2026-05-07')
      ↓
[4] Re-ranking (search-service.ts — exact coefficients from source code):
    Quality score  : approved=×1.0 / reviewed=×0.95 / draft=×0.80
    Freshness boost: ≤7d=+0.05 / ≤30d=+0.03 / ≤90d=+0.01 / older=+0
    Usage momentum : >10 uses=+0.02 / >5 uses=+0.01 / else=+0
    Final score = (milvus_score × quality) + freshness + momentum
      ↓
[5] HTTP 200 { data: [{ id, score, quality, title, body, domain, ... }] }
```

### 6.2 Without Milvus (silent SQLite fallback)

```typescript
// search-service.ts
try {
  return await this.milvusSearch(query, filters, limit);
} catch (err) {
  console.warn('Milvus search failed, falling back to SQLite:', err.message);
  return await this.sqliteSearch(query, filters, limit);
}
// sqliteSearch: LIKE on title and body_excerpt — returned score = 0
// Re-ranking still applied, but all at score=0 → sorted by uses DESC
```

⚠️ Entirely silent fallback. `GET /v1/index/status → { mode: 'sqlite' }` to check.

---

## 7. Flow B — Document Composition

### 7.1 Template YAML structure

⚡ Claude Code — Full schema (`schema/template.ts`):

```yaml
id: tpl-lincloud-slides         # required, prefix 'tpl-'
name: LinCloud — Client Presentation
description: LinCloud presentation slides
output_format: slides            # docx | xlsx | slides | pptx | reveal
version: "1.0"
author: mmaudet

# Context schema validated at composition time
context_schema:
  client:
    type: string
    required: true
  date:
    type: date
    default: today
  lang:
    type: string
    enum: [fr, en]
    default: fr

# Fragment slots to resolve
fragments:
  - key: introduction
    type: introduction
    domain: lincloud
    lang: "{{context.lang}}"    # can reference context
    quality_min: approved        # draft | reviewed | approved
    required: true
    fallback: error              # error | skip | generate
    count: 1
  - key: arguments
    type: argument
    domain: lincloud
    lang: "{{context.lang}}"
    quality_min: reviewed
    fallback: skip
    count: 3
  - key: pricing
    type: pricing
    domain: lincloud
    lang: fr
    quality_min: approved
    required: false
    fallback: skip
    count: 1

# Collections allowed for slot resolution
collections: [common, team-sales]
```

### 7.2 Template storage

Templates are stored in **both SQLite and Git**:

- **SQLite**: metadata (`id`, `name`, `output_format`, `version`, `author`, `git_hash`, `template_path`, `yaml_path`)
- **Git**: YAML file + template file (`.docx`, `.md`...) committed together
- **Directory**: `{store_path}/templates/`
- **Naming convention**: `{template_id}.yaml` for YAML, free name for the template file

### 7.3 Rendering engines

⚡ Claude Code — Libraries read from `render-engine.ts`:

| Format | Library | Template syntax |
|--------|---------|----------------|
| DOCX | docx-templates | `{fragments.intro.body}` ; loop: `+++FOR row IN rows+++ {row.name} +++END-FOR row+++` ; condition: `+++IF show+++ ... +++END-IF show+++` |
| XLSX | xlsx-template | Dynamic cell references, automatic VAT calculations |
| slides | @marp-team/marp-core | Markdown with `marp: true` frontmatter, `---` slide separators |
| pptx | @marp-team/marp-cli | Same Marp source, rendered to PPTX via CLI subprocess |
| reveal | HTML interpolation | HTML template with `{{fragment_x_body}}` placeholders |

### 7.4 Full composition flow

```
POST /v1/collections/common/templates/tpl-lincloud-slides/compose
Body: { context: { client: 'City of Lyon', date: 'today' } }
      ↓
[1] Load template YAML from SQLite
[2] Validate output format:
    requestedFormat = request.output?.format ?? yaml.output_format
    If mismatch → error 400
[3] Validate context against context_schema
    (required fields, enum values, apply defaults)
[4] For each slot → resolveSlot() → fragmentService.list() — pure SQL
    SELECT * FROM fragments
    WHERE type='introduction' AND domain='lincloud' AND lang='fr'
    AND quality >= 'approved'
    AND (valid_from IS NULL OR valid_from <= '2026-05-07')
    LIMIT 1
    → First SQL result. No semantics. Score: 0.00.
[5] Build template data object:
    {
      fragments: { introduction: {body, id, quality, ...tags}, arguments: [...] },
      metadata:  { client: 'City of Lyon', date: '2026-05-07', total_ht, tva, total_ttc },
      lignes:    [...]       // if structured_data provided in request
    }
[6] Auto-compute pricing if pu (unit price) tags present:
    quantity × unit_price → total
    sum(totals) → total_ht → VAT 20% → total_ttc
    fr-FR formatting: 42500 → "42 500,00"
[7] Render according to output_format → buffer
[8] Write to {store_path}/outputs/{uuid}.{ext}  (TTL 1h, cleanup every 10min)
[9] HTTP 200 { document_url: '/v1/outputs/...', context, resolved: [...], skipped: [...] }
```

---

## 8. Flow C — Harvester Pipeline

### 8.1 Overview

```
Upload DOCX
      ↓
POST /v1/collections/common/harvest → HTTP 202 (async)
Background: HarvesterService.process(job)
      ↓
[1] Pandoc: DOCX → Markdown
[2] Language detection: FR/EN stopword counting (no AI)
[3] Chunking: 6000 chars, 400-char overlap
[4] For each chunk: Mistral segment()
[5] For each segment: Mistral classify()
[6] For each segment: embed() → Milvus search() (duplicates > 0.80)
[7] Save to harvest_candidates
[8] UPDATE job status='done', stats={total, duplicates, low_confidence, valid}
      ↓
UI polls GET /v1/harvest/:jobId every 2 seconds
```

### 8.2 Chunking

```
12000-char document:
  Chunk 1: chars 0–6000
  Chunk 2: chars 5600–11600   ← 400-char overlap (avoids cutting a fragment)
  Chunk 3: chars 11200–12000
```

### 8.3 Segmentation (Mistral)

```json
POST :11434/v1/chat/completions
{
  "model": "mistral-nemo:12b", "temperature": 0.2,
  "messages": [{ "role": "user", "content":
    "Analyze the following markdown and identify reusable content blocks.
     Return a JSON array: [{title, body, type, lang}].
     [chunk content]
     Return ONLY a JSON array." }]
}
→ [{ "title": "...", "body": "...", "type": "introduction", "lang": "fr" }, ...]
```

### 8.4 Classification (Mistral)

```json
{
  "content": "Classify the following text.
    Available types: [\"introduction\", \"argument\", ...].
    Available domains: [\"lincloud\"].   ← Bug #11
    Return JSON: {type, domain, tags, confidence}."
}
→ { "type": "introduction", "domain": "lincloud", "tags": [...], "confidence": 0.95 }
```

⚠️ **Bug #11**: `existingDomains=['lincloud']` forces Mistral to classify into that single domain. Cooking recipes get classified as lincloud with 95% confidence.

### 8.5 Duplicate detection

```typescript
EmbeddingClient.embed("search_document: " + segment.body)
MilvusClient.search(vector, top_k=5)
→ score > 0.80 → candidate.status = 'duplicate'
→ score ≤ 0.80 → candidate.status = 'pending'
```

⚠️ **Bug #4**: timing issue — vectors of freshly created fragments are not yet in Milvus when the Harvester checks.

### 8.6 Human validation

```json
POST /v1/harvest/:jobId/validate
{
  "accepted": ["cand-uuid1"],
  "rejected": ["cand-uuid2"],
  "modified": [{ "id": "cand-uuid3", "domain": "cooking" }]
}
// For each accepted → FragmentService.create() → Git + SQLite + embed + Milvus
```

---

## 9. MCP Server — Claude Code/Desktop Integration

The `packages/mcp/` package exposes an MCP (Model Context Protocol) server over stdio. It allows Claude Code and Claude Desktop to interact directly with Fragmint.

⚡ Claude Code — 9 exposed tools:

| MCP tool | Role |
|----------|------|
| `collection_list` | List accessible collections |
| `fragment_inventory` | Diagnose fragment coverage by topic/domain |
| `fragment_search` | Semantic search with filters (type, lang, quality_min) |
| `fragment_get` | Retrieve a full fragment with optional Git history |
| `fragment_create` | Create a new fragment (quality: draft automatically) |
| `fragment_update` | Edit content/metadata/quality (except approved → requires expert) |
| `fragment_lineage` | Get the derivation tree (parent, children, translations) |
| `document_compose` | Compose a document from a template, returns the composition report |
| `fragment_harvest` | Trigger the extraction pipeline from a DOCX file |

All tools accept a `collection_slug` parameter (default: `"common"`).

---

## 10. Re-indexing

### 10.1 When it is triggered

- **At startup**: if SQLite is empty → `fragmentService.reindex()` rebuilds from `.md` files in the vault
- **Manually**: `POST /v1/index/trigger` (admin only)

### 10.2 What it does (two phases)

```
Phase 1 — SQLite:
  Recursive walk of fragments/ directory
  → reads each .md (frontmatter + body)
  → upsert into SQLite (INSERT OR UPDATE)

Phase 2 — Milvus:
  searchService.indexBatch(all fragments)
  → embed in batches of 32
  → upsert into Milvus in chunks of 100

→ returns { indexed: N, total: M }
```

### 10.3 Git / SQLite / Milvus relationship

⚡ Claude Code — Important sync note:

```
Git    → Source of truth for history and recovery
SQLite → Source of truth for production reads
Milvus → Derived index, rebuilt via reindex()
```

SQLite is **not automatically rebuilt from Git** on every startup. `reindex()` is triggered only if SQLite is empty. Otherwise, Git and SQLite are assumed to be in sync (every write modifies both simultaneously).

---

## 11. Server Initialization

⚡ Claude Code — Startup sequence (`packages/server/src/index.ts`):

```
[1]  Load config (YAML file + env vars)
[2]  SQLite: open ~/.fragmint.db (or :memory: in dev)
     + migrate tables (Drizzle ORM)
[3]  Collections: if no collections exist →
     create 'common' (system, auto_assign=true)
     + assign all existing users to 'common'
[4]  Git: initialize repo if .git/ absent
     + configure user.email=fragmint@localhost, user.name=Fragmint
[5]  EmbeddingClient: connect to AI engine
[6]  Milvus (if enabled): connect + ensure collection exists
[7]  SearchService: wraps EmbeddingClient + Milvus (or null if disabled)
[8]  Business services:
     UserService, TokenService, AuditService
     FragmentService (db + storePath + audit + search)
     TemplateService (db + storePath + audit)
     ComposerService (fragments + templates + storePath)
[9]  Register Fastify routes:
     /v1/auth, /v1/fragments, /v1/templates, /v1/tokens,
     /v1/collections, /v1/harvest, /v1/index, /v1/outputs
     + prefixed routes /v1/collections/:slug/* (same handlers)
[10] Dev seed (if NODE_ENV=development):
     → create user mmaudet / fragmint-dev
[11] Auto-reindex if SQLite empty:
     → fragmentService.reindex() → "Indexed X fragments on startup"
[12] Start output cleanup timer (every 10min)
[13] Server listening on port 3210
```

---

## 12. Storage Summary

| Layer | What it stores | Source of truth | Survives restart |
|-------|---------------|-----------------|-----------------|
| **Git** | Fragment `.md` files + template files | History and recovery | ✅ Yes |
| **SQLite** | Metadata, indexes, templates, users, tokens, collections, jobs, audit | Production reads | ❌ Dev (RAM) / ✅ Prod (file) |
| **Milvus** | 768D vectors + filterable metadata | Derived index (rebuilt via reindex) | ✅ Docker volume |

**SQLite tables:**
`fragments`, `users`, `api_tokens`, `collections`, `collection_memberships`, `templates`, `harvest_jobs`, `harvest_candidates`, `audit_log`

---

## 13. Obsidian Plugin — Out of Scope (Phase 8)

### 13.1 Status

⚠️ **Out of scope for the main mission (20 days).** The Obsidian plugin must not be developed at the expense of the primary deliverables: Fragmint UI and OpenCode skill.

It is an exploratory track to pursue only if the main deliverables are well advanced.

### 13.2 Concept

[Obsidian](https://obsidian.md) is a Markdown note editor. Its files are `.md` stored locally — same format as Fragmint fragments.

The idea: let Obsidian users **access the Fragmint library directly from their notes** — search fragments, insert them, compose documents, harvest existing notes.

The plugin would be a simple Fragmint REST API client, authenticated via an API token. No additional server component needed.

### 13.3 Current code state

⚡ Claude Code — The `packages/obsidian/` package is an **empty stub**: only a `package.json` and a one-line README. No source code, no Obsidian `manifest.json`, no implementation.
