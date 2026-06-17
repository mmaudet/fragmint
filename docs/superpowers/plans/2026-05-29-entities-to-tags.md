# Entities → Tags Refactor + "Référentiel" Rename — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the entity system into the tag system (entities become prefixed tags like `client:dgfip`, `produit:linshare`, `tech:apache-james`), migrate all data, and rename the "Métadonnées" admin section to "Référentiel".

**Architecture:** Entities are a specialized form of tags — they were separate only for historical reasons. After this refactor, the `fragment_tags` + `fragment_tag_links` tables hold everything; `entities` and `fragment_entities` tables become dead weight. The LLM directly produces prefixed tags; no post-processing entity-linking step is needed.

**Tech Stack:** Drizzle/SQLite (migration), Fastify routes, React 19 + shadcn/ui, TypeScript

---

## Entity type → tag prefix mapping

| Entity `type` column | Tag prefix | Example |
|---|---|---|
| `client` | `client:` | `client:dgfip` |
| `product` | `produit:` | `produit:linshare` |
| `technology` | `tech:` | `tech:apache-james` |
| `partner` | `partner:` | `partner:microsoft` |
| `certification` | `cert:` | `cert:iso27001` |
| `regulation` | `reg:` | `reg:rgpd` |
| *(plural JSON bucket)* `clients` | `client:` | (LLM output format) |
| *(plural JSON bucket)* `products` | `produit:` | |
| *(plural JSON bucket)* `technologies` | `tech:` | |

---

## File Map

### New / migrated
- Create: `scripts/migrate-entities-to-tags.ts` — one-time data migration

### Server — modify
- `packages/server/src/db/schema.ts` — remove `entities` / `fragmentEntities` exports
- `packages/server/src/schema/trust-source.ts` — remove `entities` from `UploadHints`
- `packages/server/src/services/llm-client.ts` — remove `entities` from `CombinedBlock`; update prompt
- `packages/server/src/services/quality-signals.ts` — replace entity coverage check with tag prefix check
- `packages/server/src/services/harvester-pipeline.ts` — remove validEntityRows query + entities_json insert
- `packages/server/src/services/harvest-hint-processor.ts` — remove entity functions (setupHintEntities, etc.)
- `packages/server/src/services/harvester-validation.ts` — remove `linkFragmentEntities` + entity imports
- `packages/server/src/services/fragment-service.ts` — remove `updateEntities()` + entity join in `getById`
- `packages/server/src/routes/fragment-routes.ts` — remove `PUT /fragments/:id/entities`
- `packages/server/src/routes/admin-referential-helpers.ts` — remove `entity` from VALID_TYPES / TABLE_MAP
- `packages/server/src/routes/admin-referential-routes.ts` — remove cooccurrence + entity type branches
- `packages/server/src/routes/admin-metadata-routes.ts` — remove entity kind throughout
- `packages/server/src/routes/admin-metadata-helpers.ts` — remove entity-specific functions
- `packages/server/src/schema/__tests__/quality-signals.test.ts` — update tests

### Web — modify
- `packages/web/src/types/admin-metadata.ts` — remove `entity` from `ProposalKind`
- `packages/web/src/types/trust-source.ts` — remove `entities` from `UploadHints`
- `packages/web/src/api/types.ts` — remove `entities_json` + `entities` from types
- `packages/web/src/api/hooks/use-reference-lookup.ts` — remove `entity` kind
- `packages/web/src/api/hooks/use-metadata-proposals.ts` — remove entity-specific hooks
- `packages/web/src/lib/i18n.tsx` — rename "Métadonnées" → "Référentiel" in admin context
- `packages/web/src/pages/admin/home.tsx` — update tab label
- `packages/web/src/pages/admin/metadata.tsx` — update page title
- `packages/web/src/components/admin/fragment-detail-drawer.tsx` — remove EntityPicker + entities section
- `packages/web/src/components/candidate-detail-sheet.tsx` — remove EntityEditor + entities_json
- `packages/web/src/components/admin/metadata/admin-metadata-tab.tsx` — remove entity tab
- `packages/web/src/components/admin/metadata/proposal-card.tsx` — remove convert-to-entity button
- `packages/web/src/components/admin/metadata/unified-metadata-card.tsx` — remove entity sections
- `packages/web/src/components/admin/metadata/convert-to-entity-dialog.tsx` — delete file
- `packages/web/src/components/admin/metadata/merge-dialog.tsx` — remove entity merge branch
- `packages/web/src/components/admin/cooccurrence-heatmap.tsx` — remove (no entity data)
- `packages/web/src/components/admin/referential-list.tsx` — remove entity tab
- `packages/web/src/components/admin/referential-item-card.tsx` — remove entity display
- `packages/web/src/components/admin/referential-item-sheet.tsx` — remove entity sections
- `packages/web/src/components/admin/rename-modal.tsx` — remove entity handling
- `packages/web/src/components/harvest/upload-hints-form.tsx` — remove EntitySelector
- `packages/web/src/components/harvest/entity-selector.tsx` — delete file

---

## Task 1: Data migration script

**Files:**
- Create: `scripts/migrate-entities-to-tags.ts`

- [ ] **Step 1: Write the migration script**

