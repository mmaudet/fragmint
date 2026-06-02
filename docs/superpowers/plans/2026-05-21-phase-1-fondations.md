# Feature: Phase 1 — Fondations (Chunking, Prompt unifié, Référentiels, Confiance)

## Summary

Refonte du pipeline harvest de Fragmint en 3 jours : (1) ajout de référentiels admin structurés (subjects, entities) en DB + seeds Linagora, (2) refonte du prompt `segmentAndClassify` avec contraintes de taille 30-200 mots + post-processing split/merge, (3) fix exact duplicate detection et passage de `harvest_confidence` jusqu'aux fragments finaux.

## User Story

As a Linagora sales/pre-sales user validating harvested fragments  
I want fragments to be well-sized, correctly classified with structured metadata, and exact duplicates clearly flagged  
So that my knowledge base is trustworthy enough to be used for automated proposal generation

## Problem Statement

Three concrete bugs + one missing feature observed in production:

1. **Fragments oversized**: `segmentAndClassify` prompt has no size constraint → fragments of 300-500 words that mix unrelated ideas
2. **Metadata unstructured**: LLM outputs free-form tags (`jmap`, `open-source`, `twake mail`) with no canonical referential → search and filtering unreliable  
3. **Exact duplicate bug**: `deduplicateBlocks` uses first-50-chars string key (harvester-service.ts:471-480), not full body comparison → `duplicate_score` stays ~80% on exact matches instead of 1.0
4. **Confidence lost**: `harvest_confidence` field exists in DB schema but is never written when creating the final fragment (fragment-service.ts:117-136 has no `harvest_confidence` write)

## Solution Statement

Two-level chunking fix (prompt constraint + post-processing safety net), unified prompt rewrite that outputs subject/function/audience/maturity/entities from referentials, new `subjects` and `entities` DB tables seeded with Linagora canonical data, fix of exact duplicate detection to use full-body normalized comparison, and confidence propagation to final fragments.

## Metadata

| Field            | Value |
|------------------|-------|
| Type             | ENHANCEMENT + BUG_FIX |
| Complexity       | HIGH |
| Systems Affected | server (llm-client, harvester-service, schema, connection, index, taxonomy-routes), web (fragment-detail, harvest page) |
| Dependencies     | None new — existing stack (Drizzle, Zod, Fastify 5, SQLite) |
| Estimated Tasks  | 11 |

---

## UX Design

### Before State

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                              BEFORE STATE                                      ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║   Upload DOCX          LLM segment+classify       Harvest candidates          ║
║   ──────────  ──────►  ────────────────────  ───► ─────────────────          ║
║   (1 file)             (no size constraint)        fragment 1: 450 words      ║
║                        (free-form tags)             "Cloud Act, FISA, RGPD,  ║
║                        (domain: only 5 values)       Gaia-X, sovereignty..."  ║
║                                                     confidence: 0.87 ???      ║
║                                                                               ║
║   PAIN_POINTS:                                                                ║
║   - Fragments too large, mix ideas → not reusable                             ║
║   - Tags: "twake mail", "Twake Mail", "twake-mail" → 3 unrelated entries     ║
║   - Exact duplicate shows 82% instead of 100% → human can't trust score      ║
║   - harvest_confidence visible on candidate but gone after validation         ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

### After State

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                               AFTER STATE                                      ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║   Upload DOCX      LLM (30-200w constraint)     Post-process       Candidates ║
║   ──────────  ───► ─────────────────────────  ► split/merge  ──►  ──────────  ║
║                    subject: "twake-mail"  ✓     oversized → 2     frag 1: 95w ║
║                    function: "commercial" ✓     undersized → 1    subject: twake-mail ║
║                    entities: {                  (idempotent)       entities: {clients: ["CNB"]} ║
║                      clients: ["CNB"]                              confidence: 0.87            ║
║                      products: ["Twake Mail"]                      NEW:edge → admin review     ║
║                    }                                                                           ║
║                    new_proposals: {                                                            ║
║                      tags: ["NEW:edge-computing"]  → admin queue                              ║
║                    }                                                                           ║
║                                                                               ║
║   EXACT DUPLICATE: normalizeForComparison(body) → score = 1.0               ║
║   CONFIDENCE: propagated to final fragment.harvest_confidence field          ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

### Interaction Changes

