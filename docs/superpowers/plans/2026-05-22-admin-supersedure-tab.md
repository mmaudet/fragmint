# Feature: Admin "Remplacements" Tab (Supersedure)

## Summary

Add a "Remplacements" tab to the admin panel that detects when a newly ingested fragment supersedes an existing one. Detection runs automatically after a harvest candidate is validated (fragment created). An admin UI surfaces proposals with a side-by-side diff, and lets the admin approve (deprecate old + link fragments) or dismiss. The system uses Jaccard similarity as a pre-filter and an LLM judge as the final arbiter.

## User Story

As an admin
I want to see proposals where a new fragment may replace an existing one
So that I can keep the library free of outdated duplicates without manual scanning

## Problem Statement

After harvest, the library accumulates fragments covering the same topic at different points in time (e.g., pricing 2025 / pricing 2026). There is currently no mechanism to detect or resolve this — admins must find these manually.

## Solution Statement

1. After each `fragmentService.create()` call in `harvester-service.ts:validate()`, trigger async supersedure detection (fire-and-forget, error-logged).
2. Detection: Jaccard similarity on `body_excerpt` tokens as a candidate pre-filter → LLM judge (SUPERSEDE | COEXIST | DIFFERENT_TOPIC).
3. Proposals stored in a `supersedure_proposals` table.
4. Admin UI tab "Remplacements" shows open proposals, each with a visual diff. Admin approves (old → `deprecated`, bidirectional `supersedes`/`superseded_by` links) or dismisses.

## Metadata

| Field            | Value                                                    |
| ---------------- | -------------------------------------------------------- |
| Type             | NEW_CAPABILITY                                           |
| Complexity       | HIGH                                                     |
| Systems Affected | server/db, server/services, server/routes, web/api, web/pages |
| Dependencies     | diff v9 (server+web), react-diff-viewer-continued v3.4.0 |
| Estimated Tasks  | 11                                                       |

---

## UX Design

### Before State

```
╔══════════════════════════════════════════════════════════════════╗
║  Admin Panel                                                     ║
║  ┌──────────┬──────────┬─────────────┬──────────────────────┐   ║
║  │ Metadata │ Users    │ Remplacements (disabled)            │   ║
║  └──────────┴──────────┴─────────────┴──────────────────────┘   ║
║                                                                  ║
║  After harvest validation:                                       ║
║  - New fragment created silently                                 ║
║  - No detection of potential duplicates/supersedures             ║
║  - Admin must manually compare fragments                         ║
╚══════════════════════════════════════════════════════════════════╝
```

### After State

```
╔══════════════════════════════════════════════════════════════════╗
║  Admin Panel                                                     ║
║  ┌──────────┬──────────┬─────────────────────────────────────┐   ║
║  │ Metadata │ Users    │ Remplacements [3]  ← badge count     │   ║
║  └──────────┴──────────┴─────────────────────────────────────┘   ║
║                                                                  ║
║  ┌──────────────────────────────────────────────────────────┐    ║
║  │ Propositions de remplacement                             │    ║
║  │ ┌──────────────────────────────────────────────────────┐ │    ║
║  │ │ Fragment A → remplace → Fragment B     [LLM: 0.91]   │ │    ║
║  │ │ [Voir diff]  [Confirmer]  [Coexister]  [Rejeter]    │ │    ║
║  │ └──────────────────────────────────────────────────────┘ │    ║
║  │ ┌──────────────────────────────────────────────────────┐ │    ║
║  │ │ Fragment C → remplace → Fragment D     [LLM: 0.78]   │ │    ║
║  │ │ [Voir diff]  [Confirmer]  [Coexister]  [Rejeter]    │ │    ║
║  │ └──────────────────────────────────────────────────────┘ │    ║
║  └──────────────────────────────────────────────────────────┘    ║
║                                                                  ║
║  [Diff Sheet — side-by-side comparison when "Voir diff" clicked] ║
╚══════════════════════════════════════════════════════════════════╝
```

### Interaction Changes

| Location                              | Before                          | After                                      | User Impact                         |
| ------------------------------------- | ------------------------------- | ------------------------------------------ | ----------------------------------- |
| `pages/admin.tsx`                     | "Remplacements" tab disabled    | Tab enabled, shows proposal count badge    | Admin can navigate to the tab       |
| Harvest validate (server)             | Fragment created silently        | Async detection triggered, proposals saved | Automatic proposal generation       |
| Admin "Remplacements" tab             | Not rendered                    | Proposal list with diff sheet              | Visually compare and decide          |
| Fragment after approval               | No supersedure metadata          | `superseded_by`/`supersedes` + `deprecated`| Library stays clean                 |

