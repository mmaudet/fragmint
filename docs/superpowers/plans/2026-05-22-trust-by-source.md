# Trust by Source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add upload hints to the harvest pipeline so metadata supplied by the uploader gets tagged `human-direct`/`llm-confirmed`/`llm-deviation`/`llm-inferred`, auto-validating trusted proposals and surfacing deviations in the admin queue.

**Architecture:** `UploadHints` are parsed from the harvest multipart form and stored on `harvest_jobs`. During the LLM pipeline, each classified metadata field is assigned a `TrustSource`. New metadata proposals are auto-approved when `trust_source` is `human-direct` or `llm-confirmed`; others go to the admin queue. After ingestion, the commercial user sees a simplified debrief. The admin validates all candidates in a new `/admin/harvest` tab — trust badges (high/mixed/low) allow fast bulk-approval of high-confidence fragments. All fragments are created with `quality='draft'` regardless of trust; the admin then drives the `draft → reviewed → approved` workflow.

**Role split:**
- Commercial (ingestor): uploads a document, fills optional hints, sees simplified debrief
- Admin: validates candidates in `/admin/harvest` with trust badges + bulk action, then drives `draft → reviewed → approved`

**Tech Stack:** Fastify 5 · Drizzle ORM (SQLite, ALTER TABLE pattern) · Vitest · React 19 · TanStack Query · shadcn/ui · TypeScript · react-router-dom

---

## File Map

### Server (`packages/server/src/`)
| File | Action | Purpose |
|------|--------|---------|
| `db/connection.ts` | Modify | 10 `ALTER TABLE` blocks for new columns |
| `db/schema.ts` | Modify | Add new fields to all affected Drizzle table definitions |
| `schema/trust-source.ts` | **Create** | `TrustSource` type, `UploadHints` interface, `determineTrustSource()` |
| `routes/harvest-routes.ts` | Modify | Parse `upload_hints` from multipart; add `GET .../debrief` endpoint |
| `services/harvester-service.ts` | Modify | Thread hints through pipeline; compute trust_sources; auto-validate proposals |
| `services/llm-client.ts` | Modify | `segmentAndClassify()` accepts hints and injects them into the system prompt |
| `routes/admin-metadata-routes.ts` | Modify | `GET /v1/admin/references/lookup`; expose `trust_source` on proposals; add filter |

### Web (`packages/web/src/`)
| File | Action | Purpose |
|------|--------|---------|
| `types/trust-source.ts` | **Create** | `TrustSource`, `UploadHints` types for web |
| `types/admin-metadata.ts` | Modify | Add `trust_source?: TrustSource` to `MetadataProposal` |
| `api/types.ts` | Modify | Add `upload_hints?: UploadHints` to `HarvestJobWithCandidates` |
| `lib/use-debounced-value.ts` | **Create** | `useDebouncedValue<T>` hook |
| `api/hooks/use-harvest.ts` | Modify | Pass `upload_hints` in FormData |
| `api/hooks/use-reference-lookup.ts` | **Create** | `useReferenceLookup(kind, q)` for autocomplete |
| `api/hooks/use-harvest-debrief.ts` | **Create** | `useHarvestDebrief(jobId)` |
| `api/hooks/use-metadata-proposals.ts` | Modify | Add `trust_source` filter param |
| `components/harvest/autocomplete-select.tsx` | **Create** | Single-value strict autocomplete |
| `components/harvest/multi-autocomplete-select.tsx` | **Create** | Multi-value strict autocomplete |
| `components/harvest/entity-selector.tsx` | **Create** | EntityType + name picker |
| `components/harvest/upload-hints-form.tsx` | **Create** | Hints form section for upload page |
| `pages/harvest.tsx` | Modify | Upload form + hints; navigate to simplified debrief after start. Candidate validation removed. |
| `pages/harvest-debrief.tsx` | **Create** | Commercial simplified debrief: fragment count + 'admin will validate' message |
| `App.tsx` | Modify | Add `/harvest/:jobId/debrief` route |
| `components/admin/metadata/proposal-card.tsx` | Modify | Add `TrustSourceBadge` |
| `components/admin/metadata/proposals-list.tsx` | Modify | Add trust_source filter buttons |
| `layouts/admin-layout.tsx` | Modify | Add "Harvest" nav item between Metadata and Relations |
| `pages/admin/harvest.tsx` | **Create** | Candidate validation page with trust badges, filters, bulk accept |
| `pages/admin/harvest-job.tsx` | **Create** | Admin debrief detail for a single job |
| `components/admin/harvest/trust-badge.tsx` | **Create** | TrustBadge component (high/mixed/low) |
| `api/hooks/use-admin-harvest.ts` | **Create** | `usePendingCandidates`, `useBulkAcceptCandidates` hooks |

---

## Task 1: DB Schema Additions

**Files:**
- Modify: `packages/server/src/db/connection.ts`
- Modify: `packages/server/src/db/schema.ts`

### Background

The project uses `ALTER TABLE ... ADD COLUMN` with `try/catch` to add columns to existing databases (see lines 155–260 of `connection.ts`). The `CREATE TABLE IF NOT EXISTS` blocks are NOT updated — only `ALTER TABLE` blocks are added. `schema.ts` must be kept in sync with the logical column set (including all ALTER TABLE additions).

The `trust_source` column on referential tables (`fragment_types`, `fragment_domains`, `fragment_tags`, `fragment_functions`, `entities`) tracks how each item was proposed. Default is `'human-direct'` (backfills existing admin-created rows correctly since they were all human-managed).

- [ ] **Step 1: Add ALTER TABLE blocks to connection.ts**

Append these try/catch blocks AFTER the existing ones (after line ~260, before `const db = drizzle(...)`):

```typescript
  // Trust by Source — referential tables
  try {
    sqlite.exec("ALTER TABLE fragment_types ADD COLUMN trust_source TEXT NOT NULL DEFAULT 'human-direct'");
  } catch (_) {}
  try {
    sqlite.exec("ALTER TABLE fragment_domains ADD COLUMN trust_source TEXT NOT NULL DEFAULT 'human-direct'");
  } catch (_) {}
  try {
    sqlite.exec("ALTER TABLE fragment_tags ADD COLUMN trust_source TEXT NOT NULL DEFAULT 'human-direct'");
  } catch (_) {}
  try {
    sqlite.exec("ALTER TABLE fragment_functions ADD COLUMN trust_source TEXT NOT NULL DEFAULT 'human-direct'");
  } catch (_) {}
  try {
    sqlite.exec("ALTER TABLE entities ADD COLUMN trust_source TEXT NOT NULL DEFAULT 'human-direct'");
  } catch (_) {}

  // Trust by Source — harvest_candidates
  try {
    sqlite.exec('ALTER TABLE harvest_candidates ADD COLUMN trust_sources_json TEXT');
  } catch (_) {}

  // Trust by Source — harvest_jobs (upload hints)
  try {
    sqlite.exec('ALTER TABLE harvest_jobs ADD COLUMN upload_hints TEXT');
  } catch (_) {}

  // Trust by Source — audit_log enrichment
  try {
    sqlite.exec('ALTER TABLE audit_log ADD COLUMN entity_type TEXT');
  } catch (_) {}
  try {
    sqlite.exec('ALTER TABLE audit_log ADD COLUMN entity_id TEXT');
  } catch (_) {}
```

- [ ] **Step 2: Update schema.ts — referential tables**

Add `trustSource` field to `fragmentTypes`, `fragmentDomains`, `fragmentTags`, `fragmentFunctions`, `entities`:

```typescript
// fragmentTypes (line ~182)
export const fragmentTypes = sqliteTable('fragment_types', {
  slug: text('slug').primaryKey(),
  label: text('label').notNull(),
  description: text('description'),
  created_at: text('created_at').notNull(),
  validated: integer('validated').notNull().default(1),
  usageCount: integer('usage_count').notNull().default(0),
  proposedBy: text('proposed_by').notNull().default('admin'),
  trustSource: text('trust_source').notNull().default('human-direct'),
});

// Same pattern for fragmentDomains, fragmentTags, fragmentFunctions, entities
// Each gets: trustSource: text('trust_source').notNull().default('human-direct'),
```

- [ ] **Step 3: Update schema.ts — harvestCandidates + harvestJobs + auditLog**

```typescript
// harvestCandidates: add trust_sources_json after metadata_status
export const harvestCandidates = sqliteTable('harvest_candidates', {
  // ... existing fields ...
  metadata_status: text('metadata_status'),
  trust_sources_json: text('trust_sources_json'),  // NEW
});

// harvestJobs: add upload_hints after updated_at
export const harvestJobs = sqliteTable('harvest_jobs', {
  // ... existing fields ...
  updated_at: text('updated_at').notNull(),
  upload_hints: text('upload_hints'),  // NEW
});

// auditLog: add entity_type + entity_id after ip_source
export const auditLog = sqliteTable('audit_log', {
  // ... existing fields ...
  ip_source: text('ip_source'),
  entity_type: text('entity_type'),  // NEW
  entity_id: text('entity_id'),      // NEW
});
```

- [ ] **Step 4: Verify typecheck passes**

```bash
pnpm --filter @fragmint/server typecheck
```
Expected: no errors.

---

## Task 2: Server-Side Types — trust-source.ts

**Files:**
- Create: `packages/server/src/schema/trust-source.ts`
- Test: `packages/server/src/schema/__tests__/trust-source.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/server/src/schema/__tests__/trust-source.test.ts
import { describe, it, expect } from 'vitest';
import { determineTrustSource } from '../trust-source.js';

describe('determineTrustSource', () => {
  const referential = ['twake-mail', 'liveoffice', 'linshare'];

  it('returns llm-inferred when no hint provided', () => {
    expect(determineTrustSource(undefined, 'twake-mail', referential)).toBe('llm-inferred');
    expect(determineTrustSource(null, 'twake-mail', referential)).toBe('llm-inferred');
    expect(determineTrustSource('', 'twake-mail', referential)).toBe('llm-inferred');
  });

  it('returns human-direct when hint matches existing referential item', () => {
    expect(determineTrustSource('twake-mail', 'twake-mail', referential)).toBe('human-direct');
    expect(determineTrustSource('liveoffice', 'something-else', referential)).toBe('human-direct');
  });

  it('returns llm-confirmed when hint is new and LLM agrees', () => {
    expect(determineTrustSource('new-product', 'new-product', referential)).toBe('llm-confirmed');
  });

  it('returns llm-deviation when hint is given but LLM disagrees', () => {
    expect(determineTrustSource('new-product', 'other-thing', referential)).toBe('llm-deviation');
  });

  it('handles array hints: human-direct when all hints in referential', () => {
    expect(determineTrustSource(['twake-mail', 'liveoffice'], ['twake-mail', 'liveoffice'], referential)).toBe('human-direct');
  });

  it('handles array hints: llm-confirmed when hint arrays match exactly', () => {
    expect(determineTrustSource(['new-a', 'new-b'], ['new-a', 'new-b'], referential)).toBe('llm-confirmed');
  });

  it('handles array hints: llm-deviation when LLM adds or removes items', () => {
    expect(determineTrustSource(['new-a'], ['new-a', 'extra'], referential)).toBe('llm-deviation');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @fragmint/server test src/schema/__tests__/trust-source.test.ts
```
Expected: FAIL with "Cannot find module '../trust-source.js'"

- [ ] **Step 3: Create trust-source.ts**

```typescript
// packages/server/src/schema/trust-source.ts

export type TrustSource = 'human-direct' | 'llm-confirmed' | 'llm-deviation' | 'llm-inferred';

export interface UploadHints {
  domain?: string;
  function_type?: string;
  audience?: string[];
  maturity?: string;
  tags?: string[];
  entities?: string[];
}

export type TrustSourcesPerMetadata = Partial<Record<keyof UploadHints | 'type', TrustSource>>;

export function determineTrustSource(
  hint: string | string[] | null | undefined,
  llmValue: string | string[],
  existingReferential: string[],
): TrustSource {
  if (!hint || (Array.isArray(hint) && hint.length === 0) || hint === '') {
    return 'llm-inferred';
  }

  const hints = Array.isArray(hint) ? hint : [hint];
  const llmValues = Array.isArray(llmValue) ? llmValue : [llmValue];

  // If all hint values are already in the referential, human directly specified existing items
  const allInReferential = hints.every((h) => existingReferential.includes(h));
  if (allInReferential) {
    return 'human-direct';
  }

  // Hint provided but not fully in referential — check if LLM agrees with the hint exactly
  const hintSet = new Set(hints.map((h) => h.toLowerCase()));
  const llmSet = new Set(llmValues.map((v) => v.toLowerCase()));
  const setsMatch = hintSet.size === llmSet.size && [...hintSet].every((v) => llmSet.has(v));
  if (setsMatch) {
    return 'llm-confirmed';
  }

  return 'llm-deviation';
}

export function computeTrustSources(
  hints: UploadHints,
  block: {
    domain: string;
    function_type: string;
    audience: string[];
    maturity: string;
    tags: string[];
  },
  referential: {
    domains: string[];
    functions: string[];
    tags: string[];
  },
): TrustSourcesPerMetadata {
  return {
    domain: determineTrustSource(hints.domain, block.domain, referential.domains),
    function_type: determineTrustSource(hints.function_type, block.function_type, referential.functions),
    audience: determineTrustSource(hints.audience, block.audience, ['technical', 'decision-maker', 'user', 'legal']),
    maturity: determineTrustSource(hints.maturity, block.maturity, ['production', 'beta', 'roadmap', 'archive']),
    tags: determineTrustSource(hints.tags, block.tags, referential.tags),
  };
}

export function overallTrustSource(sources: TrustSourcesPerMetadata): TrustSource {
  const values = Object.values(sources).filter(Boolean) as TrustSource[];
  if (values.includes('llm-deviation')) return 'llm-deviation';
  if (values.includes('llm-inferred')) return 'llm-inferred';
  if (values.includes('llm-confirmed')) return 'llm-confirmed';
  return 'human-direct';
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @fragmint/server test src/schema/__tests__/trust-source.test.ts
```
Expected: 7 tests pass.

---

## Task 3: Harvest Pipeline — Hints + Trust Computation

**Files:**
- Modify: `packages/server/src/routes/harvest-routes.ts` (lines 36–80, multipart parsing)
- Modify: `packages/server/src/services/harvester-service.ts` (harvest() + _runPipeline())
- Modify: `packages/server/src/services/llm-client.ts` (segmentAndClassify())

### 3a — harvest-routes.ts: parse upload_hints

- [ ] **Step 1: Add upload_hints parsing to multipart loop**

In `harvest-routes.ts`, inside the `for await (const part of parts)` loop (around line 52), add a branch alongside the `options` branch:

```typescript
} else if (part.type === 'field' && part.fieldname === 'upload_hints') {
  try {
    uploadHints = JSON.parse(part.value as string);
  } catch {
    return reply.status(400).send({ data: null, meta: null, error: 'Invalid upload_hints JSON' });
  }
}
```

Also declare `let uploadHints: Record<string, unknown> | undefined;` before the loop, and pass it to `harvesterService.harvest()`:

```typescript
const jobId = await harvesterService.harvest(
  files,
  filenames,
  options,
  request.user.login,
  collectionSlug,
  uploadHints,
);
```

### 3b — harvester-service.ts: store hints + thread through pipeline

- [ ] **Step 2: Update harvest() signature and store upload_hints**