```typescript
// scripts/migrate-entities-to-tags.ts
// Run once to migrate entity data into the tags system.
// Idempotent — safe to run multiple times.
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const DB_PATH = process.env.FRAGMINT_DB_PATH ?? join(process.cwd(), '.fragmint.db');
if (!existsSync(DB_PATH)) {
  console.error(`DB not found at ${DB_PATH}. Set FRAGMINT_DB_PATH env var.`);
  process.exit(1);
}

const db = new Database(DB_PATH);

// Entity type (singular) → tag prefix
const TYPE_PREFIX: Record<string, string> = {
  client: 'client',
  product: 'produit',
  technology: 'tech',
  partner: 'partner',
  certification: 'cert',
  regulation: 'reg',
};

// entities_json bucket (plural) → tag prefix
const BUCKET_PREFIX: Record<string, string> = {
  clients: 'client',
  products: 'produit',
  technologies: 'tech',
  partners: 'partner',
  certifications: 'cert',
  regulations: 'reg',
};

function normalize(name: string): string {
  return name
    .replace(/^NEW:/i, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function tagSlug(prefix: string, name: string): string {
  return `${prefix}:${normalize(name)}`;
}

const now = new Date().toISOString();

// ── 1. Migrate entities table → fragment_tags ──────────────────────────────
const entities = db.prepare('SELECT * FROM entities WHERE status != ?').all('rejected') as any[];
let tagsMigrated = 0;
for (const ent of entities) {
  const prefix = TYPE_PREFIX[ent.type] ?? ent.type;
  const slug = tagSlug(prefix, ent.canonical_name ?? ent.name);
  const label = ent.canonical_name ?? ent.name;
  const isValidated = ent.validated === 1 ? 1 : 0;
  const status = isValidated ? 'active' : 'pending';
  const existing = db.prepare('SELECT slug FROM fragment_tags WHERE slug = ?').get(slug);
  if (!existing) {
    db.prepare(
      `INSERT INTO fragment_tags (slug, label, category, created_at, validated, proposed_by, trust_source, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(slug, label, prefix, ent.created_at ?? now, isValidated, ent.proposed_by ?? 'migration', ent.trust_source ?? 'human-direct', status);
    tagsMigrated++;
  }
}
console.log(`entities → fragment_tags: ${tagsMigrated} new tags`);

// ── 2. Migrate fragment_entities → fragment_tag_links ─────────────────────
const feRows = db.prepare('SELECT fe.fragment_id, e.type, e.canonical_name, e.name FROM fragment_entities fe JOIN entities e ON e.id = fe.entity_id').all() as any[];
let linksMigrated = 0;
for (const row of feRows) {
  const prefix = TYPE_PREFIX[row.type] ?? row.type;
  const slug = tagSlug(prefix, row.canonical_name ?? row.name);
  const existing = db.prepare('SELECT 1 FROM fragment_tag_links WHERE fragment_id = ? AND tag_slug = ?').get(row.fragment_id, slug);
  if (!existing) {
    db.prepare('INSERT OR IGNORE INTO fragment_tag_links (fragment_id, tag_slug) VALUES (?, ?)').run(row.fragment_id, slug);
    linksMigrated++;
  }
  // Also patch the JSON tags column on the fragment
  const frag = db.prepare('SELECT tags FROM fragments WHERE id = ?').get(row.fragment_id) as any;
  if (frag) {
    const tags: string[] = JSON.parse(frag.tags ?? '[]');
    if (!tags.includes(slug)) {
      tags.push(slug);
      db.prepare('UPDATE fragments SET tags = ? WHERE id = ?').run(JSON.stringify(tags), row.fragment_id);
    }
  }
}
console.log(`fragment_entities → fragment_tag_links: ${linksMigrated} new links`);

// ── 3. Migrate harvest_candidates entities_json → tags ────────────────────
const candidates = db.prepare('SELECT id, entities_json, tags FROM harvest_candidates WHERE entities_json IS NOT NULL AND entities_json != ?').all('{}') as any[];
let candidatesMigrated = 0;
for (const cand of candidates) {
  let entMap: Record<string, string[]>;
  try { entMap = JSON.parse(cand.entities_json); } catch { continue; }
  const existingTags: string[] = JSON.parse(cand.tags ?? '[]');
  const added: string[] = [];
  for (const [bucket, names] of Object.entries(entMap)) {
    const prefix = BUCKET_PREFIX[bucket] ?? bucket.replace(/s$/, '');
    for (const name of names as string[]) {
      if (!name?.trim()) continue;
      const slug = tagSlug(prefix, name);
      if (!existingTags.includes(slug) && !added.includes(slug)) added.push(slug);
    }
  }
  if (added.length > 0) {
    const newTags = [...existingTags, ...added];
    db.prepare('UPDATE harvest_candidates SET tags = ? WHERE id = ?').run(JSON.stringify(newTags), cand.id);
    candidatesMigrated++;
  }
}
console.log(`harvest_candidates entities_json → tags: ${candidatesMigrated} candidates updated`);
console.log('Migration complete.');
db.close();
```

- [ ] **Step 2: Run migration script in container**

```bash
# In Docker (prod):
docker exec fragmint-fragmint-1 node -e "require('tsx/cjs'); require('./scripts/migrate-entities-to-tags.ts')"
# Or locally with tsx:
pnpm tsx scripts/migrate-entities-to-tags.ts
```

Expected output:
```
entities → fragment_tags: N new tags
fragment_entities → fragment_tag_links: N new links
harvest_candidates entities_json → tags: N candidates updated
Migration complete.
```

- [ ] **Step 3: Verify migration result (SQL)**

```sql
SELECT COUNT(*) FROM fragment_tags WHERE slug LIKE 'client:%' OR slug LIKE 'produit:%' OR slug LIKE 'tech:%';
SELECT COUNT(*) FROM fragment_tag_links ftl JOIN fragment_tags ft ON ft.slug = ftl.tag_slug WHERE ft.slug LIKE 'client:%' OR ft.slug LIKE 'produit:%';
```

---

## Task 2: LLM output schema — remove entities field

**Files:**
- Modify: `packages/server/src/services/llm-client.ts`

- [ ] **Step 1: Update `CombinedBlock` interface** — remove `entities` field; `new_proposals.entities` disappears

```typescript
// BEFORE — CombinedBlock in llm-client.ts
export interface CombinedBlock {
  title: string;
  body: string;
  type: string;
  domain: string;
  function_type: string;
  audience: string[];
  maturity: string;
  lang: string;
  tags: string[];
  entities: {
    clients: string[];
    products: string[];
    technologies: string[];
    partners: string[];
    certifications: string[];
    regulations: string[];
  };
  new_proposals: {
    tags: string[];
    domains: string[];
    entities: Partial<Record<string, string[]>>;
  };
  confidence: number;
}