---

## Mandatory Reading

| Priority | File | Lines | Why Read This |
| -------- | ---- | ----- | ------------- |
| P0 | `packages/server/src/db/connection.ts` | 1-260 | Migration pattern — `CREATE TABLE IF NOT EXISTS` in DDL block, `ALTER TABLE` in try/catch after |
| P0 | `packages/server/src/db/schema.ts` | 1-100 | Drizzle table definitions — column names, types, defaults |
| P0 | `packages/server/src/services/harvester-service.ts` | 431-540 | `validate()` method — hook points after `fragmentService.create()` |
| P0 | `packages/server/src/routes/admin-metadata-routes.ts` | 1-40 | Canonical Fastify 5 route pattern (preHandler, no app.register) |
| P1 | `packages/server/src/services/llm-client.ts` | 56-94 | `chatMessages()` signature and response parsing |
| P1 | `packages/server/src/index.ts` | 285-340 | Route registration — where to add `adminSupersedureRoutes` |
| P1 | `packages/web/src/api/client.ts` | all | `apiRequest<T>()` — extracts `json.data` from `{ data, meta, error }` |
| P1 | `packages/web/src/pages/admin.tsx` | all | Enable disabled tab, add panel content |
| P2 | `packages/web/src/components/admin/` | all | Existing admin component patterns |
| P2 | `packages/web/src/api/hooks/use-metadata-proposals.ts` | all | React Query hook pattern to mirror |

**External Documentation:**

| Source | Section | Why Needed |
| ------ | ------- | ---------- |
| diff v9 npm | `diffWords()`, `Change[]` | Word-level diff for body comparison |
| react-diff-viewer-continued v3.4.0 | README | Requires `--legacy-peer-deps` on React 19 |

---

## Patterns to Mirror

**FASTIFY_5_ROUTE_REGISTRATION:**
```typescript
// SOURCE: packages/server/src/routes/admin-metadata-routes.ts:15-30
// COPY THIS PATTERN (plain function, NOT app.register):
export function adminSupersedureRoutes(
  app: FastifyInstance,
  db: FragmintDb,
  authenticate: ReturnType<typeof import('../auth/middleware.js').buildAuthMiddleware>,
  llmClient: LlmClient,
) {
  app.get('/v1/admin/supersedure/proposals',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => { ... }
  );
}
```

**API_RESPONSE_FORMAT:**
```typescript
// SOURCE: packages/server/src/routes/fragment-routes.ts (correct format)
// ALWAYS wrap — admin-metadata-routes.ts does NOT do this correctly (pre-existing bug)
return reply.send({ data: proposals, meta: { count: proposals.length }, error: null });
// ERROR case:
return reply.status(404).send({ data: null, meta: null, error: 'Not found' });
```

**DRIZZLE_SYNC_TRANSACTION:**
```typescript
// SOURCE: pattern from connection.ts — better-sqlite3 transactions are SYNCHRONOUS
// NEVER use async tx => — use synchronous callback with .run()
const result = db.transaction((tx) => {
  tx.update(fragments).set({ quality: 'deprecated' }).where(eq(fragments.id, oldId)).run();
  tx.update(supersedureProposals).set({ status: 'approved', reviewed_at: now })
    .where(eq(supersedureProposals.id, proposalId)).run();
  return true;
});
```

**DB_MIGRATION_NEW_TABLE:**
```typescript
// SOURCE: packages/server/src/db/connection.ts:13-153
// New tables go INSIDE the sqlite.exec(`...`) DDL block (not in try/catch)
CREATE TABLE IF NOT EXISTS supersedure_proposals (
  id TEXT PRIMARY KEY,
  new_fragment_id TEXT NOT NULL,
  old_fragment_id TEXT NOT NULL,
  ...
);
```

**DB_MIGRATION_NEW_COLUMN:**
```typescript
// SOURCE: packages/server/src/db/connection.ts:156-256
// New columns go AFTER the main DDL block, each in its own try/catch
try {
  sqlite.exec('ALTER TABLE fragments ADD COLUMN superseded_by TEXT');
} catch (_) {}
try {
  sqlite.exec('ALTER TABLE fragments ADD COLUMN supersedes TEXT');
} catch (_) {}
```