Change the `harvest()` signature to accept `uploadHints`:

```typescript
async harvest(
  files: Buffer[],
  filenames: string[],
  options: { min_confidence: number },
  userId: string,
  collectionSlug: string | null = null,
  uploadHints?: UploadHints,
): Promise<string> {
  const jobId = `hrv-${randomUUID()}`;
  const now = new Date().toISOString();

  await this.db.insert(harvestJobs).values({
    id: jobId,
    status: 'processing',
    files: JSON.stringify(filenames),
    pipeline: 'docx-pandoc-llm',
    min_confidence: options.min_confidence,
    collection_slug: collectionSlug,
    upload_hints: uploadHints ? JSON.stringify(uploadHints) : null,
    created_by: userId,
    created_at: now,
    updated_at: now,
  });

  setImmediate(() => {
    this._runPipeline(jobId, files, filenames, options.min_confidence, uploadHints ?? {}).catch(
      (err) => { console.error(`Pipeline error for job ${jobId}:`, err); },
    );
  });

  return jobId;
}
```

Add import at top of file:
```typescript
import { type UploadHints, computeTrustSources, overallTrustSource } from '../schema/trust-source.js';
```

- [ ] **Step 3: Update _runPipeline() signature**

Change signature to:
```typescript
async _runPipeline(
  jobId: string,
  files: Buffer[],
  filenames: string[],
  minConfidence: number,
  uploadHints: UploadHints = {},
): Promise<void> {
```

- [ ] **Step 4: Thread hints into segmentAndClassify call**

In `_runPipeline`, the `Promise.all` over chunks calls `this.llmClient.segmentAndClassify(...)`. Add `uploadHints` as the last argument:

```typescript
const result = await this.llmClient.segmentAndClassify(
  chunk,
  existingTypes,
  existingDomains,
  knownTags,
  domainHints,
  validFunctions,
  validEntityRows,
  uploadHints,    // NEW
);
```

- [ ] **Step 5: Compute trust_sources_json and store on each candidate**

After `blocks` is built (after `HarvesterService.deduplicateBlocks(...)`) and before the `await this.db.insert(harvestCandidates)` call, add:

```typescript
const trustSourcesPerBlock = blocks.map((block) =>
  computeTrustSources(
    uploadHints,
    {
      domain: block.domain,
      function_type: block.function_type,
      audience: block.audience ?? [],
      maturity: block.maturity,
      tags: block.tags,
    },
    {
      domains: existingDomains,
      functions: validFunctions,
      tags: knownTags,
    },
  )
);
```

Then in the `blocks.map((block, j) => ...)` call, add `trust_sources_json`:

```typescript
trust_sources_json: JSON.stringify(trustSourcesPerBlock[j]),
```

- [ ] **Step 6: Auto-validate trusted proposals when inserting**

In the proposal insertion loops (lines ~287–346), use `trust_source` to set `validated`:

For tags:
```typescript
for (const rawTag of proposals.tags ?? []) {
  const slug = rawTag.replace(/^NEW:/i, '').toLowerCase().replace(/\s+/g, '-');
  const tagTrust = trustSourcesPerBlock[blockIndex]?.tags ?? 'llm-inferred';
  const autoValidated = tagTrust === 'human-direct' || tagTrust === 'llm-confirmed' ? 1 : 0;
  await this.db
    .insert(fragmentTags)
    .values({
      slug,
      label: slug,
      category: 'proposed',
      validated: autoValidated,
      proposedBy: 'llm-auto',
      trustSource: tagTrust,
      created_at: now2,
    })
    .onConflictDoNothing();
}
```

Same pattern for domains (using `trustSourcesPerBlock[blockIndex]?.domain`) and entities (using `overallTrustSource(trustSourcesPerBlock[blockIndex])`).

Note: the outer loop over `blocks` needs to track the index. Change `for (const block of blocks)` to `for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++)` and use `const block = blocks[blockIndex]`.

- [ ] **Step 7: Run typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```
Expected: no errors.

### 3c — llm-client.ts: inject hints into prompt

- [ ] **Step 8: Add UploadHints param to segmentAndClassify**

Change signature from:
```typescript
async segmentAndClassify(
  markdown: string,
  validTypes: string[],
  validDomains: string[],
  knownTags: string[] = [],
  domainHints: Record<string, string> = {},
  validFunctions: string[] = [],
  validEntities: Array<{ type: string; canonicalName: string }> = [],
): Promise<CombinedBlock[]>
```

To:
```typescript
async segmentAndClassify(
  markdown: string,
  validTypes: string[],
  validDomains: string[],
  knownTags: string[] = [],
  domainHints: Record<string, string> = {},
  validFunctions: string[] = [],
  validEntities: Array<{ type: string; canonicalName: string }> = [],
  uploadHints: import('../schema/trust-source.js').UploadHints = {},
): Promise<CombinedBlock[]>
```

- [ ] **Step 9: Inject hints block into the prompt**

Just before the `# Document` section in the `segmentAndClassify` prompt, add a conditional hints block:

```typescript
const hintsBlock = Object.keys(uploadHints).length > 0
  ? `\n# Operator hints (high confidence — prefer these unless content clearly contradicts them)\n${
      uploadHints.domain ? `- domain: ${uploadHints.domain}\n` : ''
    }${
      uploadHints.function_type ? `- function_type: ${uploadHints.function_type}\n` : ''
    }${
      uploadHints.audience?.length ? `- audience: ${uploadHints.audience.join(', ')}\n` : ''
    }${
      uploadHints.maturity ? `- maturity: ${uploadHints.maturity}\n` : ''
    }${
      uploadHints.tags?.length ? `- tags (suggested): ${uploadHints.tags.join(', ')}\n` : ''
    }${
      uploadHints.entities?.length ? `- entities (suggested): ${uploadHints.entities.join(', ')}\n` : ''
    }`
  : '';
```

Then insert `${hintsBlock}` in the prompt string between the classification rules section and `# Document`.

