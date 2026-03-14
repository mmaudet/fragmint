# Phase 7: Fragment Harvester DOCX Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a DOCX ingestion pipeline that extracts fragments using LLM-powered segmentation and classification, with deduplication and human review via a frontend Ingestion view.

**Architecture:** HarvesterService orchestrates a pipeline: Pandoc (docx→markdown) → LLM segmentation → LLM classification → vectorial deduplication → candidate storage → human review → fragment commit. LlmClient wraps Ollama/OpenAI API. Frontend adds a 6th page for upload + candidate review.

**Tech Stack:** Pandoc (binary), Ollama (LLM via OpenAI-compatible API), Milvus (optional dedup), Fastify multipart, React + shadcn/ui

**Spec:** `docs/superpowers/specs/2026-03-14-fragmint-phase7-design.md`

---

## Chunk 1: Data Model + Config + LlmClient

### Task 1: Add harvest tables + LLM config

**Files:**
- Modify: `packages/server/src/db/schema.ts`
- Modify: `packages/server/src/db/connection.ts`
- Modify: `packages/server/src/config.ts`

- [ ] **Step 1: Read existing schema.ts, connection.ts, and config.ts to understand patterns**

- [ ] **Step 2: Add harvest_jobs and harvest_candidates tables to schema.ts**

```typescript
export const harvestJobs = sqliteTable('harvest_jobs', {
  id: text('id').primaryKey(),
  status: text('status').notNull(),          // processing | done | error
  files: text('files').notNull(),            // JSON array of filenames
  pipeline: text('pipeline').notNull(),      // "docx"
  min_confidence: real('min_confidence').notNull(),
  stats: text('stats'),                      // JSON { total, duplicates, low_confidence, valid }
  error: text('error'),
  created_by: text('created_by').notNull(),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});

export const harvestCandidates = sqliteTable('harvest_candidates', {
  id: text('id').primaryKey(),
  job_id: text('job_id').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  type: text('type').notNull(),
  domain: text('domain').notNull(),
  lang: text('lang').notNull(),
  tags: text('tags'),                        // JSON array
  confidence: real('confidence').notNull(),
  origin_source: text('origin_source').notNull(),
  origin_page: integer('origin_page'),
  duplicate_of: text('duplicate_of'),
  duplicate_score: real('duplicate_score'),
  status: text('status').notNull().default('pending'), // pending | accepted | rejected | merged
  fragment_id: text('fragment_id'),
});
```

- [ ] **Step 3: Add CREATE TABLE statements in connection.ts**

Follow the existing pattern (CREATE TABLE IF NOT EXISTS).

- [ ] **Step 4: Add LLM config to config.ts**

```typescript
llm_endpoint: string;    // FRAGMINT_LLM_ENDPOINT, default 'http://localhost:11434/v1'
llm_model: string;       // FRAGMINT_LLM_MODEL, default 'mistral-nemo:12b'
llm_temperature: number; // FRAGMINT_LLM_TEMPERATURE, default 0.2
llm_timeout: number;     // FRAGMINT_LLM_TIMEOUT, default 60000
```

- [ ] **Step 5: Verify server starts**

```bash
cd /Users/mmaudet/work/fragmint/packages/server && npx vitest run
```

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/db/ packages/server/src/config.ts
git commit -m "feat(db): add harvest_jobs and harvest_candidates tables + LLM config"
```

### Task 2: Implement LlmClient

**Files:**
- Create: `packages/server/src/services/llm-client.ts`
- Create: `packages/server/src/services/llm-client.test.ts`

- [ ] **Step 1: Create LlmClient**

```typescript
import { setTimeout } from 'node:timers/promises';

export interface LlmClientConfig {
  endpoint: string;
  model: string;
  temperature: number;
  timeout: number;
}

export interface SegmentBlock {
  start_marker: string;
  end_marker: string;
  type_candidate: string;
  confidence: number;
}

export interface Classification {
  type: string;
  domain: string;
  lang: string;
  tags: string[];
  title: string;
  confidence: number;
}

const SEGMENTATION_PROMPT = `Tu analyses un document professionnel converti en Markdown.
Identifie les blocs de contenu autonomes et réutilisables —
c'est-à-dire les parties qui pourraient exister indépendamment
du document source et être réutilisées dans d'autres documents.

Types de blocs à identifier : introduction, argument, clause,
pricing, conclusion, faq, bio, témoignage.

Pour chaque bloc, retourne un JSON array (et rien d'autre) :
[{
  "start_marker": "les 10 premiers mots du bloc",
  "end_marker": "les 10 derniers mots du bloc",
  "type_candidate": "type probable",
  "confidence": 0.0-1.0
}]

Document :
`;

