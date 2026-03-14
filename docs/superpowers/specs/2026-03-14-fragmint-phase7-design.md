# Fragmint Phase 7 — Fragment Harvester DOCX

**Date:** 2026-03-14
**Phase:** 7 of 9
**Duration:** 3 weeks
**Status:** Design approved

## Scope

Build a document ingestion pipeline that extracts fragments from .docx files using LLM-powered segmentation and classification, with deduplication and human review.

### In scope

- Pipeline DOCX: Pandoc → Markdown → LLM segmentation → LLM classification → deduplication → human review → commit
- LlmClient service (Ollama/OpenAI API compatible)
- HarvesterService (pipeline orchestrator)
- SQLite tables: harvest_jobs, harvest_candidates
- 3 API endpoints (`/v1/harvest/*`)
- Vue Ingestion frontend (upload + candidate review)
- CLI `fragmint harvest`
- MCP tool `fragment_harvest`
- Pandoc in Dockerfile

### Out of scope

- Pipelines PPTX/XLSX/PDF (post-MVP, specs only in PRD)
- LLM config admin panel (Phase 6+ backlog)
- Auto-merge of duplicates (human decides)

## Architecture

```
Upload .docx via API/CLI/MCP
        │
        ▼
┌─────────────────┐
│ 1. Extraction    │  pandoc docx → markdown
│    (Pandoc)      │
└────────┬────────┘
         ▼
┌─────────────────┐
│ 2. Pré-traitement│  nettoyage headers/footers, normalisation,
│    DOCX          │  détection langue (langdetect)
└────────┬────────┘
         ▼
┌─────────────────┐
│ 3. Segmentation  │  LLM (Ollama) découpe en blocs candidats
│    LLM           │  avec start/end markers + type + confidence
└────────┬────────┘
         ▼
┌─────────────────┐
│ 4. Classification│  LLM attribue type, domain, lang, tags
│    LLM           │  en contexte des types/domaines existants
└────────┬────────┘
         ▼
┌─────────────────┐
│ 5. Déduplication │  Embedding → comparaison Milvus
│    vectorielle   │  >0.95 doublon, 0.80-0.95 probable, <0.80 nouveau
└────────┬────────┘  (skippée si Milvus absent)
         ▼
┌─────────────────┐
│ 6. Stockage job  │  Candidats stockés en SQLite
│                  │  Statut: processing → done
└────────┬────────┘
         ▼
┌─────────────────┐
│ 7. Revue humaine │  Vue Ingestion frontend
│    (frontend)    │  accept / reject / merge par candidat
└────────┬────────┘
         ▼
┌─────────────────┐
│ 8. Commit        │  FragmentService.create() pour chaque accepté
│                  │  origin: 'harvested', origin_source, origin_page
└─────────────────┘
```

## Data Model

### SQLite tables

Add to `packages/server/src/db/schema.ts`:

```sql
CREATE TABLE harvest_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  files TEXT NOT NULL,
  pipeline TEXT NOT NULL,
  min_confidence REAL NOT NULL,
  stats TEXT,
  error TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE harvest_candidates (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  type TEXT NOT NULL,
  domain TEXT NOT NULL,
  lang TEXT NOT NULL,
  tags TEXT,
  confidence REAL NOT NULL,
  origin_source TEXT NOT NULL,
  origin_page INTEGER,
  duplicate_of TEXT,
  duplicate_score REAL,
  status TEXT NOT NULL DEFAULT 'pending',
  fragment_id TEXT
);
```

Fields:
- `harvest_jobs.status`: `processing` | `done` | `error`
- `harvest_jobs.files`: JSON array of filenames
- `harvest_jobs.stats`: JSON `{ total, duplicates, low_confidence, valid }`
- `harvest_candidates.status`: `pending` | `accepted` | `rejected` | `merged`
- `harvest_candidates.duplicate_of`: fragment ID if duplicate detected (null if new)
- `harvest_candidates.fragment_id`: populated after commit (accepted → fragment created)

