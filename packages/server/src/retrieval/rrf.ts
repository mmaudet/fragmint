/**
 * Reciprocal Rank Fusion (Cormack, Clarke & Büttcher, SIGIR 2009).
 *
 * Works on ranks (not scores), so no score normalization between
 * heterogeneous sources is needed. k=60 is empirically validated
 * across multiple IR benchmarks (Cormack 2009).
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
