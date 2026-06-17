# Feature: Metadata Enrichment

## Summary

End-to-end enrichment of fragment metadata: add structured referentials (functions, entities) to the DB, expand domain slugs to granular product-level values, enrich the harvest prompt to output `function_type`/`audience`/`maturity`/`entities`/`new_proposals`, store all new fields on candidates and fragments, and expose an admin validation queue for LLM-proposed new values. All column names and enum values are in English.

## User Story

As a Linagora pre-sales user composing a proposal  
I want each fragment to carry structured metadata (product, function, audience, entities)  
So that I can filter and retrieve fragments precisely without relying on free-text search alone

## Problem Statement

Today:
- `domain` has 5 coarse values (twake, lincloud, linshare, linagora, other) — not granular enough to distinguish twake-mail from twake-chat
- No `function_type` (technical vs commercial vs legal vs operational vs strategic vs reference) — impossible to filter by intent
- No `audience` — cannot target a fragment at decision-makers vs engineers
- No `entities` table — "CNB", "Conseil National des Barreaux", "cnb" are treated as unrelated tags
- LLM can propose any free-form tag — no canonical referential → orthographic variations pollute the index
- `fragment_types`, `fragment_domains`, `fragment_tags` have no `validated`/`proposed_by` columns → no admin validation workflow

## Solution Statement

Add `function_type`, `audience`, `maturity` columns to `fragments` and `harvest_candidates`. Create an `entities` table (with `fragment_entities` join). Enrich existing referential tables with `validated`/`usage_count`/`proposed_by`. Seed all referentials with Linagora initial data (English values). Rewrite `segmentAndClassify` prompt to output the new fields from closed-vocabulary lists. Implement a tiered auto-validation: if LLM confidence ≥ 0.85 and no `NEW:` proposals → auto-validate candidate metadata; otherwise queue for admin review.

## Metadata

| Field            | Value |
|------------------|-------|
| Type             | ENHANCEMENT |
| Complexity       | HIGH |
| Systems Affected | server: db/connection, db/schema, services/harvester-taxonomy, services/llm-client, services/harvester-service, services/fragment-service, routes/taxonomy-routes, index.ts |
| Dependencies     | None new — existing stack (Drizzle, Zod, Fastify 5, SQLite) |
| Estimated Tasks  | 9 |

---

## UX Design

### Before State

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                              BEFORE STATE                                      ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║  Harvest candidate card:                                                      ║
║  ┌────────────────────────────────────────────────────┐                       ║
║  │ Title: Twake Mail — architecture JMAP              │                       ║
║  │ type: introduction   domain: twake                 │                       ║
║  │ tags: ["jmap","apache james","email","twake-mail"] │  ← free-form mess    ║
║  │ confidence: 0.87                                   │  ← single score      ║
║  └────────────────────────────────────────────────────┘                       ║
║                                                                               ║
║  Fragment filter panel:                                                       ║
║  [All types ▾] [All domains ▾]    ← only 2 filters, domain=5 coarse values  ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

### After State

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                               AFTER STATE                                      ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║  Harvest candidate card:                                                      ║
║  ┌────────────────────────────────────────────────────────────────────┐       ║
║  │ Title: Twake Mail — JMAP Architecture                              │       ║
║  │ domain: twake-mail   function: technical   maturity: production    │       ║
║  │ audience: ["technical"]                                            │       ║
║  │ entities: { products: ["Twake Mail"], technologies: ["JMAP"] }    │       ║
║  │ tags: ["jmap", "open-source"]  ← canonical from referential       │       ║
║  │ confidence: 0.91  ✓ auto-validated (no NEW: proposals)            │       ║
║  └────────────────────────────────────────────────────────────────────┘       ║
║                                                                               ║
║  Admin validation queue (new):                                                ║
║  ┌─────────────────────────────────────────────────┐                         ║
║  │ NEW:edge-computing (tag, 3 proposals)  [Approve] [Reject] [Rename] │       ║
║  │ NEW:Kotlin (technology, 1 proposal)    [Approve] [Reject] [Rename] │       ║
║  └─────────────────────────────────────────────────┘                         ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

### Interaction Changes

| Location | Before | After | User Impact |
|----------|--------|-------|-------------|
| Harvest candidate | domain=twake (coarse) | domain=twake-mail (granular) | Filter by exact product |
| Harvest candidate | No function/audience/maturity | All 3 present | Can retrieve "commercial fragments for decision-makers" |
| Harvest candidate (contributor) | Cannot edit LLM metadata | Can edit domain/function_type/audience/maturity before accepting | Fixes LLM errors case by case |
| Fragment filter panel | 2 filters | 4 filters (+ function, audience) | Precision search |
| Admin interface (global) | No referential management | Validate/reject/rename NEW: proposals, see usage_count per slug | Admin controls the canonical referential |
| Auto-validation | All candidates need review | confidence≥0.85 + no NEW: → metadata pre-filled, contributor just checks content | Fewer manual reviews |

---

## Mandatory Reading

**CRITICAL: Implementation agent MUST read these files before starting any task:**

| Priority | File | Lines | Why Read This |
|----------|------|-------|---------------|
| P0 | `packages/server/src/db/connection.ts` | all (165 lines) | Raw SQL table creation pattern + ALTER TABLE try/catch pattern to MIRROR exactly |
| P0 | `packages/server/src/db/schema.ts` | all (193 lines) | All Drizzle table exports — add new declarations here |
| P0 | `packages/server/src/services/llm-client.ts` | 1-170 | CombinedBlock type + segmentAndClassify method to REWRITE |
| P0 | `packages/server/src/services/harvester-service.ts` | 75-254, 446-480 | Pipeline + deduplicateBlocks — where to plug new logic |
| P1 | `packages/server/src/services/harvester-taxonomy.ts` | all | Existing HARVESTER_DOMAINS/TYPES — extend with new constants |
| P1 | `packages/server/src/routes/taxonomy-routes.ts` | all | Admin CRUD pattern to MIRROR for new endpoints |
| P1 | `packages/server/src/index.ts` | 120-145, 254-296 | Seed pattern + route registration |
| P1 | `packages/server/src/services/fragment-service.ts` | 100-160 | Fragment create — where to write new metadata fields |
| P2 | `packages/server/src/schema/fragment.ts` | 30-91 | Zod schemas — add new fields to createFragmentSchema |

---

## Patterns to Mirror

**ALTER TABLE (try/catch idempotent — connection.ts:126-148):**
```typescript
// COPY THIS PATTERN for every new column:
try {
  sqlite.exec('ALTER TABLE fragments ADD COLUMN function_type TEXT');
} catch (_) {}
```

**CREATE TABLE IF NOT EXISTS (connection.ts:105-122):**
```typescript
// COPY THIS PATTERN for new tables (inside the sqlite.exec template literal):
CREATE TABLE IF NOT EXISTS fragment_functions (
  slug TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  validated INTEGER NOT NULL DEFAULT 1,
  usage_count INTEGER NOT NULL DEFAULT 0,
  proposed_by TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL
);
```

**Drizzle table declaration (schema.ts:173-192):**
```typescript
// COPY THIS PATTERN:
export const fragmentFunctions = sqliteTable('fragment_functions', {
  slug: text('slug').primaryKey(),
  label: text('label').notNull(),
  description: text('description'),
  validated: integer('validated').notNull().default(1),
  usageCount: integer('usage_count').notNull().default(0),
  proposedBy: text('proposed_by').notNull().default('admin'),
  createdAt: text('created_at').notNull(),
});
```

**Seed at startup (index.ts:123-136):**
```typescript
// COPY THIS PATTERN:
const fnCount = await db.select({ c: count() }).from(fragmentFunctions);
if (fnCount[0].c === 0) {
  for (const { slug, label, description } of HARVESTER_FUNCTIONS) {
    await db.insert(fragmentFunctions).values({ slug, label, description, createdAt: now })
      .onConflictDoNothing();
  }
}
```

**Admin route pattern (taxonomy-routes.ts:30-60):**
```typescript
// COPY THIS PATTERN:
app.patch(
  '/v1/admin/proposals/:table/:id/validate',
  { preHandler: [authenticate, requireRole('admin')] },
  async (request, reply) => {
    const parsed = z.object({ action: z.enum(['approve', 'reject', 'rename']), target: z.string().optional() }).safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    // ...update validated field
    return { data: { id }, meta: null, error: null };
  },
);
```

---

## Files to Change

| File | Action | Justification |
|------|--------|---------------|
| `packages/server/src/db/connection.ts` | UPDATE | Add `fragment_functions`, `entities`, `fragment_entities` tables + ALTER TABLE for new columns |
| `packages/server/src/db/schema.ts` | UPDATE | Add Drizzle exports for new tables; add new columns to `fragments` and `harvestCandidates` |
| `packages/server/src/services/harvester-taxonomy.ts` | UPDATE | Add `HARVESTER_FUNCTIONS`, `HARVESTER_ENTITIES`, `HARVESTER_DOMAINS_GRANULAR`, `HARVESTER_TAGS_INITIAL` |
| `packages/server/src/index.ts` | UPDATE | Seed new referentials at startup |
| `packages/server/src/services/llm-client.ts` | UPDATE | Rewrite `CombinedBlock` + `segmentAndClassify` with new metadata fields |
| `packages/server/src/services/harvester-service.ts` | UPDATE | Pass referentials to LLM, store new fields on candidates, auto-validation logic, insert NEW: proposals |
| `packages/server/src/routes/taxonomy-routes.ts` | UPDATE | Add admin proposals queue endpoints |
| `packages/server/src/schema/fragment.ts` | UPDATE | Add `function_type`, `audience`, `maturity` to `createFragmentSchema` |
| `packages/server/src/services/fragment-service.ts` | UPDATE | Write `function_type`, `audience`, `maturity` when creating from harvest candidates |
| `packages/server/src/routes/harvest-routes.ts` | UPDATE | Add `PATCH /v1/harvest/:jobId/candidates/:candidateId` for inline metadata editing |
| `packages/web/src/pages/admin.tsx` (or new route) | CREATE/UPDATE | Admin metadata page: LLM proposals queue + human-created values dashboard |
| `packages/web/src/components/fragment-detail.tsx` | UPDATE | Add editable metadata fields (domain, function_type, audience, maturity, tags, entities) in drawer |
| `packages/web/src/components/harvest-candidate-card.tsx` (or equivalent) | UPDATE | Show metadata_status badge + inline metadata editing on candidate |