- [ ] **Step 10: Run typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```
Expected: no errors.

---

## Task 4: Backend API Additions

**Files:**
- Modify: `packages/server/src/routes/admin-metadata-routes.ts`
- Modify: `packages/server/src/routes/harvest-routes.ts`

### 4a — GET /v1/admin/references/lookup (autocomplete)

- [ ] **Step 1: Add lookup endpoint to admin-metadata-routes.ts**

At the end of the file, before the closing of `adminMetadataRoutes`, add:

```typescript
// GET /v1/admin/metadata/references/lookup?kind=domain&q=tw&limit=10
app.get(`${prefix}/admin/metadata/references/lookup`, { preHandler: adminHandlers }, async (request) => {
  const { kind, q = '', limit = 10 } = request.query as { kind?: string; q?: string; limit?: number };
  const search = (q as string).toLowerCase();
  const maxResults = Math.min(Number(limit) || 10, 50);

  if (kind === 'domain') {
    const rows = await db.select({ slug: fragmentDomains.slug, label: fragmentDomains.label })
      .from(fragmentDomains)
      .where(eq(fragmentDomains.validated, 1))
      .limit(100);
    const filtered = rows.filter(r => r.slug.includes(search) || r.label.toLowerCase().includes(search)).slice(0, maxResults);
    return { data: filtered.map(r => ({ slug: r.slug, label: r.label })), meta: null, error: null };
  }

  if (kind === 'tag') {
    const rows = await db.select({ slug: fragmentTags.slug, label: fragmentTags.label })
      .from(fragmentTags)
      .where(eq(fragmentTags.validated, 1))
      .limit(100);
    const filtered = rows.filter(r => r.slug.includes(search) || r.label.toLowerCase().includes(search)).slice(0, maxResults);
    return { data: filtered.map(r => ({ slug: r.slug, label: r.label })), meta: null, error: null };
  }

  if (kind === 'function') {
    const rows = await db.select({ slug: fragmentFunctions.slug, label: fragmentFunctions.label })
      .from(fragmentFunctions)
      .where(eq(fragmentFunctions.validated, 1))
      .limit(100);
    const filtered = rows.filter(r => r.slug.includes(search) || r.label.toLowerCase().includes(search)).slice(0, maxResults);
    return { data: filtered.map(r => ({ slug: r.slug, label: r.label })), meta: null, error: null };
  }

  if (kind === 'entity') {
    const rows = await db.select({ id: entities.id, name: entities.canonicalName, type: entities.type })
      .from(entities)
      .where(eq(entities.validated, 1))
      .limit(200);
    const filtered = rows.filter(r => r.name.toLowerCase().includes(search)).slice(0, maxResults);
    return { data: filtered.map(r => ({ slug: String(r.id), label: r.name, type: r.type })), meta: null, error: null };
  }

  return { data: [], meta: null, error: null };
});
```

Make sure to import `fragmentFunctions` from `../db/schema.js` if not already imported.

### 4b — GET /v1/harvest/jobs/:id/debrief (updated response shape)

- [ ] **Step 2: Update debrief endpoint in harvest-routes.ts**

The endpoint computes a trust breakdown (high/mixed/low) per candidate, plus metadata proposal counts.

```typescript
// GET /v1/harvest/jobs/:id/debrief
app.get(`${prefix}/harvest/jobs/:id/debrief`, { preHandler: expertHandlers }, async (request, reply) => {
  const { id } = request.params as { id: string };
  if (!db) return reply.status(500).send({ data: null, meta: null, error: 'DB not available' });

  const [jobRow] = await db
    .select({ status: harvestJobs.status, upload_hints: harvestJobs.upload_hints })
    .from(harvestJobs)
    .where(eq(harvestJobs.id, id))
    .limit(1);
  if (!jobRow) return reply.status(404).send({ data: null, meta: null, error: 'Job not found' });

  const candidateRows = await db
    .select({ trust_sources_json: harvestCandidates.trust_sources_json })
    .from(harvestCandidates)
    .where(eq(harvestCandidates.job_id, id));

  const byTrust = { high: 0, mixed: 0, low: 0 };
  const byTrustSource = { 'human-direct': 0, 'llm-confirmed': 0, 'llm-deviation': 0, 'llm-inferred': 0 };

  for (const row of candidateRows) {
    const sources: Record<string, string> = row.trust_sources_json ? JSON.parse(row.trust_sources_json) : {};
    const vals = Object.values(sources);
    let worst: string = 'human-direct';
    if (vals.includes('llm-deviation')) worst = 'llm-deviation';
    else if (vals.includes('llm-inferred')) worst = 'llm-inferred';
    else if (vals.includes('llm-confirmed')) worst = 'llm-confirmed';
    byTrustSource[worst as keyof typeof byTrustSource]++;
    if (worst === 'human-direct' || worst === 'llm-confirmed') byTrust.high++;
    else if (worst === 'llm-deviation') byTrust.mixed++;
    else byTrust.low++;
  }

  const autoValidated = byTrustSource['human-direct'] + byTrustSource['llm-confirmed'];
  const toReview = byTrustSource['llm-deviation'] + byTrustSource['llm-inferred'];

  return reply.send({
    data: {
      job_id: id,
      job_status: jobRow.status,
      upload_hints: jobRow.upload_hints ? JSON.parse(jobRow.upload_hints) : null,
      had_hints: !!jobRow.upload_hints,
      fragments: {
        total: candidateRows.length,
        by_trust: byTrust,
      },
      metadata: {
        auto_validated: autoValidated,
        to_review: toReview,
        breakdown: byTrustSource,
      },
    },
    meta: null,
    error: null,
  });
});
```

Note: also update `use-harvest-debrief.ts` type (`HarvestDebrief`) to match this response shape.

### 4c — Expose trust_source on proposals endpoint

- [ ] **Step 3: Add trust_source to MetadataProposal in admin-metadata-routes.ts**

In the proposals query (the GET `/v1/admin/metadata/proposals` handler), the queries select from `fragmentTags`, `fragmentDomains`, `entities` tables. Add `trustSource` to each select:

For fragment_tags query:
```typescript
const tagRows = await db.select({
  slug: fragmentTags.slug,
  label: fragmentTags.label,
  category: fragmentTags.category,
  validated: fragmentTags.validated,
  usageCount: fragmentTags.usageCount,
  proposedBy: fragmentTags.proposedBy,
  created_at: fragmentTags.created_at,
  trustSource: fragmentTags.trustSource,   // ADD
}).from(fragmentTags).where(eq(fragmentTags.validated, 0));
```

And map to response:
```typescript
{ ...proposal, trust_source: row.trustSource ?? 'llm-inferred' }
```

Also add `trust_source` query filter. In the proposals handler, after reading `kind`:
```typescript
const trustSource = (request.query as any).trust_source as string | undefined;
```

Then filter in-memory: if `trustSource`, keep only rows where `row.trustSource === trustSource`.

Do the same for `fragmentDomains` and `entities`.

- [ ] **Step 4: Run typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```
Expected: no errors.

### 4d — Fix determineTrustSource + add bulk-accept endpoint

- [ ] **Step 5: Fix determineTrustSource() in schema/trust-source.ts**

`human-direct` must ONLY come from explicit human correction, never from upload hints. Change the function to:

```typescript
export function determineTrustSource(
  hint: unknown,
  llmValue: unknown,
): TrustSource {
  const hintArray = normalizeToArray(hint);
  if (hintArray.length === 0) return 'llm-inferred';
  const llmArray = normalizeToArray(llmValue);
  if (arraysEqual(hintArray, llmArray)) return 'llm-confirmed';
  return 'llm-deviation';
}
```

Remove the `referential` parameter. Update the call site in `computeTrustSources()`: change `determineTrustSource(hintValue, blockValue, fieldReferential)` to `determineTrustSource(hintValue, blockValue)`.

- [ ] **Step 6: Add bulk-accept endpoint to harvest-routes.ts**

```typescript
// POST /v1/admin/harvest/candidates/bulk-accept
app.post(
  `${prefix}/admin/harvest/candidates/bulk-accept`,
  { preHandler: adminHandlers },
  async (request, reply) => {
    const { candidate_ids } = request.body as { candidate_ids: string[] };
    if (!Array.isArray(candidate_ids) || candidate_ids.length === 0) {
      return reply.status(400).send({ data: null, meta: null, error: 'candidate_ids required' });
    }

    const candidates = await db
      .select()
      .from(harvestCandidates)
      .where(inArray(harvestCandidates.id, candidate_ids));

    for (const c of candidates) {
      const sources: Record<string, string> = c.trust_sources_json ? JSON.parse(c.trust_sources_json) : {};
      const vals = Object.values(sources);
      let worst = 'human-direct';
      if (vals.includes('llm-deviation')) worst = 'llm-deviation';
      else if (vals.includes('llm-inferred')) worst = 'llm-inferred';
      else if (vals.includes('llm-confirmed')) worst = 'llm-confirmed';
      const isHigh = worst === 'human-direct' || worst === 'llm-confirmed';
      if (!isHigh) {
        return reply.status(400).send({
          data: null, meta: null,
          error: `Candidate ${c.id} is not trust-high, refusing bulk accept`,
        });
      }
    }

    const accepted = await harvesterService.bulkAccept(candidates, request.user.id);
    return reply.send({ data: { accepted }, meta: null, error: null });
  },
);
```

Also add `bulkAccept(candidates, userId)` method to `HarvesterService` that iterates candidates, calls `fragmentService.create()` for each with `quality='draft'`, and marks each candidate status='accepted'. Reuse the same logic as `commitValidation()` for accepted candidates.