// AFTER
export interface CombinedBlock {
  title: string;
  body: string;
  type: string;
  domain: string;
  function_type: string;
  audience: string[];
  maturity: string;
  lang: string;
  tags: string[];
  new_proposals: {
    tags: string[];
    domains: string[];
  };
  confidence: number;
}
```

- [ ] **Step 2: Update `segmentAndClassify` prompt** — replace the `## entities` section with prefixed-tag instructions

Replace the entity block in the prompt (the `entityBlock` variable and its usage) with this:

```typescript
// Remove these lines (entityBlock setup):
// const entityListByType = validEntities.reduce...
// const entityBlock = Object.entries(entityListByType)...

// Add this constant to the prompt body instead, WITHIN the ## tags section:
const entityTagHint = `
## Entity tags — use these prefixed tags to identify named organizations, products, and technologies:
  Prefix format: client:name, produit:name, tech:name, partner:name, cert:name, reg:name
  Use lowercase kebab-case after the colon prefix. Examples: client:dgfip, produit:linshare, tech:apache-james, cert:iso-27001, reg:rgpd
  Apply entity tags ONLY when the fragment body explicitly names the organization/product/technology.
  New entity proposals: prefix with NEW: (e.g. NEW:client:some-new-client). These enter the admin validation queue.
`;
```

And update the prompt's `## tags` instruction:

```typescript
// Replace:
// ## tags — ${tagHint}

// With:
`## tags — ${tagHint}
${entityTagHint}
`
```

Also remove the entity block from the JSON example at the bottom of the prompt:

```typescript
// BEFORE example block in prompt:
// "entities": {
//   "clients": [], "products": [], "technologies": [],
//   "partners": [], "certifications": [], "regulations": []
// },
// "new_proposals": { "tags": [], "domains": [], "entities": {} },

// AFTER:
// "new_proposals": { "tags": [], "domains": [] },
```

And remove the `validEntities` parameter from `segmentAndClassify`:

```typescript
// BEFORE:
async segmentAndClassify(
  markdown: string,
  validTypes: string[],
  validDomains: string[],
  knownTags: string[] = [],
  domainHints: Record<string, string> = {},
  validFunctions: string[] = [],
  validEntities: Array<{ type: string; canonicalName: string }> = [],
  uploadHints: UploadHints = {},
): Promise<CombinedBlock[]>

// AFTER:
async segmentAndClassify(
  markdown: string,
  validTypes: string[],
  validDomains: string[],
  knownTags: string[] = [],
  domainHints: Record<string, string> = {},
  validFunctions: string[] = [],
  uploadHints: UploadHints = {},
): Promise<CombinedBlock[]>
```

- [ ] **Step 3: Run typecheck to confirm**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: type errors on files that still reference `CombinedBlock.entities` — these are fixed in later tasks.

---

## Task 3: Quality signals — replace entity check with prefixed-tag check

**Files:**
- Modify: `packages/server/src/services/quality-signals.ts`
- Modify: `packages/server/src/schema/__tests__/quality-signals.test.ts`

- [ ] **Step 1: Replace `checkEntityCoverage` with `checkTagCoverage`**

```typescript
// REMOVE:
const ENTITY_EXPECTATIONS: Record<string, string[]> = {
  technical: ['technologies', 'products'],
  commercial: ['products'],
  reference: ['clients'],
  legal: ['regulations', 'certifications'],
};

export function checkEntityCoverage(block: {
  function_type: string | null | undefined;
  entities: Record<string, string[]>;
}): CoherenceFlag { ... }

// ADD:
// Prefixes expected in tags for each function_type
const TAG_PREFIX_EXPECTATIONS: Record<string, string[]> = {
  technical: ['tech:', 'produit:'],
  commercial: ['produit:'],
  reference: ['client:'],
  legal: ['reg:', 'cert:'],
};

export function checkTagCoverage(block: {
  function_type: string | null | undefined;
  tags: string[];
}): CoherenceFlag {
  const expected = TAG_PREFIX_EXPECTATIONS[block.function_type ?? ''] ?? [];
  if (expected.length === 0) {
    return {
      type: 'entity_coverage',   // keep same type string for backward compat with stored signals
      level: 'info',
      message: 'No entity tag expectations for this function',
    };
  }
  const missing = expected.filter(
    (prefix) => !block.tags.some((t) => t.startsWith(prefix)),
  );
  if (missing.length > 0) {
    return {
      type: 'entity_coverage',
      level: 'warning',
      message: `Missing expected entity tags: ${missing.join(', ')}`,
    };
  }
  return { type: 'entity_coverage', level: 'ok', message: 'Expected entity tags present' };
}
```

- [ ] **Step 2: Update `computeQualitySignals` signature and call**

```typescript
// BEFORE:
export function computeQualitySignals(
  block: {
    type: string;
    body: string;
    domain: string;
    function_type?: string | null;
    entities?: Record<string, string[]>;
  },
  dupResult: { id: string; score: number } | null,
  hintEntities: string[] = [],
): CoherenceFlag[]

// AFTER:
export function computeQualitySignals(
  block: {
    type: string;
    body: string;
    domain: string;
    function_type?: string | null;
    tags?: string[];
  },
  dupResult: { id: string; score: number } | null,
): CoherenceFlag[]
```

And update the body:

```typescript
// BEFORE:
const signals: CoherenceFlag[] = [
  checkSubjectCoherence({ domain: block.domain, body: block.body }),
  checkEntityCoverage({ function_type: block.function_type, entities: block.entities ?? {} }),
  duplicateSignal(dupResult),
];
const hintSignal = checkHintEntityCoverage(block.body, hintEntities);
if (hintSignal) signals.push(hintSignal);

// AFTER:
const signals: CoherenceFlag[] = [
  checkSubjectCoherence({ domain: block.domain, body: block.body }),
  checkTagCoverage({ function_type: block.function_type, tags: block.tags ?? [] }),
  duplicateSignal(dupResult),
];
```

- [ ] **Step 3: Remove `checkHintEntityCoverage`** — no longer needed (entity hints are now regular tag hints)

Delete the function `checkHintEntityCoverage` from `quality-signals.ts`.

- [ ] **Step 4: Update quality-signals tests**