---

## NOT Building (Scope Limits)

- `fragment_relations`, `supersedure_proposals`, `contradictions` tables — Phase 2 schema plan
- Back-fill of `function_type`/`audience`/`maturity` on existing fragments — post-deploy script, not in this plan
- Signal 3 confidence (prototype distance via embeddings) — Phase 2
- Automatic entity extraction from body text — admin seeds only for now
- Fragment filter panel UI (fragments page) — separate plan, lower priority

---

## Vocabulary Reference (all values in English)

```
FUNCTION_TYPE values: technical | commercial | legal | operational | strategic | reference

AUDIENCE values: technical | decision-maker | user | legal
  (JSON array on fragment: ["technical", "decision-maker"])

MATURITY values: production | beta | roadmap | archive

DOMAIN slugs (granular): twake-mail | twake-calendar | twake-drive | twake-chat |
  linshare | lincloud | linto | openrag | linagora-corp | other
  (replaces coarse: twake | lincloud | linshare | linagora | other)

ENTITY types: client | product | technology | partner | certification | regulation | metric
```

---

## Validation Rules — humans vs LLM

**Core rule: trust humans, queue LLM.**

```
proposed_by = 'admin'       → validated = 1  (immediate)
proposed_by = 'user:xxx'    → validated = 1  (immediate — all humans trusted)
proposed_by = 'llm-auto'    → validated = 0  (mandatory admin review)
```

**What can be created by whom:**

| Field | Human (any role) | LLM |
|-------|-----------------|-----|
| Tags | Create freely → `validated=1` | Propose `NEW:` → queue `validated=0` (admin mandatory) |
| Entities | Create freely → `validated=1` | Propose `NEW:` → queue `validated=0` (admin mandatory) |
| Domains | Create freely → `validated=1` | Propose `NEW:` → queue `validated=0` (admin mandatory) |
| Function/type/audience/maturity | Pick from list only | Pick from list only |

**Admin dashboard shows:**
- New values created by humans — visibility only, no action required, shows `proposed_by` (user login), `created_at`, `usage_count`
- LLM proposals — action required (approve/reject/rename)

**Human correction of LLM proposal**: if a contributor changes the domain/tag on their fragment from the LLM-proposed value, that override counts as validation — no separate admin step needed for that specific fragment.

**Metadata auto-validation (candidate level):**

| Condition | `metadata_status` on candidate |
|-----------|-------------------------------|
| confidence ≥ 0.85 AND no NEW: proposals | `auto-validated` — contributor sees pre-filled metadata |
| confidence 0.60–0.85 OR ≤2 NEW: proposals | `needs-review` — yellow indicator on candidate card |
| confidence < 0.60 OR >2 NEW: proposals | `requires-review` — red indicator, metadata editable |

Admin queue shows `WHERE proposed_by = 'llm-auto' AND validated = 0`. Human-created values are visible but don't require action.

---

## Step-by-Step Tasks

Execute in order. Typecheck after every task.

---

### Task 1: DB raw SQL — new tables + ALTER TABLE for new columns

**File**: `packages/server/src/db/connection.ts`

**1a — Add new tables** inside the `sqlite.exec()` template literal (after the `fragment_tags` table definition, before the closing backtick):

```sql
CREATE TABLE IF NOT EXISTS fragment_functions (
  slug TEXT PRIMARY KEY,
  label TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type, validated);

CREATE TABLE IF NOT EXISTS fragment_entities (
  fragment_id TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  PRIMARY KEY (fragment_id, entity_id),
  FOREIGN KEY (fragment_id) REFERENCES fragments(id) ON DELETE CASCADE,
  FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
);
```

**1b — Enrich existing referential tables** (add to the ALTER TABLE try/catch section):

```typescript
// Enrich fragment_types with validation columns
try { sqlite.exec('ALTER TABLE fragment_types ADD COLUMN validated INTEGER NOT NULL DEFAULT 1'); } catch (_) {}
try { sqlite.exec('ALTER TABLE fragment_types ADD COLUMN usage_count INTEGER NOT NULL DEFAULT 0'); } catch (_) {}
try { sqlite.exec('ALTER TABLE fragment_types ADD COLUMN proposed_by TEXT NOT NULL DEFAULT \'admin\''); } catch (_) {}

// Enrich fragment_domains
try { sqlite.exec('ALTER TABLE fragment_domains ADD COLUMN validated INTEGER NOT NULL DEFAULT 1'); } catch (_) {}
try { sqlite.exec('ALTER TABLE fragment_domains ADD COLUMN usage_count INTEGER NOT NULL DEFAULT 0'); } catch (_) {}
try { sqlite.exec('ALTER TABLE fragment_domains ADD COLUMN proposed_by TEXT NOT NULL DEFAULT \'admin\''); } catch (_) {}

// Enrich fragment_tags
try { sqlite.exec('ALTER TABLE fragment_tags ADD COLUMN validated INTEGER NOT NULL DEFAULT 1'); } catch (_) {}
try { sqlite.exec('ALTER TABLE fragment_tags ADD COLUMN usage_count INTEGER NOT NULL DEFAULT 0'); } catch (_) {}
try { sqlite.exec('ALTER TABLE fragment_tags ADD COLUMN proposed_by TEXT NOT NULL DEFAULT \'admin\''); } catch (_) {}

// New columns on fragments
try { sqlite.exec('ALTER TABLE fragments ADD COLUMN function_type TEXT'); } catch (_) {}
try { sqlite.exec('ALTER TABLE fragments ADD COLUMN audience TEXT'); } catch (_) {}
try { sqlite.exec('ALTER TABLE fragments ADD COLUMN maturity TEXT'); } catch (_) {}

// New columns on harvest_candidates
try { sqlite.exec('ALTER TABLE harvest_candidates ADD COLUMN function_type TEXT'); } catch (_) {}
try { sqlite.exec('ALTER TABLE harvest_candidates ADD COLUMN audience TEXT'); } catch (_) {}
try { sqlite.exec('ALTER TABLE harvest_candidates ADD COLUMN maturity TEXT'); } catch (_) {}
try { sqlite.exec('ALTER TABLE harvest_candidates ADD COLUMN entities_json TEXT'); } catch (_) {}
try { sqlite.exec('ALTER TABLE harvest_candidates ADD COLUMN new_proposals TEXT'); } catch (_) {}
try { sqlite.exec('ALTER TABLE harvest_candidates ADD COLUMN metadata_status TEXT'); } catch (_) {}
```

**VALIDATE**: `pnpm --filter @fragmint/server typecheck`

---

### Task 2: Drizzle schema — TypeScript declarations

**File**: `packages/server/src/db/schema.ts`

**2a — Add new columns to `fragments` table** (after `valid_until`, before closing `}`):
```typescript
function_type: text('function_type'),
audience: text('audience'),
maturity: text('maturity'),
```

**2b — Add new columns to `harvestCandidates` table** (after `fragment_id`):
```typescript
function_type: text('function_type'),
audience: text('audience'),
maturity: text('maturity'),
entities_json: text('entities_json'),
new_proposals: text('new_proposals'),
metadata_status: text('metadata_status'),
```

**2c — Update `fragmentTypes`, `fragmentDomains`, `fragmentTags`** — add the 3 new columns to each Drizzle declaration:
```typescript
validated: integer('validated').notNull().default(1),
usageCount: integer('usage_count').notNull().default(0),
proposedBy: text('proposed_by').notNull().default('admin'),
```

**2d — Add new table declarations** (after `fragmentTags`):

```typescript
export const fragmentFunctions = sqliteTable('fragment_functions', {
  slug: text('slug').primaryKey(),
  label: text('label').notNull(),
  description: text('description'),
  validated: integer('validated').notNull().default(1),
  usageCount: integer('usage_count').notNull().default(0),
  proposedBy: text('proposed_by').notNull().default('admin'),
  createdAt: text('created_at').notNull(),
});

export const entities = sqliteTable('entities', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  name: text('name').notNull(),
  canonicalName: text('canonical_name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  aliases: text('aliases'),
  validated: integer('validated').notNull().default(0),
  usageCount: integer('usage_count').notNull().default(0),
  proposedBy: text('proposed_by').notNull().default('admin'),
  createdAt: text('created_at').notNull(),
});

export const fragmentEntities = sqliteTable('fragment_entities', {
  fragmentId: text('fragment_id').notNull(),
  entityId: integer('entity_id').notNull(),
});
```

**VALIDATE**: `pnpm --filter @fragmint/server typecheck`

---

### Task 3: Extend harvester-taxonomy.ts with English referential data

**File**: `packages/server/src/services/harvester-taxonomy.ts`

Add the following exports **after** existing constants. All values in English.

