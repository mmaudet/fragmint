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

## 3. Agentic Retrieval — Multi-Phase LLM Pipeline

When `mode=agentic-only`, `AgenticRetriever` runs three sequential phases entirely on the fragment index (no cosine):

### Phase 0 — TOC domain:type filtering
**Condition:** only when `index.total > 200` AND no domain filter on the query.
LLM reads a compact table-of-contents of all `domain:type` combinations and selects the ones relevant for the section. The full index is then filtered to only those combinations before Phase 1.

**Why:** reduces Phase 1 context from ~233 fragments to a focused subset, saves LLM tokens and improves precision.

### Phase 1 — LLM candidate selection from index
LLM reads the full filtered index (markdown with one fragment per line: title, excerpt, type, domain, tags) and returns a ranked JSON array of fragment IDs. Cap: `limit × 4` IDs (default: 20 for limit=5).

Readable IDs (like `TM-arg-001`) are used in the prompt and mapped back to UUIDs internally via `buildReadableIdMap()`.

**Pool A merging:** Phase 1 candidates are merged with domain/tag-forced candidates from plan-service (`forced_candidates`). Phase 2 judges both together.

### Phase 2 — Self-consistency batch scoring
**Factory behavior:** `factory.ts` always instantiates `AgenticRetriever` with `selfConsistency: true` (even though the class default is `false`). This means Phase 2 makes **two parallel LLM calls** per section:

| Agent | Temperature | Purpose |
|-------|-------------|---------|
| Agent 1 | 0.2 (low — near-deterministic) | Main judgment |
| Agent 2 | 0.4 (slightly higher) | Diverse judgment |

Final score = `min(agent1_score, agent2_score)` — conservative consensus.

If `|agent1_score - agent2_score| > 0.3`, a `STRONG_DISAGREEMENT` warning is logged.

**Threshold:** fragments with normalized score < `PHASE2_SCORE_MIN = 0.3` are dropped.

**score_breakdown** for agentic:
```typescript
{ method: 'agentic', llm_score: rawScore }  // rawScore: 0-10 integer
```
No `vector_score` — agentic is index-based, not cosine-based.

**Neutral fallback:** if Phase 2 LLM fails to mention a fragment, it receives `llm_score = 5` (neutral, not rejection). Unlike hybrid, agentic does not implicitly reject unlisted fragments — it keeps them with `score = 0.5`. This is intentional: conservative pessimism (min score) already penalizes uncertain fragments.

**Cost (serial path):** agentic-only makes `4 LLM calls` per section for typical corpora > 200 fragments (1 Phase 0 + 1 Phase 1 + 2 Phase 2 self-consistency). For 8 sections with `concurrency=3`: `ceil(8/3) × 3 = 4` sequential "rounds" of 3 concurrent sections — ~12 LLM round-trips on the critical path. Expect 5-10 minutes on rate-limited free-tier LLMs.

### Batch parallel execution (searchForSectionsBatch)

`AgenticRetriever` implements the optional `FragmentRetriever.searchForSectionsBatch?` interface, which `searchAllSections` in `plan-service.ts` uses when available.

Instead of running Phase 0 → 1 → 2 sequentially **per section** (serial), the batch variant runs each phase **across all sections** before moving to the next:

```
Serial path (N=10, concurrency=3):
  round 1: [S1: 0→1→2]  [S2: 0→1→2]  [S3: 0→1→2]
  round 2: [S4: 0→1→2]  [S5: 0→1→2]  [S6: 0→1→2]
  round 3: [S7: 0→1→2]  [S8: 0→1→2]  [S9: 0→1→2]
  round 4: [S10: 0→1→2]
  Critical path: 4 rounds × 3 LLM phases = 12 LLM round-trips

Batch path (N=10, concurrency=3):
  Phase 0: [S1..S10 in parallel, semaphore(3)]  → 1 wave
  Phase 1: [S1..S10 in parallel, semaphore(3)]  → 1 wave
  Phase 2: [S1..S10 in parallel, semaphore(3)]  → 1 wave
  Critical path: 3 phases = 3 LLM round-trips (66% reduction)
```

