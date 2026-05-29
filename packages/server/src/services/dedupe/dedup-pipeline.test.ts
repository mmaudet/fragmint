import { describe, it, expect } from 'vitest';
import { deduplicateL1L2, cosineSim, deduplicateL3 } from './dedup-pipeline.js';

const block = (title: string, body: string) => ({
  title,
  body,
  type: 'introduction',
  domain: 'test',
  function_type: 'technical',
  audience: ['technical'] as string[],
  maturity: 'production',
  lang: 'en',
  tags: [] as string[],
  entities: { clients: [], products: [], technologies: [], partners: [], certifications: [], regulations: [] },
  new_proposals: { tags: [], domains: [], entities: {} },
  confidence: 0.9,
});

describe('deduplicateL1L2', () => {
  it('keeps all blocks when all are distinct', () => {
    const blocks = [
      block('Introduction to Twake', 'Twake is an open source collaboration suite developed by Linagora.'),
      block('LinShare Overview', 'LinShare is a secure file sharing solution for enterprises.'),
    ];
    const result = deduplicateL1L2(blocks);
    expect(result).toHaveLength(2);
  });

  it('removes duplicate title (L1 — Jaccard on title tokens)', () => {
    const blocks = [
      block('Introduction to Twake', 'Twake is an open source collaboration suite developed by Linagora.'),
      block('Introduction to Twake', 'A different body but same title almost entirely.'),
    ];
    const result = deduplicateL1L2(blocks);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Introduction to Twake');
  });

  it('removes near-duplicate body (L2 — shingles on body)', () => {
    // Titles are long and semantically distinct → L1 Jaccard ≈ 0 → L1 passes, L2 fires
    const base = 'Twake est une suite collaborative open source développée par Linagora. Elle intègre messagerie, visioconférence et gestion documentaire.';
    const nearDup = 'Twake est une suite collaborative open source développée par Linagora. Elle intègre messagerie, visioconférence et gestion documentaire en une interface.';
    const blocks = [
      block('Présentation générale de la suite Twake Workplace', base),
      block('Architecture et intégration des modules de collaboration', nearDup),
    ];
    const result = deduplicateL1L2(blocks);
    expect(result).toHaveLength(1);
  });

  it('keeps blocks with same title tokens but very different bodies', () => {
    // Title match alone is not sufficient if bodies are completely different
    // BUT with L1 Jaccard >= 0.85 on title, we dedup regardless of body
    // So: titles that are truly identical → dedup. Titles that partially overlap but are distinct phrases → keep.
    const blocks = [
      block('Cloud Security', 'Our cloud security solution provides end-to-end encryption and compliance monitoring for enterprise workloads.'),
      block('Cloud Storage', 'Our cloud storage solution allows teams to store and share documents securely with version control.'),
    ];
    const result = deduplicateL1L2(blocks);
    expect(result).toHaveLength(2); // "Cloud Security" ≠ "Cloud Storage" → both kept
  });

  it('first occurrence wins when deduplicating', () => {
    const blocks = [
      block('Twake overview', 'First body text, should be kept as the canonical version.'),
      block('Twake overview', 'Second body text, should be dropped as duplicate.'),
    ];
    const result = deduplicateL1L2(blocks);
    expect(result).toHaveLength(1);
    expect(result[0].body).toContain('First body text');
  });
});

describe('cosineSim', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSim([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns 0 for zero vector', () => {
    expect(cosineSim([0, 0], [1, 1])).toBe(0);
  });
});

describe('deduplicateL3', () => {
  it('keeps all blocks when embeddings are orthogonal', () => {
    const blocks = ['a', 'b', 'c'];
    const embeddings = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    expect(deduplicateL3(blocks, embeddings)).toHaveLength(3);
  });

  it('removes near-duplicate when cosine >= threshold', () => {
    // Nearly identical vectors (cosine ~0.999)
    const blocks = ['a', 'b'];
    const embeddings = [[1, 0.001], [1, 0.002]];
    expect(deduplicateL3(blocks, embeddings)).toHaveLength(1);
  });

  it('first occurrence wins', () => {
    const blocks = ['first', 'second'];
    const embeddings = [[1, 0], [1, 0]]; // identical
    const result = deduplicateL3(blocks, embeddings);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('first');
  });

  it('throws when blocks and embeddings lengths differ', () => {
    expect(() => deduplicateL3(['a', 'b'], [[1, 0]])).toThrow();
  });
});