```typescript
// ---- Functions ----
export interface FunctionDef {
  slug: string;
  label: string;
  description: string;
}

export const HARVESTER_FUNCTIONS: FunctionDef[] = [
  { slug: 'technical', label: 'Technical', description: 'Architecture, deployment, integration, technical specifications' },
  { slug: 'commercial', label: 'Commercial', description: 'Offers, pricing, value proposition, competitive positioning' },
  { slug: 'legal', label: 'Legal', description: 'Contractual clauses, compliance, regulatory requirements' },
  { slug: 'operational', label: 'Operational', description: 'Support, SLA, maintenance procedures, operations' },
  { slug: 'strategic', label: 'Strategic', description: 'Vision, market positioning, roadmap, partnerships' },
  { slug: 'reference', label: 'Reference', description: 'Client testimonials, case studies, concrete use cases' },
];

// ---- Granular domain slugs (product-level) ----
export const HARVESTER_DOMAINS_GRANULAR = [
  { slug: 'twake-mail', label: 'Twake Mail', description: 'Twake Mail — email, JMAP, Apache James. Use when text explicitly discusses Twake Mail.' },
  { slug: 'twake-calendar', label: 'Twake Calendar', description: 'Twake Calendar — scheduling, CalDAV. Use when text explicitly discusses Twake Calendar.' },
  { slug: 'twake-drive', label: 'Twake Drive', description: 'Twake Drive — file sharing, collaborative storage.' },
  { slug: 'twake-chat', label: 'Twake Chat', description: 'Twake Chat — instant messaging, Matrix protocol.' },
  { slug: 'linshare', label: 'LinShare', description: 'LinShare — secure file transfer. Use when text explicitly discusses LinShare.' },
  { slug: 'lincloud', label: 'LinCloud', description: 'LinCloud — sovereign cloud platform. Use when text explicitly discusses LinCloud.' },
  { slug: 'linto', label: 'LinTO', description: 'LinTO — voice assistant, AI.' },
  { slug: 'openrag', label: 'OpenRAG', description: 'OpenRAG — retrieval-augmented generation.' },
  { slug: 'linagora-corp', label: 'Linagora (company)', description: 'Linagora as a company — history, values, methodology. NOT for generic SLA or tech specs.' },
  { slug: 'other', label: 'Other', description: 'Client-specific content, SLA, procurement, regulatory content not tied to a specific product.' },
];

// ---- Entities ----
export interface EntityDef {
  type: 'client' | 'product' | 'technology' | 'partner' | 'certification' | 'regulation' | 'metric';
  canonicalName: string;
  aliases: string[];
}

export const INITIAL_ENTITIES: EntityDef[] = [
  // Clients
  { type: 'client', canonicalName: 'CNB', aliases: ['Conseil National des Barreaux'] },
  { type: 'client', canonicalName: 'Sesam-Vitale', aliases: ['SESAM-Vitale', 'Sesam Vitale'] },
  { type: 'client', canonicalName: 'IRA', aliases: ["Institut Regional d'Administration", 'IRAs'] },
  { type: 'client', canonicalName: 'DGAFP', aliases: ["Direction generale de l'administration"] },
  { type: 'client', canonicalName: 'Mauritius Government', aliases: ['Maurice', 'gouvernement mauricien'] },
  // Products
  { type: 'product', canonicalName: 'Twake Mail', aliases: ['Twake.Mail'] },
  { type: 'product', canonicalName: 'Twake Calendar', aliases: ['Twake.Calendar'] },
  { type: 'product', canonicalName: 'Twake Drive', aliases: ['Twake.Drive'] },
  { type: 'product', canonicalName: 'Twake Chat', aliases: ['Twake.Chat'] },
  { type: 'product', canonicalName: 'LinShare', aliases: ['LinShare Pro'] },
  { type: 'product', canonicalName: 'LinCloud', aliases: [] },
  { type: 'product', canonicalName: 'Apache James', aliases: ['James'] },
  { type: 'product', canonicalName: 'Office 365', aliases: ['Microsoft 365', 'O365'] },
  { type: 'product', canonicalName: 'Microsoft Exchange', aliases: ['Exchange'] },
  // Technologies
  { type: 'technology', canonicalName: 'JMAP', aliases: [] },
  { type: 'technology', canonicalName: 'IMAP', aliases: [] },
  { type: 'technology', canonicalName: 'CalDAV', aliases: [] },
  { type: 'technology', canonicalName: 'LDAP', aliases: ['Active Directory', 'AD'] },
  { type: 'technology', canonicalName: 'Kubernetes', aliases: ['K8s'] },
  { type: 'technology', canonicalName: 'PostgreSQL', aliases: ['Postgres'] },
  { type: 'technology', canonicalName: 'Matrix', aliases: ['Matrix protocol'] },
  { type: 'technology', canonicalName: 'SAML', aliases: [] },
  { type: 'technology', canonicalName: 'OIDC', aliases: ['OpenID Connect'] },
  { type: 'technology', canonicalName: 'LemonLDAP', aliases: ['LemonLDAP-NG'] },
  // Certifications
  { type: 'certification', canonicalName: 'SecNumCloud', aliases: [] },
  { type: 'certification', canonicalName: 'HDS', aliases: ['Hebergeur de Donnees de Sante'] },
  { type: 'certification', canonicalName: 'ISO27001', aliases: ['ISO 27001'] },
  // Regulations
  { type: 'regulation', canonicalName: 'GDPR', aliases: ['RGPD'] },
  { type: 'regulation', canonicalName: 'Cloud Act', aliases: ['CLOUD Act'] },
  // Partners
  { type: 'partner', canonicalName: 'DINUM', aliases: ['Direction interministerielle du numerique'] },
  { type: 'partner', canonicalName: 'OVH', aliases: ['OVHcloud'] },
  { type: 'partner', canonicalName: 'Cloud Temple', aliases: [] },
];

// ---- Initial validated tags ----
export const INITIAL_TAGS = [
  { slug: 'open-source', label: 'Open Source', category: 'concept' },
  { slug: 'sovereignty', label: 'Sovereignty', category: 'concept' },
  { slug: 'on-premise', label: 'On-Premise', category: 'deployment' },
  { slug: 'cloud-native', label: 'Cloud Native', category: 'deployment' },
  { slug: 'high-availability', label: 'High Availability', category: 'concept' },
  { slug: 'scalable', label: 'Scalable', category: 'concept' },
  { slug: 'interoperability', label: 'Interoperability', category: 'concept' },
  { slug: 'saas', label: 'SaaS', category: 'deployment' },
  { slug: 'self-hosted', label: 'Self-Hosted', category: 'deployment' },
  { slug: 'hybrid', label: 'Hybrid', category: 'deployment' },
  { slug: 'public-sector', label: 'Public Sector', category: 'industry' },
  { slug: 'health', label: 'Health', category: 'industry' },
  { slug: 'european-initiative', label: 'European Initiative', category: 'concept' },
];
```

**VALIDATE**: `pnpm --filter @fragmint/server typecheck`

---

### Task 4: Seed new referentials at startup

**File**: `packages/server/src/index.ts`

Add the following **after** the existing `fragmentDomains` seed block (around line 136). Import `fragmentFunctions`, `entities`, `fragmentTags` from `./db/schema.js` and `HARVESTER_FUNCTIONS`, `INITIAL_ENTITIES`, `HARVESTER_DOMAINS_GRANULAR`, `INITIAL_TAGS` from `./services/harvester-taxonomy.js`.

```typescript
// Seed fragment_functions if empty
const fnCount = await db.select({ c: count() }).from(fragmentFunctions);
if (fnCount[0].c === 0) {
  for (const { slug, label, description } of HARVESTER_FUNCTIONS) {
    await db.insert(fragmentFunctions).values({ slug, label, description, createdAt: now }).onConflictDoNothing();
  }
}

// Seed granular domain slugs (add new ones, keep existing)
for (const { slug, label, description } of HARVESTER_DOMAINS_GRANULAR) {
  await db.insert(fragmentDomains).values({ slug, label, description, createdAt: now }).onConflictDoNothing();
}

// Seed initial validated tags
for (const { slug, label, category } of INITIAL_TAGS) {
  await db.insert(fragmentTags).values({ slug, label, category, createdAt: now }).onConflictDoNothing();
}

// Seed initial entities (admin-validated)
const entityCount = await db.select({ c: count() }).from(entities);
if (entityCount[0].c === 0) {
  for (const e of INITIAL_ENTITIES) {
    const normalized = e.canonicalName.toLowerCase().replace(/[\s\-\.]+/g, '-');
    await db.insert(entities).values({
      type: e.type,
      name: e.canonicalName,
      canonicalName: e.canonicalName,
      normalizedName: normalized,
      aliases: JSON.stringify(e.aliases),
      validated: 1,
      proposedBy: 'admin',
      createdAt: now,
    }).onConflictDoNothing();
  }
}
```

**VALIDATE**: `pnpm --filter @fragmint/server typecheck`

---

### Task 5: Rewrite CombinedBlock + segmentAndClassify

**File**: `packages/server/src/services/llm-client.ts`

**5a — New CombinedBlock interface** (replace lines 30-38):

```typescript
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
```

**5b — New segmentAndClassify signature** (replace lines 118-164). New parameters: `validFunctions`, `validDomains` (already there), `validEntities` (list of `{type, canonicalName}`):

```typescript
async segmentAndClassify(
  markdown: string,
  validTypes: string[],
  validDomains: string[],
  knownTags: string[] = [],
  domainHints: Record<string, string> = {},
  validFunctions: string[] = [],
  validEntities: Array<{ type: string; canonicalName: string }> = [],
): Promise<CombinedBlock[]> {
  const functionList = validFunctions.length > 0
    ? validFunctions.join(' | ')
    : 'technical | commercial | legal | operational | strategic | reference';

  const domainList = validDomains
    .map((d) => (domainHints[d] ? `"${d}": ${domainHints[d]}` : `"${d}"`))
    .join('\n  ');

  const entityListByType = validEntities.reduce<Record<string, string[]>>((acc, e) => {
    if (!acc[e.type]) acc[e.type] = [];
    acc[e.type].push(e.canonicalName);
    return acc;
  }, {});
  const entityBlock = Object.entries(entityListByType)
    .map(([type, names]) => `  ${type}s: ${names.join(', ')}`)
    .join('\n');

  const tagHint = knownTags.length > 0
    ? `Use tags from this list when relevant: ${JSON.stringify(knownTags.slice(0, 60))}. For new tags not in the list, prefix with "NEW:" (e.g. "NEW:edge-computing"). All tags must be English lowercase kebab-case.`
    : 'English lowercase kebab-case only. Prefix unknown ones with "NEW:".';

  const prompt = `You are a document analysis assistant for Linagora, a French open-source software company.
Extract reusable content blocks from the document and classify each one using structured metadata.

# Extraction rules
- body: EXACT verbatim text from the document. Do NOT translate, paraphrase, or summarize.
- title: short English label (3-8 words) describing the block content.
- lang: ISO 639-1 code of the body language (fr, en, ...)

# Classification rules

## domain — the Linagora product or area this block is about. MUST be one of:
  ${domainList}
  Use "other" for client requirements, SLA specs, procurement content, or anything not clearly tied to one product.
  If the content clearly belongs to a Linagora product NOT in the list, add it to new_proposals.domains with "NEW:" prefix.

## function_type — the rhetorical function of this block. MUST be one of:
  ${functionList}

## type — the content type. MUST be one of:
  ${JSON.stringify(validTypes)}

## audience — who this block targets. JSON array with 1-3 values from:
  ["technical", "decision-maker", "user", "legal"]

## maturity — lifecycle stage of the described feature/offer. MUST be one of:
  production | beta | roadmap | archive

## entities — use canonical names from the referential. Use exact spelling.
${entityBlock || '  (no referential available — use best judgment)'}
  If you detect an entity NOT in the referential above, add it to new_proposals.entities with "NEW:" prefix.

## tags — ${tagHint}

# Document
${markdown}