**LLM_JUDGE_CALL:**
```typescript
// SOURCE: packages/server/src/services/llm-client.ts:63-94
// Returns raw string — extract JSON manually
const raw = await llmClient.chatMessages([
  { role: 'system', content: SYSTEM_PROMPT },
  { role: 'user', content: userPrompt },
]);
// Then parse: raw.match(/\{[\s\S]*\}/) to extract JSON object
```

**REACT_QUERY_HOOK:**
```typescript
// SOURCE: packages/web/src/api/hooks/use-metadata-proposals.ts (mirror pattern)
export function useSupersedureProposals(params: ...) {
  return useQuery({
    queryKey: ['supersedure-proposals', params],
    queryFn: () => apiRequest<SupersedureProposalListResponse>('GET', '/api/v1/admin/supersedure/proposals'),
  });
}
```

**JACCARD_SIMILARITY:**
```typescript
// Pure utility — no external dep needed:
function jaccard(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const setB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}
```

---

## Files to Change

| File | Action | Justification |
| ---- | ------ | ------------- |
| `packages/server/src/db/connection.ts` | UPDATE | Add `supersedure_proposals` DDL + `ALTER TABLE fragments` for 2 columns |
| `packages/server/src/db/schema.ts` | UPDATE | Add `supersedureProposals` Drizzle table + `superseded_by`/`supersedes` to `fragments` |
| `packages/server/src/services/supersedure-detector.ts` | CREATE | Jaccard pre-filter + LLM judge + DB proposal insert |
| `packages/server/src/services/harvester-service.ts` | UPDATE | Add detection hook after each `fragmentService.create()` in `validate()` |
| `packages/server/src/routes/admin-supersedure-routes.ts` | CREATE | 7 endpoints (list, get, confirm, coexist, reject, stats, bulk-reject) |
| `packages/server/src/index.ts` | UPDATE | Import + register `adminSupersedureRoutes` + pass `llmClient` |
| `packages/web/src/types/admin-supersedure.ts` | CREATE | TypeScript interfaces for frontend |
| `packages/web/src/api/hooks/use-supersedure-proposals.ts` | CREATE | React Query hooks (list, stats, confirm, coexist, reject) |
| `packages/web/src/components/admin/supersedure/supersedure-proposal-card.tsx` | CREATE | Single proposal row with actions |
| `packages/web/src/components/admin/supersedure/supersedure-diff-sheet.tsx` | CREATE | Side-by-side diff drawer |
| `packages/web/src/components/admin/supersedure/supersedure-proposal-list.tsx` | CREATE | List + empty state + loading skeleton |
| `packages/web/src/components/admin/supersedure/supersedure-tab.tsx` | CREATE | Tab root, stats header, list |
| `packages/web/src/pages/admin.tsx` | UPDATE | Enable tab, add badge, render `SupersedureTab` |
| `package.json` (root) | UPDATE | Add `diff` dependency |
| `packages/web/package.json` | UPDATE | Add `react-diff-viewer-continued` |

---

## NOT Building (Scope Limits)

- No UI for seeing supersedure chain history (which fragment replaced which over time)
- No automatic approval — always requires admin action
- No supersedure detection for manually created fragments (only harvested ones)
- No email/notification on new proposals
- No batch approval UI (only single approve per proposal)
- No Users tab (separate feature, out of scope for this task)

---

## Step-by-Step Tasks

Execute in order. Each task is independently verifiable.

---

### Task 1: DB — Add `supersedure_proposals` table + fragment columns

**File**: `packages/server/src/db/connection.ts`

**IMPLEMENT**:

Inside the main `sqlite.exec(`` ` `` ... `` ` ``)` DDL block, before the closing backtick, add:

```sql
CREATE TABLE IF NOT EXISTS supersedure_proposals (
  id TEXT PRIMARY KEY,
  new_fragment_id TEXT NOT NULL,
  old_fragment_id TEXT NOT NULL,
  similarity_score REAL NOT NULL,
  llm_judgment TEXT NOT NULL,
  llm_confidence REAL NOT NULL,
  llm_reasoning TEXT,
  elements_lost_in_new TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  resolved_by TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sp_new_fragment_idx ON supersedure_proposals(new_fragment_id);
CREATE INDEX IF NOT EXISTS sp_status_idx ON supersedure_proposals(status);
```