## Services

### LlmClient

`packages/server/src/services/llm-client.ts`

HTTP client for Ollama/OpenAI-compatible API:

```typescript
interface LlmClientConfig {
  endpoint: string;   // default: FRAGMINT_LLM_ENDPOINT || 'http://localhost:11434/v1'
  model: string;      // default: FRAGMINT_LLM_MODEL || 'mistral-nemo:12b'
  temperature: number; // default: 0.2
  timeout: number;    // default: 60000 (ms)
}
```

Methods:

**`segment(markdown: string): Promise<SegmentBlock[]>`**

Calls chat completion with segmentation prompt. Returns array of:
```typescript
interface SegmentBlock {
  start_marker: string;  // first 10 words
  end_marker: string;    // last 10 words
  type_candidate: string;
  confidence: number;
}
```

Prompt (from PRD):
```
Tu analyses un document professionnel converti en Markdown.
Identifie les blocs de contenu autonomes et réutilisables —
c'est-à-dire les parties qui pourraient exister indépendamment
du document source et être réutilisées dans d'autres documents.

Types de blocs à identifier : introduction, argument, clause,
pricing, conclusion, faq, bio, témoignage.

Pour chaque bloc, retourne un JSON array :
[{
  "start_marker": "les 10 premiers mots du bloc",
  "end_marker": "les 10 derniers mots du bloc",
  "type_candidate": "type probable",
  "confidence": 0.0-1.0
}]

Document :
{markdown_content}
```

**`classify(blockText: string, existingTypes: string[], existingDomains: string[]): Promise<Classification>`**

Calls chat completion with classification prompt. Returns:
```typescript
interface Classification {
  type: string;
  domain: string;
  lang: string;
  tags: string[];
  title: string;
  confidence: number;
}
```

Prompt (from PRD):
```
Bloc de contenu :
{bloc_text}

Types disponibles : {existingTypes}
Domaines disponibles : {existingDomains}

Retourne un seul objet JSON :
{
  "type": "...",
  "domain": "...",
  "lang": "fr|en",
  "tags": [...],
  "title": "titre court proposé",
  "confidence": 0.0-1.0
}
```

Both methods parse the LLM response as JSON. If parsing fails, retry once. If still fails, return low confidence (0.1) with best-effort extraction.

### HarvesterService

`packages/server/src/services/harvester-service.ts`

Orchestrates the full pipeline. Constructor takes: `db`, `llmClient`, `searchService`, `fragmentService`, `storePath`.

**`harvest(files: Buffer[], filenames: string[], options: HarvestOptions, userId: string): Promise<string>`**

Returns `job_id`. Runs pipeline asynchronously (not blocking the request).

Flow:
1. Create job in `harvest_jobs` with status `processing`
2. For each file:
   a. Write to temp dir
   b. Run `pandoc --from docx --to markdown <file>` via `child_process.execFile`
   c. Pre-process: clean headers/footers, normalize whitespace, detect language via simple heuristic (count of French vs English stop words)
   d. Call `llmClient.segment(markdown)` → get blocks
   e. Extract block text from markdown using start/end markers
   f. For each block with confidence >= min_confidence:
      - Call `llmClient.classify(blockText, existingTypes, existingDomains)`
      - If Milvus available: embed block, search for similar fragments
        - similarity > 0.95 → set `duplicate_of` + `duplicate_score`
        - similarity 0.80-0.95 → set `duplicate_of` + `duplicate_score` (probable)
      - Insert into `harvest_candidates`
3. Compute stats: `{ total, duplicates, low_confidence, valid }`
4. Update job status to `done` (or `error` if pipeline fails)

**`getJob(jobId: string): Promise<HarvestJob>`**

Returns job with candidates list.

**`validate(jobId: string, validation: ValidationRequest, userId: string): Promise<ValidationResult>`**