Return ONLY a valid JSON array. Each element must contain ALL fields:
[
  {
    "title": "...",
    "body": "...",
    "domain": "...",
    "function_type": "...",
    "type": "...",
    "audience": ["technical"],
    "maturity": "production",
    "lang": "fr",
    "tags": ["open-source"],
    "entities": {
      "clients": [], "products": [], "technologies": [],
      "partners": [], "certifications": [], "regulations": []
    },
    "new_proposals": {
      "tags": [],
      "domains": [],
      "entities": {}
    },
    "confidence": 0.85
  }
]`;

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

### Task 6: Update harvester-service.ts

**File**: `packages/server/src/services/harvester-service.ts`

Four sub-changes.

#### 6a — Load referentials before LLM call

At the start of `_runPipeline`, after loading existing types/domains (around line 135), add:

```typescript
// Load validated referentials for LLM prompt
const validFunctionRows = await this.db.select({ slug: fragmentFunctions.slug })
  .from(fragmentFunctions).where(eq(fragmentFunctions.validated, 1));
const validFunctions = validFunctionRows.map((r) => r.slug);

const validEntityRows = await this.db.select({
  type: entities.type, canonicalName: entities.canonicalName,
}).from(entities).where(eq(entities.validated, 1));

const knownTagRows = await this.db.select({ slug: fragmentTags.slug })
  .from(fragmentTags).where(eq(fragmentTags.validated, 1));
const knownTags = knownTagRows.map((r) => r.slug);
```

Import `fragmentFunctions`, `entities`, `fragmentTags` from `../db/schema.js`.

#### 6b — Pass new args to segmentAndClassify (around line 169)

```typescript
const result = await this.llmClient.segmentAndClassify(
  chunk, existingTypes, existingDomains, knownTags, domainHints,
  validFunctions, validEntityRows,  // ← new params
);
```

#### 6c — Auto-validation logic + store new fields on candidates (around lines 203-224)

Replace or extend the candidate insert block:

```typescript
// Determine metadata_status per block
function getMetadataStatus(block: CombinedBlock): string {
  const proposalCount =
    (block.new_proposals?.tags?.length ?? 0) +
    Object.values(block.new_proposals?.entities ?? {}).flat().length;
  if (block.confidence >= 0.85 && proposalCount === 0) return 'auto-validated';
  if (block.confidence >= 0.60 && proposalCount <= 2) return 'needs-review';
  return 'requires-review';
}

// In the candidates insert:
await this.db.insert(harvestCandidates).values(
  blocks.map((block, j) => ({
    id: `hcn-${randomUUID()}`,
    job_id: jobId,
    title: block.title || 'Untitled',
    body: block.body,
    type: block.type,
    domain: block.domain,
    lang: block.lang || lang,
    tags: JSON.stringify(block.tags),
    confidence: block.confidence,
    function_type: block.function_type ?? null,
    audience: JSON.stringify(block.audience ?? []),
    maturity: block.maturity ?? null,
    entities_json: JSON.stringify(block.entities ?? {}),
    new_proposals: JSON.stringify(block.new_proposals ?? {}),
    metadata_status: getMetadataStatus(block),
    origin_source: filename,
    origin_page: null,
    duplicate_of: dupeChecks[j]?.id ?? null,
    duplicate_score: dupeChecks[j]?.score ?? null,
    status: 'pending',
  })),
);
```

#### 6d — Insert NEW: proposals into referential tables with validated=0

**Rule**: `proposed_by = 'llm-auto'` → `validated = 0` → mandatory admin review. Applies to tags, domains, and entities.

After the candidate insert, add:

```typescript
// Insert LLM NEW: proposals — tags, domains, and entities all go to admin queue
for (const block of blocks) {
  const proposals = block.new_proposals ?? {};

  for (const rawTag of proposals.tags ?? []) {
    const slug = rawTag.replace(/^NEW:/i, '').toLowerCase().replace(/\s+/g, '-');
    await this.db.insert(fragmentTags).values({
      slug, label: slug, category: 'proposed', validated: 0, proposedBy: 'llm-auto', createdAt: now,
    }).onConflictDoNothing();
  }

  for (const rawDomain of proposals.domains ?? []) {
    const slug = rawDomain.replace(/^NEW:/i, '').toLowerCase().replace(/\s+/g, '-');
    await this.db.insert(fragmentDomains).values({
      slug, label: slug, description: 'LLM-proposed', validated: 0, proposedBy: 'llm-auto', createdAt: now,
    }).onConflictDoNothing();
  }

  for (const [entType, entNames] of Object.entries(proposals.entities ?? {})) {
    for (const rawName of (entNames as string[]) ?? []) {
      const canonical = rawName.replace(/^NEW:/i, '');
      const normalized = canonical.toLowerCase().replace(/[\s\-\.]+/g, '-');
      const validType = ['client','product','technology','partner','certification','regulation','metric']
        .includes(entType) ? entType as any : 'product';
      await this.db.insert(entities).values({
        type: validType, name: canonical, canonicalName: canonical,
        normalizedName: normalized, aliases: '[]',
        validated: 0, proposedBy: 'llm-auto', createdAt: now,
      }).onConflictDoNothing();
    }
  }
}
```

**VALIDATE**: `pnpm --filter @fragmint/server typecheck`

---

### Task 7: Admin routes for proposals queue

**File**: `packages/server/src/routes/admin-metadata-routes.ts` (NEW file — separate from `taxonomy-routes.ts`)

**Register in `packages/server/src/index.ts`** alongside other route registrations:

```typescript
import { adminMetadataRoutes } from './routes/admin-metadata-routes.js';
app.register(adminMetadataRoutes);
```

**Endpoints** (all admin-protected except `/v1/admin/functions`):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/admin/metadata/proposals` | List pending LLM proposals (tags + domains + entities) with flags |
| POST | `/v1/admin/metadata/proposals/:id/approve` | Approve → `validated=1` |
| POST | `/v1/admin/metadata/proposals/:id/reject` | Reject + cascade-update fragments using the value |
| POST | `/v1/admin/metadata/proposals/:id/rename` | Rename + approve in one step, update all fragment references |
| POST | `/v1/admin/metadata/proposals/:id/merge` | Merge into validated value, repoint fragment references |
| POST | `/v1/admin/metadata/proposals/:id/convert-to-entity` | Promote tag → entity, remove tag from fragments |
| POST | `/v1/admin/metadata/proposals/:id/set-as-alias` | Add proposed entity as alias of canonical, repoint FK |
| POST | `/v1/admin/metadata/proposals/:id/reclassify-entity-type` | Change entity type (product → technology etc.) |
| POST | `/v1/admin/metadata/bulk-action` | Bulk approve or reject, iterates individual updates |
| GET | `/v1/admin/metadata/validated` | List validated values for merge/alias pickers in UI |
| GET | `/v1/admin/functions` | List all fragment functions (public for dropdowns) |

**File skeleton** (Fastify plugin pattern — mirror `fragmentRoutes` in `fragments.ts`):

