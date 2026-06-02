# Scoring Refacto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor all 3 scoring systems (retrieval hybrid, duplicate detection, supersedure) following 2024-2026 IR literature best practices. Replace the linear weighted combination in `HybridRetriever` with RRF (Cormack 2009), add a Jaccard shingles cascade for duplicate detection, add `score_breakdown` transparency throughout, and expose scoring details in the UI.

**Architecture:** A shared `shingles.ts` utility (zero dependencies) powers both the duplicate cascade and supersedure pre-filter. A new `rrf.ts` utility implements Reciprocal Rank Fusion. `HybridRetriever` is refactored to produce two independent ranked lists (vector + LLM judge) then applies RRF instead of the current linear formula. `SQLiteSearch` returns `score: null` (not a fake `0.6`) for honest fallback signaling. A `ScoreBreakdown` type and `<ScoreBreakdown>` UI component expose scoring internals in all three card types.

**Tech Stack:** TypeScript, Fastify 5, Drizzle (SQLite), React 19, shadcn/ui, Vitest

---

## File map

### Create
- `packages/server/src/services/dedupe/shingles.ts` — Jaccard shingles utility
- `packages/server/src/services/dedupe/shingles.test.ts` — unit tests for shingles
- `packages/server/src/retrieval/rrf.ts` — RRF fusion + normalization
- `packages/web/src/components/score-breakdown.tsx` — reusable UI breakdown tooltip content
- `docs/scoring.md` — scoring documentation

### Modify
- `packages/server/src/services/harvester-pipeline.ts` — cascade 3 niveaux (hash → shingles → cosine), store `duplicate_method`
- `packages/server/src/retrieval/hybrid-retriever.ts` — full RRF refacto, expose `score_breakdown`
- `packages/server/src/retrieval/agentic-retriever.ts` — add `score_breakdown.method = 'agentic'` to all output fragments
- `packages/server/src/retrieval/fragment-retriever.ts` — add `ScoreBreakdown` type + `score: number | null`
- `packages/server/src/retrieval/retrieval.test.ts` — update HybridRetriever tests for RRF + add RRF tests
- `packages/server/src/search/search-service.ts` — SQLite fallback returns `score: null`
- `packages/server/src/retrieval/vector-retriever.ts` — handle null score, cap vector at 1.0, add breakdown
- `packages/server/src/services/supersedure-detector.ts` — replace `jaccard()` with shingles, expose `llm_confidence` (already stored — just surface it to UI)
- `packages/server/src/db/connection.ts` — `ALTER TABLE harvest_candidates ADD COLUMN duplicate_method`
- `packages/server/src/db/schema.ts` — add `duplicateMethod` to `harvestCandidates`
- `packages/web/src/components/plan/section-fragment-card.tsx` — score breakdown tooltip, add `unscored` tier
- `packages/web/src/components/candidate-card.tsx` — show `duplicate_method` breakdown
- `packages/web/src/components/admin/supersedure/supersedure-proposal-card.tsx` — show shingles score + llm_confidence
- `packages/server/src/config.ts` — add `FRAGMINT_RRF_K`, `FRAGMINT_RRF_WEIGHTS`
- `CLAUDE.md` — add Scoring section

---

## Task 1: Shingles utility (Phase 1 setup)

**Files:**
- Create: `packages/server/src/services/dedupe/shingles.ts`
- Create: `packages/server/src/services/dedupe/shingles.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/services/dedupe/shingles.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateShingles, jaccardSimilarity } from './shingles.js';

describe('generateShingles', () => {
  it('generates 3-grams from text', () => {
    const shingles = generateShingles('le renard rapide saute haut', 3);
    expect(shingles.has('le renard rapide')).toBe(true);
    expect(shingles.has('renard rapide saute')).toBe(true);
    expect(shingles.has('rapide saute haut')).toBe(true);
    expect(shingles.size).toBe(3);
  });

  it('returns empty set when text is too short for k', () => {
    expect(generateShingles('un deux', 3).size).toBe(0);
  });

  it('normalizes uppercase and punctuation', () => {
    const a = generateShingles('LinShare, Solution Souveraine.', 2);
    const b = generateShingles('linshare solution souveraine', 2);
    expect(jaccardSimilarity(a, b)).toBeGreaterThan(0.8);
  });

  it('returns empty set for empty string', () => {
    expect(generateShingles('', 3).size).toBe(0);
  });
});

describe('jaccardSimilarity', () => {
  it('returns 1.0 for identical sets', () => {
    const s = new Set(['a b c', 'b c d', 'c d e']);
    expect(jaccardSimilarity(s, s)).toBe(1.0);
  });

  it('returns 0 for disjoint sets', () => {
    const a = new Set(['a b c']);
    const b = new Set(['d e f']);
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it('returns 0 if either set is empty', () => {
    expect(jaccardSimilarity(new Set(), new Set(['a b c']))).toBe(0);
    expect(jaccardSimilarity(new Set(['a b c']), new Set())).toBe(0);
  });

  it('computes partial overlap correctly', () => {
    const a = new Set(['a b c', 'b c d', 'c d e']);
    const b = new Set(['a b c', 'b c d', 'x y z']);
    // intersection=2, union=4 → 0.5
    expect(jaccardSimilarity(a, b)).toBeCloseTo(0.5);
  });

  it('detects near-duplicate with 90% word overlap', () => {
    // Simulates LLM slightly rewriting a fragment
    const original = generateShingles(
      'LinShare est une solution souveraine de partage de fichiers développée par Linagora',
      3,
    );
    const rewritten = generateShingles(
      'LinShare est une solution souveraine de partage de documents développée par Linagora',
      3,
    );
    // Should be high Jaccard — only one 3-gram differs
    expect(jaccardSimilarity(original, rewritten)).toBeGreaterThan(0.7);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter @fragmint/server test shingles
```

Expected: FAIL — cannot find module `./shingles.js`.

- [ ] **Step 3: Implement `shingles.ts`**

Create `packages/server/src/services/dedupe/shingles.ts`:

```typescript
/**
 * Generate k-word shingles from text.
 * Normalizes: lowercase, strip non-alphanumeric (Unicode-aware), collapse whitespace.
 * k=3 is the standard for near-duplicate detection in IR literature.
 */
export function generateShingles(text: string, k = 3): Set<string> {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = normalized.split(' ').filter((w) => w.length > 0);
  const shingles = new Set<string>();
  for (let i = 0; i <= words.length - k; i++) {
    shingles.add(words.slice(i, i + k).join(' '));
  }
  return shingles;
}

/**
 * Jaccard similarity between two shingle sets.
 * J(A,B) = |A ∩ B| / |A ∪ B|
 * Returns 0 if either set is empty.
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const s of a) {
    if (b.has(s)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
pnpm --filter @fragmint/server test shingles
```

Expected: all tests PASS.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/dedupe/shingles.ts \
        packages/server/src/services/dedupe/shingles.test.ts
git commit -m "feat(dedupe): add Jaccard shingles utility (generateShingles, jaccardSimilarity)"
```

---

## Task 2: Harvester cascade 3 niveaux (Phase 1 main)

**Files:**
- Modify: `packages/server/src/services/harvester-pipeline.ts`
- Modify: `packages/server/src/db/connection.ts`
- Modify: `packages/server/src/db/schema.ts`

**Context:** The current pipeline has 2 detection levels: exact hash (via `detectExactDuplicate`) and Milvus cosine (threshold 0.70). We add shingles as a middle level. The result type gains a `method` discriminant so the UI and DB can show which level caught the duplicate.

- [ ] **Step 1: Add `duplicate_method` column to DB migration**

In `packages/server/src/db/connection.ts`, find the last migration block (currently Migration 015+ area, after the `fragment_tag_links` table). Add a new migration block:

```typescript
  // Migration 016 — harvest_candidates: duplicate_method column
  try {
    sqlite.exec(
      "ALTER TABLE harvest_candidates ADD COLUMN duplicate_method TEXT",
    );
  } catch (_) {}
```

- [ ] **Step 2: Add `duplicateMethod` to Drizzle schema**

In `packages/server/src/db/schema.ts`, in the `harvestCandidates` table definition, after the `duplicate_score: real('duplicate_score')` line (around line 148), add:

```typescript
  duplicate_method: text('duplicate_method'),
```

So the table becomes:

```typescript
export const harvestCandidates = sqliteTable('harvest_candidates', {
  // ... existing fields ...
  duplicate_of: text('duplicate_of'),
  duplicate_score: real('duplicate_score'),
  duplicate_method: text('duplicate_method'),     // 'hash' | 'shingles' | 'cosine'
  // ... rest ...
});
```

- [ ] **Step 3: Add the shingles cascade to `harvester-pipeline.ts`**

At the top of `packages/server/src/services/harvester-pipeline.ts`, add the import after existing imports:

```typescript
import { generateShingles, jaccardSimilarity } from './dedupe/shingles.js';
```

Define the `DupeResult` type before `runHarvestPipeline`:

```typescript
type DupeResult = { id: string; score: number; method: 'hash' | 'shingles' | 'cosine' };
```

The current pipeline at lines ~95-104 loads `existingFragmentRows` with `{ id, type, body_excerpt }`. Expand that query to also fetch `domain` and `lang` (needed for shingles cross-field filtering):

```typescript
const existingFragmentRows = (
  await db
    .select({
      id: fragments.id,
      type: fragments.type,
      domain: fragments.domain,
      lang: fragments.lang,
      body_excerpt: fragments.body_excerpt,
    })
    .from(fragments)
    .where(inArray(fragments.quality, ['reviewed', 'approved']))
)
  .filter((r) => r.body_excerpt != null)
  .map((r) => ({
    id: r.id,
    type: r.type,
    domain: r.domain,
    lang: r.lang,
    body: r.body_excerpt!,
  }));
