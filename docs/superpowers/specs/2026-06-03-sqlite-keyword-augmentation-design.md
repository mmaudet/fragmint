# SQLite Keyword Augmentation for Hybrid and Vector Retrievers

**Date:** 2026-06-03  
**Scope:** `packages/server/src/retrieval/`, `packages/server/src/search/search-service.ts`

## Problem

When the embedding model (Qwen3-Embedding-0.6B on prod) fails to discriminate between semantically close documents (e.g. a "MIRAI" section query returning only "Fragmint" fragments), the LLM re-ranker has no chance to correct it — it only sees whatever Milvus returned. MIRAI fragments never enter the candidate pool.

## Solution

Add SQLite LIKE keyword search as a second candidate source in `HybridRetriever` and `VectorRetriever`. The merged pool gives the LLM (and the vector signal) a chance to surface domain-specific fragments that embedding proximity alone misses.

`AgenticRetriever` is not affected — it already passes the full fragment index to the LLM.

## Files Changed

### 1. `search-service.ts` — expose keyword search

Add a thin public wrapper around the existing private `sqliteSearch`:

```typescript
async keywordSearch(query: string, filters?: SearchFilters, limit = 20): Promise<SearchResult[]> {
  return this.sqliteSearch(query, filters, limit);
}
```

`sqliteSearch` remains private (internal implementation detail). `keywordSearch` is the stable public API.

### 2. `hybrid-retriever.ts` — merge before LLM judging

**Step 1 — build merged candidate pool:**
```
vectorCandidates ─┐
                  ├→ dedup by ID → allCandidates
keywordCandidates ┘
```

- `keywordCandidates` uses same filters as vector search (same `phase1Count`, same `quality_min: 'approved'`)
- Dedup: vector candidates take priority; SQLite-only fragments appended after
- Early exit: change `if (vectorCandidates.length === 0) return []` → `if (allCandidates.length === 0) return []`

**Step 2 — LLM judges all candidates:**
- `batchJudge(query, allCandidates)` — unchanged method signature

**Step 3 — RRF with two lists:**
- `list1` = vector candidates only, cosine order (SQLite-only fragments absent from list1 → only get LLM signal in RRF)
- `list2` = all candidates, LLM score order

RRF correctly handles fragments absent from a list — they get `0` contribution from that list. A SQLite-only fragment the LLM scores `9/10` will still rank well via `list2`.

**Score breakdown for SQLite-only fragments:**
- `method: 'hybrid_rrf'`
- `vector_score: 0` (not in Milvus results)
- `vector_rank: 0` (sentinel: not ranked by vector)
- `llm_score`, `llm_rank`, `rrf_score`: populated normally

### 3. `vector-retriever.ts` — merge after vector search

```
searchService.search() ─┐
                         ├→ dedup by ID → merged → threshold filter → return
keywordSearch()         ┘
```

- Same limit as vector search
- SQLite-only fragments have `score: null` → already bypass the `SCORE_THRESHOLD` filter (line 32: `r.score == null || r.score >= SCORE_THRESHOLD`)
- `score_breakdown` for SQLite-only: `{ method: 'sqlite_like' }` — already handled by existing code pattern

## Invariants Preserved

- SQLite LIKE results still carry `score: null` — no fake score injected
- `reRankResults` is never called on null-score results in this path
- `quality_min: 'approved'` filter applied to both vector and keyword searches — same quality floor
- `deprecated` fragments excluded in `sqliteSearch` (already enforced)

## Performance Impact

- 1 additional DB query per `searchForSection` call (SQLite LIKE, fast)
- LLM prompt size: up to 2× `phase1Count` in worst case (no overlap between vector and keyword results). In practice, overlap is high for relevant queries — expect ~10-30% more candidates.
- No Milvus calls added

## Testing

- Unit: mock `searchService.keywordSearch` to return MIRAI fragments when vector returns none → verify they appear in `RetrievedFragment[]`
- Manual: create a plan with a "Présentation MIRAI" section, run in hybrid and vector modes, confirm MIRAI fragments surface as candidates