```typescript
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, like, count } from 'drizzle-orm';
import { db } from '../db/index.js';
import { fragmentTags, fragmentDomains, fragmentFunctions, entities, fragmentEntities, fragments } from '../db/schema.js';
import { authenticate, requireRole } from '../auth/index.js';

export async function adminMetadataRoutes(app: FastifyInstance) {

  // GET /v1/admin/metadata/proposals
  app.get('/v1/admin/metadata/proposals',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      const { kind, entity_type, search, limit = 50, offset = 0 } =
        (request.query ?? {}) as { kind?: string; entity_type?: string; search?: string; limit?: number; offset?: number };

      const proposals: any[] = [];

      if (!kind || kind === 'tag') {
        const conditions: any[] = [eq(fragmentTags.validated, 0)];
        if (search) conditions.push(like(fragmentTags.label, `%${search}%`));
        const tags = await db.select().from(fragmentTags).where(and(...conditions)).limit(Number(limit)).offset(Number(offset));
        for (const tag of tags) {
          const preview = await getPreviewForTag(tag.slug);
          const flags = await computeFlagsForTag(tag);
          proposals.push({ id: tag.slug, kind: 'tag', name: tag.slug, label: tag.label, usage_count: tag.usageCount, validated: !!tag.validated, proposed_by: tag.proposedBy, created_at: tag.createdAt, preview, flags });
        }
      }

      if (!kind || kind === 'domain') {
        const conditions: any[] = [eq(fragmentDomains.validated, 0)];
        if (search) conditions.push(like(fragmentDomains.label, `%${search}%`));
        const domains = await db.select().from(fragmentDomains).where(and(...conditions)).limit(Number(limit)).offset(Number(offset));
        for (const d of domains) {
          proposals.push({ id: d.slug, kind: 'domain', name: d.slug, label: d.label, usage_count: d.usageCount ?? 0, validated: !!d.validated, proposed_by: d.proposedBy, created_at: d.createdAt, preview: null, flags: [] });
        }
      }

      if (!kind || kind === 'entity') {
        const conditions: any[] = [eq(entities.validated, 0)];
        if (entity_type) conditions.push(eq(entities.type, entity_type));
        if (search) conditions.push(like(entities.name, `%${search}%`));
        const ents = await db.select().from(entities).where(and(...conditions)).limit(Number(limit)).offset(Number(offset));
        for (const ent of ents) {
          const preview = await getPreviewForEntity(ent.id);
          const flags = await computeFlagsForEntity(ent);
          proposals.push({ id: ent.id, kind: 'entity', name: ent.name, entity_type: ent.type, usage_count: ent.usageCount, validated: !!ent.validated, proposed_by: ent.proposedBy, created_at: ent.createdAt, preview, flags });
        }
      }

      const counts = await computeCounts();
      return { proposals, total: proposals.length, counts };
    }
  );

  // POST /v1/admin/metadata/proposals/:id/approve
  app.post('/v1/admin/metadata/proposals/:id/approve',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ kind: z.enum(['tag', 'domain', 'entity']) }).safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
      const { kind } = parsed.data;
      if (kind === 'tag') await db.update(fragmentTags).set({ validated: 1 }).where(eq(fragmentTags.slug, id));
      else if (kind === 'domain') await db.update(fragmentDomains).set({ validated: 1 }).where(eq(fragmentDomains.slug, id));
      else await db.update(entities).set({ validated: 1 }).where(eq(entities.id, Number(id)));
      return { success: true, id, kind };
    }
  );

  // POST /v1/admin/metadata/proposals/:id/reject
  // Tags: removes from referential + removes from fragment.tags JSON arrays
  // Domains: removes from referential (fragments keep their domain value until reassigned)
  // Entities: FK ON DELETE CASCADE handles fragment_entities cleanup automatically
  app.post('/v1/admin/metadata/proposals/:id/reject',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ kind: z.enum(['tag', 'domain', 'entity']) }).safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
      const { kind } = parsed.data;
      let affectedFragments = 0;

      if (kind === 'tag') {
        const fragmentsUsing = await db.select().from(fragments).where(like(fragments.tags, `%"${id}"%`));
        for (const f of fragmentsUsing) {
          const tagsArr = JSON.parse(f.tags ?? '[]').filter((t: string) => t !== id);
          await db.update(fragments).set({ tags: JSON.stringify(tagsArr) }).where(eq(fragments.id, f.id));
        }
        affectedFragments = fragmentsUsing.length;
        await db.delete(fragmentTags).where(eq(fragmentTags.slug, id));
      } else if (kind === 'domain') {
        await db.delete(fragmentDomains).where(eq(fragmentDomains.slug, id));
      } else {
        await db.delete(entities).where(eq(entities.id, Number(id)));
      }
      return { success: true, rejected_id: id, affected_fragments: affectedFragments };
    }
  );

  // POST /v1/admin/metadata/proposals/:id/rename — renames + validates in one step
  app.post('/v1/admin/metadata/proposals/:id/rename',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ kind: z.enum(['tag', 'domain', 'entity']), new_name: z.string(), new_label: z.string().optional() }).safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
      const { kind, new_name, new_label } = parsed.data;

      if (kind === 'tag') {
        const fragmentsUsing = await db.select().from(fragments).where(like(fragments.tags, `%"${id}"%`));
        for (const f of fragmentsUsing) {
          const tagsArr = JSON.parse(f.tags ?? '[]').map((t: string) => t === id ? new_name : t);
          await db.update(fragments).set({ tags: JSON.stringify(tagsArr) }).where(eq(fragments.id, f.id));
        }
        await db.update(fragmentTags).set({ slug: new_name, label: new_label ?? new_name, validated: 1 }).where(eq(fragmentTags.slug, id));
      } else if (kind === 'domain') {
        await db.update(fragments).set({ domain: new_name }).where(eq(fragments.domain, id));
        await db.update(fragmentDomains).set({ slug: new_name, label: new_label ?? new_name, validated: 1 }).where(eq(fragmentDomains.slug, id));
      } else {
        await db.update(entities).set({ name: new_name, canonicalName: new_name, normalizedName: normalizeForComparison(new_name), validated: 1 }).where(eq(entities.id, Number(id)));
      }
      return { success: true, updated: { id: new_name, name: new_name } };
    }
  );

  // POST /v1/admin/metadata/proposals/:id/merge — merges proposal into an existing validated value
  app.post('/v1/admin/metadata/proposals/:id/merge',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ kind: z.enum(['tag', 'domain', 'entity']), target_id: z.string() }).safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
      const { kind, target_id } = parsed.data;
      let affectedFragments = 0;

      if (kind === 'tag') {
        const fragmentsUsing = await db.select().from(fragments).where(like(fragments.tags, `%"${id}"%`));
        for (const f of fragmentsUsing) {
          const newTags = [...new Set(JSON.parse(f.tags ?? '[]').map((t: string) => t === id ? target_id : t))];
          await db.update(fragments).set({ tags: JSON.stringify(newTags) }).where(eq(fragments.id, f.id));
        }
        affectedFragments = fragmentsUsing.length;
        await db.delete(fragmentTags).where(eq(fragmentTags.slug, id));
      } else if (kind === 'entity') {
        await db.update(fragmentEntities).set({ entity_id: Number(target_id) }).where(eq(fragmentEntities.entity_id, Number(id)));
        await db.delete(entities).where(eq(entities.id, Number(id)));
      }
      return { success: true, merged_into: target_id, affected_fragments: affectedFragments };
    }
  );

  // POST /v1/admin/metadata/proposals/:id/convert-to-entity — tag → new entity
  // GOTCHA: better-sqlite3 doesn't support .returning(). Insert then select back by unique key.
  app.post('/v1/admin/metadata/proposals/:id/convert-to-entity',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ entity_type: z.string(), canonical_name: z.string(), aliases: z.array(z.string()).default([]) }).safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
      const { entity_type, canonical_name, aliases } = parsed.data;
      const now = new Date().toISOString();

      await db.insert(entities).values({ type: entity_type, name: canonical_name, canonicalName: canonical_name, normalizedName: normalizeForComparison(canonical_name), aliases: JSON.stringify(aliases), validated: 1, proposedBy: 'admin', usageCount: 0, createdAt: now });
      const [newEntity] = await db.select().from(entities).where(and(eq(entities.canonicalName, canonical_name), eq(entities.type, entity_type)));

      const fragmentsUsing = await db.select().from(fragments).where(like(fragments.tags, `%"${id}"%`));
      for (const f of fragmentsUsing) {
        const tagsArr = JSON.parse(f.tags ?? '[]').filter((t: string) => t !== id);
        await db.update(fragments).set({ tags: JSON.stringify(tagsArr) }).where(eq(fragments.id, f.id));
        await db.insert(fragmentEntities).values({ fragment_id: f.id, entity_id: newEntity.id }).onConflictDoNothing();
      }
      await db.delete(fragmentTags).where(eq(fragmentTags.slug, id));
      return { success: true, created_entity: newEntity, affected_fragments: fragmentsUsing.length };
    }
  );

  // POST /v1/admin/metadata/proposals/:id/set-as-alias — add proposed entity as alias of canonical
  app.post('/v1/admin/metadata/proposals/:id/set-as-alias',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ canonical_entity_id: z.number() }).safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
      const { canonical_entity_id } = parsed.data;

      const [proposal] = await db.select().from(entities).where(eq(entities.id, Number(id)));
      const [canonical] = await db.select().from(entities).where(eq(entities.id, canonical_entity_id));
      const currentAliases = JSON.parse(canonical.aliases ?? '[]');
      await db.update(entities).set({ aliases: JSON.stringify([...new Set([...currentAliases, proposal.name])]) }).where(eq(entities.id, canonical_entity_id));
      await db.update(fragmentEntities).set({ entity_id: canonical_entity_id }).where(eq(fragmentEntities.entity_id, Number(id)));
      await db.delete(entities).where(eq(entities.id, Number(id)));
      return { success: true, canonical_entity: canonical };
    }
  );

  // POST /v1/admin/metadata/proposals/:id/reclassify-entity-type
  app.post('/v1/admin/metadata/proposals/:id/reclassify-entity-type',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ new_type: z.string() }).safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
      const [old] = await db.select().from(entities).where(eq(entities.id, Number(id)));
      await db.update(entities).set({ type: parsed.data.new_type }).where(eq(entities.id, Number(id)));
      return { success: true, updated: { id: Number(id), old_type: old.type, new_type: parsed.data.new_type } };
    }
  );

  // POST /v1/admin/metadata/bulk-action
  app.post('/v1/admin/metadata/bulk-action',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      const { action, items } = request.body as { action: 'approve' | 'reject'; items: Array<{ id: string | number; kind: 'tag' | 'domain' | 'entity' }> };
      const results = [];
      for (const item of items) {
        try {
          if (item.kind === 'tag') {
            action === 'approve'
              ? await db.update(fragmentTags).set({ validated: 1 }).where(eq(fragmentTags.slug, String(item.id)))
              : await db.delete(fragmentTags).where(eq(fragmentTags.slug, String(item.id)));
          } else if (item.kind === 'domain') {
            action === 'approve'
              ? await db.update(fragmentDomains).set({ validated: 1 }).where(eq(fragmentDomains.slug, String(item.id)))
              : await db.delete(fragmentDomains).where(eq(fragmentDomains.slug, String(item.id)));
          } else {
            action === 'approve'
              ? await db.update(entities).set({ validated: 1 }).where(eq(entities.id, Number(item.id)))
              : await db.delete(entities).where(eq(entities.id, Number(item.id)));
          }
          results.push({ id: item.id, success: true });
        } catch (e: any) {
          results.push({ id: item.id, success: false, error: e.message });
        }
      }
      return { success: true, results };
    }
  );

  // GET /v1/admin/metadata/validated — for merge/alias pickers in the UI
  app.get('/v1/admin/metadata/validated',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      const { kind, entity_type } = (request.query ?? {}) as { kind?: string; entity_type?: string };
      if (kind === 'tag') return db.select().from(fragmentTags).where(eq(fragmentTags.validated, 1));
      if (kind === 'domain') return db.select().from(fragmentDomains).where(eq(fragmentDomains.validated, 1));
      const conditions: any[] = [eq(entities.validated, 1)];
      if (entity_type) conditions.push(eq(entities.type, entity_type));
      return db.select().from(entities).where(and(...conditions));
    }
  );

  // GET /v1/admin/functions — publicly readable (used in contributor dropdowns)
  app.get('/v1/admin/functions', { preHandler: [authenticate] }, async () => {
    const rows = await db.select().from(fragmentFunctions).orderBy(fragmentFunctions.slug);
    return { data: rows, meta: { count: rows.length }, error: null };
  });
}

// --- Helpers (outside plugin, used internally) ---

export function normalizeForComparison(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function similarityRatio(a: string, b: string): number {
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1.0;
  const mat = Array.from({ length: shorter.length + 1 }, (_, j) => Array.from({ length: longer.length + 1 }, (_, i) => j === 0 ? i : i === 0 ? j : 0));
  for (let j = 1; j <= shorter.length; j++)
    for (let i = 1; i <= longer.length; i++)
      mat[j][i] = longer[i-1] === shorter[j-1] ? mat[j-1][i-1] : Math.min(mat[j][i-1]+1, mat[j-1][i]+1, mat[j-1][i-1]+1);
  return (longer.length - mat[shorter.length][longer.length]) / longer.length;
}

async function getPreviewForTag(slug: string): Promise<string> {
  const [row] = await db.select({ bodyExcerpt: fragments.bodyExcerpt }).from(fragments).where(like(fragments.tags, `%"${slug}"%`)).limit(1);
  return (row?.bodyExcerpt ?? '').slice(0, 150);
}

async function getPreviewForEntity(entityId: number): Promise<string> {
  const [row] = await db.select({ bodyExcerpt: fragments.bodyExcerpt }).from(fragments)
    .innerJoin(fragmentEntities, eq(fragmentEntities.fragment_id, fragments.id))
    .where(eq(fragmentEntities.entity_id, entityId)).limit(1);
  return (row?.bodyExcerpt ?? '').slice(0, 150);
}

async function computeFlagsForTag(tag: any): Promise<any[]> {
  const flags = [];
  if ((tag.usageCount ?? 0) < 3) flags.push({ type: 'info', label: 'Low usage' });
  const entityKeywords = ['cert', 'iso', 'rgpd', 'cnb', 'james', 'jmap', 'secnum'];
  if (entityKeywords.some(kw => tag.slug.toLowerCase().includes(kw)))
    flags.push({ type: 'warning', label: 'Possibly entity', suggestion: 'Convert to entity' });
  const validatedTags = await db.select().from(fragmentTags).where(eq(fragmentTags.validated, 1));
  for (const vt of validatedTags) {
    if (similarityRatio(tag.slug, vt.slug) > 0.7 && tag.slug !== vt.slug) {
      flags.push({ type: 'info', label: `Similar to ${vt.slug}`, merge_target: vt.slug });
      break;
    }
  }
  return flags;
}

async function computeFlagsForEntity(ent: any): Promise<any[]> {
  const flags = [];
  const validatedEntities = await db.select().from(entities).where(and(eq(entities.type, ent.type), eq(entities.validated, 1)));
  for (const ve of validatedEntities) {
    if (similarityRatio(ent.normalizedName, ve.normalizedName) > 0.6) {
      flags.push({ type: 'warning', label: `Canonical: ${ve.canonicalName}`, suggestion: `Set as alias of ${ve.canonicalName}` });
      break;
    }
  }
  const typeKeywords: Record<string, string[]> = {
    technology: ['protocol', 'api', 'sdk', 'framework', 'james', 'jmap'],
    certification: ['cert', 'iso', 'rgpd', 'secnumcloud', 'hds'],
  };
  for (const [correctType, kws] of Object.entries(typeKeywords)) {
    if (ent.type !== correctType && kws.some(kw => ent.name.toLowerCase().includes(kw))) {
      flags.push({ type: 'warning', label: 'Wrong type?', suggestion: `Reclassify as ${correctType}`, reclassify_to: correctType });
      break;
    }
  }
  return flags;
}

async function computeCounts() {
  const tagCount = await db.select({ value: count() }).from(fragmentTags).where(eq(fragmentTags.validated, 0));
  const entityCount = await db.select({ value: count() }).from(entities).where(eq(entities.validated, 0));
  const domainCount = await db.select({ value: count() }).from(fragmentDomains).where(eq(fragmentDomains.validated, 0));
  const entitiesByType = await db.select({ type: entities.type, value: count() }).from(entities).where(eq(entities.validated, 0)).groupBy(entities.type);
  return {
    tags: tagCount[0]?.value ?? 0,
    entities: entityCount[0]?.value ?? 0,
    domains: domainCount[0]?.value ?? 0,
    entities_by_type: entitiesByType.reduce((acc: any, r) => ({ ...acc, [r.type]: r.value }), {}),
  };
}
```