After the DDL block (in the try/catch section), add:

```typescript
try {
  sqlite.exec('ALTER TABLE fragments ADD COLUMN superseded_by TEXT');
} catch (_) {}
try {
  sqlite.exec('ALTER TABLE fragments ADD COLUMN supersedes TEXT');
} catch (_) {}
```

**VALIDATE**: `pnpm --filter @fragmint/server typecheck`

---

### Task 2: DB — Add Drizzle schema definitions

**File**: `packages/server/src/db/schema.ts`

**IMPLEMENT**:

1. Add `superseded_by` and `supersedes` columns to the `fragments` table definition.
2. Add new `supersedureProposals` table definition.

```typescript
// In the fragments table (after maturity column):
superseded_by: text('superseded_by'),
supersedes: text('supersedes'),
```

```typescript
// New table at bottom:
export const supersedureProposals = sqliteTable('supersedure_proposals', {
  id: text('id').primaryKey(),
  newFragmentId: text('new_fragment_id').notNull(),
  oldFragmentId: text('old_fragment_id').notNull(),
  similarityScore: real('similarity_score').notNull(),
  llmJudgment: text('llm_judgment').notNull(),
  llmConfidence: real('llm_confidence').notNull(),
  llmReasoning: text('llm_reasoning'),
  elementsLostInNew: text('elements_lost_in_new'),
  status: text('status').notNull().default('pending'),
  resolvedBy: text('resolved_by'),
  resolvedAt: text('resolved_at'),
  createdAt: text('created_at').notNull(),
});
```

**GOTCHA**: Column name in Drizzle uses camelCase but maps to `snake_case` SQL columns — match exactly what was put in connection.ts DDL.

**VALIDATE**: `pnpm --filter @fragmint/server typecheck`

---

### Task 3: Service — Create `supersedure-detector.ts`

**File**: `packages/server/src/services/supersedure-detector.ts`

**IMPLEMENT**:

```typescript
import { randomUUID } from 'node:crypto';
import { eq, ne, and, isNull } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { fragments, supersedureProposals } from '../db/schema.js';
import type { LlmClient } from './llm-client.js';

const JACCARD_THRESHOLD = 0.25;
const LLM_CONFIDENCE_MIN = 0.65;

const SYSTEM_PROMPT = `You are a document supersedure judge for a knowledge library.
Given two text fragments, decide if the NEW fragment supersedes the OLD one.
Return JSON: { "recommendation": "SUPERSEDE"|"COEXIST"|"DIFFERENT_TOPIC", "confidence": 0-1, "reasoning": "...", "elements_lost_in_b": ["element 1"] or null }
SUPERSEDE: new fragment covers the same topic and makes the old one outdated or redundant.
COEXIST: both are useful and complementary.
DIFFERENT_TOPIC: different subjects entirely.`;

function jaccard(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const setB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  const intersection = [...setA].filter(x => setB.has(x));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

export async function detectAndPropose(
  newFragmentId: string,
  db: FragmintDb,
  llmClient: LlmClient,
): Promise<void> {
  // Load new fragment
  const newRows = await db.select().from(fragments)
    .where(eq(fragments.id, newFragmentId)).limit(1);
  if (newRows.length === 0) return;
  const newFrag = newRows[0];
  if (!newFrag.body_excerpt) return;

  // Candidate pool: same domain + type, not deprecated, not already linked, not self
  const candidates = await db.select().from(fragments).where(
    and(
      eq(fragments.domain, newFrag.domain),
      eq(fragments.type, newFrag.type),
      ne(fragments.quality, 'deprecated'),
      ne(fragments.id, newFragmentId),
      isNull(fragments.superseded_by),
    ),
  ).limit(50);

  const now = new Date().toISOString();

  for (const candidate of candidates) {
    if (!candidate.body_excerpt) continue;
    const score = jaccard(newFrag.body_excerpt, candidate.body_excerpt);
    if (score < JACCARD_THRESHOLD) continue;

    // LLM judge
    const userPrompt = `NEW fragment:\n${newFrag.body_excerpt}\n\nOLD fragment:\n${candidate.body_excerpt}`;
    let judgment = 'COEXIST';
    let confidence = 0.5;
    let reasoning = '';
    let elementsLost: string | null = null;
    try {
      const raw = await llmClient.chatMessages([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ]);
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        judgment = parsed.recommendation ?? 'COEXIST';
        confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;
        reasoning = parsed.reasoning ?? '';
        elementsLost = parsed.elements_lost_in_b ? JSON.stringify(parsed.elements_lost_in_b) : null;
      }
    } catch {
      continue;
    }

    if (judgment !== 'SUPERSEDE' || confidence < LLM_CONFIDENCE_MIN) continue;

    // Check no pending proposal already exists for this pair
    const existing = await db.select({ id: supersedureProposals.id })
      .from(supersedureProposals)
      .where(
        and(
          eq(supersedureProposals.newFragmentId, newFragmentId),
          eq(supersedureProposals.oldFragmentId, candidate.id),
          eq(supersedureProposals.status, 'pending'),
        ),
      ).limit(1);
    if (existing.length > 0) continue;

    await db.insert(supersedureProposals).values({
      id: randomUUID(),
      newFragmentId,
      oldFragmentId: candidate.id,
      similarityScore: score,
      llmJudgment: judgment,
      llmConfidence: confidence,
      llmReasoning: reasoning,
      elementsLostInNew: elementsLost,
      status: 'pending',
      createdAt: now,
    });
  }
}
```