Add `GET /v1/admin/harvest/candidates` endpoint (protected by admin role) to list pending candidates with pagination and trust-level filter:

```typescript
app.get(
  `${prefix}/admin/harvest/candidates`,
  { preHandler: adminHandlers },
  async (request) => {
    const { job_id, trust_level, limit = 50, offset = 0 } = request.query as {
      job_id?: string; trust_level?: 'high' | 'mixed' | 'low'; limit?: number; offset?: number;
    };

    const conditions: any[] = [eq(harvestCandidates.status, 'pending')];
    if (job_id) conditions.push(eq(harvestCandidates.job_id, job_id));

    const rows = await db
      .select()
      .from(harvestCandidates)
      .where(and(...conditions))
      .limit(Number(limit))
      .offset(Number(offset));

    // If trust_level filter requested, filter in-memory (trust is derived from trust_sources_json)
    const filtered = trust_level
      ? rows.filter((c) => {
          const vals = Object.values(JSON.parse(c.trust_sources_json ?? '{}') as Record<string, string>);
          let worst = 'human-direct';
          if (vals.includes('llm-deviation')) worst = 'llm-deviation';
          else if (vals.includes('llm-inferred')) worst = 'llm-inferred';
          else if (vals.includes('llm-confirmed')) worst = 'llm-confirmed';
          if (trust_level === 'high') return worst === 'human-direct' || worst === 'llm-confirmed';
          if (trust_level === 'mixed') return worst === 'llm-deviation';
          return worst === 'llm-inferred';
        })
      : rows;

    return { data: filtered, meta: { total: filtered.length }, error: null };
  },
);
```

---

## Task 5: Frontend Types + API Hooks

**Files:**
- Create: `packages/web/src/types/trust-source.ts`
- Modify: `packages/web/src/types/admin-metadata.ts`
- Modify: `packages/web/src/api/types.ts`
- Create: `packages/web/src/api/hooks/use-reference-lookup.ts`
- Create: `packages/web/src/api/hooks/use-harvest-debrief.ts`
- Modify: `packages/web/src/api/hooks/use-metadata-proposals.ts`

- [ ] **Step 1: Create packages/web/src/types/trust-source.ts**

```typescript
export type TrustSource = 'human-direct' | 'llm-confirmed' | 'llm-deviation' | 'llm-inferred';

export interface UploadHints {
  domain?: string;
  function_type?: string;
  audience?: string[];
  maturity?: string;
  tags?: string[];
  entities?: string[];
}
```

- [ ] **Step 2: Add trust_source to MetadataProposal in admin-metadata.ts**

```typescript
import type { TrustSource } from './trust-source';

export interface MetadataProposal {
  // ...existing fields...
  trust_source?: TrustSource;
}
```

- [ ] **Step 3: Create use-reference-lookup.ts**

```typescript
// packages/web/src/api/hooks/use-reference-lookup.ts
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';

export interface ReferenceItem {
  slug: string;
  label: string;
  type?: string;
}

export function useReferenceLookup(kind: 'domain' | 'tag' | 'function' | 'entity', q: string) {
  return useQuery<ReferenceItem[]>({
    queryKey: ['reference-lookup', kind, q],
    queryFn: () => {
      const params = new URLSearchParams({ kind, q, limit: '15' });
      return apiRequest('GET', `/v1/admin/metadata/references/lookup?${params}`);
    },
    enabled: true,
    staleTime: 30_000,
  });
}
```

- [ ] **Step 4: Create use-harvest-debrief.ts**

```typescript
// packages/web/src/api/hooks/use-harvest-debrief.ts
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import type { TrustSource } from '@/types/trust-source';

export interface HarvestDebrief {
  job_id: string;
  total_candidates: number;
  auto_validated: number;
  needs_review: number;
  by_trust_source: Record<TrustSource, number>;
}

export function useHarvestDebrief(jobId: string | null) {
  return useQuery<HarvestDebrief>({
    queryKey: ['harvest-debrief', jobId],
    queryFn: () => apiRequest('GET', `/v1/harvest/jobs/${jobId}/debrief`),
    enabled: !!jobId,
  });
}
```

- [ ] **Step 5: Add trust_source filter to useMetadataProposals**

In `use-metadata-proposals.ts`, extend the params type:
```typescript
export function useMetadataProposals(
  params: {
    kind?: ProposalKind;
    entity_type?: EntityType;
    search?: string;
    trust_source?: string;
    limit?: number;
    offset?: number;
  } = {},
)
```
The existing `URLSearchParams` construction already handles this since it iterates `Object.entries(params)`.

- [ ] **Step 6: Run typecheck**

```bash
pnpm --filter @fragmint/web typecheck
```
Expected: no errors.

---

## Task 6: Frontend Autocomplete Components

**Files:**
- Create: `packages/web/src/lib/use-debounced-value.ts`
- Create: `packages/web/src/components/harvest/autocomplete-select.tsx`
- Create: `packages/web/src/components/harvest/multi-autocomplete-select.tsx`
- Create: `packages/web/src/components/harvest/entity-selector.tsx`

- [ ] **Step 1: Create use-debounced-value.ts**

```typescript
// packages/web/src/lib/use-debounced-value.ts
import { useState, useEffect } from 'react';

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
```

- [ ] **Step 2: Create autocomplete-select.tsx**

```tsx
// packages/web/src/components/harvest/autocomplete-select.tsx
import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useReferenceLookup } from '@/api/hooks/use-reference-lookup';
import type { ReferenceItem } from '@/api/hooks/use-reference-lookup';

interface Props {
  kind: 'domain' | 'tag' | 'function' | 'entity';
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function AutocompleteSelect({ kind, value, onChange, placeholder }: Props) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 300);
  const { data = [] } = useReferenceLookup(kind, debouncedQuery);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const select = (item: ReferenceItem) => {
    setQuery(item.slug);
    onChange(item.slug);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <Input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="text-sm"
      />
      {open && data.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto">
          {data.map((item) => (
            <button
              key={item.slug}
              type="button"
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent"
              onMouseDown={() => select(item)}
            >
              {item.label}
              {item.type && <span className="ml-1 text-xs text-muted-foreground">({item.type})</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create multi-autocomplete-select.tsx**

```tsx
// packages/web/src/components/harvest/multi-autocomplete-select.tsx
import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useReferenceLookup } from '@/api/hooks/use-reference-lookup';
import type { ReferenceItem } from '@/api/hooks/use-reference-lookup';

interface Props {
  kind: 'domain' | 'tag' | 'function' | 'entity';
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}