Processes validation:
- `accepted[]` → create fragments via `FragmentService.create()` with `origin: 'harvested'`, `origin_source`, `origin_page`, `harvest_confidence`
- `modified[]` → create fragments with modified content/metadata
- `merged[]` → update existing fragment (append body or update metadata)
- `rejected[]` → update candidate status to `rejected`

Returns `{ committed: number, merged: number, rejected: number }`.

## API Endpoints

| Method | Route | Min role | Description |
|--------|-------|----------|-------------|
| POST | `/v1/harvest` | expert | Upload .docx files + start pipeline. Multipart: files + options JSON. Returns `{ job_id, status }` |
| GET | `/v1/harvest/:jobId` | reader | Get job status + candidates list |
| POST | `/v1/harvest/:jobId/validate` | expert | Validate candidates: accepted/modified/merged/rejected. Commits accepted as draft fragments. |

### POST /v1/harvest

Request: `multipart/form-data`
- `files`: one or more .docx files
- `options`: JSON string `{ "min_confidence": 0.65 }`

Response:
```json
{
  "data": {
    "job_id": "hrv-<uuid>",
    "status": "processing",
    "files": ["proposition-2024.docx"]
  }
}
```

### GET /v1/harvest/:jobId

Response:
```json
{
  "data": {
    "id": "hrv-xxx",
    "status": "done",
    "stats": { "total": 18, "duplicates": 3, "low_confidence": 2, "valid": 13 },
    "candidates": [
      {
        "id": "cand-xxx",
        "title": "Introduction souveraineté numérique",
        "body": "Dans un contexte où...",
        "type": "introduction",
        "domain": "souveraineté",
        "lang": "fr",
        "tags": ["souveraineté", "europe"],
        "confidence": 0.87,
        "origin_source": "proposition-2024.docx",
        "origin_page": 2,
        "duplicate_of": null,
        "duplicate_score": null,
        "status": "pending"
      }
    ]
  }
}
```

### POST /v1/harvest/:jobId/validate

Request:
```json
{
  "accepted": ["cand-xxx", "cand-yyy"],
  "modified": [{ "id": "cand-zzz", "title": "...", "domain": "...", "body": "..." }],
  "merged": [{ "candidate": "cand-aaa", "into": "frag-existing-bbb" }],
  "rejected": ["cand-bbb"]
}
```

Response:
```json
{
  "data": { "committed": 12, "merged": 2, "rejected": 4 }
}
```

## Frontend — Vue Ingestion

6th page at route `/harvest`. Add to sidebar navigation.

### Phase 1 — Upload

- Drag-and-drop zone for .docx files
- Slider "Confiance minimum" (50-95%, default 65%)
- Button "Analyser les documents" → `POST /v1/harvest`
- Loading state: poll `GET /v1/harvest/:jobId` every 2s until `status: done`
- Show progress indicator during processing

### Phase 2 — Candidate review

**Stats row (4 Cards):**
- Total candidats
- Doublons (rouge badge)
- Faible confiance (ambre badge)
- Valides (vert badge)

**Candidate list:**
- Card per candidate with:
  - Title (bold)
  - Badges: type, lang
  - Confidence badge (color-coded: green ≥80%, amber 65-79%, red <65%)
  - Duplicate warning badge if `duplicate_of` not null: "doublon probable · {fragment_id}"
  - Body excerpt (110 chars)
  - Accept button (green) / Reject button (red)
  - Visual state: accepted=green bg, rejected=grayed out, pending=default

**Global actions:**
- "Tout accepter" / "Tout rejeter" buttons
- "Commiter les acceptés" button → `POST /v1/harvest/:jobId/validate`

**Success state:**
- Message "N fragments committés en draft"
- Link "Aller à la Validation →" (navigate to /validation)

### TanStack Query hooks

```typescript
useHarvestJob(jobId)        → GET /v1/harvest/:jobId (poll while processing)
useStartHarvest()           → POST /v1/harvest (mutation)
useValidateCandidates()     → POST /v1/harvest/:jobId/validate (mutation)
```

## CLI

```bash
fragmint harvest <file.docx> [--min-confidence 0.65] [--json]
```

