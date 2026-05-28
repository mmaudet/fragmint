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
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
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
    // Single word substitution invalidates k=3 consecutive windows → 3 shingles differ.
    // For n=10 shingles: intersection=7, union=13 → J≈0.538. Threshold > 0.5 is correct.
    expect(jaccardSimilarity(original, rewritten)).toBeGreaterThan(0.5);
  });
});