**VALIDATE**: `pnpm --filter @fragmint/server typecheck`

---

### Task 8: Propagate new metadata to final fragments

**File 1**: `packages/server/src/schema/fragment.ts`  
Add to `createFragmentSchema` (after `valid_until`):

```typescript
function_type: z.string().nullable().default(null),
audience: z.array(z.string()).default([]),
maturity: z.string().nullable().default(null),
harvest_confidence: z.number().min(0).max(1).nullable().default(null),
```

**File 2**: `packages/server/src/services/fragment-service.ts`  
In the `create()` DB insert (mirror existing fields), add:

```typescript
function_type: input.function_type ?? null,
audience: input.audience ? JSON.stringify(input.audience) : null,
maturity: input.maturity ?? null,
harvest_confidence: input.harvest_confidence ?? null,
```

**File 3**: `packages/server/src/services/harvester-service.ts`  
When calling `fragmentService.create()` for accepted candidates, pass:

```typescript
function_type: candidate.function_type ?? null,
audience: candidate.audience ? JSON.parse(candidate.audience) : [],
maturity: candidate.maturity ?? null,
harvest_confidence: candidate.confidence,
```

**VALIDATE**: `pnpm --filter @fragmint/server typecheck`

---

### Task 9: Backend — PATCH endpoint for candidate metadata editing

**File**: `packages/server/src/routes/harvest-routes.ts`

Add a PATCH endpoint so contributors can edit metadata on a specific candidate before accepting it. The candidate's referential values (tags/domains created inline by a human) get `validated=1` automatically.

```typescript
// PATCH /v1/collections/:collection/harvest/:jobId/candidates/:candidateId
// Also registered without collection prefix
app.patch(
  '/harvest/:jobId/candidates/:candidateId',
  { preHandler: [authenticate, requireRole('contributor')] },
  async (request, reply) => {
    const { jobId, candidateId } = request.params as { jobId: string; candidateId: string };
    const parsed = z.object({
      domain: z.string().optional(),
      function_type: z.string().optional(),
      audience: z.array(z.string()).optional(),
      maturity: z.string().optional(),
      tags: z.array(z.string()).optional(),
      entities_json: z.string().optional(),
    }).safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });

    const now = new Date().toISOString();
    const userLogin = request.user.login;

    // If contributor sets a domain not yet in referential → create with validated=1 (human-created)
    if (parsed.data.domain) {
      await db.insert(fragmentDomains).values({
        slug: parsed.data.domain, label: parsed.data.domain,
        validated: 1, proposedBy: `user:${userLogin}`, createdAt: now,
      }).onConflictDoNothing();
    }
    // Same for new tags
    for (const tag of parsed.data.tags ?? []) {
      await db.insert(fragmentTags).values({
        slug: tag, label: tag, validated: 1, proposedBy: `user:${userLogin}`, createdAt: now,
      }).onConflictDoNothing();
    }

    await db.update(harvestCandidates)
      .set({
        ...(parsed.data.domain && { domain: parsed.data.domain }),
        ...(parsed.data.function_type && { function_type: parsed.data.function_type }),
        ...(parsed.data.audience && { audience: JSON.stringify(parsed.data.audience) }),
        ...(parsed.data.maturity && { maturity: parsed.data.maturity }),
        ...(parsed.data.tags && { tags: JSON.stringify(parsed.data.tags) }),
        ...(parsed.data.entities_json && { entities_json: parsed.data.entities_json }),
        metadata_status: 'human-validated',
      })
      .where(and(eq(harvestCandidates.id, candidateId), eq(harvestCandidates.job_id, jobId)));

    return { data: { id: candidateId, metadata_status: 'human-validated' }, meta: null, error: null };
  },
);
```

Import `harvestCandidates`, `fragmentDomains`, `fragmentTags` from `../db/schema.js` and `and`, `eq` from `drizzle-orm`.

**VALIDATE**: `pnpm --filter @fragmint/server typecheck`

---

### Task 10: Frontend — Admin metadata page

Split into 5 sub-steps. Execute in order.

#### 10a — TypeScript types

**File**: `packages/web/src/types/admin-metadata.ts` (NEW)

```typescript
export type ProposalKind = 'tag' | 'domain' | 'entity';

export type EntityType =
  | 'client' | 'product' | 'technology' | 'partner'
  | 'certification' | 'regulation' | 'metric';

export interface ProposalFlag {
  type: 'warning' | 'info';
  label: string;
  suggestion?: string;
  merge_target?: string;
  reclassify_to?: EntityType;
}

export interface MetadataProposal {
  id: string | number;
  kind: ProposalKind;
  name: string;
  label?: string;
  entity_type?: EntityType;
  usage_count: number;
  validated: boolean;
  proposed_by: string;
  created_at: string;
  preview?: string;
  flags: ProposalFlag[];
}

export interface ProposalCounts {
  tags: number;
  entities: number;
  domains: number;
  entities_by_type: Record<EntityType, number>;
}

export interface ProposalsResponse {
  proposals: MetadataProposal[];
  total: number;
  counts: ProposalCounts;
}

export interface ValidatedReferenceValue {
  id: string | number;
  slug?: string;
  name?: string;
  label: string;
  type?: EntityType;
  canonical_name?: string;
  usage_count: number;
}
```

**VALIDATE**: `pnpm --filter @fragmint/web typecheck`

#### 10b — React Query hooks

**File**: `packages/web/src/api/hooks/use-metadata-proposals.ts` (NEW)

**MIRROR**: Check `apiRequest` signature in `packages/web/src/api/client.ts` — it's `apiRequest<T>(method, url, body?)` based on how `use-fragments.ts` uses it.

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import type { ProposalKind, EntityType, ProposalsResponse, ValidatedReferenceValue } from '@/types/admin-metadata';

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['admin', 'metadata'] });
  qc.invalidateQueries({ queryKey: ['fragments'] });
}

export function useMetadataProposals(params: {
  kind?: ProposalKind; entity_type?: EntityType; search?: string; limit?: number; offset?: number;
} = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([_, v]) => v !== undefined) as [string, string][]).toString();
  return useQuery<ProposalsResponse>({
    queryKey: ['admin', 'metadata', 'proposals', params],
    queryFn: () => apiRequest('GET', `/v1/admin/metadata/proposals?${qs}`),
  });
}

export function useValidatedReferenceValues(kind: ProposalKind, entity_type?: EntityType) {
  return useQuery<ValidatedReferenceValue[]>({
    queryKey: ['admin', 'metadata', 'validated', kind, entity_type],
    queryFn: () => {
      const p = new URLSearchParams({ kind });
      if (entity_type) p.set('entity_type', entity_type);
      return apiRequest('GET', `/v1/admin/metadata/validated?${p}`);
    },
  });
}