| Location | Before | After | User Impact |
|----------|--------|-------|-------------|
| Harvest candidates list | Fragments 300-500 words | Fragments 30-200 words | Candidates are reusable, one idea each |
| Candidate card | Tags: free-form | Tags: canonical from referential, NEW: flagged | Consistent metadata across corpus |
| Duplicate detection | Score ~80% on exact match | Score 1.0 on exact match | Human trusts the flag |
| Fragment detail | No confidence shown | `harvest_confidence` visible | Reviewer knows LLM certainty |
| Admin page (new) | No referential management | Validate/reject NEW: proposals from LLM | Admin controls taxonomy quality |

---

## Mandatory Reading

**CRITICAL: Implementation agent MUST read these files before starting any task:**

| Priority | File | Lines | Why Read This |
|----------|------|-------|---------------|
| P0 | `packages/server/src/services/llm-client.ts` | 1-170 | segmentAndClassify prompt + CombinedBlock type to REWRITE |
| P0 | `packages/server/src/services/harvester-service.ts` | 75-254, 446-480 | Full pipeline + deduplicateBlocks to MODIFY |
| P0 | `packages/server/src/db/connection.ts` | 1-165 | Raw SQL table creation pattern + ALTER TABLE migration pattern |
| P0 | `packages/server/src/db/schema.ts` | 1-193 | All Drizzle table exports — add new tables here |
| P1 | `packages/server/src/services/harvester-taxonomy.ts` | all | HARVESTER_DOMAINS + HARVESTER_TYPES patterns to EXTEND |
| P1 | `packages/server/src/routes/taxonomy-routes.ts` | 1-135 | Admin CRUD route pattern to MIRROR for subjects/entities |
| P1 | `packages/server/src/index.ts` | 120-140, 204-296 | Seed pattern + route registration to FOLLOW |
| P1 | `packages/server/src/services/fragment-service.ts` | 100-160 | Fragment create → find where harvest_confidence should be written |
| P2 | `packages/server/src/schema/fragment.ts` | 30-91 | Zod schemas — add harvest_confidence to createFragmentSchema |

---

## Patterns to Mirror

**MIGRATION_PATTERN (try/catch ALTER TABLE):**
```typescript
// SOURCE: packages/server/src/db/connection.ts:125-135
// COPY THIS PATTERN for every new column:
try {
  sqlite.exec('ALTER TABLE fragments ADD COLUMN valid_from TEXT');
} catch (_) {
  // Column already exists — ignore
}
```