**VALIDATE**: `pnpm --filter @fragmint/server typecheck`

---

### Task 4: Service — Hook detection into `harvester-service.ts`

**File**: `packages/server/src/services/harvester-service.ts`

**IMPLEMENT**:

1. Add import at the top (after existing imports):
```typescript
import { detectAndPropose } from './supersedure-detector.js';
```

2. NO constructor change needed — `private llmClient: LlmClient` is already the 2nd parameter (confirmed at line 89).

3. After **each** `fragmentService.create()` call in `validate()` (both the `accepted` loop ~line 453 and the `modified` loop ~line 500), add the fire-and-forget hook:
```typescript
// Fire-and-forget — must not block validate()
detectAndPropose(result.id, this.db, this.llmClient).catch((err) => {
  console.error(`[supersedure] detection failed for ${result.id}:`, err);
});
```

**COHERENCE NOTE (Trust-by-Source package)**: The Trust-by-Source package also modifies `harvester-service.ts` but touches `_runPipeline()` (upload hints + trust_source computation). Supersedure only touches `validate()`. No conflict — apply both changes independently.

**VALIDATE**: `pnpm --filter @fragmint/server typecheck`

---

### Task 5: Routes — Create `admin-supersedure-routes.ts`

**File**: `packages/server/src/routes/admin-supersedure-routes.ts`

**IMPLEMENT** (6 endpoints):

```typescript
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { fragments, supersedureProposals } from '../db/schema.js';
import { requireRole } from '../auth/middleware.js';
import type { LlmClient } from '../services/llm-client.js';

// 1. GET /v1/admin/supersedure/proposals  — list pending proposals with fragment details
// 2. GET /v1/admin/supersedure/proposals/:id — single proposal
// 3. POST /v1/admin/supersedure/proposals/:id/confirm — deprecate old, link fragments
// 4. POST /v1/admin/supersedure/proposals/:id/coexist — mark coexist (both fragments stay active)
// 5. POST /v1/admin/supersedure/proposals/:id/reject — mark rejected
// 6. GET /v1/admin/supersedure/stats — counts by status
// 7. POST /v1/admin/supersedure/proposals/bulk-reject — reject all pending by new_fragment_id
```

**CONFIRM logic** (synchronous transaction — `/confirm` endpoint):
```typescript
const now = new Date().toISOString();
db.transaction((tx) => {
  // Mark old fragment as deprecated
  tx.update(fragments)
    .set({ quality: 'deprecated', superseded_by: proposal.newFragmentId, updated_at: now })
    .where(eq(fragments.id, proposal.oldFragmentId))
    .run();
  // Link new fragment back to old
  tx.update(fragments)
    .set({ supersedes: proposal.oldFragmentId, updated_at: now })
    .where(eq(fragments.id, proposal.newFragmentId))
    .run();
  // Mark proposal confirmed
  tx.update(supersedureProposals)
    .set({ status: 'confirmed', resolvedBy: request.user.login, resolvedAt: now })
    .where(eq(supersedureProposals.id, proposalId))
    .run();
});
```