```

Before the `blocks.map` loop, add the pre-calculation of `existingShinglesMap` and `SHINGLES_THRESHOLD`:

```typescript
// Threshold configurable via FRAGMINT_DUPE_SHINGLES_THRESHOLD (default 0.70).
// Will be plumbed through FragmintConfig in Task 4 — read from env directly here.
const SHINGLES_THRESHOLD = Number(process.env.FRAGMINT_DUPE_SHINGLES_THRESHOLD ?? 0.70);

// Pre-calculate shingles for ALL existing fragments once, before the candidate loop.
// Avoids recomputing shingle sets N×M times (N candidates × M fragments → just M).
const existingShinglesMap = new Map<string, Set<string>>(
  existingFragmentRows.map((r) => [r.id, generateShingles(r.body, 3)])
);
```

Replace the duplicate detection block (the `blocks.map(async (block, bi) => { ... })` section from line ~187 to ~250). The new cascade:

```typescript
const dupeChecks = await Promise.all(
  blocks.map(async (block, bi) => {
    const title = (block.title || 'untitled').slice(0, 50);
    console.log(`[dup-detect] candidate "${title}" — checking duplicates`);
    console.log(
      `[dup-detect]   filters: domain=${block.domain}, type=${block.type}, lang=${block.lang}`,
    );
    console.log(`[dup-detect]   exact-match pool size: ${existingFragmentRows.length}`);

    // ── Level 1: Hash exact ─────────────────────────────────────────────────
    const normalizedBody = block.body.toLowerCase().replace(/\s+/g, ' ').trim();
    const exactDup = existingFragmentRows.find(
      (f) => f.body.toLowerCase().replace(/\s+/g, ' ').trim() === normalizedBody,
    );
    if (exactDup) {
      console.log(`[dup-detect]   exact-match result: HIT ${exactDup.id}`);
      console.log(`[dup-detect]   final verdict: DOUBLON (exact hash match, score=1.0)`);
      return { id: exactDup.id, score: 1.0, method: 'hash' } satisfies DupeResult;
    }
    console.log(`[dup-detect]   exact-match result: MISS`);

    // ── Level 2: Jaccard shingles (Milvus-independent) ─────────────────────
    // Threshold configurable via FRAGMINT_DUPE_SHINGLES_THRESHOLD (default 0.70).
    // 0.70 is intentionally lower than 0.85 to catch LLM reformulations that
    // change 15-20% of words (gpt-oss-120b behaviour observed empirically).
    const candidateShingles = generateShingles(block.body, 3);
    for (const existing of existingFragmentRows) {
      if (existing.domain !== block.domain) continue;
      if (existing.type !== block.type) continue;
      if (existing.lang !== block.lang) continue;
      const existingShingles = existingShinglesMap.get(existing.id)!;
      const jSim = jaccardSimilarity(candidateShingles, existingShingles);
      if (jSim >= SHINGLES_THRESHOLD) {
        console.log(
          `[dup-detect]   shingles result: HIT ${existing.id} (J=${jSim.toFixed(3)})`,
        );
        console.log(
          `[dup-detect]   final verdict: DOUBLON (shingles Jaccard=${(jSim * 100).toFixed(0)}%)`,
        );
        return { id: existing.id, score: jSim, method: 'shingles' } satisfies DupeResult;
      }
    }
    console.log(`[dup-detect]   shingles result: MISS`);

    // ── Level 3: Cosine semantic via Milvus (threshold 0.65, lowered from 0.70) ──
    const milvusFilters = { domain: [block.domain], type: [block.type], lang: block.lang };
    console.log(
      `[dup-detect]   near-match Milvus call with filters=${JSON.stringify(milvusFilters)}`,
    );
    const vectorResults = await searchService.searchVector(block.body, milvusFilters, 1);
    if (vectorResults === null) {
      console.log(`[dup-detect]   near-match score: no match (Milvus disabled)`);
      console.log(`[dup-detect]   final verdict: OK (Milvus unavailable — exact+shingles only)`);
      return null;
    }
    if (vectorResults.length === 0) {
      console.log(`[dup-detect]   near-match score: no match (0 Milvus results)`);
      console.log(`[dup-detect]   final verdict: OK (no Milvus results)`);
      return null;
    }
    const raw = vectorResults[0].score;
    const nearMatchScore = Math.min(raw, 1.0);
    const pct = Math.round(nearMatchScore * 100);
    console.log(
      `[dup-detect]   near-match score: ${nearMatchScore.toFixed(4)} (${pct}%) — fragment id=${vectorResults[0].id} raw=${raw.toFixed(4)}`,
    );
    if (nearMatchScore >= 0.65) {
      const reason =
        nearMatchScore >= 0.95
          ? 'quasi-exact duplicate'
          : nearMatchScore >= 0.8
            ? 'strong similarity — possible update'
            : 'moderate similarity';
      const verdict =
        nearMatchScore >= 0.95 ? 'DOUBLON' : nearMatchScore >= 0.8 ? 'MISE-A-JOUR?' : 'PROCHE';
      console.log(`[dup-detect]   final verdict: ${verdict} (${reason}, score=${pct}%)`);
      return {
        id: vectorResults[0].id,
        score: nearMatchScore,
        method: 'cosine',
      } satisfies DupeResult;
    }
    console.log(`[dup-detect]   final verdict: OK (score ${pct}% below 65% threshold)`);
    return null;
  }),
);
```

Update the batch insert (around line 336) to store `duplicate_method`:

```typescript
await db.insert(harvestCandidates).values(
  blocks.map((block, j) => ({
    // ... all existing fields unchanged ...
    duplicate_of: dupeChecks[j]?.id ?? null,
    duplicate_score: dupeChecks[j]?.score ?? null,
    duplicate_method: dupeChecks[j]?.method ?? null,   // NEW
    // ... rest unchanged ...
  })),
);
```

Also remove the import of `detectExactDuplicate` if it becomes unused (check with `grep -n detectExactDuplicate packages/server/src/services/harvester-pipeline.ts` after the change). The function itself lives elsewhere — only remove the import call, not the function definition.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors. If `DupeResult` causes issues with the return type of the `blocks.map` callback, ensure the null case is typed as `DupeResult | null`.

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @fragmint/server test
```

Expected: all existing tests PASS (no harvester unit tests exist for this path; integration coverage is in e2e).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/harvester-pipeline.ts \
        packages/server/src/services/dedupe/ \
        packages/server/src/db/connection.ts \
        packages/server/src/db/schema.ts
git commit -m "feat(harvest): 3-level duplicate cascade (hash → shingles → cosine), store duplicate_method"
```

---

## Task 3: RRF utility (Phase 2 setup)

**Files:**
- Create: `packages/server/src/retrieval/rrf.ts`
- Modify: `packages/server/src/retrieval/retrieval.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/src/retrieval/retrieval.test.ts`:

```typescript
import { rrfFusion, normalizeRrfScore } from './rrf.js';

describe('rrfFusion', () => {
  it('ranks item first in both lists at the top', () => {
    const list1 = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const list2 = [{ id: 'a' }, { id: 'c' }, { id: 'b' }];
    const result = rrfFusion([list1, list2]);
    expect(result[0].item.id).toBe('a');
  });

  it('promotes item ranked low in vector but high in LLM', () => {
    // f1: rank 1 vector + rank 2 LLM → 1/61 + 1/62 = 0.0324
    // f3: rank 3 vector + rank 1 LLM → 1/63 + 1/61 = 0.0322
    // f1 wins but by a small margin
    const vectorList = [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }];
    const llmList = [{ id: 'f3' }, { id: 'f1' }, { id: 'f2' }];
    const result = rrfFusion([vectorList, llmList]);
    expect(result[0].item.id).toBe('f1');
    expect(result[1].item.id).toBe('f3');
  });

  it('includes items that appear in only one list', () => {
    const list1 = [{ id: 'a' }, { id: 'b' }];
    const list2 = [{ id: 'c' }, { id: 'a' }];
    const result = rrfFusion([list1, list2]);
    const ids = result.map((r) => r.item.id);
    expect(ids).toContain('b');
    expect(ids).toContain('c');
  });

  it('respects weights — higher weight list dominates', () => {
    // f2 is rank 1 in list2 (weight 2), rank 2 in list1 (weight 1)
    // f1 is rank 1 in list1 (weight 1), rank 2 in list2 (weight 2)
    // f2: 1/61 + 2/61 = 3/61 ≈ 0.0492
    // f1: 1/61 + 2/62 ≈ 0.0484
    const list1 = [{ id: 'f1' }, { id: 'f2' }];
    const list2 = [{ id: 'f2' }, { id: 'f1' }];
    const result = rrfFusion([list1, list2], 60, [1, 2]);
    expect(result[0].item.id).toBe('f2');
  });

  it('returns empty array for empty input', () => {
    expect(rrfFusion([])).toEqual([]);
    expect(rrfFusion([[]])).toEqual([]);
  });
});