export function useApproveProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, kind }: { id: string | number; kind: ProposalKind }) =>
      apiRequest('POST', `/v1/admin/metadata/proposals/${id}/approve`, { kind }),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useRejectProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, kind }: { id: string | number; kind: ProposalKind }) =>
      apiRequest('POST', `/v1/admin/metadata/proposals/${id}/reject`, { kind }),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useRenameProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { id: string | number; kind: ProposalKind; new_name: string; new_label?: string }) =>
      apiRequest('POST', `/v1/admin/metadata/proposals/${p.id}/rename`, p),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useMergeProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { id: string | number; kind: ProposalKind; target_id: string | number }) =>
      apiRequest('POST', `/v1/admin/metadata/proposals/${p.id}/merge`, p),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useConvertToEntity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { id: string; entity_type: EntityType; canonical_name: string; aliases?: string[] }) =>
      apiRequest('POST', `/v1/admin/metadata/proposals/${p.id}/convert-to-entity`, p),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useSetAsAlias() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { id: number; canonical_entity_id: number }) =>
      apiRequest('POST', `/v1/admin/metadata/proposals/${p.id}/set-as-alias`, p),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useReclassifyEntityType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { id: number; new_type: EntityType }) =>
      apiRequest('POST', `/v1/admin/metadata/proposals/${p.id}/reclassify-entity-type`, p),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useBulkAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { action: 'approve' | 'reject'; items: Array<{ id: string | number; kind: ProposalKind }> }) =>
      apiRequest('POST', `/v1/admin/metadata/bulk-action`, p),
    onSuccess: () => invalidateAll(qc),
  });
}
```

**VALIDATE**: `pnpm --filter @fragmint/web typecheck`

#### 10c — Components

**Directory**: `packages/web/src/components/admin/metadata/` (NEW — create dir)

**Prerequisite**: check shadcn components. If `Checkbox` or `Select` are missing:
```bash
npx shadcn@latest add checkbox select
```

Add `warning` and `info` badge variants to `packages/web/src/components/ui/badge.tsx` if not present:
```typescript
warning: 'border-transparent bg-yellow-100 text-yellow-900 hover:bg-yellow-200',
info: 'border-transparent bg-blue-100 text-blue-900 hover:bg-blue-200',
```

**File 1: `admin-metadata-tab.tsx`** — Top-level with Tags/Entities/Domains sub-tabs, search, bulk actions.

```typescript
import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Check, X, Loader2 } from 'lucide-react';
import { useMetadataProposals, useBulkAction } from '@/api/hooks/use-metadata-proposals';
import { ProposalsList } from './proposals-list';
import type { ProposalKind } from '@/types/admin-metadata';