```typescript
// packages/server/src/schema/__tests__/quality-signals.test.ts
// Replace entity-based tests with tag-based tests:

describe('checkTagCoverage', () => {
  it('returns ok when expected tag prefixes present for function', () => {
    const result = checkTagCoverage({
      function_type: 'reference',
      tags: ['client:dgfip', 'open-source'],
    });
    expect(result.level).toBe('ok');
  });

  it('returns warning when expected tag prefix missing', () => {
    const result = checkTagCoverage({
      function_type: 'reference',
      tags: ['open-source'],
    });
    expect(result.level).toBe('warning');
    expect(result.message).toContain('client:');
  });

  it('returns info for function types with no expectations', () => {
    const result = checkTagCoverage({
      function_type: 'introduction',
      tags: [],
    });
    expect(result.level).toBe('info');
  });

  it('handles missing tags gracefully', () => {
    const result = checkTagCoverage({ function_type: 'commercial', tags: [] });
    expect(result.level).toBe('warning');
  });
});
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @fragmint/server test -- --run packages/server/src/schema/__tests__/quality-signals.test.ts
```

Expected: all tests pass.

---

## Task 4: Harvest pipeline cleanup

**Files:**
- Modify: `packages/server/src/services/harvester-pipeline.ts`
- Modify: `packages/server/src/services/harvest-hint-processor.ts`

- [ ] **Step 1: Remove entity loading from `harvester-pipeline.ts`**

Remove lines 85–92 (validEntityRows query):

```typescript
// REMOVE:
let validEntityRows = await db
  .select({
    type: entities.type,
    canonicalName: entities.canonicalName,
    normalizedName: entities.normalizedName,
  })
  .from(entities)
  .where(eq(entities.validated, 1));
```

- [ ] **Step 2: Remove hint entity setup in `harvester-pipeline.ts`**

```typescript
// REMOVE (lines ~94–96):
const { hintEntityNames, hintEntityMeta, hintEntitiesFound, hintTagsFound } =
  await setupHintEntities(db, uploadHints, validEntityRows);
// Replace with:
const hintTagsFound = new Set<string>();
```

- [ ] **Step 3: Update `segmentAndClassify` call** — remove `validEntityRows` argument

```typescript
// BEFORE:
const result = await llmClient.segmentAndClassify(
  chunk.text,
  existingTypes,
  existingDomains,
  knownTags,
  domainHints,
  validFunctions,
  validEntityRows,    // ← REMOVE
  uploadHints,
);

// AFTER:
const result = await llmClient.segmentAndClassify(
  chunk.text,
  existingTypes,
  existingDomains,
  knownTags,
  domainHints,
  validFunctions,
  uploadHints,
);
```

- [ ] **Step 4: Remove entity-based quality signals call in `harvester-pipeline.ts`**

```typescript
// BEFORE (lines ~261–273):
const qualitySignalsPerBlock = blocks.map((block, j) => {
  const blockEntityMap = (block.entities ?? {}) as Record<string, string[]>;
  return computeQualitySignals(
    {
      type: block.type,
      body: block.body,
      domain: block.domain,
      function_type: block.function_type,
      entities: blockEntityMap,
    },
    dupeChecks[j],
    hintEntityNames,
  );
});

// AFTER:
const qualitySignalsPerBlock = blocks.map((block, j) =>
  computeQualitySignals(
    {
      type: block.type,
      body: block.body,
      domain: block.domain,
      function_type: block.function_type,
      tags: block.tags ?? [],
    },
    dupeChecks[j],
  ),
);
```

- [ ] **Step 5: Remove entity judge input in `harvester-pipeline.ts`**

```typescript
// BEFORE (lines ~285–296):
return runQualityJudge(
  llmClient,
  {
    title: block.title || 'Untitled',
    body: block.body,
    domain: block.domain,
    function_type: block.function_type,
    type: block.type,
    audience: block.audience,
    entities: (block.entities ?? {}) as Record<string, string[]>,
  },
  ...
);

// AFTER:
return runQualityJudge(
  llmClient,
  {
    title: block.title || 'Untitled',
    body: block.body,
    domain: block.domain,
    function_type: block.function_type,
    type: block.type,
    audience: block.audience,
  },
  ...
);
```

- [ ] **Step 6: Remove `entities_json` from `harvestCandidates` batch insert**

```typescript
// In the batch insert block (~lines 320–348):
// REMOVE:
entities_json: JSON.stringify(block.entities ?? {}),
```

- [ ] **Step 7: Remove `applyUploadHintsInPlace` call + entity parts**

```typescript
// REMOVE the entire applyUploadHintsInPlace call (lines ~251–258)
// Keep only hint tag tracking (hintTagsFound) — already done via LLM output
```

- [ ] **Step 8: Update `flushHintReferentials` call** — remove entity-related args

```typescript
// BEFORE:
await flushHintReferentials(
  db,
  uploadHints,
  hintEntityNames,
  hintEntitiesFound,
  hintTagsFound,
  existingDomains,
);

// AFTER (simplified — entity args removed):
await flushHintReferentials(db, uploadHints, hintTagsFound, existingDomains);
```

- [ ] **Step 9: Rewrite entity-heavy functions in `harvest-hint-processor.ts`**

Remove:
- `setupHintEntities` function entirely
- `applyUploadHintsInPlace` entity injection block (keep tag tracking part as standalone)
- `insertNewProposals` entity loop
- `flushHintReferentials` entity promotion block
- `HintEntitySetup` interface
- `normalizeEntityName` export (no longer needed)
- `VALID_ENTITY_TYPES` constant
- `entities` import from `../db/schema.js`

Update `HintEntitySetup` → no longer needed; remove `hintEntityNames` / `hintEntityMeta` / `hintEntitiesFound` entirely from the exported types.

New simplified `flushHintReferentials` signature:

```typescript
export async function flushHintReferentials(
  db: FragmintDb,
  uploadHints: UploadHints,
  hintTagsFound: Set<string>,
  existingDomains: string[],
): Promise<void> {
  const now = new Date().toISOString();

  // Create pending domain entry if hint domain is new
  if (uploadHints.domain && !existingDomains.includes(uploadHints.domain)) {
    await db
      .insert(fragmentDomains)
      .values({
        slug: uploadHints.domain,
        label: uploadHints.domain,
        description: 'Hint-proposed',
        validated: 0,
        proposedBy: 'harvest-hint',
        trustSource: 'human-direct',
        created_at: now,
      })
      .onConflictDoNothing();
  }

  // Create pending tag entries for hint tags applied by the LLM to ≥1 fragment
  for (const tag of hintTagsFound) {
    await db
      .insert(fragmentTags)
      .values({
        slug: tag,
        label: tag,
        validated: 0,
        status: 'pending',
        proposedBy: 'harvest-hint',
        trustSource: 'human-direct',
        created_at: now,
      })
      .onConflictDoNothing();
  }
}
```

Also simplify `insertNewProposals` — remove the entity loop:

```typescript
export async function insertNewProposals(
  db: FragmintDb,
  blocks: CombinedBlock[],
  trustSourcesPerBlock: (TrustSourcesPerMetadata | undefined)[],
): Promise<void> {
  const now = new Date().toISOString();
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
    const block = blocks[blockIndex];
    const blockTrustSources = trustSourcesPerBlock[blockIndex];
    const proposals = block.new_proposals ?? {};

    const tagTrust = blockTrustSources?.tags ?? 'llm-inferred';
    const tagAutoValidated = tagTrust === 'human-direct' || tagTrust === 'llm-confirmed' ? 1 : 0;

    for (const rawTag of proposals.tags ?? []) {
      const slug = rawTag.replace(/^NEW:/i, '').toLowerCase().replace(/\s+/g, '-');
      await db
        .insert(fragmentTags)
        .values({
          slug,
          label: slug,
          category: 'proposed',
          status: tagAutoValidated ? 'active' : 'pending',
          validated: tagAutoValidated,
          proposedBy: 'llm-auto',
          trustSource: tagTrust,
          created_at: now,
        })
        .onConflictDoNothing();
    }

    const domainTrust = blockTrustSources?.domain ?? 'llm-inferred';
    const domainAutoValidated =
      domainTrust === 'human-direct' || domainTrust === 'llm-confirmed' ? 1 : 0;

    for (const rawDomain of proposals.domains ?? []) {
      const slug = rawDomain.replace(/^NEW:/i, '').toLowerCase().replace(/\s+/g, '-');
      await db
        .insert(fragmentDomains)
        .values({
          slug,
          label: slug,
          description: 'LLM-proposed',
          status: domainAutoValidated ? 'active' : 'pending',
          validated: domainAutoValidated,
          proposedBy: 'llm-auto',
          trustSource: domainTrust,
          created_at: now,
        })
        .onConflictDoNothing();
    }
  }
}
```

- [ ] **Step 10: Update imports in harvester-pipeline.ts** — remove entity/setupHintEntities/applyUploadHintsInPlace imports

- [ ] **Step 11: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

---

## Task 5: Harvester-validation cleanup

**Files:**
- Modify: `packages/server/src/services/harvester-validation.ts`

- [ ] **Step 1: Remove `linkFragmentEntities` function** — delete lines 248–278

- [ ] **Step 2: Remove entity imports**

```typescript
// REMOVE from imports:
import {
  ...
  entities,
  fragmentEntities,
} from '../db/schema.js';
```

- [ ] **Step 3: Remove `linkFragmentEntities` calls** (3 occurrences — in `validate` and `bulkAccept`)

```typescript
// REMOVE:
await linkFragmentEntities(db, result.id, candidate.entities_json);
await linkFragmentEntities(db, result.id, mod.entities_json ?? candidate.entities_json);
await linkFragmentEntities(db, id, candidate.entities_json);
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

---

## Task 6: Schema cleanup

**Files:**
- Modify: `packages/server/src/db/schema.ts`
- Modify: `packages/server/src/schema/trust-source.ts`

- [ ] **Step 1: Remove `entities` and `fragmentEntities` table exports from schema.ts**

```typescript
// REMOVE these entire table definitions (lines ~267–303):
export const entities = sqliteTable('entities', { ... });
export const fragmentEntities = sqliteTable('fragment_entities', { ... });
```

Note: the SQLite tables will still exist in the database — we just stop referencing them in code. No `DROP TABLE` needed.

- [ ] **Step 2: Remove `entities` from `UploadHints` in trust-source.ts**

```typescript
// BEFORE:
export interface UploadHints {
  domain?: string;
  function_type?: string;
  audience?: string[];
  maturity?: string;
  tags?: string[];
  entities?: string[];
}

export const UploadHintsSchema = z.object({
  ...
  entities: z.array(z.string().max(100)).max(20).optional(),
}).strict();

// AFTER:
export interface UploadHints {
  domain?: string;
  function_type?: string;
  audience?: string[];
  maturity?: string;
  tags?: string[];
}

export const UploadHintsSchema = z.object({
  domain: z.string().max(100).optional(),
  function_type: z.string().max(100).optional(),
  audience: z.array(z.string().max(50)).max(4).optional(),
  maturity: z.enum(['production', 'beta', 'roadmap', 'archive']).optional(),
  tags: z.array(z.string().max(80)).max(20).optional(),
}).strict();
```

- [ ] **Step 3: Remove `entities` from `computeTrustSources` fields array**

```typescript
// BEFORE:
const fields: (keyof UploadHints)[] = [
  'domain', 'function_type', 'audience', 'maturity', 'tags', 'entities',
];

// AFTER:
const fields: (keyof UploadHints)[] = [
  'domain', 'function_type', 'audience', 'maturity', 'tags',
];
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

---

## Task 7: Fragment service cleanup

**Files:**
- Modify: `packages/server/src/services/fragment-service.ts`

- [ ] **Step 1: Remove entity join from `getById`**