describe('normalizeRrfScore', () => {
  it('maps max possible score to 1.0', () => {
    // Best possible: rank 0 in both lists with weights [1,1]
    // max = 1/(60+1) + 1/(60+1) = 2/61
    const maxRrf = 1 / 61 + 1 / 61;
    expect(normalizeRrfScore(maxRrf, [1, 1])).toBeCloseTo(1.0);
  });

  it('returns 0 for score 0', () => {
    expect(normalizeRrfScore(0, [1, 1])).toBe(0);
  });

  it('returns 0 when weights sum to 0', () => {
    expect(normalizeRrfScore(0.1, [0, 0])).toBe(0);
  });

  it('clamps to 1.0 on rounding edge', () => {
    expect(normalizeRrfScore(999, [1, 1])).toBe(1.0);
  });

  it('maps midpoint correctly', () => {
    // A score of 1/61 with weights [1,1] → half of max (2/61) → 0.5
    expect(normalizeRrfScore(1 / 61, [1, 1])).toBeCloseTo(0.5);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter @fragmint/server test retrieval
```

Expected: FAIL — cannot find module `./rrf.js`.

- [ ] **Step 3: Implement `rrf.ts`**

Create `packages/server/src/retrieval/rrf.ts`:

```typescript
/**
 * Reciprocal Rank Fusion (Cormack, Clarke & Büttcher, SIGIR 2009).
 *
 * Works on ranks (not scores), so no score normalization between
 * heterogeneous sources is needed. k=60 is empirically validated
 * across multiple IR benchmarks (Cormack 2009) and preferred here
 * because it dampens the effect of top-ranked items less aggressively
 * than k=1, giving the full list more influence.
 *
 * Formula: RRF(d) = Σ_r∈R  w_r / (k + rank_r(d))
 */
export function rrfFusion<T extends { id: string }>(
  rankedLists: T[][],
  k = 60,
  weights?: number[],
): Array<{ item: T; rrf_score: number }> {
  const scoreMap = new Map<string, number>();
  const itemMap = new Map<string, T>();

  rankedLists.forEach((list, li) => {
    const w = weights?.[li] ?? 1;
    list.forEach((item, rank) => {
      itemMap.set(item.id, item);
      scoreMap.set(item.id, (scoreMap.get(item.id) ?? 0) + w / (k + rank + 1));
    });
  });

  return Array.from(scoreMap.entries())
    .map(([id, rrf_score]) => ({ item: itemMap.get(id)!, rrf_score }))
    .sort((a, b) => b.rrf_score - a.rrf_score);
}

/**
 * Normalize an RRF score to [0, 1].
 * The theoretical maximum when a document ranks first in every list is:
 *   max = Σ_i  w_i / (k + 1)
 * Returns 0 if weights sum to 0.
 */
export function normalizeRrfScore(
  rrfScore: number,
  weights: number[],
  k = 60,
): number {
  const maxScore = weights.reduce((acc, w) => acc + w / (k + 1), 0);
  if (maxScore <= 0) return 0;
  return Math.min(1.0, rrfScore / maxScore);
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
pnpm --filter @fragmint/server test retrieval
```

Expected: all tests PASS.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/retrieval/rrf.ts \
        packages/server/src/retrieval/retrieval.test.ts
git commit -m "feat(retrieval): add RRF fusion utility (Cormack 2009) with normalization"
```

---

## Task 4: Add `ScoreBreakdown` type to `fragment-retriever.ts` (Phase 2 setup)

**Files:**
- Modify: `packages/server/src/retrieval/fragment-retriever.ts`
- Modify: `packages/server/src/config.ts`

- [ ] **Step 1: Extend `fragment-retriever.ts`**

Replace the contents of `packages/server/src/retrieval/fragment-retriever.ts` entirely:

```typescript
import type { PlanFilters } from '../schema/plan.js';

export interface SectionQuery {
  text: string;
  filters: PlanFilters;
  collectionSlug: string | null;
  inferred_type?: string;
  /**
   * First ~300 chars of the plan spec_prompt.
   * Prevents LLM reranking from judging fragments without document context
   * (Bug 2 — eval 2026-05-27: RGPD ranked #1 for "Présentation LinShare" without this).
   * Propagated from plan-service via p.state.spec_prompt.slice(0, 300).
   */
  spec_context?: string;
}

/**
 * Score breakdown for a retrieved fragment.
 * All fields optional — only the ones relevant to the retrieval method are set.
 */
export interface ScoreBreakdown {
  /** Which retrieval path produced this result. */
  method: 'vector' | 'agentic' | 'hybrid_rrf' | 'sqlite_like';
  /** Raw cosine similarity from Milvus (0-1, capped at 1.0). */
  vector_score?: number;
  /** Rank of this fragment in the vector list (1-based). */
  vector_rank?: number;
  /** LLM relevance score (0-10 integer). */
  llm_score?: number;
  /** Rank of this fragment in the LLM-sorted list (1-based). */
  llm_rank?: number;
  /** Raw RRF score before normalization. */
  rrf_score?: number;
  /** k parameter used in RRF computation. */
  rrf_k?: number;
}

export interface RetrievedFragment {
  fragment_id: string;
  /** null when source is SQLite LIKE fallback (no real ranking). */
  score: number | null;
  title: string | null;
  body_excerpt: string | null;
  quality: string;
  justification?: string;
  score_breakdown?: ScoreBreakdown;
}

export interface FragmentRetriever {
  searchForSection(query: SectionQuery, limit?: number): Promise<RetrievedFragment[]>;
}
```

- [ ] **Step 2: Add `rrf_k` and `rrf_weights` to config**

In `packages/server/src/config.ts`, in the `FragmintConfig` interface, after `retrieval_mode`, add:

```typescript
  // Retrieval scoring
  rrf_k: number;
  rrf_weights: 'balanced' | 'vector-heavy' | 'llm-heavy';
  dupe_shingles_threshold: number;  // FRAGMINT_DUPE_SHINGLES_THRESHOLD (default 0.70)
```

In `loadConfig`, after the `retrieval_mode` line, add:

```typescript
    rrf_k: Number(process.env.FRAGMINT_RRF_K ?? fileConfig.rrf_k ?? 60),
    rrf_weights: (process.env.FRAGMINT_RRF_WEIGHTS as FragmintConfig['rrf_weights'] | undefined) ??
      fileConfig.rrf_weights ??
      'balanced',
    dupe_shingles_threshold: Number(process.env.FRAGMINT_DUPE_SHINGLES_THRESHOLD ?? fileConfig.dupe_shingles_threshold ?? 0.70),
```

The weight presets will be resolved by `HybridRetriever` in Task 5:
- `'balanced'` → `[1, 1]`
- `'vector-heavy'` → `[2, 1]`
- `'llm-heavy'` → `[1, 2]`

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors. If callers of `RetrievedFragment` that check `r.score >= threshold` break, they will be fixed in Task 5 and Task 6.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/retrieval/fragment-retriever.ts \
        packages/server/src/config.ts
git commit -m "feat(retrieval): add ScoreBreakdown type, score nullable, rrf_k/rrf_weights config"
```

---

## Task 5: HybridRetriever RRF refacto (Phase 2 main)

**Files:**
- Modify: `packages/server/src/retrieval/hybrid-retriever.ts`
- Modify: `packages/server/src/retrieval/retrieval.test.ts`
- Modify: `packages/server/src/retrieval/factory.ts` (pass rrfK + rrfWeights)

The current `HybridRetriever` uses `0.4 × vectorScore + 0.6 × (llmScore/10)`. The problem: this formula depends on score distributions being comparable across sources. Milvus cosine and LLM 0-10 judgments have completely different ranges and semantics. RRF operates on ranks, not scores — distribution-agnostic and empirically better validated.

- [ ] **Step 1: Write the failing tests**

Replace the existing `describe('HybridRetriever', ...)` block in `packages/server/src/retrieval/retrieval.test.ts` with:

```typescript
describe('HybridRetriever (RRF)', () => {
  it('returns RRF-fused results with score_breakdown', async () => {
    const candidates: SearchResult[] = [
      { ...SAMPLE_RESULT, id: 'f1', score: 0.9 },
      { ...SAMPLE_RESULT, id: 'f2', score: 0.8 },
      { ...SAMPLE_RESULT, id: 'f3', score: 0.7 },
    ];
    const svc = fakeSearchService(candidates);
    const llmResp = JSON.stringify([
      { id: 'f1', score: 3 },
      { id: 'f2', score: 7 },
      { id: 'f3', score: 9 },
    ]);
    const llm = fakeLlmClient([llmResp]);
    const retriever = new HybridRetriever(svc, llm);
    const results = await retriever.searchForSection(
      { text: 'x', filters: {}, collectionSlug: null },
      3,
    );
    expect(results).toHaveLength(3);
    expect(results[0].score_breakdown?.method).toBe('hybrid_rrf');
    expect(results[0].score_breakdown?.vector_score).toBeDefined();
    expect(results[0].score_breakdown?.llm_score).toBeDefined();
    expect(results[0].score_breakdown?.rrf_score).toBeDefined();
    expect(results[0].score).not.toBeNull();
  });

  it('promotes fragment ranked low in vector but high in LLM', async () => {
    const candidates: SearchResult[] = [
      { ...SAMPLE_RESULT, id: 'f1', score: 0.95 }, // rank 1 vector
      { ...SAMPLE_RESULT, id: 'f2', score: 0.85 }, // rank 2 vector
      { ...SAMPLE_RESULT, id: 'f3', score: 0.60 }, // rank 3 vector
    ];
    const svc = fakeSearchService(candidates);
    // LLM: f3=10 (rank 1), f2=5 (rank 2), f1=1 (rank 3)
    const llmResp = JSON.stringify([
      { id: 'f1', score: 1 },
      { id: 'f2', score: 5 },
      { id: 'f3', score: 10 },
    ]);
    const llm = fakeLlmClient([llmResp]);
    const retriever = new HybridRetriever(svc, llm);
    const results = await retriever.searchForSection(
      { text: 'x', filters: {}, collectionSlug: null },
      2,
    );
    // f1: rank 1 vector + rank 3 LLM = 1/61 + 1/63 ≈ 0.0321
    // f3: rank 3 vector + rank 1 LLM = 1/63 + 1/61 ≈ 0.0321 (symmetric — very close)
    // Both should appear in top 2
    const ids = results.map((r) => r.fragment_id);
    expect(ids).toContain('f3');
    expect(ids).toContain('f1');
  });

  it('falls back to neutral LLM score when LLM returns unparseable response', async () => {
    const candidates: SearchResult[] = [
      { ...SAMPLE_RESULT, id: 'fa', score: 0.9 },
      { ...SAMPLE_RESULT, id: 'fb', score: 0.8 },
    ];
    const svc = fakeSearchService(candidates);
    const llm = fakeLlmClient(['This is not JSON at all, sorry.']);
    const retriever = new HybridRetriever(svc, llm);
    const results = await retriever.searchForSection(
      { text: 'x', filters: {}, collectionSlug: null },
      2,
    );
    // Fallback: neutral LLM score 5 for all → both lists rank in same order
    // → RRF preserves vector order
    expect(results[0].fragment_id).toBe('fa');
    expect(results).toHaveLength(2);
  });

  it('returns empty when SearchService returns no results', async () => {
    const retriever = new HybridRetriever(fakeSearchService([]), fakeLlmClient([]));
    expect(
      await retriever.searchForSection({ text: 'x', filters: {}, collectionSlug: null }),
    ).toEqual([]);
  });

  it('score_breakdown.llm_score is the raw 0-10 value', async () => {
    const candidates: SearchResult[] = [{ ...SAMPLE_RESULT, id: 'f1', score: 0.8 }];
    const svc = fakeSearchService(candidates);
    const llm = fakeLlmClient([JSON.stringify([{ id: 'f1', score: 7 }])]);
    const retriever = new HybridRetriever(svc, llm);
    const results = await retriever.searchForSection(
      { text: 'x', filters: {}, collectionSlug: null },
      1,
    );
    expect(results[0].score_breakdown?.llm_score).toBe(7);
    expect(results[0].score_breakdown?.vector_score).toBeCloseTo(0.8);
    expect(results[0].score_breakdown?.vector_rank).toBe(1);
    expect(results[0].score_breakdown?.llm_rank).toBe(1);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter @fragmint/server test retrieval
```

Expected: FAIL — `HybridRetriever` tests fail (old linear formula, no `score_breakdown`).

- [ ] **Step 3: Rewrite `hybrid-retriever.ts`**

Replace the entire file `packages/server/src/retrieval/hybrid-retriever.ts`:

```typescript
import { rrfFusion, normalizeRrfScore } from './rrf.js';
import type { SearchService, SearchResult } from '../search/search-service.js';
import type { LlmClient } from '../services/llm-client.js';
import type {
  FragmentRetriever,
  RetrievedFragment,
  ScoreBreakdown,
  SectionQuery,
} from './fragment-retriever.js';

const PREFILTER_COUNT = 20;
const LLM_NEUTRAL_SCORE = 5;

function resolveWeights(preset: string): [number, number] {
  switch (preset) {
    case 'vector-heavy':
      return [2, 1];
    case 'llm-heavy':
      return [1, 2];
    default: // 'balanced'
      return [1, 1];
  }
}

export class HybridRetriever implements FragmentRetriever {
  private weights: [number, number];

  constructor(
    private searchService: SearchService,
    private llm: LlmClient,
    private rrfK = 60,
    weightsPreset: string = 'balanced',
  ) {
    this.weights = resolveWeights(weightsPreset);
  }

  async searchForSection(query: SectionQuery, limit = 5): Promise<RetrievedFragment[]> {
    const { text, filters, collectionSlug } = query;

    // Step 1 — Vector candidates (20 max), already sorted by cosine desc
    const vectorCandidates = await this.searchService.search(
      text,
      {
        domain: filters.domain?.length ? filters.domain : undefined,
        type: filters.type ? [filters.type] : undefined,
        lang: filters.lang,
        tags: filters.tags,
        collectionSlug: collectionSlug ?? undefined,
        quality_min: 'approved',
      },
      PREFILTER_COUNT,
    );
    console.debug(
      `[retrieval][hybrid] section "${text.slice(0, 50)}" → ${vectorCandidates.length} vector candidates`,
    );

    if (vectorCandidates.length === 0) return [];

    // Keep raw vector scores for breakdown (before any RRF transformation)
    const vectorScoreMap = new Map(vectorCandidates.map((c) => [c.id, c.score]));

    // Step 2 — LLM batch judge → Map<id, llm_score_0_10>
    const llmScoreMap = await this.batchJudge(query, vectorCandidates);

    // Step 3 — Build 2 ranked lists
    // List 1: vector order (already sorted by cosine desc)
    const list1 = vectorCandidates.map((c) => ({ id: c.id, _data: c }));

    // List 2: same candidates sorted by LLM score desc
    const list2 = [...vectorCandidates]
      .sort((a, b) => (llmScoreMap.get(b.id) ?? LLM_NEUTRAL_SCORE) - (llmScoreMap.get(a.id) ?? LLM_NEUTRAL_SCORE))
      .map((c) => ({ id: c.id, _data: c }));

    // Step 4 — RRF fusion
    const fused = rrfFusion([list1, list2], this.rrfK, this.weights);

    // Step 5 — Build result with score_breakdown
    const list1IndexMap = new Map(list1.map((item, i) => [item.id, i + 1]));
    const list2IndexMap = new Map(list2.map((item, i) => [item.id, i + 1]));

    const results = fused.slice(0, limit).map(({ item, rrf_score }) => {
      const c = item._data;
      const vectorScore = Math.min(1.0, vectorScoreMap.get(c.id) ?? 0);
      const llmScore = llmScoreMap.get(c.id) ?? LLM_NEUTRAL_SCORE;
      const vectorRank = list1IndexMap.get(c.id) ?? 0;
      const llmRank = list2IndexMap.get(c.id) ?? 0;
      const normalizedScore = normalizeRrfScore(rrf_score, this.weights, this.rrfK);

      const breakdown: ScoreBreakdown = {
        method: 'hybrid_rrf',
        vector_score: vectorScore,
        vector_rank: vectorRank,
        llm_score: llmScore,
        llm_rank: llmRank,
        rrf_score,
        rrf_k: this.rrfK,
      };

      return {
        fragment_id: c.id,
        score: normalizedScore,
        title: c.title,
        body_excerpt: c.body_excerpt,
        quality: c.quality,
        score_breakdown: breakdown,
      } satisfies RetrievedFragment;
    });

    console.debug(
      `[retrieval][hybrid] section "${text.slice(0, 50)}" → returning top ${results.length} after RRF`,
    );
    return results;
  }

  private async batchJudge(
    query: SectionQuery,
    candidates: SearchResult[],
  ): Promise<Map<string, number>> {
    const defaultMap = new Map(candidates.map((c) => [c.id, LLM_NEUTRAL_SCORE]));

    const list = candidates
      .map(
        (c, i) =>
          `${i + 1}. ID:${c.id}\nTitle: ${c.title ?? ''}\nExcerpt: ${(c.body_excerpt ?? '').slice(0, 120)}`,
      )
      .join('\n\n');

    // spec_context prevents the LLM from judging fragments without document context
    // (eval 2026-05-27 Bug 2: without this, RGPD ranked #1 for "Présentation LinShare")
    const contextLine = query.spec_context
      ? `\nDocument context (spec): "${query.spec_context.slice(0, 300)}"\n`
      : '';

    const prompt = `Rate the relevance of each fragment for the following document section.
${contextLine}
Section: "${query.text}"

Fragments:
${list}

Return a JSON array where each item is {"id": "...", "score": 7}.
Score from 0 to 10. Include ALL ${candidates.length} fragments.
Return ONLY the JSON array, no other text.`;

    try {
      const response = await this.llm.chatMessages([{ role: 'user', content: prompt }]);
      const match = response.match(/\[[\s\S]*\]/);
      if (!match) return defaultMap;
      const parsed = JSON.parse(match[0]) as unknown[];
      if (!Array.isArray(parsed)) return defaultMap;
      const result = new Map(candidates.map((c) => [c.id, LLM_NEUTRAL_SCORE]));
      for (const item of parsed) {
        if (
          typeof (item as Record<string, unknown>).id === 'string' &&
          typeof (item as Record<string, unknown>).score === 'number'
        ) {
          result.set(
            (item as { id: string }).id,
            Math.max(0, Math.min(10, (item as { score: number }).score)),
          );
        }
      }
      return result;
    } catch (err) {
      console.warn(
        '[hybrid][batch-judge] LLM response unparseable, falling back to neutral score 5 — hybrid degraded to vector-only',
        err,
      );
      return defaultMap;
    }
  }
}
```

- [ ] **Step 3b: Add `score_breakdown` to `AgenticRetriever`**

In `packages/server/src/retrieval/agentic-retriever.ts`, the `searchForSection` method returns `RetrievedFragment[]`. Every fragment currently lacks `score_breakdown`. The multi-agent self-consistency pipeline needs `score_breakdown.method = 'agentic'` to distinguish agentic from vector results.

Find the return mapping inside `searchForSection` (the `.map(...)` call that produces `RetrievedFragment` objects). It currently produces:

```typescript
return {
  fragment_id: ...,
  score: ...,
  title: ...,
  body_excerpt: ...,
  quality: ...,
  justification: ...,
};
```

Update it to:

```typescript
return {
  fragment_id: ...,
  score: ...,
  title: ...,
  body_excerpt: ...,
  quality: ...,
  justification: ...,
  score_breakdown: {
    method: 'agentic',
    llm_score: Math.round((score ?? 0) * 10),  // convert 0-1 back to 0-10 for breakdown display
  },
};
```

If the agentic retriever stores the raw LLM 0-10 score internally (check for a `rawScore` or `judgeScore` variable), use that directly instead of the conversion. The goal is `score_breakdown.method === 'agentic'` so the UI and multi-agent pipeline can branch on retrieval method.

> **Note (self-consistency already implemented):** If the multi-agent self-consistency plan is already merged, `judgeFragment` has been renamed to `judgeFragmentWithTemp(query, id, temperature?)` and a `judgeFragmentPair()` method was added. In that case:
> - Add `score_breakdown` **inside `judgeFragmentWithTemp`**, not in the `searchForSection` map — that's where each individual `RetrievedFragment` is constructed.
> - `judgeFragmentPair` does `{ ...finalAgent, score: finalScore }` which will spread `score_breakdown` automatically — no change needed there.
> - Verify with `grep -n 'score_breakdown' packages/server/src/retrieval/agentic-retriever.ts` after the edit — should appear exactly once (inside `judgeFragmentWithTemp`).

After editing, run:

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors.

- [ ] **Step 4: Wire `rrfK` + `weightsPreset` through `factory.ts`**

In `packages/server/src/retrieval/factory.ts`, update the `RetrieverDeps` interface to include optional RRF config:

```typescript
export interface RetrieverDeps {
  searchService: SearchService;
  llm: LlmClient;
  indexService: IndexService;
  fragmentService: FragmentService;
  rrfK?: number;
  rrfWeightsPreset?: string;
}
```

In the `build` function, update the `'hybrid'` case:

```typescript
case 'hybrid':
  return new HybridRetriever(deps.searchService, deps.llm, deps.rrfK ?? 60, deps.rrfWeightsPreset ?? 'balanced');
```

In `packages/server/src/index.ts`, update the `createRetriever` call to pass config values:

```typescript
const retriever = createRetriever(config.retrieval_mode, {
  searchService,
  llm: llmClient,
  indexService,
  fragmentService,
  rrfK: config.rrf_k,
  rrfWeightsPreset: config.rrf_weights,
});
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
pnpm --filter @fragmint/server test retrieval
```

Expected: all tests PASS including the new RRF-based HybridRetriever tests.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/retrieval/hybrid-retriever.ts \
        packages/server/src/retrieval/rrf.ts \
        packages/server/src/retrieval/factory.ts \
        packages/server/src/retrieval/retrieval.test.ts \
        packages/server/src/index.ts
git commit -m "feat(retrieval): refactor HybridRetriever to RRF (Cormack 2009), add score_breakdown"
```

---

## Task 6: Score null for SQLite fallback + cap 1.0 in VectorRetriever (Phase 3)

**Files:**
- Modify: `packages/server/src/search/search-service.ts`
- Modify: `packages/server/src/retrieval/vector-retriever.ts`

**Problem:** The SQLite fallback currently returns `score: 0.6` — a fabricated constant that makes fragments appear "moderately relevant" even though there is no actual ranking signal. This propagates through the pipeline and misleads users. Instead, return `null` to signal "unranked LIKE match" and let consumers handle it explicitly.

- [ ] **Step 1: Change SQLite fallback score to null**

In `packages/server/src/search/search-service.ts`, find the `sqliteSearch` method (around line 372). The `SearchResult` type needs to allow `null` scores. Find the `SearchResult` interface definition near the top of the file and change `score: number` to `score: number | null`.

Then in `sqliteSearch`, around line 460-472, change:

```typescript
// BEFORE:
const results = rows.map((row) => ({
  id: row.id,
  score: 0.6, // no vector score in SQLite fallback — treat any LIKE match as relevant
  // ...
}));
return reRankResults(results);

// AFTER:
const results = rows.map((row) => ({
  id: row.id,
  score: null as null,  // SQLite LIKE has no ranking signal — consumers must handle null
  title: row.title,
  body_excerpt: row.body_excerpt,
  type: row.type,
  domain: row.domain,
  lang: row.lang,
  quality: row.quality,
  author: row.author,
  uses: row.uses,
  updated_at: row.updated_at,
}));
// Do NOT call reRankResults — it multiplies score and null * number = NaN
// Order by uses desc is already applied in the SQL query above
return results;
```

**Note:** `reRankResults` multiplies `score` by quality multipliers. With `null` scores, calling it would produce `NaN`. Skip it for SQLite results. The SQL query already orders by `uses desc`.

- [ ] **Step 2: Update `reRankResults` to handle null safely**

In `packages/server/src/search/search-service.ts`, update `reRankResults` so it skips null-scored items gracefully (they pass through unchanged):

```typescript
export function reRankResults(results: SearchResult[]): SearchResult[] {
  const now = Date.now();

  return results
    .map((r) => {
      // SQLite fallback results have null scores — pass through unchanged
      if (r.score == null) return r;

      let adjustedScore = r.score;
      // ... rest of existing logic unchanged ...
    })
    .sort((a, b) => {
      // null scores sort to the bottom
      if (a.score == null && b.score == null) return 0;
      if (a.score == null) return 1;
      if (b.score == null) return -1;
      return b.score - a.score;
    });
}
```

- [ ] **Step 3: Update `VectorRetriever` to handle null scores**

Replace the contents of `packages/server/src/retrieval/vector-retriever.ts`:

```typescript
import type { SearchService } from '../search/search-service.js';
import type {
  FragmentRetriever,
  RetrievedFragment,
  ScoreBreakdown,
  SectionQuery,
} from './fragment-retriever.js';

const SCORE_THRESHOLD = 0.2;

export class VectorRetriever implements FragmentRetriever {
  constructor(private searchService: SearchService) {}

  async searchForSection(query: SectionQuery, limit = 5): Promise<RetrievedFragment[]> {
    const { text, filters, collectionSlug } = query;
    const results = await this.searchService.search(
      text,
      {
        domain: filters.domain?.length ? filters.domain : undefined,
        type: filters.type ? [filters.type] : undefined,
        lang: filters.lang,
        tags: filters.tags,
        collectionSlug: collectionSlug ?? undefined,
        quality_min: 'approved',
      },
      limit,
    );

    const filtered = results
      // null score = SQLite LIKE result → always pass through (no threshold)
      // non-null score = Milvus cosine → apply threshold
      .filter((r) => r.score == null || r.score >= SCORE_THRESHOLD)
      .map((r) => {
        const cappedScore = r.score != null ? Math.min(1.0, r.score) : null;
        const breakdown: ScoreBreakdown = r.score != null
          ? { method: 'vector', vector_score: cappedScore! }
          : { method: 'sqlite_like' };

        return {
          fragment_id: r.id,
          score: cappedScore,
          title: r.title,
          body_excerpt: r.body_excerpt,
          quality: r.quality,
          score_breakdown: breakdown,
        } satisfies RetrievedFragment;
      });

    console.debug(
      `[retrieval][vector-only] section "${text.slice(0, 50)}" → ${filtered.length} candidates after threshold`,
    );
    return filtered;
  }
}
```

- [ ] **Step 4: Fix callers that compare score directly**

Search for places in the codebase that compare `RetrievedFragment.score` or `SearchResult.score` without null guard:

```bash
grep -rn "\.score >=" packages/server/src --include="*.ts" | grep -v ".test.ts" | grep -v "node_modules"
```

Key place to fix: in `packages/server/src/services/plan-service.ts`, the `SECTION_SCORE_THRESHOLD` filter:

```typescript
// Find the line: .filter((r) => r.score >= SECTION_SCORE_THRESHOLD)
// Change to:
.filter((r) => r.score == null || r.score >= SECTION_SCORE_THRESHOLD)
```

This lets unscored SQLite results through (better to suggest a fragment than return nothing).

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @fragmint/server test
```

Expected: all tests PASS. The existing `VectorRetriever` tests check `score: 0.85` — these still pass because Milvus results still have numeric scores. The `score: 0.1` filter test must be updated: the test simulates a low Milvus score, which should still be filtered. Check `retrieval.test.ts`:

The `'filters out results below SCORE_THRESHOLD (0.2)'` test passes `score: 0.1` — this is a Milvus score (non-null), so it is still filtered. No change needed.

Add one new test to `retrieval.test.ts` to verify SQLite null passthrough:

```typescript
  it('passes through null-score SQLite results without threshold', async () => {
    const sqliteResult: SearchResult = { ...SAMPLE_RESULT, id: 'sqlite-1', score: null as unknown as number };
    const svc = fakeSearchService([sqliteResult]);
    const retriever = new VectorRetriever(svc);
    const results = await retriever.searchForSection({
      text: 'cloud',
      filters: {},
      collectionSlug: null,
    });
    expect(results).toHaveLength(1);
    expect(results[0].score).toBeNull();
    expect(results[0].score_breakdown?.method).toBe('sqlite_like');
  });
```

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/search/search-service.ts \
        packages/server/src/retrieval/vector-retriever.ts \
        packages/server/src/services/plan-service.ts \
        packages/server/src/retrieval/retrieval.test.ts
git commit -m "feat(search): SQLite fallback returns score=null, VectorRetriever handles null + caps at 1.0"
```

---

## Task 7: Supersedure shingles (Phase 4)

**Files:**
- Modify: `packages/server/src/services/supersedure-detector.ts`

**Context:** The current `supersedure-detector.ts` has a hand-rolled `jaccard()` function that tokenizes on `\W+` (token-based, unigrams). The shingles approach (k=3 word n-grams) is more robust to word-order variations and paraphrasing. The `llm_confidence` field is already stored in the DB (`supersedure_proposals.llm_confidence`) — no migration needed here. The `SupersedureProposalCard` already displays it.

- [ ] **Step 1: Replace the `jaccard`/`tokenize` functions with shingles**

In `packages/server/src/services/supersedure-detector.ts`:

Add import at the top (after existing imports):

```typescript
import { generateShingles, jaccardSimilarity } from './dedupe/shingles.js';
```

Remove the two functions `tokenize` and `jaccard` (lines 30-48):

```typescript
// DELETE these:
function tokenize(text: string): Set<string> { ... }
function jaccard(a: string, b: string): number { ... }
```

Update the usage in `detectAndPropose` (around line 155):

```typescript
// BEFORE:
const score = jaccard(newFrag.body_excerpt, oldBody);

// AFTER:
const score = jaccardSimilarity(
  generateShingles(newFrag.body_excerpt, 3),
  generateShingles(oldBody, 3),
);
```

Keep `JACCARD_THRESHOLD = 0.25` — the threshold is intentionally low (0.25) because the LLM is the real gatekeeper. Shingles at k=3 are more discriminating than the old unigram Jaccard for paraphrase detection, so you may want to lower the threshold slightly to 0.20 to avoid missing real supersedures. Update the constant:

```typescript
const JACCARD_THRESHOLD = 0.20;  // lowered from 0.25: shingles k=3 are more precise
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors.

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @fragmint/server test
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/supersedure-detector.ts
git commit -m "refactor(supersedure): replace unigram Jaccard with shingles k=3, lower threshold to 0.20"
```

---

## Task 8: `<ScoreBreakdown>` UI component (Phase 5)

**Files:**
- Create: `packages/web/src/components/score-breakdown.tsx`

This component is a pure display component — no API calls, no state. It renders the content of a Tooltip. The parent card wraps it in `<TooltipContent>`.

- [ ] **Step 1: Create the component**

Create `packages/web/src/components/score-breakdown.tsx`:

```tsx
// packages/web/src/components/score-breakdown.tsx
//
// Renders score breakdown details for use inside a Tooltip.
// Define the type locally to avoid cross-package imports.

export interface ScoreBreakdownData {
  method: 'vector' | 'agentic' | 'hybrid_rrf' | 'sqlite_like';
  vector_score?: number;
  vector_rank?: number;
  llm_score?: number;
  llm_rank?: number;
  rrf_score?: number;
  rrf_k?: number;
}

interface Props {
  breakdown: ScoreBreakdownData;
  score: number | null;
}

export function ScoreBreakdown({ breakdown, score }: Props) {
  if (breakdown.method === 'sqlite_like') {
    return (
      <div className="text-xs text-muted-foreground space-y-0.5 p-2 max-w-[220px]">
        <div className="font-medium text-foreground">Recherche textuelle (SQLite)</div>
        <div className="text-yellow-600 dark:text-yellow-400">
          Score non calculé — Milvus inactif
        </div>
        <div>Résultat classé par utilisation</div>
      </div>
    );
  }

  if (breakdown.method === 'agentic') {
    const pct = score != null ? Math.round(score * 100) : null;
    return (
      <div className="text-xs text-muted-foreground space-y-0.5 p-2 max-w-[220px]">
        <div className="font-medium text-foreground">Juge LLM (agentic)</div>
        {pct != null && <div>Score : {pct}%</div>}
      </div>
    );
  }

  if (breakdown.method === 'hybrid_rrf') {
    const k = breakdown.rrf_k ?? 60;
    return (
      <div className="text-xs text-muted-foreground space-y-1 p-2 min-w-[200px] max-w-[240px]">
        <div className="font-medium text-foreground">Hybrid RRF (k={k})</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
          <span>Vectoriel :</span>
          <span>
            {breakdown.vector_score != null
              ? (breakdown.vector_score * 100).toFixed(0) + '%'
              : '—'}{' '}
            (rang {breakdown.vector_rank ?? '?'})
          </span>
          <span>Juge LLM :</span>
          <span>
            {breakdown.llm_score != null ? `${breakdown.llm_score}/10` : '—'} (rang{' '}
            {breakdown.llm_rank ?? '?'})
          </span>
          <span>Score RRF :</span>
          <span>{breakdown.rrf_score != null ? breakdown.rrf_score.toFixed(4) : '—'}</span>
        </div>
      </div>
    );
  }

  if (breakdown.method === 'vector') {
    const pct =
      breakdown.vector_score != null ? Math.round(breakdown.vector_score * 100) : null;
    return (
      <div className="text-xs text-muted-foreground space-y-0.5 p-2 max-w-[220px]">
        <div className="font-medium text-foreground">Similarité vectorielle (Milvus)</div>
        {pct != null && <div>Cosine : {pct}%</div>}
      </div>
    );
  }

  return null;
}
```

- [ ] **Step 2: Typecheck web**

```bash
pnpm --filter @fragmint/web typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/score-breakdown.tsx
git commit -m "feat(ui): add ScoreBreakdown component for tooltip content"
```

---

## Task 9: UI integration — all cards (Phase 5)

**Files:**
- Modify: `packages/web/src/components/plan/section-fragment-card.tsx`
- Modify: `packages/web/src/components/candidate-card.tsx`
- Modify: `packages/web/src/components/admin/supersedure/supersedure-proposal-card.tsx`

### Part A — `section-fragment-card.tsx`

The match badge currently shows `score.toFixed(2)` as a title attribute. Replace with a proper Tooltip showing `<ScoreBreakdown>`. Also add an `'unscored'` tier for null scores.

- [ ] **Step 1: Update `section-fragment-card.tsx`**

The `FragmentCandidate` type in `@/api/types` needs `score: number | null` and optional `score_breakdown`. Check `packages/web/src/api/types.ts` for the type — if `score` is typed as `number`, change it to `number | null` and add `score_breakdown?: ScoreBreakdownData`.

In `packages/web/src/components/plan/section-fragment-card.tsx`, add imports at the top:

```typescript
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ScoreBreakdown, type ScoreBreakdownData } from '@/components/score-breakdown';
```

Replace the `matchTier` computation (lines 40-53):

```typescript
const matchTier: 'strong' | 'medium' | 'weak' | 'unscored' =
  candidate.score == null
    ? 'unscored'
    : candidate.score >= 0.7
      ? 'strong'
      : candidate.score >= 0.55
        ? 'medium'
        : 'weak';
const matchLabel =
  matchTier === 'strong'
    ? t('planGeneration', 'matchStrong')
    : matchTier === 'medium'
      ? t('planGeneration', 'matchMedium')
      : matchTier === 'unscored'
        ? 'Non scoré'
        : t('planGeneration', 'matchWeak');
const matchClass =
  matchTier === 'strong'
    ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
    : matchTier === 'medium'
      ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
      : matchTier === 'unscored'
        ? 'bg-muted text-muted-foreground/60'
        : 'bg-muted text-muted-foreground';
```

Replace the match badge span (lines 93-98):

```tsx
// BEFORE:
<span
  className={`text-xs px-2 py-0.5 rounded ${matchClass}`}
  title={`score ${candidate.score.toFixed(2)}`}
>
  {matchLabel}
</span>

// AFTER:
{candidate.score_breakdown ? (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className={`text-xs px-2 py-0.5 rounded cursor-help ${matchClass}`}>
        {matchLabel}
      </span>
    </TooltipTrigger>
    <TooltipContent side="left" className="p-0">
      <ScoreBreakdown
        breakdown={candidate.score_breakdown as ScoreBreakdownData}
        score={candidate.score}
      />
    </TooltipContent>
  </Tooltip>
) : (
  <span
    className={`text-xs px-2 py-0.5 rounded ${matchClass}`}
    title={candidate.score != null ? `score ${candidate.score.toFixed(2)}` : 'non scoré'}
  >
    {matchLabel}
  </span>
)}
```

### Part B — `candidate-card.tsx`

The `CandidateCard` shows `duplicate_of` and `duplicate_score`. Add `duplicate_method` to the tooltip so the reviewer knows how the duplicate was detected.

- [ ] **Step 2: Update `candidate-card.tsx`**

Add import at the top:

```typescript
import type { HarvestCandidate } from '@/api/types';
```

The `HarvestCandidate` type in `@/api/types` needs `duplicate_method?: string | null`. Add this field.

Replace the `tooltip` string (lines 57-64) with a richer version that includes the method:

```typescript
const methodLabel =
  candidate.duplicate_method === 'hash'
    ? 'hash exact'
    : candidate.duplicate_method === 'shingles'
      ? `Jaccard shingles (${pct}%)`
      : candidate.duplicate_method === 'cosine'
        ? `similarité sémantique (${pct}%)`
        : pct != null
          ? `similarité ${pct}%`
          : null;

const tooltip =
  simLevel && candidate.duplicate_of && pct != null
    ? simLevel === 'exact'
      ? `Doublon quasi-exact de ${candidate.duplicate_of}${methodLabel ? ` — ${methodLabel}` : ''}`
      : simLevel === 'high'
        ? `Forte similarité avec ${candidate.duplicate_of}${methodLabel ? ` — ${methodLabel}` : ''}`
        : `Similarité modérée avec ${candidate.duplicate_of}${methodLabel ? ` — ${methodLabel}` : ''}`
    : undefined;
```

### Part C — `supersedure-proposal-card.tsx`

The card already shows `llm_confidence` and `similarity_score`. Add the shingles method label next to the similarity score to make it clear which algorithm computed it.

- [ ] **Step 3: Update `supersedure-proposal-card.tsx`**

The `SupersedureProposal` type in `@/types/admin-supersedure` may or may not have `similarity_method`. Check the type definition — if absent, add `similarity_method?: string`. The backend `supersedure-detector.ts` uses shingles from Task 7 but doesn't store a `similarity_method` column (only `similarity_score`). So for this card, just add a static label "shingles (k=3)" after the score once the migration is deployed.

In the badges row (around line 68-70), update the similarity badge:

```tsx
<Badge variant="outline" className="text-xs" title="Jaccard shingles k=3">
  {t('supersedure', 'similarity')}: {(proposal.similarity_score * 100).toFixed(0)}%
  <span className="ml-1 text-muted-foreground">(shingles)</span>
</Badge>
```

- [ ] **Step 4: Typecheck web**

```bash
pnpm --filter @fragmint/web typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/plan/section-fragment-card.tsx \
        packages/web/src/components/candidate-card.tsx \
        packages/web/src/components/admin/supersedure/supersedure-proposal-card.tsx \
        packages/web/src/api/types.ts
git commit -m "feat(ui): score breakdown tooltips in section-fragment-card, candidate-card, supersedure-card"
```

---

## Task 10: Documentation (Phase 6)

**Files:**
- Create: `docs/scoring.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Create `docs/scoring.md`**

Create `docs/scoring.md`:

```markdown
# Fragmint — Scoring Architecture

## Overview

Fragmint uses three independent scoring systems, each appropriate for its context:

| System | Method | Formula | Where |
|--------|--------|---------|-------|
| Retrieval (hybrid) | Reciprocal Rank Fusion | RRF(d) = Σ w_i / (k + rank_i(d)) | `hybrid-retriever.ts` |
| Retrieval (vector-only) | Milvus cosine + re-rank | cosine × quality_mult × freshness_boost | `search-service.ts` |
| Duplicate detection | 3-level cascade | hash → shingles → cosine | `harvester-pipeline.ts` |
| Supersedure pre-filter | Jaccard shingles k=3 | J(A,B) = |A∩B| / |A∪B| | `supersedure-detector.ts` |

---

## 1. Hybrid Retrieval — Reciprocal Rank Fusion

**Reference:** Cormack, G., Clarke, C., & Büttcher, S. (2009). *Reciprocal rank fusion outperforms condorcet and individual rank learning methods.* SIGIR 2009.

**Why RRF instead of linear combination:**
The old formula `0.4 × cosine + 0.6 × (llmScore/10)` requires both scores to be on the same scale. Milvus cosine scores cluster around 0.6-0.95 after re-ranking, while LLM scores are 0-10 integers with different semantics. RRF sidesteps this by operating on ranks, not values.

**Formula:**

```
RRF(d) = Σ_i  w_i / (k + rank_i(d))
```

- `k = 60` (default, configurable via `FRAGMINT_RRF_K`)
- `rank_i(d)` = 1-based rank of document d in list i
- `w_i` = weight for list i (default 1 for both)

**Configuration:**
```
FRAGMINT_RRF_K=60          # default
FRAGMINT_RRF_WEIGHTS=balanced   # balanced | vector-heavy | llm-heavy
```

Weight presets:
- `balanced`: [1, 1] — equal weight to vector and LLM
- `vector-heavy`: [2, 1] — trust Milvus more (good for factual queries)
- `llm-heavy`: [1, 2] — trust LLM more (good for nuanced section matching)

**score_breakdown** fields exposed to UI:
- `vector_score`: raw Milvus cosine (capped at 1.0)
- `vector_rank`: rank in vector list (1-based)
- `llm_score`: LLM raw score (0-10)
- `llm_rank`: rank in LLM-sorted list (1-based)
- `rrf_score`: raw RRF value before normalization
- `rrf_k`: k parameter used

---

## 2. Vector-Only Retrieval

When `FRAGMINT_RETRIEVAL_MODE=vector-only` (default), `VectorRetriever` calls `SearchService.search()` which:

1. Embeds the query with nomic-embed-text
2. Queries Milvus for top-N by cosine similarity
3. Applies `reRankResults()`: quality multiplier × freshness boost × usage momentum
4. Falls back to SQLite LIKE if Milvus is unavailable → returns `score: null`

**Quality multipliers:**
- `approved` → ×1.0
- `reviewed` → ×0.95
- `draft` → ×0.80

**Freshness boosts:**
- ≤7 days → +0.05
- ≤30 days → +0.03
- ≤90 days → +0.01

**Usage momentum:**
- >10 uses → +0.02
- >5 uses → +0.01

**SQLite fallback:** Returns `score: null` — no ranking signal. UI displays "Non scoré".

---

## 3. Duplicate Detection Cascade

Three levels, run in order. First match wins.

### Level 1: Exact hash
Normalize body (lowercase, collapse whitespace), compare strings. Cost: O(n) string comparisons.
Result field: `duplicate_method = 'hash'`, `duplicate_score = 1.0`

### Level 2: Jaccard shingles (k=3)
Generate 3-word shingles from body text, compute Jaccard similarity.
Only compares fragments with same `domain`, `type`, and `lang`.
Threshold: **0.70** (configurable via `FRAGMINT_DUPE_SHINGLES_THRESHOLD`) — intentionally lower than a strict 0.85 to catch LLM reformulations that change ~15-20% of words (gpt-oss-120b empirical behaviour). Pre-calculated per run for performance.
Cost: O(M + N × S) where M = existing fragments, S = shingle set size ≈ words − 2.
Result field: `duplicate_method = 'shingles'`, `duplicate_score = jaccard_value`

### Level 3: Milvus cosine (lowered threshold)
Semantic vector similarity via Milvus. Only runs when Milvus is enabled.
Threshold: **0.65** (lowered from 0.70 — shingles covers the 0.65-0.85 range for textual near-dupes).
Result field: `duplicate_method = 'cosine'`, `duplicate_score = cosine_value`

---

## 4. Supersedure Pre-filter

Before sending fragment pairs to the LLM judge, `SupersedureDetector` computes Jaccard shingles similarity to quickly discard unrelated fragments.

- k=3 word shingles
- Threshold: **0.20** (low — the LLM is the real gatekeeper, shingles just save LLM calls)
- Only compares fragments with same `domain`, `type`, and `lang`

---

## Roadmap

**V3 — Calibrated thresholds (empirical):** Run offline evaluation on a labeled set of 50 known duplicate/non-duplicate pairs from `example-vault`. Compute precision-recall curves for shingles thresholds 0.50–0.90 to validate the 0.70 default (see Task 11).

**V4 — Cross-encoder re-ranking:** Replace the LLM batch judge (20 API calls) with a local cross-encoder model (e.g., `cross-encoder/ms-marco-MiniLM-L-6-v2`) running in Ollama for <100ms latency. Keep LLM for agentic mode only.
```

- [ ] **Step 2: Add Scoring section to CLAUDE.md**

In `CLAUDE.md`, find the `## AI/Embedding Patterns` section. After the `### LLM Client` subsection (before the `## Template Syntax` section), add:

```markdown
## Scoring Architecture

Three scoring systems — each has a specific algorithm:

| System | File | Algorithm |
|--------|------|-----------|
| Retrieval hybrid | `retrieval/hybrid-retriever.ts` | RRF (Cormack 2009), k=60 |
| Retrieval vector-only | `retrieval/vector-retriever.ts` | Milvus cosine + quality re-rank |
| Duplicate detection | `services/harvester-pipeline.ts` | Cascade: hash → shingles (0.70, configurable) → cosine (0.65) |
| Supersedure pre-filter | `services/supersedure-detector.ts` | Jaccard shingles k=3, threshold 0.20 |

Key invariants:
- SQLite LIKE fallback → `score: null` (never a fake constant)
- Vector scores capped at 1.0 (re-ranking can exceed 1.0)
- `score_breakdown` is always optional — old plan state JSON without it is backward-compat
- Shingles utility lives in `services/dedupe/shingles.ts` (zero npm deps)
- Full docs: `docs/scoring.md`
```

- [ ] **Step 3: Typecheck + test full suite**

```bash
pnpm --filter @fragmint/server typecheck
pnpm --filter @fragmint/web typecheck
pnpm --filter @fragmint/server test
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(scoring): add scoring section to CLAUDE.md"
```

> **Note:** `docs/scoring.md` n'est pas commité — c'est de la documentation de travail locale, comme les plans et specs dans `docs/superpowers/`.

---

## Self-Review

| Check | Where | Status |
|-------|-------|--------|
| `score: number \| null` propagates through all callers | `plan-service.ts` filter, `VectorRetriever`, `HybridRetriever`, `section-fragment-card.tsx` | Fixed in Tasks 5, 6, 9 |
| DB migrations are idempotent | `connection.ts` — `ALTER TABLE ... ADD COLUMN` wrapped in `try/catch` | Task 2 Step 1 |
| No external npm deps for shingles | `shingles.ts` uses only built-in JS `Set` | Task 1 |
| `datasketch` or `MinHash` NOT referenced anywhere | `grep -rn datasketch packages/` → 0 results | Task 1 |
| `score_breakdown` is optional everywhere | `RetrievedFragment.score_breakdown?` (optional) | Task 4 |
| Old plan state JSON (no `score_breakdown`) remains valid | Field is optional, not required | Task 4 |
| Backward compat: `VectorRetriever` still accepts no `ScoreBreakdown` consumers | `score_breakdown` added to output but never required by callers | Task 6 |
| RRF tests cover: top-of-both, one-list-only, weights, empty input | `retrieval.test.ts` `describe('rrfFusion', ...)` | Task 3 |
| HybridRetriever tests updated (old linear formula tests removed) | `retrieval.test.ts` | Task 5 |
| `reRankResults` does not crash on null scores | `search-service.ts` null guard | Task 6 |
| SQLite fallback: `reRankResults` NOT called on null-scored results | Return before `reRankResults` in `sqliteSearch` | Task 6 |
| `JACCARD_THRESHOLD` lowered to 0.20 in supersedure (shingles more precise) | `supersedure-detector.ts` | Task 7 |
| All existing 30+ retrieval tests still pass | `pnpm --filter @fragmint/server test retrieval` | After Task 5 |
| No `score.toFixed(2)` calls on potentially-null values | `section-fragment-card.tsx` null-guards | Task 9 |
| `<ScoreBreakdown>` rendered inside `<TooltipContent>` — no extra wrapper needed | Shadcn Tooltip pattern used correctly | Task 8 |
| `docs/scoring.md` includes Cormack 2009 citation | Docs task | Task 10 |
| `AgenticRetriever` produces `score_breakdown.method = 'agentic'` | `agentic-retriever.ts` | Task 5 Step 3b |
| `FRAGMINT_DUPE_SHINGLES_THRESHOLD` wired in config | `config.ts` | Task 4 Step 2 |
| `batchJudge` fallback logs `console.warn`, not silent | `hybrid-retriever.ts` | Task 5 Step 3 |

---

## Task 11: Empirical validation protocol (Phase 6b)

**Files:** None — this is a manual validation protocol, no code changes.

**Context:** After Tasks 1-10 are implemented and committed, this task validates that the thresholds chosen (shingles 0.70, cosine 0.65, RRF k=60) actually perform well on real data. This is the empirical step that calibrates "V3 — Calibrated thresholds" from `docs/scoring.md`.

### Part A — Duplicate detection validation

- [ ] **Step 1: Build a labeled set**

In `example-vault`, identify 30 pairs of fragments where you know the ground truth. Aim for 3 categories:
- **True duplicates** (10 pairs): fragments that are clearly the same content, possibly reformulated
- **Near-duplicates** (10 pairs): fragments on the same topic but with significant new content
- **Unrelated** (10 pairs): fragments from different topics/domains

Save the list in a local file (not committed) `docs/scoring-eval-pairs.csv` with columns:
```
id_a,id_b,ground_truth
<uuid>,<uuid>,duplicate
<uuid>,<uuid>,near-dup
<uuid>,<uuid>,unrelated
```

- [ ] **Step 2: Run shingles similarity on each pair**

Use a small Node.js script (not committed):

```typescript
// scripts/eval-shingles.ts (local only, not committed)
import { generateShingles, jaccardSimilarity } from '../packages/server/src/services/dedupe/shingles.js';
import { readFileSync } from 'fs';

const pairs = readFileSync('docs/scoring-eval-pairs.csv', 'utf8')
  .split('\n')
  .slice(1)
  .filter(Boolean)
  .map((line) => {
    const [id_a, id_b, ground_truth] = line.split(',');
    return { id_a, id_b, ground_truth };
  });

// Load fragment bodies from SQLite or from vault files
// For each pair, compute jaccardSimilarity(generateShingles(bodyA, 3), generateShingles(bodyB, 3))
// Print: id_a, id_b, ground_truth, jaccard_score
```

- [ ] **Step 3: Compute precision-recall for thresholds 0.50, 0.60, 0.70, 0.80, 0.90**

For each threshold T, count:
- True Positives: ground_truth=duplicate AND jaccard >= T
- False Positives: ground_truth=unrelated AND jaccard >= T
- False Negatives: ground_truth=duplicate AND jaccard < T

Compute Precision = TP / (TP + FP) and Recall = TP / (TP + FN).

Expected result: threshold 0.70 should sit near the precision-recall elbow. If not, adjust `FRAGMINT_DUPE_SHINGLES_THRESHOLD` accordingly.

### Part B — RRF vs linear retrieval comparison

- [ ] **Step 4: Compare RRF to old linear formula on 5 real plan sections**

Take 5 section queries from recent plans (e.g., "Présentation de LinShare", "Arguments commerciaux Twake Mail", "Clause de confidentialité", "Méthodologie de mise en œuvre", "FAQ sécurité").

For each query, record:
- Top 5 fragments returned by `vector-only` mode
- Top 5 fragments returned by `hybrid` mode (new RRF)

Ask a human reviewer: which top-5 list is more relevant to the section? Tally wins.

Expected: RRF wins ≥ 4/5 queries (RRF should perform at least as well as linear; if it doesn't, check `rrf_weights` preset).

### Part C — Validation sign-off

- [ ] **Step 5: Record threshold calibration decision**

After Steps 3-4, add a one-line note to `docs/scoring.md` under "Roadmap":

```markdown
**V3 status (YYYY-MM-DD):** Shingles threshold calibrated on N pairs. Final threshold: X.XX.
RRF vs linear: RRF won N/5 queries. Threshold settings locked: FRAGMINT_DUPE_SHINGLES_THRESHOLD=0.70, FRAGMINT_RRF_K=60.
```

This is a documentation-only commit:

```bash
git add docs/scoring.md
git commit -m "docs(scoring): record empirical calibration results"
```
