/**
 * Generate k-word shingles from text.
 * Normalizes: lowercase, strip non-alphanumeric (Unicode-aware), collapse whitespace.
 * k=3 is the standard for near-duplicate detection in IR literature.
 */
export function generateShingles(text: string, k = 3): Set<string> {
  if (k < 1) return new Set();
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