**COEXIST logic** (`/coexist` endpoint — no fragment changes, just close the proposal):
```typescript
db.update(supersedureProposals)
  .set({ status: 'coexist', resolvedBy: request.user.login, resolvedAt: now })
  .where(eq(supersedureProposals.id, proposalId))
  .run();
```

**REJECT logic** (`/reject` endpoint):
```typescript
db.update(supersedureProposals)
  .set({ status: 'rejected', resolvedBy: request.user.login, resolvedAt: now })
  .where(eq(supersedureProposals.id, proposalId))
  .run();
```

**RESPONSE FORMAT**: Always use `{ data: T, meta: { count?: number } | null, error: null }`.

**VALIDATE**: `pnpm --filter @fragmint/server typecheck`

---

### Task 6: Server — Register routes in `index.ts`

**File**: `packages/server/src/index.ts`

**IMPLEMENT**:

1. Add import (after `adminMetadataRoutes` import):
```typescript
import { adminSupersedureRoutes } from './routes/admin-supersedure-routes.js';
```

2. Register after `adminMetadataRoutes` call (~line 337):
```typescript
adminMetadataRoutes(app, db, authenticate);
adminSupersedureRoutes(app, db, authenticate, llmClient);  // ← add this
```

3. `llmClient` is already a local variable at line ~291 — no changes needed there.

**VALIDATE**: `pnpm --filter @fragmint/server typecheck`

---

### Task 7: Frontend — Install packages

**IMPLEMENT**:

```bash
# Add diff to root workspace (used server-side too for potential future use, but needed client-side for diff display)
pnpm add diff
pnpm add --filter @fragmint/web react-diff-viewer-continued --legacy-peer-deps
```

**GOTCHA**: `react-diff-viewer-continued` v3.4.0 lists `react: "^15-18"` in peerDeps. React 19 is used here. The `--legacy-peer-deps` flag bypasses the peer dep check. The library works at runtime despite the version mismatch.

**If `react-diff-viewer-continued` causes build errors**, fall back to a hand-rolled word diff using the `diff` package:
```typescript
import { diffWords } from 'diff';
// Returns Change[] with { value: string, added?: boolean, removed?: boolean }
```

**VALIDATE**: `pnpm --filter @fragmint/web typecheck`

---

### Task 8: Frontend — TypeScript types

**File**: `packages/web/src/types/admin-supersedure.ts`

**IMPLEMENT**:

```typescript
export interface SupersedureProposal {
  id: string;
  new_fragment_id: string;
  old_fragment_id: string;
  similarity_score: number;
  llm_judgment: string;
  llm_confidence: number;
  llm_reasoning: string | null;
  elements_lost_in_new: string | null;
  status: 'pending' | 'confirmed' | 'rejected' | 'coexist';
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  // Joined fields from fragments:
  new_fragment?: FragmentSummary;
  old_fragment?: FragmentSummary;
}

export interface FragmentSummary {
  id: string;
  title: string | null;
  body_excerpt: string | null;
  domain: string;
  type: string;
  lang: string;
  quality: string;
  created_at: string;
}

export interface SupersedureStatsResponse {
  pending: number;
  confirmed: number;
  rejected: number;
  coexist: number;
  total: number;
}
```

**VALIDATE**: `pnpm --filter @fragmint/web typecheck`

---

### Task 9: Frontend — React Query hooks

**File**: `packages/web/src/api/hooks/use-supersedure-proposals.ts`

**IMPLEMENT** (mirror `use-metadata-proposals.ts` pattern):

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../client.js';
import type { SupersedureProposal, SupersedureStatsResponse } from '../../types/admin-supersedure.js';

export function useSupersedureProposals(status: string = 'pending') {
  return useQuery({
    queryKey: ['supersedure-proposals', status],
    queryFn: () => apiRequest<SupersedureProposal[]>('GET', `/api/v1/admin/supersedure/proposals?status=${status}`),
  });
}

export function useSupersedureStats() {
  return useQuery({
    queryKey: ['supersedure-stats'],
    queryFn: () => apiRequest<SupersedureStatsResponse>('GET', '/api/v1/admin/supersedure/stats'),
  });
}

export function useConfirmProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>('POST', `/api/v1/admin/supersedure/proposals/${id}/confirm`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supersedure-proposals'] });
      qc.invalidateQueries({ queryKey: ['supersedure-stats'] });
    },
  });
}