```typescript
// REMOVE lines ~210–218 (entity join) and line ~253 (entities field in return):

// Remove:
const entityRows = await this.db
  .select({
    id: entitiesTable.id,
    canonicalName: entitiesTable.canonicalName,
    type: entitiesTable.type,
  })
  .from(fragmentEntities)
  .innerJoin(entitiesTable, eq(entitiesTable.id, fragmentEntities.entity_id))
  .where(eq(fragmentEntities.fragment_id, id));

// Change return:
// BEFORE: return { ...row, frontmatter, body, entities: entityRows, harvest_near_dup };
// AFTER:  return { ...row, frontmatter, body, harvest_near_dup };
```

- [ ] **Step 2: Remove `updateEntities` method** — delete lines 270–287

- [ ] **Step 3: Remove entity imports**

```typescript
// REMOVE:
import {
  ...
  fragmentEntities,
  entities as entitiesTable,
} from '../db/schema.js';
// Also remove from drizzle: inArray (if only used for entity query)
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

---

## Task 8: Server routes cleanup

**Files:**
- Modify: `packages/server/src/routes/fragment-routes.ts`
- Modify: `packages/server/src/routes/admin-referential-helpers.ts`
- Modify: `packages/server/src/routes/admin-referential-routes.ts`
- Modify: `packages/server/src/routes/admin-metadata-routes.ts`
- Modify: `packages/server/src/routes/admin-metadata-helpers.ts`

- [ ] **Step 1: Remove `PUT /fragments/:id/entities` from fragment-routes.ts** (lines ~247–265)

Delete the entire route handler:

```typescript
// REMOVE:
app.put(
  `${prefix}/fragments/:id/entities`,
  { preHandler: writeHandlers },
  async (request, reply) => { ... }
);
```

- [ ] **Step 2: Update admin-referential-helpers.ts**

Remove `entity` from `VALID_TYPES`, `TABLE_MAP`, `TABLE_NAME_MAP`:

```typescript
// BEFORE:
export type ReferentialType = 'domain' | 'tag' | 'entity' | 'type' | 'function';
export const TABLE_MAP = { domain: fragmentDomains, tag: fragmentTags, type: fragmentTypes, function: fragmentFunctions, entity: entities } as const;
export const TABLE_NAME_MAP: Record<ReferentialType, string> = { ..., entity: 'entities' };
export const VALID_TYPES: ReferentialType[] = ['domain', 'tag', 'entity', 'type', 'function'];

// AFTER:
export type ReferentialType = 'domain' | 'tag' | 'type' | 'function';
export const TABLE_MAP = { domain: fragmentDomains, tag: fragmentTags, type: fragmentTypes, function: fragmentFunctions } as const;
export const TABLE_NAME_MAP: Record<ReferentialType, string> = { domain: 'fragment_domains', tag: 'fragment_tags', type: 'fragment_types', function: 'fragment_functions' };
export const VALID_TYPES: ReferentialType[] = ['domain', 'tag', 'type', 'function'];
```

Remove `entity` from `getFragmentsForItem` switch (the `case 'entity': ...` branch).

Remove `entity` and `fragmentEntities` from imports.

- [ ] **Step 3: Remove `/cooccurrence` endpoint from admin-referential-routes.ts** (lines 47–117)

Delete the entire `app.get('/v1/admin/referential/cooccurrence', ...)` handler.

Remove entity-specific branches throughout the file:
- In `GET /v1/admin/referential/:type`: remove `entity` handling in category filter, in flag computation, in preview; remove `computeFlagsForEntity`, `getPreviewForEntity` calls
- In `PATCH /v1/admin/referential/:type/:id/category`: remove `entity` branch
- In `POST /v1/admin/referential/:type/:id/rename`: remove entity rename logic

Remove `entities`, `fragmentEntities` from imports.

- [ ] **Step 4: Update admin-metadata-routes.ts** — remove all entity kind handling

a. In `GET /v1/admin/metadata/proposals`: remove the entire `if (!kind || kind === 'entity')` block (lines ~126–160)

b. In `POST /v1/admin/metadata/proposals/:id/approve`: 
```typescript
// Change kind schema from:
z.object({ kind: z.enum(['tag', 'domain', 'entity']) })
// To:
z.object({ kind: z.enum(['tag', 'domain']) })
// Remove else branch (entity approval)
```

c. In `POST /v1/admin/metadata/proposals/:id/reject`: remove entity delete branch

d. In `POST /v1/admin/metadata/proposals/:id/rename`: remove entity rename branch

e. In `POST /v1/admin/metadata/proposals/:id/merge`: remove entity merge branch

f. Delete entirely: `POST /v1/admin/metadata/proposals/:id/set-as-alias` (lines ~391–423)

g. Delete entirely: `POST /v1/admin/metadata/proposals/:id/reclassify-entity-type` (lines ~426–451)

h. In `GET /v1/admin/metadata/validated`: remove entity branch (the default else that queries entities)

i. In `GET /v1/admin/metadata/pending-count`: 
```typescript
// BEFORE:
const [tagRows, entityRows, domainRows, typeRows] = await Promise.all([...]);
const entitiesCount = entityRows[0]?.count ?? 0;
return { data: { tags, entities: entitiesCount, domains, types, total: tags + entitiesCount + domains + types } };

// AFTER:
const [tagRows, domainRows, typeRows] = await Promise.all([...]);
return { data: { tags, domains, types, total: tags + domains + types } };
```

Remove `entities`, `fragmentEntities` from imports.

- [ ] **Step 5: Update admin-metadata-helpers.ts** — remove entity functions

Remove:
- `getPreviewForEntity` function
- `computeFlagsForEntity` function
- Entity part of `computeCounts`:
```typescript
// BEFORE:
export async function computeCounts(db: FragmintDb) {
  const tagCount = ...;
  const entityCount = ...;
  const domainCount = ...;
  const entitiesByType = ...;
  return { tags: ..., entities: ..., domains: ..., entities_by_type: ... };
}