export function MultiAutocompleteSelect({ kind, values, onChange, placeholder }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 300);
  const { data = [] } = useReferenceLookup(kind, debouncedQuery);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const add = (item: ReferenceItem) => {
    if (!values.includes(item.slug)) onChange([...values, item.slug]);
    setQuery('');
    setOpen(false);
  };

  const remove = (slug: string) => onChange(values.filter((v) => v !== slug));

  return (
    <div ref={ref} className="relative">
      <div className="flex flex-wrap gap-1 mb-1">
        {values.map((v) => (
          <Badge key={v} variant="secondary" className="text-xs gap-1">
            {v}
            <button type="button" onClick={() => remove(v)}>
              <X className="h-2.5 w-2.5" />
            </button>
          </Badge>
        ))}
      </div>
      <Input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="text-sm"
      />
      {open && data.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto">
          {data.filter(item => !values.includes(item.slug)).map((item) => (
            <button
              key={item.slug}
              type="button"
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent"
              onMouseDown={() => add(item)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create entity-selector.tsx**

```tsx
// packages/web/src/components/harvest/entity-selector.tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, Plus } from 'lucide-react';
import { AutocompleteSelect } from './autocomplete-select';

interface EntityEntry {
  id: string;
  name: string;
}

interface Props {
  values: EntityEntry[];
  onChange: (values: EntityEntry[]) => void;
}

export function EntitySelector({ values, onChange }: Props) {
  const [pending, setPending] = useState('');

  const add = () => {
    if (!pending.trim()) return;
    const id = `ent-${Date.now()}`;
    onChange([...values, { id, name: pending.trim() }]);
    setPending('');
  };

  const remove = (id: string) => onChange(values.filter((v) => v.id !== id));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {values.map((e) => (
          <Badge key={e.id} variant="secondary" className="text-xs gap-1">
            {e.name}
            <button type="button" onClick={() => remove(e.id)}>
              <X className="h-2.5 w-2.5" />
            </button>
          </Badge>
        ))}
      </div>
      <div className="flex gap-2">
        <AutocompleteSelect
          kind="entity"
          value={pending}
          onChange={setPending}
          placeholder="Search entities..."
        />
        <Button type="button" size="sm" variant="outline" onClick={add}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run typecheck**

```bash
pnpm --filter @fragmint/web typecheck
```
Expected: no errors.

---

## Task 7: Frontend Upload Form with Hints

**Files:**
- Create: `packages/web/src/components/harvest/upload-hints-form.tsx`
- Modify: `packages/web/src/api/hooks/use-harvest.ts`
- Modify: `packages/web/src/pages/harvest.tsx`

- [ ] **Step 1: Create upload-hints-form.tsx**

```tsx
// packages/web/src/components/harvest/upload-hints-form.tsx
import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AutocompleteSelect } from './autocomplete-select';
import { MultiAutocompleteSelect } from './multi-autocomplete-select';
import { EntitySelector } from './entity-selector';
import type { UploadHints } from '@/types/trust-source';

interface Props {
  hints: UploadHints;
  onChange: (hints: UploadHints) => void;
}

const AUDIENCE_OPTIONS = ['technical', 'decision-maker', 'user', 'legal'];
const MATURITY_OPTIONS = ['production', 'beta', 'roadmap', 'archive'];

export function UploadHintsForm({ hints, onChange }: Props) {
  const [open, setOpen] = useState(false);

  const set = <K extends keyof UploadHints>(key: K, value: UploadHints[K]) => {
    onChange({ ...hints, [key]: value });
  };

  return (
    <div className="border rounded-md bg-muted/30">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium"
        onClick={() => setOpen((o) => !o)}
      >
        <span>Hints (optional — improves classification trust)</span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t">
          <div className="grid grid-cols-2 gap-4 mt-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Domain</label>
              <AutocompleteSelect
                kind="domain"
                value={hints.domain ?? ''}
                onChange={(v) => set('domain', v || undefined)}
                placeholder="e.g. twake-mail"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Function type</label>
              <AutocompleteSelect
                kind="function"
                value={hints.function_type ?? ''}
                onChange={(v) => set('function_type', v || undefined)}
                placeholder="e.g. commercial"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Maturity</label>
              <select
                className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                value={hints.maturity ?? ''}
                onChange={(e) => set('maturity', e.target.value || undefined)}
              >
                <option value="">— select —</option>
                {MATURITY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Audience</label>
              <div className="flex flex-wrap gap-1">
                {AUDIENCE_OPTIONS.map((o) => (
                  <Button
                    key={o}
                    type="button"
                    size="sm"
                    variant={(hints.audience ?? []).includes(o) ? 'secondary' : 'ghost'}
                    className="text-xs h-7"
                    onClick={() => {
                      const current = hints.audience ?? [];
                      set('audience', current.includes(o) ? current.filter((a) => a !== o) : [...current, o]);
                    }}
                  >
                    {o}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Tags (suggested)</label>
            <MultiAutocompleteSelect
              kind="tag"
              values={hints.tags ?? []}
              onChange={(v) => set('tags', v.length ? v : undefined)}
              placeholder="Search tags..."
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Entities mentioned</label>
            <EntitySelector
              values={(hints.entities ?? []).map((e, i) => ({ id: String(i), name: e }))}
              onChange={(entries) => set('entities', entries.map((e) => e.name))}
            />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Modify use-harvest.ts to pass upload_hints**

Change `useStartHarvest` mutation fn signature:

```typescript
export function useStartHarvest(collectionSlug: string) {
  return useMutation({
    mutationFn: async ({
      files,
      minConfidence,
      uploadHints,
    }: {
      files: File[];
      minConfidence: number;
      uploadHints?: import('@/types/trust-source').UploadHints;
    }) => {
      const form = new FormData();
      for (const file of files) {
        form.append('files', file);
      }
      form.append('options', JSON.stringify({ min_confidence: minConfidence }));
      if (uploadHints && Object.keys(uploadHints).length > 0) {
        form.append('upload_hints', JSON.stringify(uploadHints));
      }

      const token = getToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(collectionApiUrl(collectionSlug, '/harvest'), {
        method: 'POST',
        headers,
        body: form,
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      return json.data as { job_id: string; status: string; files: string[] };
    },
  });
}
```

- [ ] **Step 3: Modify harvest.tsx to add hints state + redirect**

Add to imports:
```tsx
import { useNavigate } from 'react-router-dom';
import { UploadHintsForm } from '@/components/harvest/upload-hints-form';
import type { UploadHints } from '@/types/trust-source';
```

Add state in `HarvestPage`:
```typescript
const navigate = useNavigate();
const [uploadHints, setUploadHints] = useState<UploadHints>({});
```

Change the upload submit call to pass hints and redirect:
```typescript
const handleStart = async () => {
  if (files.length === 0) return;
  try {
    const result = await startHarvest.mutateAsync({
      files,
      minConfidence,
      uploadHints,
    });
    setJobId(result.job_id);
    navigate(`/harvest/${result.job_id}/debrief`);
  } catch (e: any) {
    toast.error(e.message ?? 'Upload failed');
  }
};
```

Add `<UploadHintsForm hints={uploadHints} onChange={setUploadHints} />` just above (or below) the confidence slider in the upload form section.

- [ ] **Step 4: Run typecheck**

```bash
pnpm --filter @fragmint/web typecheck
```
Expected: no errors.

---

## Task 8: Frontend Debrief Page — Commercial (Simplified)

**Files:**
- Modify: `packages/web/src/pages/harvest-debrief.tsx`
- Modify: `packages/web/src/api/hooks/use-harvest-debrief.ts`
- Modify: `packages/web/src/App.tsx` (route already added in previous task)

The commercial debrief is intentionally simple. The user already knows the ingestion worked. Show: total fragments, that the admin will validate, and two CTAs.

- [ ] **Step 1: Update HarvestDebrief type in use-harvest-debrief.ts**

```typescript
export interface HarvestDebrief {
  job_id: string;
  job_status: string;
  had_hints: boolean;
  fragments: {
    total: number;
    by_trust: { high: number; mixed: number; low: number };
  };
  metadata: {
    auto_validated: number;
    to_review: number;
    breakdown: Record<string, number>;
  };
}

export function useHarvestDebrief(jobId: string | null) {
  return useQuery<HarvestDebrief>({
    queryKey: ['harvest-debrief', jobId],
    queryFn: () => {
      if (!jobId) throw new Error('jobId is required');
      return apiRequest('GET', `/v1/harvest/jobs/${jobId}/debrief`);
    },
    enabled: !!jobId,
  });
}
```

- [ ] **Step 2: Rewrite harvest-debrief.tsx — commercial simplified view**

```tsx
import { useParams, Link } from 'react-router-dom';
import { Loader2, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useHarvestDebrief } from '@/api/hooks/use-harvest-debrief';

export default function HarvestDebriefPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { data, isLoading } = useHarvestDebrief(jobId ?? null);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">No debrief available for this job.</p>
        <Button asChild variant="outline" className="mt-4"><Link to="/harvest">Back to harvest</Link></Button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-xl mx-auto space-y-6 text-center">
      <div className="flex justify-center">
        <CheckCircle className="h-12 w-12 text-green-500" />
      </div>
      <div>
        <h1 className="text-2xl font-medium">Ingestion terminée</h1>
        <p className="text-muted-foreground mt-2">
          {data.fragments.total} fragments extraits.
          {data.had_hints && ' Vos hints ont accéléré la classification.'}
        </p>
        <p className="text-sm text-muted-foreground mt-3">
          Prochaine étape : l'admin va valider les fragments. Ils seront disponibles pour composition une fois approuvés.
        </p>
      </div>
      <div className="flex justify-center gap-3">
        <Button asChild variant="outline"><Link to="/harvest">Nouvelle ingestion</Link></Button>
        <Button asChild><Link to="/fragments">Voir les fragments</Link></Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm --filter @fragmint/web exec tsc --noEmit
```
Expected: no errors.

---

## Task 9: Admin Metadata — TrustSourceBadge + Filter

**Files:**
- Modify: `packages/web/src/components/admin/metadata/proposal-card.tsx`
- Modify: `packages/web/src/components/admin/metadata/proposals-list.tsx`

- [ ] **Step 1: Add TrustSourceBadge to proposal-card.tsx**

Add import at top of `proposal-card.tsx`:
```tsx
import type { TrustSource } from '@/types/trust-source';
```

Add `TrustSourceBadge` component (local, not exported) at the bottom of the file:

```tsx
function TrustSourceBadge({ source }: { source?: TrustSource }) {
  if (!source || source === 'human-direct') return null;

  const config: Record<Exclude<TrustSource, 'human-direct'>, { label: string; className: string }> = {
    'llm-confirmed': { label: '✓ LLM confirmed', className: 'bg-green-100 text-green-800' },
    'llm-deviation': { label: '⚠ LLM deviation', className: 'bg-amber-100 text-amber-800' },
    'llm-inferred': { label: 'LLM inferred', className: 'bg-blue-100 text-blue-800' },
  };

  const c = config[source];
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${c.className}`}>
      {c.label}
    </span>
  );
}
```

In the `ProposalCard` component, add the badge inside the existing `div.flex.items-center.gap-2` row (alongside the `Badge` for usage count):

```tsx
<TrustSourceBadge source={proposal.trust_source} />
```

- [ ] **Step 2: Add trust_source filter to proposals-list.tsx**

Add import:
```tsx
import type { TrustSource } from '@/types/trust-source';
```

Add state:
```tsx
const [trustFilter, setTrustFilter] = useState<TrustSource | 'all'>('all');
```

Pass `trust_source` to `useMetadataProposals`:
```tsx
const { data, isLoading } = useMetadataProposals({
  kind,
  entity_type: kind === 'entity' ? entityType : undefined,
  search: search || undefined,
  trust_source: trustFilter !== 'all' ? trustFilter : undefined,
});
```

Add filter UI just before the entity type filter row (or just after it), always visible:

```tsx
<div className="flex gap-1 mb-3">
  {([
    ['all', 'All'],
    ['llm-deviation', '⚠ Deviations'],
    ['llm-inferred', 'Inferred'],
    ['llm-confirmed', '✓ Confirmed'],
  ] as [TrustSource | 'all', string][]).map(([val, label]) => (
    <Button
      key={val}
      variant={trustFilter === val ? 'secondary' : 'ghost'}
      size="sm"
      onClick={() => setTrustFilter(val)}
      className="text-xs"
    >
      {label}
    </Button>
  ))}
</div>
```

- [ ] **Step 3: Run typecheck and lint**

```bash
pnpm --filter @fragmint/web typecheck && pnpm lint
```
Expected: no errors.

- [ ] **Step 4: Final full build check**

```bash
pnpm build
```
Expected: successful build, no errors.

---

## Task 10: Admin Harvest Tab + Candidate Validation Page

**Files:**
- Modify: `packages/web/src/layouts/admin-layout.tsx`
- Modify: `packages/web/src/App.tsx`
- Create: `packages/web/src/api/hooks/use-admin-harvest.ts`
- Create: `packages/web/src/components/admin/harvest/trust-badge.tsx`
- Create: `packages/web/src/pages/admin/harvest.tsx`
- Create: `packages/web/src/pages/admin/harvest-job.tsx`

- [ ] **Step 1: Add "Harvest" to admin sidebar in admin-layout.tsx**

Add a `Inbox` (from lucide-react) icon import or use `FileStack`. Add to `adminNavItems` array, between the header/home link and Metadata:

```typescript
{ to: '/admin/harvest', label: 'Harvest', icon: FileStack },
```

Position it before `{ to: '/admin/metadata', label: 'Metadata', icon: Tag }`.

Import `FileStack` from lucide-react.

- [ ] **Step 2: Add routes in App.tsx**

Add inside the `/admin` ProtectedRoute group:
```tsx
import AdminHarvestPage from '@/pages/admin/harvest';
import AdminHarvestJobPage from '@/pages/admin/harvest-job';
// ...
<Route path="harvest" element={<AdminHarvestPage />} />
<Route path="harvest/jobs/:jobId" element={<AdminHarvestJobPage />} />
```

- [ ] **Step 3: Create trust-badge.tsx**

```tsx
// packages/web/src/components/admin/harvest/trust-badge.tsx
import type { TrustSourcesPerMetadata } from '@/types/trust-source';

type TrustLevel = 'high' | 'mixed' | 'low';

function getTrustLevel(trustSourcesJson: string | null): TrustLevel {
  const sources = trustSourcesJson ? (JSON.parse(trustSourcesJson) as Record<string, string>) : {};
  const vals = Object.values(sources);
  if (vals.includes('llm-deviation')) return 'mixed';
  if (vals.includes('llm-inferred')) return 'low';
  if (vals.includes('llm-confirmed') || vals.includes('human-direct')) return 'high';
  return 'low';
}

const CONFIG: Record<TrustLevel, { label: string; className: string }> = {
  high: { label: '✓ Trust haut', className: 'bg-green-100 text-green-800' },
  mixed: { label: '⚠ Trust mixte', className: 'bg-amber-100 text-amber-800' },
  low: { label: '⊘ Trust bas', className: 'bg-blue-100 text-blue-800' },
};

export function TrustBadge({ trustSourcesJson }: { trustSourcesJson: string | null }) {
  const level = getTrustLevel(trustSourcesJson);
  const c = CONFIG[level];
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${c.className}`}>
      {c.label}
    </span>
  );
}

export { getTrustLevel, type TrustLevel };
```

Note: update `types/trust-source.ts` to export `TrustSourcesPerMetadata` if not already exported.

- [ ] **Step 4: Create use-admin-harvest.ts**

```typescript
// packages/web/src/api/hooks/use-admin-harvest.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import type { HarvestCandidate } from '@/api/types';

export function usePendingCandidates(params: {
  job_id?: string;
  trust_level?: 'high' | 'mixed' | 'low';
  limit?: number;
  offset?: number;
} = {}) {
  const qs = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  ).toString();
  return useQuery<HarvestCandidate[]>({
    queryKey: ['admin', 'harvest', 'candidates', params],
    queryFn: () => apiRequest('GET', `/v1/admin/harvest/candidates?${qs}`),
  });
}

export function useBulkAcceptCandidates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (candidate_ids: string[]) =>
      apiRequest('POST', '/v1/admin/harvest/candidates/bulk-accept', { candidate_ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'harvest'] }),
  });
}
```

- [ ] **Step 5: Create packages/web/src/pages/admin/harvest.tsx**

This page shows pending candidates with trust badges, filter buttons, default sort (high → mixed → low), and a bulk accept button when filter is 'high'.

```tsx
import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { usePendingCandidates, useBulkAcceptCandidates } from '@/api/hooks/use-admin-harvest';
import { TrustBadge, getTrustLevel, type TrustLevel } from '@/components/admin/harvest/trust-badge';
import type { HarvestCandidate } from '@/api/types';

const TRUST_PRIORITY: Record<TrustLevel, number> = { high: 0, mixed: 1, low: 2 };

export default function AdminHarvestPage() {
  const [trustFilter, setTrustFilter] = useState<TrustLevel | 'all'>('all');
  const { data: candidates = [], isLoading } = usePendingCandidates();
  const bulkAccept = useBulkAcceptCandidates();

  const sorted = useMemo(() =>
    [...candidates].sort((a, b) =>
      TRUST_PRIORITY[getTrustLevel(a.trust_sources_json ?? null)] -
      TRUST_PRIORITY[getTrustLevel(b.trust_sources_json ?? null)]
    ), [candidates]);

  const filtered = useMemo(() =>
    trustFilter === 'all' ? sorted : sorted.filter(c => getTrustLevel(c.trust_sources_json ?? null) === trustFilter),
    [sorted, trustFilter]);

  const counts = useMemo(() => {
    const c = { all: candidates.length, high: 0, mixed: 0, low: 0 };
    for (const candidate of candidates) {
      c[getTrustLevel(candidate.trust_sources_json ?? null)]++;
    }
    return c;
  }, [candidates]);

  async function handleBulkAccept() {
    const ids = filtered.map(c => c.id);
    try {
      await bulkAccept.mutateAsync(ids);
      toast.success(`${ids.length} fragments créés en draft`);
    } catch {
      toast.error('Erreur lors de la validation');
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Validation des candidats</h1>
          <p className="text-sm text-muted-foreground">Fragments extraits en attente de validation.</p>
        </div>
      </div>

      <div className="flex gap-2">
        {([['all', 'Tous'], ['high', '✓ Trust haut'], ['mixed', '⚠ Trust mixte'], ['low', '⊘ Trust bas']] as const).map(([val, label]) => (
          <Button
            key={val}
            variant={trustFilter === val ? 'secondary' : 'ghost'}
            size="sm"
            className="text-xs"
            onClick={() => setTrustFilter(val)}
          >
            {label} ({counts[val]})
          </Button>
        ))}
      </div>

      {trustFilter === 'high' && filtered.length > 0 && (
        <Button onClick={handleBulkAccept} disabled={bulkAccept.isPending} size="sm">
          {bulkAccept.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Tout valider ces {filtered.length} fragments Trust haut
        </Button>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center">Aucun candidat en attente.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map(c => (
            <div key={c.id} className="border rounded-lg p-4 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm truncate">{c.title}</span>
                  <TrustBadge trustSourcesJson={c.trust_sources_json ?? null} />
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.body?.slice(0, 120)}</p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link to={`/admin/harvest/jobs/${c.job_id}`}>Détail job</Link>
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Create packages/web/src/pages/admin/harvest-job.tsx**

Admin debrief with full technical details:

```tsx
import { useParams, Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useHarvestDebrief } from '@/api/hooks/use-harvest-debrief';

export default function AdminHarvestJobPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { data, isLoading } = useHarvestDebrief(jobId ?? null);

  if (isLoading) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!data) {
    return <div className="p-6"><p className="text-muted-foreground">Job introuvable.</p><Button asChild variant="outline" className="mt-4"><Link to="/admin/harvest">Retour</Link></Button></div>;
  }

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Job {data.job_id}</h1>
          <p className="text-sm text-muted-foreground">Statut : {data.job_status}</p>
        </div>
        <Button asChild variant="outline">
          <Link to={`/admin/harvest?job_id=${jobId}`}>Voir les candidats</Link>
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Trust haut</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold text-green-600">{data.fragments.by_trust.high}</div><p className="text-xs text-muted-foreground">Validation rapide</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Trust mixte</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold text-amber-600">{data.fragments.by_trust.mixed}</div><p className="text-xs text-muted-foreground">Déviations à examiner</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Trust bas</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold text-blue-600">{data.fragments.by_trust.low}</div><p className="text-xs text-muted-foreground">Vérification approfondie</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Métadonnées émergentes</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Auto-validées</span><span className="font-medium text-green-600">{data.metadata.auto_validated}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">À examiner en queue admin</span><span className="font-medium text-amber-600">{data.metadata.to_review}</span></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Breakdown par trust source</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1">
          {Object.entries(data.metadata.breakdown).map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <span className="text-muted-foreground">{k}</span>
              <span className="font-medium">{v}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 7: Run typecheck**

```bash
pnpm --filter @fragmint/web exec tsc --noEmit
```
Expected: no errors.

---

## Task 11: Simplify Commercial Harvest Page

**Files:**
- Modify: `packages/web/src/pages/harvest.tsx`

The candidate validation section must be removed from harvest.tsx. The commercial user (ingestor) only uploads, fills hints, and is redirected to the simplified debrief. The CandidateCard, CandidateDetailSheet, accept/reject/edit logic, and all related state (decisions, modifications, resolvedDecisions) are removed.

- [ ] **Step 1: Simplify harvest.tsx**

Remove from harvest.tsx:
- Imports: `useValidateCandidates`, `CandidateCard`, `CandidateDetailSheet`, `CandidateEdits`
- State: `decisions`, `modifications`, `resolvedDecisions`, `selectedCandidate`, `candidatePage`, `candidatePageSize`, `commitResult`, `deleteConfirmOpen`
- Functions: `setDecisions`, `setModifications`, all handlers related to accept/reject/edit/commit
- JSX: the entire candidate review section (the part that shows after upload, with candidate cards and validation buttons)

Keep in harvest.tsx:
- File upload form (drop zone, file input, confidence slider)
- `UploadHintsForm`
- `useStartHarvest` to start ingestion
- `useHarvestJob` to poll job status while processing (show a spinner/progress)
- On job completion: navigate to `/harvest/${jobId}/debrief`
- Import cleanup: remove everything only used by the removed sections

The page should be much shorter after this (target: ~150-200 lines).

If `useDeleteHarvestJob` is only used in the deleted sections, remove its import too.

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter @fragmint/web exec tsc --noEmit
```
Expected: no errors.

---

## Validation Checklist

After all tasks are complete, verify manually:

- [ ] Upload a `.docx` without hints → all `trust_sources_json` fields are `llm-inferred`
- [ ] Upload with `domain=twake-mail` (existing domain) → domain field is `llm-confirmed` (NOT `human-direct` — that only comes from explicit admin correction)
- [ ] Upload with domain hint that LLM accepts → `llm-confirmed`, proposal auto-approved
- [ ] Commercial harvest page: after upload, redirected to simplified debrief (no candidate list)
- [ ] Commercial debrief: shows fragment count + "admin will validate" message (no trust breakdown)
- [ ] Admin sidebar has "Harvest" tab between Home and Metadata
- [ ] `/admin/harvest` shows pending candidates with trust badges (✓ haut / ⚠ mixte / ⊘ bas)
- [ ] Trust filter buttons work (Tous / Trust haut / Trust mixte / Trust bas)
- [ ] Default sort: Trust haut en premier
- [ ] Bulk action "Tout valider Trust haut" creates fragments in `quality='draft'`
- [ ] Bulk action refuses candidates not in 'high' trust
- [ ] Admin debrief `/admin/harvest/jobs/:id` shows trust breakdown (high/mixed/low)
- [ ] Admin metadata `/admin/metadata` — proposals show trust source badge
- [ ] Trust source filter buttons work in admin metadata (Deviations / Inferred)
- [ ] `GET /v1/admin/metadata/references/lookup?kind=domain&q=tw` returns matching domains