export function useCoexistProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>('POST', `/api/v1/admin/supersedure/proposals/${id}/coexist`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supersedure-proposals'] });
      qc.invalidateQueries({ queryKey: ['supersedure-stats'] });
    },
  });
}

export function useRejectProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>('POST', `/api/v1/admin/supersedure/proposals/${id}/reject`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supersedure-proposals'] });
      qc.invalidateQueries({ queryKey: ['supersedure-stats'] });
    },
  });
}
```

**VALIDATE**: `pnpm --filter @fragmint/web typecheck`

---

### Task 10: Frontend — React components

Create in `packages/web/src/components/admin/supersedure/`:

**`supersedure-diff-sheet.tsx`** — Side-by-side diff using `react-diff-viewer-continued` (or `diff` package fallback):
```typescript
// Props: { open: boolean; onClose: () => void; proposal: SupersedureProposal }
// Show: title, domain, type, lang for each fragment
// Show: side-by-side body_excerpt diff
// Show: "elements_lost_in_new" warning if non-null
// Footer: [Confirmer] [Coexister] [Rejeter] buttons
```

**`supersedure-proposal-card.tsx`** — Single row card:
```typescript
// Show: new fragment title → old fragment title
// Show: LLM confidence badge (color-coded: green ≥0.85, orange ≥0.65, red <0.65)
// Show: similarity score, created_at
// Actions: [Voir diff] [Confirmer] [Coexister] [Rejeter]
```

**`supersedure-proposal-list.tsx`** — List with skeleton loading and empty state:
```typescript
// Skeleton: 3 placeholder cards while loading
// Empty state: "Aucune proposition de remplacement en attente"
// Maps proposals to SupersedureProposalCard
// Manages diff sheet open state (selectedProposal: SupersedureProposal | null)
```

**`supersedure-tab.tsx`** — Tab root:
```typescript
// Header: "Propositions de remplacement" + stats chips (X ouvertes, Y approuvées)
// Body: SupersedureProposalList
// Filter: status selector (open / approved / dismissed)
```

**i18n**: Use existing `useTranslation()` pattern from `packages/web/src/lib/i18n.tsx`. Add keys:
- `admin.supersedure.title` → "Propositions de remplacement"
- `admin.supersedure.empty` → "Aucune proposition en attente"
- `admin.supersedure.confirm` → "Confirmer"
- `admin.supersedure.coexist` → "Coexister"
- `admin.supersedure.reject` → "Rejeter"
- `admin.supersedure.view_diff` → "Voir le diff"
- `admin.supersedure.new_fragment` → "Nouveau"
- `admin.supersedure.old_fragment` → "Remplacé"
- `admin.supersedure.elements_lost_warning` → "Éléments potentiellement perdus"

**VALIDATE**: `pnpm --filter @fragmint/web typecheck`

---

### Task 11: Frontend — Enable tab in `admin.tsx`

**File**: `packages/web/src/pages/admin.tsx`

**IMPLEMENT**:

1. Import `SupersedureTab` and `useSupersedureStats`.
2. Replace disabled tab trigger:
```typescript
// BEFORE:
<TabsTrigger value="supersedure" disabled>Supersedure</TabsTrigger>

// AFTER:
<TabsTrigger value="supersedure">
  Remplacements
  {(stats?.pending ?? 0) > 0 && (
    <Badge variant="destructive" className="ml-2 text-xs">{stats.pending}</Badge>
  )}
</TabsTrigger>
```
3. Add tab content panel:
```typescript
<TabsContent value="supersedure">
  <SupersedureTab />
</TabsContent>
```

**VALIDATE**: `pnpm --filter @fragmint/web typecheck`

---

## Post-Implementation Checks

```bash
# Type check both packages
pnpm --filter @fragmint/server typecheck
pnpm --filter @fragmint/web typecheck

# Lint
pnpm lint

# Unit tests (no new tests required, but existing must pass)
pnpm test
```

**Manual smoke test**:
1. Start dev stack (`docker compose -f docker/docker-compose.dev.yml up`)
2. Login as admin
3. Navigate to Admin > Remplacements — should show empty state
4. Run a harvest job with a document that overlaps an existing fragment
5. Validate a candidate in the harvest tab
6. Return to Remplacements — proposal should appear if LLM confidence ≥ 0.65
7. Click "Voir le diff" — diff sheet should open
8. Click "Approuver" — old fragment quality should change to `deprecated`