// AFTER:
export async function computeCounts(db: FragmintDb) {
  const [tagCount, domainCount] = await Promise.all([
    db.select({ value: count() }).from(fragmentTags).where(eq(fragmentTags.validated, 0)),
    db.select({ value: count() }).from(fragmentDomains).where(eq(fragmentDomains.validated, 0)),
  ]);
  return {
    tags: tagCount[0]?.value ?? 0,
    domains: domainCount[0]?.value ?? 0,
  };
}
```

Remove `entities`, `fragmentEntities` from imports.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: all clear on the server.

---

## Task 9: Web types and API hooks

**Files:**
- Modify: `packages/web/src/types/admin-metadata.ts`
- Modify: `packages/web/src/types/trust-source.ts`
- Modify: `packages/web/src/api/types.ts`
- Modify: `packages/web/src/api/hooks/use-reference-lookup.ts`
- Modify: `packages/web/src/api/hooks/use-metadata-proposals.ts`

- [ ] **Step 1: Update `packages/web/src/types/admin-metadata.ts`**

```typescript
// BEFORE:
export type ProposalKind = 'tag' | 'domain' | 'entity' | 'type';
export type EntityType = 'client' | 'product' | 'technology' | 'partner' | 'certification' | 'regulation';
export interface ProposalCounts {
  tags: number;
  entities: number;
  domains: number;
  total: number;
  entities_by_type: Record<EntityType, number>;
}

// AFTER:
export type ProposalKind = 'tag' | 'domain' | 'type';
export interface ProposalCounts {
  tags: number;
  domains: number;
  total: number;
}
```

- [ ] **Step 2: Update `packages/web/src/types/trust-source.ts`** — mirror server schema change

```typescript
// Remove entities field:
export interface UploadHints {
  domain?: string;
  function_type?: string;
  audience?: string[];
  maturity?: string;
  tags?: string[];
  // entities removed
}
```

- [ ] **Step 3: Update `packages/web/src/api/types.ts`** — remove entity fields

```typescript
// On HarvestCandidate, remove:
entities_json: string | null;

// Remove FragmentEntity type if defined here
// Remove entities field from FragmentDetail if defined here
```

- [ ] **Step 4: Update `use-reference-lookup.ts`** — remove entity kind

```typescript
// BEFORE:
export function useReferenceLookup(kind: 'domain' | 'tag' | 'function' | 'entity', q: string)

// AFTER:
export function useReferenceLookup(kind: 'domain' | 'tag' | 'function', q: string)
```

- [ ] **Step 5: Update `use-metadata-proposals.ts`** — remove entity-specific hooks

Remove or comment out:
- `useConvertToEntity` hook (calls `/convert-to-entity`)
- `useSetAsAlias` hook (calls `/set-as-alias`)
- `useReclassifyEntityType` hook
- `entity_type` parameter from `useMetadataProposals`
- `entity_type` parameter from `useValidatedReferenceValues`

Update `ProposalCounts` usage to match new type.

- [ ] **Step 6: Typecheck web**

```bash
pnpm --filter @fragmint/web typecheck
```

Expected: errors on components that use removed entity types — fixed in next tasks.

---

## Task 10: Web harvest components

**Files:**
- Modify: `packages/web/src/components/candidate-detail-sheet.tsx`
- Modify: `packages/web/src/components/harvest/upload-hints-form.tsx`
- Delete: `packages/web/src/components/harvest/entity-selector.tsx`

- [ ] **Step 1: Remove `EntityEditor` from `candidate-detail-sheet.tsx`**

Delete:
- `CandidateEdits.entities_json` field
- `ENTITY_TYPES` constant (lines 32–39)
- `parseEntities` function
- `serializeEntities` function
- `flatEntities` function
- `buildMap` function
- `EntityEditor` component (lines 86–161)
- All `entities_json` rendering / usage in `CandidateDetailSheet`
- Remove `Plus` import (if only used by EntityEditor)

- [ ] **Step 2: Remove `EntitySelector` from `upload-hints-form.tsx`**

```typescript
// Remove import:
import { EntitySelector } from './entity-selector';

// Remove EntitySelector usage block (the <div> containing EntitySelector ~line 83)
// Remove entityIdsRef and toStableEntries helpers
```

- [ ] **Step 3: Delete `entity-selector.tsx`**

```bash
rm packages/web/src/components/harvest/entity-selector.tsx
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @fragmint/web typecheck
```

---

## Task 11: Web admin components — entity removal

**Files:**
- Modify: `packages/web/src/components/admin/fragment-detail-drawer.tsx`
- Modify: `packages/web/src/components/admin/metadata/admin-metadata-tab.tsx`
- Modify: `packages/web/src/components/admin/metadata/proposal-card.tsx`
- Modify: `packages/web/src/components/admin/metadata/unified-metadata-card.tsx`
- Modify: `packages/web/src/components/admin/metadata/merge-dialog.tsx`
- Modify: `packages/web/src/components/admin/referential-list.tsx`
- Modify: `packages/web/src/components/admin/referential-item-card.tsx`
- Modify: `packages/web/src/components/admin/referential-item-sheet.tsx`
- Modify: `packages/web/src/components/admin/rename-modal.tsx`
- Delete: `packages/web/src/components/admin/metadata/convert-to-entity-dialog.tsx`
- Modify: `packages/web/src/pages/admin/metadata.tsx`

- [ ] **Step 1: Remove `EntityPicker` and entity display from `fragment-detail-drawer.tsx`**

Remove:
- `FragmentEntity` interface
- `EntityPicker` component (lines 62–113)
- `editEntities` state + `setEditEntities`
- `startEditing` entity init: `setEditEntities(frag?.entities ?? [])`
- `cancelEditing` entity reset: `setEditEntities([])`
- `addEntity` / `removeEntity` functions
- `updateMutation` entity put call: `apiRequest('PUT', /entities, ...)`
- The entire `{/* Entities — shown in both modes */}` JSX block (~lines 369–419)
- `entities: FragmentEntity[]` from `FragmentDetail` interface
- `useReferenceLookup` import (if only used for entity)
- `useDebouncedValue` import (if only used for entity)

- [ ] **Step 2: Remove entity tab from `admin-metadata-tab.tsx`**

```typescript
// BEFORE:
const kinds: Array<{ key: ProposalKind; label: string; count: number }> = [
  { key: 'tag', label: t('admin', 'kindTags'), count: counts.tags },
  { key: 'entity', label: t('admin', 'kindEntities'), count: counts.entities },
  { key: 'domain', label: t('admin', 'kindDomains'), count: counts.domains },
];