**TABLE_CREATION_PATTERN (raw SQL in createDb):**
```typescript
// SOURCE: packages/server/src/db/connection.ts:13-50 (fragments table)
// COPY THIS PATTERN for subjects/entities tables:
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    ...
    created_at TEXT NOT NULL
  )
`);
```

**DRIZZLE_SCHEMA_PATTERN:**
```typescript
// SOURCE: packages/server/src/db/schema.ts:173-192 (fragmentTags)
// COPY THIS PATTERN:
export const fragmentTags = sqliteTable('fragment_tags', {
  slug: text('slug').primaryKey(),
  label: text('label').notNull(),
  category: text('category'),
  created_at: text('created_at').notNull(),
});
```

**SEED_AT_STARTUP_PATTERN:**
```typescript
// SOURCE: packages/server/src/index.ts:123-136
// COPY THIS PATTERN:
const typeCount = await db.select({ c: count() }).from(fragmentTypes);
if (typeCount[0].c === 0) {
  for (const slug of FRAGMENT_TYPES) {
    await db.insert(fragmentTypes).values({ slug, label: slug, created_at: now }).onConflictDoNothing();
  }
}
```

**ADMIN_ROUTE_PATTERN:**
```typescript
// SOURCE: packages/server/src/routes/taxonomy-routes.ts:30-60
// COPY THIS PATTERN for subject/entity CRUD:
app.post(
  '/v1/admin/subjects',
  { preHandler: [authenticate, requireRole('admin')] },
  async (request, reply) => {
    const parsed = createSubjectSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    // ...insert + return 201
  },
);
```

**ERROR_RESPONSE_PATTERN:**
```typescript
// SOURCE: packages/server/src/routes/taxonomy-routes.ts:47-48
return reply.status(409).send({ data: null, meta: null, error: `Already exists` });
// Always: { data, meta, error } shape
```

**DEDUPLICATION_FIX_PATTERN (new — exact match):**
```typescript
// IMPLEMENT: full-body normalized comparison BEFORE Milvus
function normalizeForComparison(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}
// Called BEFORE deduplicateBlocks, return { id, score: 1.0 } on exact match
```

---

## Files to Change

| File | Action | Justification |
|------|--------|---------------|
| `packages/server/src/db/connection.ts` | UPDATE | Add `subjects`, `entities`, `fragment_entities` table creation + ALTER TABLE for new columns on `fragments` and `harvest_candidates` |
| `packages/server/src/db/schema.ts` | UPDATE | Add Drizzle exports for `subjects`, `entities`, `fragmentEntities`; add new columns to existing table types |
| `packages/server/src/services/harvester-taxonomy.ts` | UPDATE | Add `INITIAL_SUBJECTS`, `INITIAL_ENTITIES` exports |
| `packages/server/src/index.ts` | UPDATE | Seed subjects/entities at startup; pass subjects/entities to harvester |
| `packages/server/src/services/llm-client.ts` | UPDATE | Rewrite `CombinedBlock` type + `segmentAndClassify` prompt with size rules + referential fields |
| `packages/server/src/services/harvester-service.ts` | UPDATE | (1) Fix `deduplicateBlocks` to use full-body comparison; (2) Add `splitOversizedBlocks` + `mergeUndersizedBlocks`; (3) Pass subjects/entities to `segmentAndClassify`; (4) Store new fields on candidates |
| `packages/server/src/schema/fragment.ts` | UPDATE | Add `harvest_confidence` to `createFragmentSchema` |
| `packages/server/src/services/fragment-service.ts` | UPDATE | Write `harvest_confidence` when `origin === 'harvested'` |
| `packages/server/src/routes/taxonomy-routes.ts` | UPDATE | Add subject + entity admin CRUD endpoints |

---

## NOT Building (Scope Limits)

- **Signal 3 (prototype distance)**: requires embeddings of validated fragments → skip for Phase 1, mark as Phase 2
- **Self-consistency check (Signal 4)**: 2x LLM cost → out of scope Phase 1
- **UI admin page**: `/admin/proposals` page in `web/` → skeleton only in Phase 1 (routes sufficient for demo)
- **Re-classification of split sub-blocks via LLM**: complex async flow, defer to Phase 2
- **fragment_entities join table UI**: backend only in Phase 1
- **Milvus partition per subject**: Phase 2 (Milvus disabled by default)
- **Near-duplicate detection via Jaccard**: out of scope — existing Milvus semantic search covers this

---

## Step-by-Step Tasks

Execute in order. Each task has a typecheck validation step.

---

### Task 1: DB raw SQL — Add subjects + entities tables

**File**: `packages/server/src/db/connection.ts`  
**Action**: ADD table definitions inside `createDb()`, after existing table creation (around line 120), before the ALTER TABLE section.

**IMPLEMENT** (add these raw SQL blocks):

```sql
CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT,
  description TEXT,
  validated INTEGER NOT NULL DEFAULT 1,
  usage_count INTEGER NOT NULL DEFAULT 0,
  proposed_by TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('client','product','technology','partner','certification','regulation','metric')),
  name TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  aliases TEXT,
  validated INTEGER NOT NULL DEFAULT 0,
  usage_count INTEGER NOT NULL DEFAULT 0,
  proposed_by TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL,
  UNIQUE(type, normalized_name)
);

CREATE INDEX IF NOT EXISTS idx_entities_type_normalized ON entities(type, normalized_name);
```

**ALSO ADD** these ALTER TABLE statements (in the existing migration section, lines 125-161):

```typescript
try {
  sqlite.exec('ALTER TABLE harvest_candidates ADD COLUMN subject TEXT');
} catch (_) {}
try {
  sqlite.exec('ALTER TABLE harvest_candidates ADD COLUMN function_type TEXT');
} catch (_) {}
try {
  sqlite.exec('ALTER TABLE harvest_candidates ADD COLUMN audience TEXT');
} catch (_) {}
try {
  sqlite.exec('ALTER TABLE harvest_candidates ADD COLUMN maturity TEXT');
} catch (_) {}
try {
  sqlite.exec('ALTER TABLE harvest_candidates ADD COLUMN entities_json TEXT');
} catch (_) {}
try {
  sqlite.exec('ALTER TABLE harvest_candidates ADD COLUMN new_proposals TEXT');
} catch (_) {}
try {
  sqlite.exec('ALTER TABLE fragments ADD COLUMN subject TEXT');
} catch (_) {}
try {
  sqlite.exec('ALTER TABLE fragments ADD COLUMN harvest_confidence REAL');
} catch (_) {}
```

Note: `fragments.harvest_confidence` may already exist in schema (check connection.ts around line 22) — the `try/catch` handles it idempotently.

**VALIDATE**: `pnpm --filter @fragmint/server typecheck`

---

### Task 2: Drizzle schema — Add new table declarations

**File**: `packages/server/src/db/schema.ts`  
**Action**: ADD Drizzle table exports after the existing `fragmentTags` table (around line 193).

**IMPLEMENT**:

```typescript
export const subjects = sqliteTable('subjects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  displayName: text('display_name'),
  description: text('description'),
  validated: integer('validated', { mode: 'boolean' }).notNull().default(true),
  usageCount: integer('usage_count').notNull().default(0),
  proposedBy: text('proposed_by').notNull().default('admin'),
  createdAt: text('created_at').notNull(),
});