- Uploads file via `POST /v1/harvest`
- Polls `GET /v1/harvest/:jobId` until done
- Displays candidates with confidence scores
- `--json` outputs raw JSON result

## MCP Tool

`fragment_harvest` — 8th MCP tool:
- Parameters: `file_path` (string, path to .docx), `min_confidence` (number, optional, default 0.65)
- Reads file from disk, uploads to API
- Returns: `{ job_id, candidates_count, stats }`
- Note: validation remains human (via frontend or CLI)

## Docker

Add Pandoc to Dockerfile:

```dockerfile
RUN apk add --no-cache python3 make g++ git pandoc
```

Add LLM config env vars to docker-compose.yml:

```yaml
FRAGMINT_LLM_ENDPOINT: http://ollama:11434/v1
FRAGMINT_LLM_MODEL: mistral-nemo:12b
```

## Config

Add to `packages/server/src/config.ts`:

```typescript
llm_endpoint: string;    // FRAGMINT_LLM_ENDPOINT, default 'http://localhost:11434/v1'
llm_model: string;       // FRAGMINT_LLM_MODEL, default 'mistral-nemo:12b'
llm_temperature: number; // FRAGMINT_LLM_TEMPERATURE, default 0.2
llm_timeout: number;     // FRAGMINT_LLM_TIMEOUT, default 60000
```

## Testing Strategy

| Layer | Tests | Description |
|-------|-------|-------------|
| Unit | LlmClient | Mock fetch, verify prompts, parse JSON responses, handle malformed responses |
| Unit | HarvesterService | Mock LlmClient + SearchService, verify pipeline flow (extraction → candidates) |
| Unit | Pre-processing | Clean markdown, detect language, extract blocks by markers |
| Integration | Harvest routes | Upload .docx → GET job → validate → fragments created |
| Frontend | CandidateCard | Confidence color, duplicate badge, accept/reject buttons |
| Frontend | HarvestPage | Upload flow, candidate list rendering |

**Target:** ~15-20 new tests.

**LLM mocking strategy:** Unit tests mock `LlmClient` entirely (no actual Ollama calls). Integration tests also mock LlmClient. Real LLM testing is manual.

## Deliverables

1. `LlmClient` service (Ollama/OpenAI compatible)
2. `HarvesterService` (pipeline orchestrator)
3. SQLite tables: `harvest_jobs` + `harvest_candidates`
4. 3 API endpoints (`/v1/harvest/*`)
5. Vue Ingestion frontend (upload + candidate review)
6. CLI `fragmint harvest`
7. MCP tool `fragment_harvest`
8. Pandoc in Dockerfile
9. LLM config (env vars + config.ts)
10. Tests (~15-20)

## File Structure

### Create
- `packages/server/src/services/llm-client.ts`
- `packages/server/src/services/harvester-service.ts`
- `packages/server/src/routes/harvest-routes.ts`
- `packages/server/src/services/llm-client.test.ts`
- `packages/server/src/services/harvester-service.test.ts`
- `packages/server/src/routes/harvest.integration.test.ts`
- `packages/web/src/pages/harvest.tsx`
- `packages/web/src/components/candidate-card.tsx`
- `packages/web/src/api/hooks/use-harvest.ts`
- `packages/cli/src/commands/harvest.ts`
- `packages/mcp/src/tools/fragment-harvest.ts`

### Modify
- `packages/server/src/db/schema.ts` — add harvest tables
- `packages/server/src/db/connection.ts` — add CREATE TABLE statements
- `packages/server/src/config.ts` — add LLM config
- `packages/server/src/index.ts` — wire HarvesterService + harvest routes
- `packages/web/src/App.tsx` — add /harvest route
- `packages/web/src/layouts/app-layout.tsx` — add Ingestion nav item
- `packages/cli/src/index.ts` — register harvest command
- `packages/mcp/src/index.ts` — register fragment_harvest tool
- `Dockerfile` — add pandoc
- `docker-compose.yml` — add LLM env vars