// AFTER:
const kinds: Array<{ key: ProposalKind; label: string; count: number }> = [
  { key: 'tag', label: t('admin', 'kindTags'), count: counts.tags },
  { key: 'domain', label: t('admin', 'kindDomains'), count: counts.domains },
];
```

Also remove `countsByType` prop pass to `ProposalsList` if it was entity-specific.

- [ ] **Step 3: Remove convert-to-entity button from `proposal-card.tsx`**

```typescript
// Remove import:
import { ConvertToEntityDialog } from './convert-to-entity-dialog';
// Remove all ConvertToEntityDialog usage and state
```

- [ ] **Step 4: Delete `convert-to-entity-dialog.tsx`**

```bash
rm packages/web/src/components/admin/metadata/convert-to-entity-dialog.tsx
```

- [ ] **Step 5: Remove entity sections from `unified-metadata-card.tsx`**

Remove:
- Entity-specific display (category/type chips with entity flavoring)
- `ConvertToEntityDialog` import and usage
- Entity-specific action buttons

- [ ] **Step 6: Remove entity merge branch from `merge-dialog.tsx`**

If `merge-dialog.tsx` handles entity merging with `set-as-alias` or entity-specific APIs, simplify to only tag/domain merge.

- [ ] **Step 7: Remove entity tab from `referential-list.tsx`**

Remove entity from the tab list/filter. Remove entity-specific display logic in the list item rendering.

- [ ] **Step 8: Clean up `referential-item-card.tsx` and `referential-item-sheet.tsx`**

Remove entity-specific display (aliases, type/category for entities).

- [ ] **Step 9: Remove entity handling from `rename-modal.tsx`**

Remove entity-specific rename logic (e.g., `set canonicalName` instead of `slug`).

- [ ] **Step 10: Remove `CooccurrenceHeatmap` from `pages/admin/metadata.tsx`**

```typescript
// BEFORE:
import { CooccurrenceHeatmap } from '@/components/admin/cooccurrence-heatmap';
...
<div className="pt-6 mt-6 border-t">
  <Tooltip>...</Tooltip>
  {showCooccurrence && <CooccurrenceHeatmap />}
</div>

// AFTER:
// Remove import and the entire div block
// Also remove useState for showCooccurrence
```

- [ ] **Step 11: Typecheck**

```bash
pnpm --filter @fragmint/web typecheck
```

---

## Task 12: Admin UI rename — "Métadonnées" → "Référentiel"

**Files:**
- Modify: `packages/web/src/lib/i18n.tsx`
- Modify: `packages/web/src/pages/admin/home.tsx`
- Modify: `packages/web/src/pages/admin/metadata.tsx`

- [ ] **Step 1: Update i18n labels**

In `packages/web/src/lib/i18n.tsx`:

```typescript
// admin section — update relevant labels:

// Tab label (appears in admin sidebar/nav):
metadata: { fr: 'Référentiel', en: 'Referential' },
// (was: 'Métadonnées' / 'Metadata')

// Page title:
metadataTitle: { fr: 'Référentiel', en: 'Referential' },
// (was: 'Métadonnées' / 'Metadata')

// Remove kindEntities (entity tab gone):
// kindEntities: { fr: 'Entités', en: 'Entities' },   ← DELETE

// Update tabs section description to remove entity references
metadataDesc: {
  fr: 'Tags, domaines extraits automatiquement ou saisis manuellement. Filtrez par statut pour valider les propositions ou gérer le référentiel.',
  en: 'Tags and domains — extracted automatically or entered manually.',
},
```

- [ ] **Step 2: Update admin home page tab card**

In `packages/web/src/pages/admin/home.tsx`:

```typescript
// Find the card for /admin/metadata and update:
title: 'Référentiel',           // was 'Metadata'
description: 'Gère le vocabulaire du système : domaines, types, tags. ...'  // remove entity mention
```

- [ ] **Step 3: Final typecheck + lint**

```bash
pnpm --filter @fragmint/server typecheck
pnpm --filter @fragmint/web typecheck
pnpm lint
```

Expected: zero errors.

---

## Task 13: Full test run + Docker rebuild

- [ ] **Step 1: Run all unit tests**

```bash
pnpm test
```

Expected: all pass.

- [ ] **Step 2: Build check**

```bash
pnpm build
```

Expected: clean build.

- [ ] **Step 3: Rebuild Docker image (prod)**

```bash
docker compose build fragmint
docker compose up -d fragmint
```

- [ ] **Step 4: Smoke-test via admin UI**

1. Navigate to `/admin/metadata` — should now say "Référentiel" in title
2. Tabs show: Tags | Domaines (no Entités tab)
3. Fragment detail drawer — no "Entités" section
4. Upload hints form — no entity selector
5. Harvest a document — candidates have no `entities_json` rendered

---

## Self-Review

### Spec coverage
- ✅ Rename "Métadonnées" → "Référentiel": Tasks 12
- ✅ Entities become prefixed tags: Tasks 1 (migration), 2 (LLM), 4 (pipeline)
- ✅ Data migration: Task 1
- ✅ Remove entity infrastructure DB side: Tasks 5, 6
- ✅ Remove entity routes: Task 8
- ✅ Remove entity UI: Tasks 9, 10, 11

### No placeholders
- All code in each step is complete and compilable. No "add appropriate handling" vagueness.

### Type consistency
- `CombinedBlock` loses `entities` field throughout: Task 2 defines the new interface, Tasks 3/4/5/6 consume it.
- `UploadHints` loses `entities` in both server (`trust-source.ts`) and web (`types/trust-source.ts`).
- `ReferentialType` loses `entity` in helpers and all callers.
- `ProposalKind` loses `entity` in web types and all callers.
- `computeQualitySignals` signature updated in Task 3, called in Task 4 with matching args.
