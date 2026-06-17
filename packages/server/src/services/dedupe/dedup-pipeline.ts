/**
 * Intra-harvest deduplication pipeline.
 *
 * L1 — Title Jaccard (k=3 word shingles, threshold 0.85)
 *   Two blocks with near-identical titles are considered duplicates.
 *   First occurrence wins.
 *
 * L2 — Body shingles Jaccard (k=3 word shingles, threshold 0.72)
 *   Two blocks whose body text is highly similar are considered duplicates.
 *   First occurrence wins.
 *
 * Both levels run in a single pass (O(n²)) — acceptable for typical harvest
 * sizes (< 500 blocks per job).
 */
import { generateShingles, jaccardSimilarity } from './shingles.js';
import type { CombinedBlock } from '../llm-client.js';

const TITLE_JACCARD_THRESHOLD = 0.85;
// 0.78 rather than a lower value to avoid false positives when two distinct fragments
// open with the same boilerplate paragraph. At 0.78 on k=3 word-shingles over 500 chars,
// only near-verbatim duplicates are caught; semantic duplicates are left to L3 cosine.
const BODY_JACCARD_THRESHOLD = 0.78;
const SHINGLE_K = 3;
// 500-char window keeps the comparison cost O(1) per pair; for typical fragment sizes
// (200–1000 chars) this covers most or all of the body. Fragments that diverge only
// beyond char 500 are NOT deduplicated here — they fall through to L3.
const BODY_WINDOW = 500;

/**
 * Removes near-duplicate blocks from a harvest candidate list.
 * Runs L1 (title) then L2 (body) dedup. First occurrence always wins.
 */
export function deduplicateL1L2<T extends CombinedBlock>(blocks: T[]): T[] {
  const kept: T[] = [];

  for (const candidate of blocks) {
    const isDup = kept.some((existing) => {
      // L1: title similarity
      // For very short titles (< k words), shingle sets are empty — fall back to exact match.
      const titleA = generateShingles(existing.title.toLowerCase(), SHINGLE_K);
      const titleB = generateShingles(candidate.title.toLowerCase(), SHINGLE_K);
      if (titleA.size === 0 && titleB.size === 0) {
        // Both titles too short for shingles: use normalized exact match
        if (existing.title.toLowerCase().trim() === candidate.title.toLowerCase().trim()) return true;
      } else if (jaccardSimilarity(titleA, titleB) >= TITLE_JACCARD_THRESHOLD) {
        // NOTE: when one title has < k words and the other >= k, jaccardSimilarity
        // returns 0 (empty-set intersection). L1 is skipped; L2 body comparison still
        // runs. This is acceptable because LLM-generated titles are typically 3-8 words.
        return true;
      }

      // L2: body similarity (compare first 500 chars to limit cost)
      const bodyA = generateShingles(existing.body.slice(0, BODY_WINDOW), SHINGLE_K);
      const bodyB = generateShingles(candidate.body.slice(0, BODY_WINDOW), SHINGLE_K);
      if (jaccardSimilarity(bodyA, bodyB) >= BODY_JACCARD_THRESHOLD) return true;

      return false;
    });

    if (!isDup) kept.push(candidate);
  }

  return kept;
}

const L3_COSINE_THRESHOLD = 0.85;

/**
 * Cosine similarity between two vectors.
 * Both vectors must have the same length.
 */
export function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * L3 deduplication: removes semantically near-duplicate blocks using
 * pre-computed embeddings. First occurrence wins.
 * Threshold: cosine >= L3_COSINE_THRESHOLD (0.85).
 */
export function deduplicateL3<T>(blocks: T[], embeddings: number[][]): T[] {
  if (blocks.length !== embeddings.length) {
    throw new Error(`deduplicateL3: blocks.length (${blocks.length}) !== embeddings.length (${embeddings.length})`);
  }
  const kept: number[] = []; // indices of kept blocks

  for (let i = 0; i < blocks.length; i++) {
    const isDup = kept.some(
      (j) => cosineSim(embeddings[i], embeddings[j]) >= L3_COSINE_THRESHOLD,
    );
    if (!isDup) kept.push(i);
  }

  return kept.map((i) => blocks[i]);
}