export function AdminMetadataTab() {
  const [activeKind, setActiveKind] = useState<ProposalKind>('tag');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());

  const { data } = useMetadataProposals({ limit: 0 });
  const counts = data?.counts ?? { tags: 0, entities: 0, domains: 0, entities_by_type: {} as any };
  const bulkAction = useBulkAction();

  const handleBulk = (action: 'approve' | 'reject') => {
    if (selectedIds.size === 0) return;
    bulkAction.mutate(
      { action, items: Array.from(selectedIds).map(id => ({ id, kind: activeKind })) },
      { onSuccess: () => setSelectedIds(new Set()) }
    );
  };

  const toggleSelection = (id: string | number) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedIds(next);
  };

  return (
    <Tabs value={activeKind} onValueChange={(v) => { setActiveKind(v as ProposalKind); setSelectedIds(new Set()); }}>
      <TabsList>
        <TabsTrigger value="tag">Tags <span className="ml-1.5 text-xs opacity-70">({counts.tags})</span></TabsTrigger>
        <TabsTrigger value="entity">Entities <span className="ml-1.5 text-xs opacity-70">({counts.entities})</span></TabsTrigger>
        <TabsTrigger value="domain">Domains <span className="ml-1.5 text-xs opacity-70">({counts.domains})</span></TabsTrigger>
      </TabsList>

      <div className="flex gap-2 items-center mt-4 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search proposals..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Button variant="outline" size="sm" disabled={selectedIds.size === 0 || bulkAction.isPending} onClick={() => handleBulk('approve')}>
          {bulkAction.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
          Bulk approve ({selectedIds.size})
        </Button>
        <Button variant="outline" size="sm" disabled={selectedIds.size === 0 || bulkAction.isPending} onClick={() => handleBulk('reject')} className="text-destructive hover:text-destructive">
          <X className="h-4 w-4 mr-2" />Bulk reject ({selectedIds.size})
        </Button>
      </div>

      {(['tag', 'entity', 'domain'] as ProposalKind[]).map(k => (
        <TabsContent key={k} value={k}>
          <ProposalsList kind={k} search={search} selectedIds={selectedIds} onToggle={toggleSelection}
            countsByType={k === 'entity' ? counts.entities_by_type : undefined} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
```

**File 2: `proposals-list.tsx`** — Entity type sub-nav for entities, card list for all kinds.

```typescript
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useMetadataProposals } from '@/api/hooks/use-metadata-proposals';
import { ProposalCard } from './proposal-card';
import type { ProposalKind, EntityType } from '@/types/admin-metadata';

const ENTITY_TYPES: EntityType[] = ['client', 'product', 'technology', 'partner', 'certification', 'regulation', 'metric'];

interface Props { kind: ProposalKind; search: string; selectedIds: Set<string | number>; onToggle: (id: string | number) => void; countsByType?: Record<EntityType, number>; }

export function ProposalsList({ kind, search, selectedIds, onToggle, countsByType }: Props) {
  const [entityType, setEntityType] = useState<EntityType>('client');
  const { data, isLoading } = useMetadataProposals({ kind, entity_type: kind === 'entity' ? entityType : undefined, search: search || undefined });

  return (
    <div>
      {kind === 'entity' && (
        <div className="flex gap-1 mb-4 flex-wrap">
          {ENTITY_TYPES.map(t => (
            <Button key={t} variant={entityType === t ? 'secondary' : 'ghost'} size="sm"
              onClick={() => setEntityType(t)} className="text-xs capitalize">
              {t}s <span className="ml-1.5 opacity-70">({countsByType?.[t] ?? 0})</span>
            </Button>
          ))}
        </div>
      )}
      {isLoading
        ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        : data?.proposals.length === 0
          ? <p className="text-center py-8 text-sm text-muted-foreground">No pending {kind} proposals.</p>
          : <div className="space-y-3">{data?.proposals.map(p => <ProposalCard key={`${p.kind}-${p.id}`} proposal={p} selected={selectedIds.has(p.id)} onToggle={() => onToggle(p.id)} />)}</div>
      }
    </div>
  );
}
```

**File 3: `proposal-card.tsx`** — Card with flags, usage count, preview, and contextual action buttons.

```typescript
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Check, X, Edit, Combine, ArrowRight, AlertTriangle, Info } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useApproveProposal, useRejectProposal } from '@/api/hooks/use-metadata-proposals';
import { RenameDialog } from './rename-dialog';
import { MergeDialog } from './merge-dialog';
import { ConvertToEntityDialog } from './convert-to-entity-dialog';
import type { MetadataProposal } from '@/types/admin-metadata';

interface Props { proposal: MetadataProposal; selected: boolean; onToggle: () => void; }

export function ProposalCard({ proposal, selected, onToggle }: Props) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const approve = useApproveProposal();
  const reject = useRejectProposal();

  return (
    <Card className="p-4">
      <div className="flex gap-3">
        <Checkbox checked={selected} onCheckedChange={onToggle} className="mt-1" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <code className="text-sm font-medium px-1.5 py-0.5 bg-muted rounded">{proposal.name}</code>
            <Badge variant="secondary">
              {proposal.entity_type && <span className="mr-1">{proposal.entity_type}</span>}
              · {proposal.usage_count} fragments
            </Badge>
            {proposal.flags.map((flag, i) => (
              <Badge key={i} variant={flag.type === 'warning' ? 'destructive' : 'default'} className="text-xs">
                {flag.type === 'warning' ? <AlertTriangle className="h-3 w-3 mr-1" /> : <Info className="h-3 w-3 mr-1" />}
                {flag.label}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            Proposed by {proposal.proposed_by} · {formatDistanceToNow(new Date(proposal.created_at), { addSuffix: true })}
          </p>
          {proposal.preview && <p className="text-sm text-muted-foreground italic mb-3 line-clamp-2">"{proposal.preview}"</p>}
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" onClick={() => approve.mutate({ id: proposal.id, kind: proposal.kind })} disabled={approve.isPending}>
              <Check className="h-3.5 w-3.5 mr-1.5" />Approve
            </Button>
            {proposal.flags.some(f => f.label === 'Possibly entity') && proposal.kind === 'tag' && (
              <Button size="sm" variant="outline" onClick={() => setConvertOpen(true)}>
                <ArrowRight className="h-3.5 w-3.5 mr-1.5" />Convert to entity
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setRenameOpen(true)}><Edit className="h-3.5 w-3.5 mr-1.5" />Rename</Button>
            <Button size="sm" variant="outline" onClick={() => setMergeOpen(true)}><Combine className="h-3.5 w-3.5 mr-1.5" />Merge</Button>
            <Button size="sm" variant="outline" onClick={() => reject.mutate({ id: proposal.id, kind: proposal.kind })} disabled={reject.isPending} className="text-destructive hover:text-destructive">
              <X className="h-3.5 w-3.5 mr-1.5" />Reject
            </Button>
          </div>
        </div>
      </div>
      {renameOpen && <RenameDialog proposal={proposal} open onOpenChange={setRenameOpen} />}
      {mergeOpen && <MergeDialog proposal={proposal} open onOpenChange={setMergeOpen} />}
      {convertOpen && <ConvertToEntityDialog proposal={proposal} open onOpenChange={setConvertOpen} />}
    </Card>
  );
}
```

**File 4: `rename-dialog.tsx`** — Rename before approving.

```typescript
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useRenameProposal } from '@/api/hooks/use-metadata-proposals';
import type { MetadataProposal } from '@/types/admin-metadata';

interface Props { proposal: MetadataProposal; open: boolean; onOpenChange: (open: boolean) => void; }

export function RenameDialog({ proposal, open, onOpenChange }: Props) {
  const [newName, setNewName] = useState(proposal.name);
  const rename = useRenameProposal();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Rename {proposal.kind}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-4">
          <div><Label>Current name</Label><Input value={proposal.name} disabled /></div>
          <div>
            <Label>New name</Label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="kebab-case-name" />
            <p className="text-xs text-muted-foreground mt-1">Use kebab-case.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => rename.mutate({ id: proposal.id, kind: proposal.kind, new_name: newName }, { onSuccess: () => onOpenChange(false) })} disabled={rename.isPending || newName === proposal.name}>Save & Approve</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**File 5: `merge-dialog.tsx`** — Searchable picker to merge into or set as alias of a validated value.

```typescript
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useMergeProposal, useSetAsAlias, useValidatedReferenceValues } from '@/api/hooks/use-metadata-proposals';
import type { MetadataProposal } from '@/types/admin-metadata';

interface Props { proposal: MetadataProposal; open: boolean; onOpenChange: (open: boolean) => void; }

export function MergeDialog({ proposal, open, onOpenChange }: Props) {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | number | null>(null);
  const { data: validated } = useValidatedReferenceValues(proposal.kind, proposal.entity_type);
  const merge = useMergeProposal();
  const setAlias = useSetAsAlias();

  const isAliasMode = proposal.kind === 'entity' && proposal.flags.some(f => f.label.startsWith('Canonical:'));
  const filtered = (validated ?? []).filter(v => (v.canonical_name || v.label || v.name || '').toLowerCase().includes(search.toLowerCase()) && v.id !== proposal.id);

  const handleAction = () => {
    if (!selectedId) return;
    if (isAliasMode) setAlias.mutate({ id: Number(proposal.id), canonical_entity_id: Number(selectedId) }, { onSuccess: () => onOpenChange(false) });
    else merge.mutate({ id: proposal.id, kind: proposal.kind, target_id: selectedId }, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{isAliasMode ? 'Set as alias of...' : `Merge "${proposal.name}" with...`}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-4">
          <Input placeholder="Search validated values..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="max-h-60 overflow-y-auto space-y-1 border rounded p-2">
            {filtered.length === 0
              ? <p className="text-sm text-muted-foreground p-2">No matching values.</p>
              : filtered.map(v => (
                <div key={v.id} onClick={() => setSelectedId(v.id)} className={`p-2 rounded cursor-pointer text-sm ${selectedId === v.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
                  {v.canonical_name || v.label || v.name}<span className="text-xs opacity-70 ml-2">({v.usage_count} fragments)</span>
                </div>
              ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleAction} disabled={!selectedId || merge.isPending || setAlias.isPending}>{isAliasMode ? 'Set as alias' : 'Merge'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**File 6: `convert-to-entity-dialog.tsx`** — Converts a tag proposal into a new validated entity.

```typescript
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConvertToEntity } from '@/api/hooks/use-metadata-proposals';
import type { MetadataProposal, EntityType } from '@/types/admin-metadata';

const ENTITY_TYPES: EntityType[] = ['client', 'product', 'technology', 'partner', 'certification', 'regulation', 'metric'];

interface Props { proposal: MetadataProposal; open: boolean; onOpenChange: (open: boolean) => void; }

export function ConvertToEntityDialog({ proposal, open, onOpenChange }: Props) {
  const [entityType, setEntityType] = useState<EntityType>('technology');
  const [canonicalName, setCanonicalName] = useState(proposal.name);
  const [aliases, setAliases] = useState('');
  const convert = useConvertToEntity();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Convert tag to entity</DialogTitle></DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <Label>Entity type</Label>
            <Select value={entityType} onValueChange={(v) => setEntityType(v as EntityType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{ENTITY_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Canonical name</Label><Input value={canonicalName} onChange={(e) => setCanonicalName(e.target.value)} /></div>
          <div><Label>Aliases (comma-separated)</Label><Input value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="e.g. James, Apache James" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => convert.mutate({ id: String(proposal.id), entity_type: entityType, canonical_name: canonicalName, aliases: aliases.split(',').map(s => s.trim()).filter(Boolean) }, { onSuccess: () => onOpenChange(false) })} disabled={convert.isPending}>Convert & Validate</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**VALIDATE**: `pnpm --filter @fragmint/web typecheck`

#### 10d — Admin page

**File**: `packages/web/src/pages/admin.tsx` (NEW)

**MIRROR**: Role guard pattern from `validation.tsx:110` — `if (!hasRole(role, 'admin')) return <Navigate to="/home" replace />`

```typescript
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AdminMetadataTab } from '@/components/admin/metadata/admin-metadata-tab';

const ROLE_LEVEL: Record<string, number> = { reader: 0, contributor: 1, expert: 2, admin: 3 };
const hasRole = (role: string, min: string) => (ROLE_LEVEL[role] ?? 0) >= (ROLE_LEVEL[min] ?? 999);

export default function AdminPage() {
  const { user } = useAuth();
  if (!hasRole(user?.role ?? 'reader', 'admin')) return <Navigate to="/home" replace />;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-medium mb-1">Admin</h1>
      <p className="text-sm text-muted-foreground mb-6">Validate emergent metadata proposed by the LLM during ingestion</p>
      <Tabs defaultValue="metadata">
        <TabsList>
          <TabsTrigger value="metadata">Metadata</TabsTrigger>
          <TabsTrigger value="relations" disabled>Relations</TabsTrigger>
          <TabsTrigger value="supersedure" disabled>Supersedure</TabsTrigger>
          <TabsTrigger value="contradictions" disabled>Contradictions</TabsTrigger>
          <TabsTrigger value="users" disabled>Users</TabsTrigger>
          <TabsTrigger value="collections" disabled>Collections</TabsTrigger>
        </TabsList>
        <TabsContent value="metadata" className="mt-6">
          <AdminMetadataTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

#### 10e — Routing + sidebar

**File**: `packages/web/src/App.tsx` — read the file first to find where protected routes are registered, then add:

```typescript
import AdminPage from '@/pages/admin';

// Inside router, alongside other protected routes:
<Route path="/admin" element={<AdminPage />} />
```

**File**: `packages/web/src/components/app-layout.tsx` — read first to find where `navItems` is defined and how role-gated entries are added (mirror the pattern used for the Validation page link). Add:

```typescript
import { Shield } from 'lucide-react';

// In navItems, add conditional entry after existing items:
...(hasRole(role, 'admin') ? [{ to: '/admin', label: t('nav', 'admin'), icon: Shield }] : []),
```

**i18n**: Find the i18n file (check `packages/web/src/lib/i18n.ts` or similar), add `admin: 'Admin'` to both `fr` and `en` nav sections (mirror where `validation` key is defined).

**VALIDATE**: `pnpm --filter @fragmint/web typecheck`. Then start dev server, navigate to `/admin` as admin user, verify the page loads and the Metadata tab renders.

---

### Task 11: Frontend — Metadata editing in fragment drawer + harvest candidate card

**Files:**
- `packages/web/src/components/fragment-detail.tsx` — existing drawer, add metadata edit section
- Harvest candidate card / harvest job detail page — add inline metadata editing

**Fragment drawer additions** (for validated fragments — author/reviewer/approver can edit):

Add a "Metadata" section below the body with:
- `domain` — `<Select>` populated from `GET /v1/fragment-domains` (validated only)
- `function_type` — `<Select>` from `GET /v1/admin/functions`
- `audience` — multi-checkbox: `technical` | `decision-maker` | `user` | `legal`
- `maturity` — `<Select>`: `production` | `beta` | `roadmap` | `archive`
- `tags` — combobox with autocomplete from `GET /v1/fragment-tags?validated=1` + free creation on Enter
- `metadata_status` badge — `auto-validated` (green) | `needs-review` (yellow) | `requires-review` (red)

On save: `PATCH /v1/fragments/:id` with updated metadata fields (extend existing update endpoint if needed).

**Harvest candidate card additions** (for pending candidates):

- Show `metadata_status` badge
- Inline edit button → opens metadata edit panel
- On save: `PATCH /v1/harvest/:jobId/candidates/:candidateId` (Task 9)

**Key API hooks needed:**
- `useFragmentDomains()` — already exists as `useDomains()` in `use-taxonomy.ts`, check if it needs a `validated=1` filter
- `useFragmentFunctions()` — new hook, `GET /v1/admin/functions`
- `useFragmentTags()` — check `use-taxonomy.ts` for existing hook

**VALIDATE**: Start dev server, open a harvest candidate, edit domain from dropdown, save, verify `PATCH` fires correctly and candidate card updates.

---

### Task 12: Full validation

```bash
# Type check
pnpm --filter @fragmint/server typecheck
pnpm --filter @fragmint/web typecheck

# Lint
pnpm lint

# Unit tests
pnpm test

# Manual smoke test
# Backend:
# 1. docker compose -f docker/docker-compose.dev.yml up
# 2. GET /v1/admin/proposals → empty initially
# 3. GET /v1/admin/functions → 6 rows
# 4. GET /v1/fragment-domains → ≥10 granular slugs
# 5. Upload DOCX → harvest → check candidates have function_type/audience/maturity
# 6. PATCH /v1/harvest/:jobId/candidates/:id with new domain → metadata_status = 'human-validated'
# 7. Accept candidate → fragment.harvest_confidence, function_type populated
#
# Frontend:
# 8. pnpm --filter @fragmint/web dev
# 9. Navigate to /admin → click Metadata tab → pending queue loads (empty if no LLM proposals yet)
# 10. Upload DOCX with unknown entity → check it appears in pending queue
# 11. Open harvest candidate drawer → metadata fields editable, save works
# 12. Open fragment detail drawer → metadata section visible for author/reviewer
```

---

## Quality Criteria (Exit Gate)

| Criterion | Target | How to check |
|-----------|--------|--------------|
| function_type populated on candidates | 100% | `SELECT count(*) FROM harvest_candidates WHERE function_type IS NULL` |
| audience populated | 100% | `SELECT count(*) FROM harvest_candidates WHERE audience IS NULL` |
| LLM NEW: proposals in queue | All inserted with `validated=0` | `SELECT count(*) FROM fragment_tags WHERE validated=0 AND proposed_by='llm-auto'` |
| Human-created tags auto-validated | `validated=1` | `SELECT validated FROM fragment_tags WHERE proposed_by LIKE 'user:%'` |
| harvest_confidence on fragments | 100% of harvested | `SELECT count(*) FROM fragments WHERE origin='harvested' AND harvest_confidence IS NULL` |
| fragment_functions seeded | 6 rows | `SELECT count(*) FROM fragment_functions` |
| Granular domains seeded | ≥10 rows | `SELECT count(*) FROM fragment_domains` |
| PATCH candidate metadata | 200 response, metadata_status='human-validated' | Manual + check DB |
| Admin proposals page | Loads, approve/reject works | Browser test |
| Contributor drawer | Metadata fields editable, save fires PATCH | Browser test |
| Type check | Zero errors | `pnpm --filter @fragmint/server typecheck && pnpm --filter @fragmint/web typecheck` |