const CLASSIFICATION_PROMPT_PREFIX = `Bloc de contenu :
`;

const CLASSIFICATION_PROMPT_SUFFIX = `

Retourne un seul objet JSON (et rien d'autre) :
{
  "type": "...",
  "domain": "...",
  "lang": "fr ou en",
  "tags": ["..."],
  "title": "titre court proposé",
  "confidence": 0.0-1.0
}`;

export class LlmClient {
  constructor(private config: LlmClientConfig) {}

  async segment(markdown: string): Promise<SegmentBlock[]> {
    const content = SEGMENTATION_PROMPT + markdown;
    const response = await this.chat(content);
    return this.parseJsonArray<SegmentBlock>(response);
  }

  async classify(
    blockText: string,
    existingTypes: string[],
    existingDomains: string[],
  ): Promise<Classification> {
    const typesLine = `\nTypes disponibles : ${existingTypes.join(', ')}`;
    const domainsLine = `\nDomaines disponibles : ${existingDomains.join(', ')}`;
    const content = CLASSIFICATION_PROMPT_PREFIX + blockText + typesLine + domainsLine + CLASSIFICATION_PROMPT_SUFFIX;
    const response = await this.chat(content);
    return this.parseJsonObject<Classification>(response);
  }

  private async chat(content: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(this.config.timeout).then(() => controller.abort());

    try {
      const res = await fetch(`${this.config.endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: 'user', content }],
          temperature: this.config.temperature,
        }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`LLM API error: ${res.status} ${res.statusText}`);
      const json = await res.json();
      return json.choices?.[0]?.message?.content ?? '';
    } finally {
      // Cancel the timeout timer
    }
  }

  private parseJsonArray<T>(text: string): T[] {
    try {
      const match = text.match(/\[[\s\S]*\]/);
      if (match) return JSON.parse(match[0]);
    } catch {}
    return [];
  }

  private parseJsonObject<T>(text: string): T {
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
    } catch {}
    // Return low-confidence fallback
    return { type: 'argument', domain: 'unknown', lang: 'fr', tags: [], title: 'Untitled', confidence: 0.1 } as T;
  }
}
```

- [ ] **Step 2: Write tests**

Tests with mocked fetch:
1. `segment()` sends correct prompt, parses JSON array response
2. `segment()` returns empty array on malformed response
3. `classify()` sends correct prompt with types/domains, parses JSON object
4. `classify()` returns low-confidence fallback on parse error

Use `vi.stubGlobal('fetch', ...)` to mock fetch.

- [ ] **Step 3: Run tests**

```bash
cd /Users/mmaudet/work/fragmint/packages/server && npx vitest run src/services/llm-client.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/llm-client.ts packages/server/src/services/llm-client.test.ts
git commit -m "feat(server): add LlmClient for Ollama/OpenAI segmentation and classification"
```

---

## Chunk 2: HarvesterService

### Task 3: Implement HarvesterService

**Files:**
- Create: `packages/server/src/services/harvester-service.ts`
- Create: `packages/server/src/services/harvester-service.test.ts`

- [ ] **Step 1: Read existing services for patterns**

Read `fragment-service.ts` and `composer-service.ts` for constructor/db/audit patterns.

- [ ] **Step 2: Create HarvesterService**

Constructor takes: `db`, `llmClient`, `searchService`, `fragmentService`, `storePath`.

**Methods:**

`harvest(files: Buffer[], filenames: string[], options: { min_confidence: number }, userId: string): Promise<string>`
- Creates job in harvest_jobs (status: processing)
- Runs pipeline async (setImmediate or similar — don't block the request)
- Returns job_id immediately

`_runPipeline(jobId: string, files: Buffer[], filenames: string[], minConfidence: number): Promise<void>` (private)
- For each file:
  1. Write buffer to temp file
  2. Run `pandoc --from docx --to markdown <tempfile>` via execFile
  3. Pre-process: strip repeated header/footer patterns, normalize whitespace
  4. Detect language via simple heuristic (count French stop words vs English)
  5. Call `llmClient.segment(markdown)`
  6. For each block: extract text from markdown using start/end markers (fuzzy match first 10 words)
  7. Filter blocks with confidence >= min_confidence
  8. For each block: call `llmClient.classify(blockText, existingTypes, existingDomains)`
  9. If search service has Milvus: embed block, search top-1 similar, set duplicate_of/duplicate_score
  10. Insert into harvest_candidates
- Compute stats
- Update job status to done (or error with message)

`getJob(jobId: string): Promise<job + candidates>`
- Query harvest_jobs + harvest_candidates

`validate(jobId: string, validation, userId: string): Promise<{ committed, merged, rejected }>`
- For accepted: create fragment via FragmentService.create() with origin: 'harvested'
- For modified: create with modified fields
- For merged: update existing fragment (not implemented for MVP — just mark as merged)
- For rejected: update candidate status
- Update candidate.fragment_id for committed ones

**Helper functions:**

`extractBlockText(markdown: string, startMarker: string, endMarker: string): string`
- Find the position of start_marker (fuzzy: first 10 words) in the markdown
- Find the position of end_marker after start
- Return the text between them

`detectLanguage(text: string): string`
- Count French stop words (le, la, les, de, du, des, un, une, est, sont, dans, pour, avec, qui, que)
- Count English stop words (the, is, are, of, in, to, for, with, and, that, this, from)
- Return 'fr' if French count > English, else 'en'

- [ ] **Step 3: Write tests**

Mock LlmClient, SearchService:
1. `extractBlockText` correctly extracts text between markers
2. `detectLanguage` returns 'fr' for French text
3. `detectLanguage` returns 'en' for English text
4. `getJob` returns job with candidates
5. `validate` with accepted candidates creates fragments

Don't test `_runPipeline` directly (requires Pandoc + LLM) — test the helpers and validate.

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/services/harvester-service.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/harvester-service.ts packages/server/src/services/harvester-service.test.ts
git commit -m "feat(server): add HarvesterService with pipeline orchestration"
```

---

## Chunk 3: API Routes + Server Wiring

### Task 4: Implement harvest routes

**Files:**
- Create: `packages/server/src/routes/harvest-routes.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Read existing route patterns**

Read `template-routes.ts` for multipart upload pattern and `fragment-routes.ts` for general patterns.

- [ ] **Step 2: Create harvest-routes.ts**

3 endpoints:

`POST /v1/harvest` (expert role):
- Parse multipart: extract .docx files + options JSON field
- Call `harvesterService.harvest(files, filenames, options, user.login)`
- Return 202 `{ data: { job_id, status: 'processing', files: [...] } }`

`GET /v1/harvest/:jobId` (reader role):
- Call `harvesterService.getJob(jobId)`
- Return job with candidates

`POST /v1/harvest/:jobId/validate` (expert role):
- Parse JSON body: `{ accepted[], modified[], merged[], rejected[] }`
- Call `harvesterService.validate(jobId, body, user.login)`
- Return `{ data: { committed, merged, rejected } }`

- [ ] **Step 3: Wire in index.ts**

Read index.ts. Add:
- Import LlmClient, HarvesterService, harvestRoutes
- Create LlmClient with config
- Create HarvesterService with db, llmClient, searchService, fragmentService, storePath
- Register harvestRoutes

- [ ] **Step 4: Verify server starts**

```bash
npx tsx src/index.ts &
sleep 3
curl -s http://localhost:3210/v1/harvest/hrv-nonexistent -H "Authorization: Bearer <token>"
kill %1
```
Should return 404 or similar (proves route is registered).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/harvest-routes.ts packages/server/src/index.ts
git commit -m "feat(server): add harvest API routes and wire HarvesterService"
```

### Task 5: Integration test for harvest routes

**Files:**
- Create: `packages/server/src/routes/harvest.integration.test.ts`

- [ ] **Step 1: Write integration test**

Test the validate flow (skip the full pipeline — it requires Pandoc + LLM):
1. Manually insert a harvest_job and harvest_candidates in the DB
2. Call `POST /v1/harvest/:jobId/validate` with accepted candidates
3. Verify fragments were created with origin: 'harvested'

Also test `GET /v1/harvest/:jobId` returns candidates.

- [ ] **Step 2: Run tests**

```bash
npx vitest run src/routes/harvest.integration.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/routes/harvest.integration.test.ts
git commit -m "test(server): add harvest routes integration test"
```

---

## Chunk 4: Frontend Ingestion View

### Task 6: TanStack Query hooks for harvest

**Files:**
- Create: `packages/web/src/api/hooks/use-harvest.ts`
- Modify: `packages/web/src/api/types.ts`

- [ ] **Step 1: Add harvest types**

Add to `packages/web/src/api/types.ts`:

```typescript
export interface HarvestJob {
  id: string;
  status: 'processing' | 'done' | 'error';
  files: string[];
  stats: { total: number; duplicates: number; low_confidence: number; valid: number } | null;
  error: string | null;
  created_at: string;
}

export interface HarvestCandidate {
  id: string;
  job_id: string;
  title: string;
  body: string;
  type: string;
  domain: string;
  lang: string;
  tags: string[];
  confidence: number;
  origin_source: string;
  origin_page: number | null;
  duplicate_of: string | null;
  duplicate_score: number | null;
  status: 'pending' | 'accepted' | 'rejected' | 'merged';
}

export interface HarvestJobWithCandidates extends HarvestJob {
  candidates: HarvestCandidate[];
}

export interface ValidateResult {
  committed: number;
  merged: number;
  rejected: number;
}
```

- [ ] **Step 2: Create hooks**

```typescript
export function useHarvestJob(jobId: string | null) {
  return useQuery({
    queryKey: ['harvest-job', jobId],
    queryFn: () => apiRequest<HarvestJobWithCandidates>('GET', `/v1/harvest/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (query) => {
      // Poll every 2s while processing
      return query.state.data?.status === 'processing' ? 2000 : false;
    },
  });
}

export function useStartHarvest() { /* mutation, multipart upload */ }
export function useValidateCandidates() { /* mutation POST validate */ }
```

The `useStartHarvest` mutation needs to send multipart form data (files + options). Use FormData like the template upload.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/api/
git commit -m "feat(web): add harvest types and TanStack Query hooks"
```

### Task 7: CandidateCard component + HarvestPage

**Files:**
- Create: `packages/web/src/components/candidate-card.tsx`
- Create: `packages/web/src/pages/harvest.tsx`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/layouts/app-layout.tsx`
- Modify: `packages/web/src/lib/i18n.tsx`

- [ ] **Step 1: Add i18n keys for harvest**

Add `harvest` section to both `fr` and `en` translations in `i18n.tsx`:

```typescript
harvest: {
  title: 'Ingestion',
  uploadTitle: 'Importer des documents',
  dropzone: 'Glisser des fichiers ici ou cliquer pour sélectionner',
  formats: '.docx supporté · .pptx · .xlsx · .pdf prochainement',
  confidence: 'Confiance minimum',
  analyze: 'Analyser les documents',
  analyzing: 'Analyse en cours...',
  total: 'Total candidats',
  duplicates: 'Doublons',
  lowConfidence: 'Faible confiance',
  valid: 'Valides',
  acceptAll: 'Tout accepter',
  rejectAll: 'Tout rejeter',
  commit: 'Commiter les acceptés',
  committed: 'fragments committés en draft',
  goToValidation: 'Aller à la Validation',
  duplicateWarning: 'doublon probable',
  noFragment: 'Aucun fragment',
  accept: 'Accepter',
  reject: 'Rejeter',
},
```

And English:
```typescript
harvest: {
  title: 'Ingestion',
  uploadTitle: 'Import documents',
  dropzone: 'Drop files here or click to select',
  formats: '.docx supported · .pptx · .xlsx · .pdf coming soon',
  confidence: 'Minimum confidence',
  analyze: 'Analyze documents',
  analyzing: 'Analyzing...',
  total: 'Total candidates',
  duplicates: 'Duplicates',
  lowConfidence: 'Low confidence',
  valid: 'Valid',
  acceptAll: 'Accept all',
  rejectAll: 'Reject all',
  commit: 'Commit accepted',
  committed: 'fragments committed as draft',
  goToValidation: 'Go to Validation',
  duplicateWarning: 'probable duplicate',
  noFragment: 'No fragment',
  accept: 'Accept',
  reject: 'Reject',
},
```

- [ ] **Step 2: Create CandidateCard component**

Props: `candidate: HarvestCandidate`, `onAccept: () => void`, `onReject: () => void`

Displays:
- Title (bold)
- Badges: type, lang
- Confidence badge (green ≥80%, amber 65-79%, red <65%)
- Duplicate warning badge if `duplicate_of` not null
- Body excerpt (110 chars)
- Accept/Reject buttons (hidden if status !== 'pending')
- Visual state: accepted = green bg, rejected = opacity-50, pending = default

- [ ] **Step 3: Create HarvestPage**

Two-phase page:

**Phase 1 — Upload:**
- File input (accept=".docx") with drag-and-drop styling
- Slider for min confidence (50-95, default 65)
- Button "Analyser" → calls useStartHarvest mutation
- After mutation: store jobId, poll with useHarvestJob

**Phase 2 — Review (when job.status === 'done'):**
- Stats row: 4 Cards (total, duplicates in red, low confidence in amber, valid in green)
- Candidate list: CandidateCard for each
- Local state tracks accept/reject per candidate (not API calls until commit)
- "Tout accepter" / "Tout rejeter" buttons set all to accepted/rejected
- "Commiter" button → calls useValidateCandidates with the accepted/rejected arrays
- Success: show committed count + link to /validation

- [ ] **Step 4: Add route and nav item**

In `App.tsx`: add `/harvest` route inside ProtectedRoute.
In `app-layout.tsx`: add nav item with Upload icon (Lucide `Upload`).

- [ ] **Step 5: Add nav label to i18n**

Add `harvest: 'Ingestion'` / `harvest: 'Ingestion'` to the `nav` section.

- [ ] **Step 6: Verify build**

```bash
cd /Users/mmaudet/work/fragmint/packages/web && pnpm build
```

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/
git commit -m "feat(web): add Ingestion page with upload, candidate review, and commit flow"
```

---

## Chunk 5: CLI + MCP + Docker + Final

### Task 8: CLI harvest command

**Files:**
- Create: `packages/cli/src/commands/harvest.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/client.ts`

- [ ] **Step 1: Add uploadHarvest method to client.ts**

Similar to `uploadTemplate()` — send multipart with .docx file + options.

```typescript
async uploadHarvest(filePath: string, minConfidence: number): Promise<{ job_id: string }> {
  const { readFileSync } = await import('node:fs');
  const { basename } = await import('node:path');
  const form = new FormData();
  form.append('files', new Blob([readFileSync(filePath)]), basename(filePath));
  form.append('options', JSON.stringify({ min_confidence: minConfidence }));
  // ... fetch POST /v1/harvest with form
}
```

- [ ] **Step 2: Create harvest command**

```bash
fragmint harvest <file.docx> [--min-confidence 0.65] [--json]
```

Flow:
1. Upload file → get job_id
2. Poll `GET /v1/harvest/:jobId` every 2s until done
3. Display candidates with confidence scores
4. If `--json`: output raw JSON

- [ ] **Step 3: Register in index.ts**

- [ ] **Step 4: Commit**

```bash
git add packages/cli/
git commit -m "feat(cli): add harvest command for DOCX ingestion"
```

### Task 9: MCP tool fragment_harvest

**Files:**
- Create: `packages/mcp/src/tools/fragment-harvest.ts`
- Modify: `packages/mcp/src/index.ts`

- [ ] **Step 1: Create fragment_harvest tool**

Similar pattern to document_compose:
- Read file from `file_path` parameter
- Upload to `/v1/harvest` as multipart
- Poll job until done
- Return candidates count + stats

Parameters:
- `file_path` (string, required) — path to .docx file
- `min_confidence` (number, optional, default 0.65)

- [ ] **Step 2: Register in index.ts**

- [ ] **Step 3: Commit**

```bash
git add packages/mcp/
git commit -m "feat(mcp): add fragment_harvest tool (8th MCP tool)"
```

### Task 10: Docker updates

**Files:**
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add pandoc to Dockerfile**

In both builder and runtime stages, add pandoc to the `apk add` line:

```dockerfile
RUN apk add --no-cache python3 make g++ git pandoc
```

- [ ] **Step 2: Add LLM env vars to docker-compose.yml**

```yaml
FRAGMINT_LLM_ENDPOINT: http://ollama:11434/v1
FRAGMINT_LLM_MODEL: mistral-nemo:12b
```

- [ ] **Step 3: Commit**

```bash
git add Dockerfile docker-compose.yml
git commit -m "feat(docker): add pandoc and LLM config for harvester"
```

### Task 11: Run all tests

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

- [ ] **Step 4: Fix any failures**

---

## Task Dependencies

```
Task 1 (DB + config) → Task 2 (LlmClient)
Task 1 + Task 2 → Task 3 (HarvesterService)
Task 3 → Task 4 (routes + wiring)
Task 4 → Task 5 (integration test)
Task 4 → Task 6 (frontend hooks)
Task 6 → Task 7 (frontend page)
Task 4 → Task 8 (CLI)
Task 4 → Task 9 (MCP)
Task 4 → Task 10 (Docker)
All → Task 11 (final verification)
```

Tasks 1+2 are sequential. Task 3 depends on both.
After Task 4 (wiring), Tasks 5-10 can run in parallel.
Task 7 depends on Task 6.
Task 11 after all.