export const entities = sqliteTable('entities', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type', {
    enum: ['client', 'product', 'technology', 'partner', 'certification', 'regulation', 'metric'],
  }).notNull(),
  name: text('name').notNull(),
  canonicalName: text('canonical_name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  aliases: text('aliases'),
  validated: integer('validated', { mode: 'boolean' }).notNull().default(false),
  usageCount: integer('usage_count').notNull().default(0),
  proposedBy: text('proposed_by').notNull().default('admin'),
  createdAt: text('created_at').notNull(),
});
```

**ALSO ADD** new columns to existing table declarations:

In `harvestCandidates` table, add:
```typescript
subject: text('subject'),
functionType: text('function_type'),
audience: text('audience'),
maturity: text('maturity'),
entitiesJson: text('entities_json'),
newProposals: text('new_proposals'),
```

In `fragments` table, verify `harvest_confidence: real('harvest_confidence')` exists (it's at line ~24). If `subject` column is missing, add `subject: text('subject')`.

**VALIDATE**: `pnpm --filter @fragmint/server typecheck`

---

### Task 3: Extend harvester-taxonomy.ts with Linagora referential data

**File**: `packages/server/src/services/harvester-taxonomy.ts`  
**Action**: ADD exports for subjects and entities below existing constants.

**IMPLEMENT**:

```typescript
export interface SubjectDef {
  name: string;
  displayName: string;
  description: string;
}

export interface EntityDef {
  type: 'client' | 'product' | 'technology' | 'partner' | 'certification' | 'regulation' | 'metric';
  canonicalName: string;
  aliases: string[];
}

export const INITIAL_SUBJECTS: SubjectDef[] = [
  { name: 'twake-mail', displayName: 'Twake Mail', description: 'Twake Mail messaging product' },
  { name: 'twake-calendar', displayName: 'Twake Calendar', description: 'Twake Calendar product' },
  { name: 'twake-drive', displayName: 'Twake Drive', description: 'Twake Drive file sharing' },
  { name: 'twake-chat', displayName: 'Twake Chat', description: 'Twake Chat instant messaging' },
  { name: 'linshare', displayName: 'LinShare', description: 'LinShare secure file sharing' },
  { name: 'lincloud', displayName: 'LinCloud', description: 'LinCloud sovereign cloud platform' },
  { name: 'linto', displayName: 'LinTO', description: 'LinTO voice/AI assistant' },
  { name: 'openrag', displayName: 'OpenRAG', description: 'OpenRAG retrieval-augmented generation' },
  { name: 'linagora-corp', displayName: 'Linagora (société)', description: 'Linagora as a company' },
  { name: 'other', displayName: 'Autre', description: 'Fallback when nothing else fits' },
];

