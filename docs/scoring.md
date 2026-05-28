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