**Pool A computation** (tag/domain DB lookups) happens per-section in parallel before `searchForSectionsBatch` is called — it's I/O-bound and fast. The shared `indexData` (fragment index) is fetched once and reused across all sections.

**Extending to new retrievers:** implement `searchForSectionsBatch?(queries, limit, concurrency)` on any `FragmentRetriever` subclass. The method is optional — retrievers that don't implement it fall back to the serial path automatically.

---

## 4. Duplicate Detection Cascade

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

## 6. Retrieval Latency — Current State & Known Limits

### Latency model per mode

| Mode | LLM calls/section | Wall clock (N sections, concurrency=3) | Bottleneck |
|------|--------------------|----------------------------------------|------------|
| `vector-only` | 0 | ~0.5–2s total | Milvus search |
| `hybrid` | 1 (batch judge) | `ceil(N/3) × ~5–8s` | LLM endpoint |
| `agentic` serial (before fix) | 4 (P0+P1+P2×2) | `ceil(N/3) × 4 × ~5s` | Sequential LLM phases |
| `agentic` batch (current) | 4 amortized | `3 phases × ~5s` regardless of N | LLM endpoint |

### Improvements made

**Phase 0 factorization — `AgenticRetriever.searchForSectionsBatch`** (2026-06-09)

Agentic mode now runs Phase 0 for all sections, then Phase 1 for all, then Phase 2 for all, instead of Phase 0→1→2 sequentially per section. For 10 sections at `concurrency=3`:
- Before: `ceil(10/3) × 3 phases = 4 rounds × 3 = 12 LLM round-trips` on critical path
- After: `3 phases` (each phase runs all sections in parallel up to concurrency)
- **~66% reduction in agentic wall clock**

`plan-service.searchAllSections` automatically uses the batch path when the retriever implements `searchForSectionsBatch?` (currently only `AgenticRetriever`).

### What remains

**Hybrid mode** is already fully parallelized (`Promise.all` + semaphore). There is no sequential phase bottleneck — only 1 LLM call per section. The wall clock is `ceil(N/concurrency) × LLM_latency`. A `searchForSectionsBatch` for hybrid would save less than 5% (only hides the fast vector search behind LLM calls).

**Root bottleneck for all LLM-based modes:** LLM endpoint latency. `ai.linagora.com` vs Ollama locally can vary 2–10×. The code cannot compress below `LLM_calls_on_critical_path × endpoint_latency`.

### Configuration levers

| Variable | Default | Effect |
|----------|---------|--------|
| `FRAGMINT_LLM_CONCURRENCY` | `3` | Max concurrent sections. Raising to 5–10 reduces hybrid wall clock proportionally. |
| `FRAGMINT_LLM_TIMEOUT` | `60s` | Per-call timeout. Raise if LLM is slow on large prompts. |
| `FRAGMINT_LLM_ENDPOINT` | Ollama local | Switch to `ai.linagora.com` for faster hosted inference. |

**Raising `FRAGMINT_LLM_CONCURRENCY` is the most effective lever for hybrid mode** — going from 3 to 10 reduces 10-section hybrid from ~4 rounds to 1 round.

---

## Roadmap

**V3 — Calibrated thresholds (empirical):** Run offline evaluation on a labeled set of 50 known duplicate/non-duplicate pairs from `example-vault`. Compute precision-recall curves for shingles thresholds 0.50–0.90 to validate the 0.70 default (see Task 11).

**V4 — Cross-encoder re-ranking:** Replace the LLM batch judge (20 API calls) with a local cross-encoder model (e.g., `cross-encoder/ms-marco-MiniLM-L-6-v2`) running in Ollama for <100ms latency. Keep LLM for agentic mode only.

---

## Parallelism summary

| Operation | Before | After | File |
|-----------|--------|-------|------|
| `searchAllSections` agentic | `ceil(N/3) × 3 phases` serial | `3 phases` batch | `agentic-retriever.ts` |
| `searchAllSections` hybrid | `ceil(N/3)` rounds (already parallel) | — | `plan-service.ts` |
| `generateAllSections` | N sections serial (`for await`) | `ceil(N/concurrency)` parallel | `plan-assembler.ts` |