export const INITIAL_ENTITIES: EntityDef[] = [
  // Clients
  { type: 'client', canonicalName: 'CNB', aliases: ['Conseil National des Barreaux'] },
  { type: 'client', canonicalName: 'Sesam-Vitale', aliases: ['SESAM-Vitale', 'Sesam Vitale'] },
  { type: 'client', canonicalName: 'IRA', aliases: ["Institut Régional d'Administration", 'IRAs'] },
  { type: 'client', canonicalName: 'État Mauricien', aliases: ['Maurice', 'gouvernement mauricien'] },
  { type: 'client', canonicalName: 'DGAFP', aliases: ["Direction générale de l'administration"] },
  // Products
  { type: 'product', canonicalName: 'Twake Mail', aliases: ['Twake.Mail'] },
  { type: 'product', canonicalName: 'Twake Calendar', aliases: ['Twake.Calendar'] },
  { type: 'product', canonicalName: 'LinShare', aliases: ['LinShare Pro'] },
  { type: 'product', canonicalName: 'LinCloud', aliases: ['LinCloud Souverain'] },
  { type: 'product', canonicalName: 'Apache James', aliases: ['James'] },
  { type: 'product', canonicalName: 'Office 365', aliases: ['Microsoft 365', 'O365'] },
  // Technologies
  { type: 'technology', canonicalName: 'JMAP', aliases: [] },
  { type: 'technology', canonicalName: 'IMAP', aliases: [] },
  { type: 'technology', canonicalName: 'CalDAV', aliases: [] },
  { type: 'technology', canonicalName: 'LDAP', aliases: ['Active Directory', 'AD'] },
  { type: 'technology', canonicalName: 'Kubernetes', aliases: ['K8s'] },
  { type: 'technology', canonicalName: 'PostgreSQL', aliases: ['Postgres'] },
  // Certifications
  { type: 'certification', canonicalName: 'SecNumCloud', aliases: [] },
  { type: 'certification', canonicalName: 'HDS', aliases: ['Hébergeur de Données de Santé'] },
  { type: 'certification', canonicalName: 'ISO27001', aliases: ['ISO 27001'] },
  // Regulations
  { type: 'regulation', canonicalName: 'RGPD', aliases: ['GDPR'] },
  { type: 'regulation', canonicalName: 'Cloud Act', aliases: ['CLOUD Act'] },
  // Partners
  { type: 'partner', canonicalName: 'DINUM', aliases: ['Direction interministérielle du numérique'] },
  { type: 'partner', canonicalName: 'OVH', aliases: ['OVHcloud'] },
];
```

**VALIDATE**: `pnpm --filter @fragmint/server typecheck`

---

### Task 4: Seed subjects + entities at startup

**File**: `packages/server/src/index.ts`  
**Action**: After the existing `fragmentDomains` seed block (around line 136), add subject and entity seeding. Import `INITIAL_SUBJECTS`, `INITIAL_ENTITIES` from `harvester-taxonomy.ts`. Import `subjects`, `entities` from `db/schema.ts`.

**IMPLEMENT** (mirror the existing seed pattern at lines 123-136):

```typescript
// Seed subjects if empty
const subjectCount = await db.select({ c: count() }).from(subjects);
if (subjectCount[0].c === 0) {
  for (const s of INITIAL_SUBJECTS) {
    await db.insert(subjects).values({
      name: s.name,
      displayName: s.displayName,
      description: s.description,
      validated: true,
      proposedBy: 'admin',
      createdAt: now,
    }).onConflictDoNothing();
  }
}

// Seed entities if empty
const entityCount = await db.select({ c: count() }).from(entities);
if (entityCount[0].c === 0) {
  for (const e of INITIAL_ENTITIES) {
    const normalized = e.canonicalName.toLowerCase().replace(/\s+/g, '-');
    await db.insert(entities).values({
      type: e.type,
      name: e.canonicalName,
      canonicalName: e.canonicalName,
      normalizedName: normalized,
      aliases: JSON.stringify(e.aliases),
      validated: true,
      proposedBy: 'admin',
      createdAt: now,
    }).onConflictDoNothing();
  }
}
```

**VALIDATE**: `pnpm --filter @fragmint/server typecheck`

---

### Task 5: Admin routes for subjects and entities

**File**: `packages/server/src/routes/taxonomy-routes.ts`  
**Action**: ADD subject and entity CRUD endpoints to the existing `taxonomyRoutes` function (mirror `fragmentTypes` pattern).

**IMPLEMENT** — add after the existing fragmentTags endpoints:

```typescript
// ---- Subjects ----
app.get('/v1/admin/subjects', { preHandler: [authenticate] }, async () => {
  const rows = await db.select().from(subjects).orderBy(subjects.name);
  return { data: rows, meta: { count: rows.length }, error: null };
});

