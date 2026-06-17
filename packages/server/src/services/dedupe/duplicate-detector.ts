// packages/server/src/services/dedupe/duplicate-detector.ts
// 3-level duplicate cascade: hash → shingles → cosine (Milvus)
import { generateShingles, jaccardSimilarity } from './shingles.js';
import type { SearchService } from '../../search/index.js';

export type DupeResult = { id: string; score: number; method: 'hash' | 'shingles' | 'cosine' };

export interface ExistingFragment {
  id: string;
  type: string;
  domain: string;
  lang: string;
  body: string;
}

/**
 * Runs the 3-level duplicate cascade for a single candidate block.
 *
 * Level 1 — hash: normalized exact-string match (Milvus-independent, O(n))
 * Level 2 — shingles: Jaccard similarity on 3-word shingles, filtered by domain/type/lang
 * Level 3 — cosine: Milvus semantic search (skipped when Milvus is unavailable)
 *
 * Returns DupeResult on first hit, null if no duplicate found.
 */
export async function detectDuplicate(
  block: { body: string; domain: string; type: string; lang: string },
  existingFragmentRows: ExistingFragment[],
  existingShinglesMap: Map<string, Set<string>>,
  shinglesThreshold: number,
  searchService: SearchService,
): Promise<DupeResult | null> {
  // ── Level 1: Hash exact ───────────────────────────────────────────────────
  const normalizedBody = block.body.toLowerCase().replace(/\s+/g, ' ').trim();
  const exactDup = existingFragmentRows.find(
    (f) => f.body.toLowerCase().replace(/\s+/g, ' ').trim() === normalizedBody,
  );
  if (exactDup) {
    console.log(`[dup-detect]   exact-match result: HIT ${exactDup.id}`);
    console.log(`[dup-detect]   final verdict: DOUBLON (exact hash match, score=1.0)`);
    return { id: exactDup.id, score: 1.0, method: 'hash' };
  }
  console.log(`[dup-detect]   exact-match result: MISS`);

  // ── Level 2: Jaccard shingles (Milvus-independent) ───────────────────────
  // Threshold configurable via FRAGMINT_DUPE_SHINGLES_THRESHOLD (default 0.70).
  const candidateShingles = generateShingles(block.body, 3);
  for (const existing of existingFragmentRows) {
    if (existing.domain !== block.domain) continue;
    if (existing.type !== block.type) continue;
    if (existing.lang !== block.lang) continue;
    const existingShingles =
      existingShinglesMap.get(existing.id) ?? generateShingles(existing.body, 3);
    const jSim = jaccardSimilarity(candidateShingles, existingShingles);
    if (jSim >= shinglesThreshold) {
      console.log(`[dup-detect]   shingles result: HIT ${existing.id} (J=${jSim.toFixed(3)})`);
      console.log(
        `[dup-detect]   final verdict: DOUBLON (shingles Jaccard=${(jSim * 100).toFixed(0)}%)`,
      );
      return { id: existing.id, score: jSim, method: 'shingles' };
    }
  }
  console.log(`[dup-detect]   shingles result: MISS`);

  // ── Level 3: Cosine semantic via Milvus (threshold 0.65) ─────────────────
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
  // searchVector only returns results from Milvus — scores are always numeric (not null)
  const raw = vectorResults[0].score!;
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
    return { id: vectorResults[0].id, score: nearMatchScore, method: 'cosine' };
  }
  console.log(`[dup-detect]   final verdict: OK (score ${pct}% below 65% threshold)`);
  return null;
}