app.post(
  '/v1/admin/subjects',
  { preHandler: [authenticate, requireRole('admin')] },
  async (request, reply) => {
    const parsed = z.object({ name: z.string().min(1), displayName: z.string().optional(), description: z.string().optional() }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    const { name, displayName, description } = parsed.data;
    const now = new Date().toISOString();
    await db.insert(subjects).values({ name, displayName: displayName ?? name, description: description ?? null, validated: true, proposedBy: 'admin', createdAt: now }).onConflictDoNothing();
    return reply.status(201).send({ data: { name }, meta: null, error: null });
  },
);

app.patch(
  '/v1/admin/subjects/:name/validate',
  { preHandler: [authenticate, requireRole('admin')] },
  async (request, reply) => {
    const { name } = request.params as { name: string };
    const parsed = z.object({ validated: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    await db.update(subjects).set({ validated: parsed.data.validated }).where(eq(subjects.name, name));
    return { data: { name, validated: parsed.data.validated }, meta: null, error: null };
  },
);

// ---- Entities ----
app.get('/v1/admin/entities', { preHandler: [authenticate] }, async (request) => {
  const { type } = request.query as { type?: string };
  const query = db.select().from(entities);
  const rows = type ? await query.where(eq(entities.type, type as any)) : await query;
  return { data: rows, meta: { count: rows.length }, error: null };
});

app.patch(
  '/v1/admin/entities/:id/validate',
  { preHandler: [authenticate, requireRole('admin')] },
  async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const parsed = z.object({ validated: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    await db.update(entities).set({ validated: parsed.data.validated }).where(eq(entities.id, id));
    return { data: { id, validated: parsed.data.validated }, meta: null, error: null };
  },
);
```

Make sure to import `subjects`, `entities` from `../db/schema.js` and `eq` from `drizzle-orm`.

**VALIDATE**: `pnpm --filter @fragmint/server typecheck`

---

### Task 6: Rewrite CombinedBlock + segmentAndClassify

**File**: `packages/server/src/services/llm-client.ts`  
**Action**: Replace the `CombinedBlock` interface (lines 30-38) and `segmentAndClassify` method (lines 118-164) with the new unified prompt.

**NEW CombinedBlock** (replace lines 30-38):

```typescript
export interface CombinedBlock {
  title: string;
  body: string;
  subject: string;
  function_type: string;
  type: string;
  audience: string[];
  maturity: string;
  lang: string;
  domain: string;
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
    entities: Partial<Record<string, string[]>>;
  };
  confidence: number;
}
```

**NEW segmentAndClassify** (replace lines 118-164):

```typescript
async segmentAndClassify(
  markdown: string,
  validTypes: string[],
  validDomains: string[],
  knownTags: string[] = [],
  domainHints: Record<string, string> = {},
  validSubjects: string[] = [],
  validEntities: { type: string; canonicalName: string }[] = [],
): Promise<CombinedBlock[]> {
  const subjectList = validSubjects.length > 0
    ? validSubjects.join(', ')
    : 'twake-mail, twake-calendar, twake-drive, twake-chat, linshare, lincloud, linto, openrag, linagora-corp, other';

  const entityList = validEntities.length > 0
    ? validEntities.map((e) => `${e.type}: ${e.canonicalName}`).join('\n  ')
    : '(no referential loaded)';

  const tagHint = knownTags.length > 0
    ? `Prefer tags from this list: ${JSON.stringify(knownTags.slice(0, 60))}. New tags: prefix with "NEW:" (e.g. "NEW:edge-computing").`
    : 'English lowercase kebab-case only. Prefix unknown ones with "NEW:".';

  const domainList = validDomains
    .map((d) => (domainHints[d] ? `"${d}": ${domainHints[d]}` : `"${d}"`))
    .join('\n  ');

  const prompt = `You are a document analysis assistant for Linagora, a French open-source software company.
Extract reusable content blocks and classify each one.

# Extraction rules

- body: EXACT verbatim text. Do NOT translate, paraphrase, or summarize.
- title: short label (3-8 words) in the SAME language as the body.
- lang: ISO 639-1 code (fr, en, ...)

# Size rules (MANDATORY)

- Each block body must be 30–200 words.
- If a section exceeds 200 words, split it into multiple blocks, each covering ONE distinct idea.
- List items may each become their own block when ≥30 words.
- Short atomic blocks (≥30 words) are valuable — do not artificially merge them.
- Never bundle unrelated ideas into one block.
- Each block must express ONE coherent idea that can stand alone without other blocks.
- Avoid references like "as mentioned above" or "see next section".

# Classification rules

## subject (MUST be one of)
${subjectList}
Use "other" when content is not tied to a specific Linagora product.

## function_type (MUST be one of)
- technical: architecture, deployment, integration
- commercial: offers, pricing, value proposition, commitments
- legal: clauses, compliance, regulatory aspects
- operational: support, SLA, maintenance, procedures
- strategic: vision, positioning, roadmap, partnerships
- reference: customer testimonial, use case

## type (MUST be one of)
${JSON.stringify(validTypes)}

## audience (1 to 3 values from)
["technique", "decideur", "utilisateur", "juridique"]

## maturity (MUST be one of)
production, beta, roadmap, archive

## domain (MUST be one of)
  ${domainList}

## entities (use canonical names from referential)
${entityList}
If you detect an entity NOT in the referential, add it to new_proposals with "NEW:" prefix.

## tags
${tagHint}

# Document
${markdown}

Return ONLY a JSON array. Each element must have ALL fields:
{
  "title": "...",
  "body": "...",
  "subject": "...",
  "function_type": "...",
  "type": "...",
  "audience": ["..."],
  "maturity": "...",
  "lang": "...",
  "domain": "...",
  "tags": ["..."],
  "entities": {
    "clients": [], "products": [], "technologies": [],
    "partners": [], "certifications": [], "regulations": []
  },
  "new_proposals": { "tags": [], "entities": {} },
  "confidence": 0.85
}`;

  try {
    const response = await this.chat(prompt);
    const json = this.extractJson(response, true);
    if (!json) return [];
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed as CombinedBlock[];
  } catch {
    return [];
  }
}
```

**VALIDATE**: `pnpm --filter @fragmint/server typecheck`

---

### Task 7: Update harvester-service.ts — post-processing + new fields + exact duplicate fix

**File**: `packages/server/src/services/harvester-service.ts`  
**Action**: Four sub-changes in this file.

#### 7a: Fix deduplicateBlocks (lines 471-480)

Replace the first-50-chars approach with full-body normalized comparison:

```typescript
static deduplicateBlocks<T extends { body: string }>(blocks: T[]): T[] {
  const seen = new Set<string>();
  return blocks.filter((b) => {
    const key = (b.body || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
```

Also add before the Milvus semantic search (around line 180), an exact-match check:

```typescript
// Exact duplicate check (string match, score = 1.0)
static findExactDuplicate(body: string, existing: Array<{ id: string; body: string }>): { id: string; score: number } | null {
  const normalized = body.toLowerCase().replace(/\s+/g, ' ').trim();
  for (const frag of existing) {
    if ((frag.body || '').toLowerCase().replace(/\s+/g, ' ').trim() === normalized) {
      return { id: frag.id, score: 1.0 };
    }
  }
  return null;
}
```

Use this check in `_runPipeline` before the Milvus search. If exact match found, skip Milvus call for that block.

#### 7b: Add post-processing functions (add as static methods after chunkMarkdown)

```typescript
private static countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

private static splitOversizedBlock(block: CombinedBlock): CombinedBlock[] {
  const MAX_WORDS = 200;
  const MIN_WORDS = 30;
  if (HarvesterService.countWords(block.body) <= MAX_WORDS) return [block];

  // Split on double newlines (paragraphs)
  const parts = block.body.split(/\n\n+/).filter((p) => p.trim().length > 0);
  if (parts.length > 1) {
    const valid = parts.every((p) => {
      const wc = HarvesterService.countWords(p);
      return wc >= MIN_WORDS && wc <= MAX_WORDS;
    });
    if (valid) {
      return parts.map((part, idx) => ({
        ...block,
        body: part.trim(),
        title: idx === 0 ? block.title : `${block.title} (${idx + 1})`,
      }));
    }
  }

  // Fallback: split at MAX_WORDS boundary on sentence end
  const words = block.body.split(/\s+/);
  const chunks: CombinedBlock[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + MAX_WORDS, words.length);
    const chunk = words.slice(start, end).join(' ');
    chunks.push({
      ...block,
      body: chunk,
      title: chunks.length === 0 ? block.title : `${block.title} (${chunks.length + 1})`,
    });
    start = end;
  }
  return chunks;
}

private static mergeUndersizedBlocks(blocks: CombinedBlock[]): CombinedBlock[] {
  const MIN_WORDS = 30;
  const MAX_WORDS = 200;
  const merged: CombinedBlock[] = [];
  let buffer: CombinedBlock | null = null;

  for (const block of blocks) {
    const wc = HarvesterService.countWords(block.body);
    if (wc < MIN_WORDS && buffer) {
      const combined = buffer.body + '\n\n' + block.body;
      if (HarvesterService.countWords(combined) <= MAX_WORDS && buffer.subject === block.subject) {
        buffer = { ...buffer, body: combined };
      } else {
        merged.push(buffer);
        buffer = block;
      }
    } else if (wc < MIN_WORDS) {
      buffer = block;
    } else {
      if (buffer) { merged.push(buffer); buffer = null; }
      merged.push(block);
    }
  }
  if (buffer) merged.push(buffer);
  return merged;
}
```

#### 7c: Call post-processing in _runPipeline (after deduplicateBlocks, around line 176)

```typescript
let blocks = HarvesterService.deduplicateBlocks(chunkResults.flat());
// Post-processing: fix oversized and undersized blocks
blocks = blocks.flatMap((b) => HarvesterService.splitOversizedBlock(b));
blocks = HarvesterService.mergeUndersizedBlocks(blocks);
```

#### 7d: Store new fields on candidates (around lines 203-222)

In the `harvestCandidates` insert, add the new fields:

```typescript
subject: block.subject ?? null,
functionType: block.function_type ?? null,
audience: JSON.stringify(block.audience ?? []),
maturity: block.maturity ?? null,
entitiesJson: JSON.stringify(block.entities ?? {}),
newProposals: JSON.stringify(block.new_proposals ?? {}),
```

Also pass `validSubjects` and `validEntities` to `segmentAndClassify` call (Task 6 signature). Load them from DB at the start of `_runPipeline`:

```typescript
const validSubjectRows = await this.db.select({ name: subjects.name }).from(subjects).where(eq(subjects.validated, true));
const validEntityRows = await this.db.select({ type: entities.type, canonicalName: entities.canonicalName }).from(entities).where(eq(entities.validated, true));
const validSubjectNames = validSubjectRows.map((r) => r.name);
```

Import `subjects`, `entities` from `../db/schema.js`.

**VALIDATE**: `pnpm --filter @fragmint/server typecheck`

---

### Task 8: Pass harvest_confidence to final fragments

**File 1**: `packages/server/src/schema/fragment.ts`  
**Action**: Add `harvest_confidence` to `createFragmentSchema` (after line 88).

```typescript
harvest_confidence: z.number().min(0).max(1).nullable().default(null),
```

**File 2**: `packages/server/src/services/fragment-service.ts`  
**Action**: In the `create()` method DB insert (around line 117-136), add:

```typescript
harvest_confidence: input.harvest_confidence ?? null,
```

**File 3**: `packages/server/src/services/harvester-service.ts`  
**Action**: When calling `fragmentService.create()` for accepted candidates (around line 325-342), pass `harvest_confidence: candidate.confidence`.

**VALIDATE**: `pnpm --filter @fragmint/server typecheck`

---

### Task 9: Register new routes in index.ts

**File**: `packages/server/src/index.ts`  
**Action**: The `taxonomyRoutes` function already handles taxonomy CRUD. Verify it's called with the `db` param and that `subjects`/`entities` imports are passed. If `taxonomyRoutes` is registered, the new endpoints from Task 5 will be active automatically.

Check the registration call (around line 289):
```typescript
taxonomyRoutes(app, db, authenticate);
```

If this already exists, no change needed. If missing, add it.

**VALIDATE**: `pnpm --filter @fragmint/server typecheck`

---

### Task 10: Run full validation

```bash
# Type check both packages
pnpm --filter @fragmint/server typecheck
pnpm --filter @fragmint/web typecheck

# Lint
pnpm lint

# Unit tests
pnpm test

# Manual smoke test:
# 1. Start server: docker compose -f docker/docker-compose.dev.yml up
# 2. Start frontend: pnpm --filter @fragmint/web dev
# 3. Upload a DOCX with known large sections
# 4. Verify: candidates are 30-200 words
# 5. Verify: subject/function_type/entities visible on candidate
# 6. Upload same DOCX twice → second time shows duplicate_score: 1.0
# 7. Accept candidates → fragment.harvest_confidence populated
```

---

### Task 11: Ré-ingestion test corpus IRA

After all code changes:
1. Delete existing fragments from the IRA collection via UI or `DELETE /v1/fragments?collection=ira&quality=draft`
2. Re-harvest the IRA DOCX files
3. Check candidate quality:
   - 90%+ fragments in 30-200 words range
   - subject populated (not null)
   - entities populated where applicable
   - No "NEW:" proposals for known entities (CNB, IRA, etc.)
4. If NEW: proposals appear for Linagora standard entities → re-check seed (Task 3/4)

---

## Quality Criteria (Exit Gate for Phase 1)

| Criterion | Target | How to measure |
|-----------|--------|----------------|
| Fragment word count | 90%+ in 30-200 words | Count words on accepted candidates |
| Subject populated | 100% not null | SQL: SELECT count(*) FROM harvest_candidates WHERE subject IS NULL |
| Exact duplicate score | 1.0 on identical content | Re-harvest same doc twice, check duplicate_score |
| harvest_confidence in fragments | 100% of harvested fragments | SQL: SELECT count(*) FROM fragments WHERE origin='harvested' AND harvest_confidence IS NULL |
| Type check | Zero errors | `pnpm --filter @fragmint/server typecheck` |
