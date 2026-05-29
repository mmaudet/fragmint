import { describe, it, expect } from 'vitest';
import {
  normalizeForComparison,
  detectExactDuplicate,
  checkSubjectCoherence,
  checkTagCoverage,
  computeQualitySignals,
} from '../../services/quality-signals.js';

describe('normalizeForComparison', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeForComparison('  Hello   World  ')).toBe('hello world');
    expect(normalizeForComparison('A\nB\tC')).toBe('a b c');
  });
  it('truncates to 200 chars', () => {
    const long = 'a'.repeat(300);
    expect(normalizeForComparison(long)).toHaveLength(200);
  });
});

describe('detectExactDuplicate', () => {
  const existingFragments = [
    { id: 'frag-1', type: 'argument', body: 'Open source réel, sans dual licensing.' },
    { id: 'frag-2', type: 'description', body: 'Twake Mail est une messagerie souveraine.' },
  ];

  it('returns matching fragment id when exact match found', () => {
    const result = detectExactDuplicate(
      { type: 'argument', body: 'Open source réel, sans dual licensing.' },
      existingFragments,
    );
    expect(result).toEqual({ id: 'frag-1', score: 1.0 });
  });

  it('returns null when no match', () => {
    const result = detectExactDuplicate(
      { type: 'argument', body: 'Contenu différent.' },
      existingFragments,
    );
    expect(result).toBeNull();
  });

  it('returns null when type differs even if body matches', () => {
    const result = detectExactDuplicate(
      { type: 'description', body: 'Open source réel, sans dual licensing.' },
      existingFragments,
    );
    expect(result).toBeNull();
  });

  it('matches despite different whitespace', () => {
    const result = detectExactDuplicate(
      { type: 'argument', body: '  Open source  réel,   sans dual licensing.  ' },
      existingFragments,
    );
    expect(result).toEqual({ id: 'frag-1', score: 1.0 });
  });
});

describe('checkSubjectCoherence', () => {
  it('returns ok when subject keyword found in body', () => {
    const result = checkSubjectCoherence({
      domain: 'twake-mail',
      body: 'Twake Mail est une messagerie basée sur Apache James et JMAP.',
    });
    expect(result.level).toBe('ok');
  });

  it('returns warning when no keyword matches', () => {
    const result = checkSubjectCoherence({
      domain: 'twake-mail',
      body: 'Contenu totalement sans rapport.',
    });
    expect(result.level).toBe('warning');
    expect(result.type).toBe('subject_coherence');
  });

  it('returns info for unknown domain', () => {
    const result = checkSubjectCoherence({ domain: 'unknown-product', body: 'Quelque chose.' });
    expect(result.level).toBe('info');
  });
});

describe('checkTagCoverage', () => {
  it('returns ok when expected tag prefixes present for function', () => {
    const result = checkTagCoverage({
      function_type: 'reference',
      tags: ['client:dgfip', 'open-source'],
    });
    expect(result.level).toBe('ok');
    expect(result.type).toBe('entity_coverage');
  });

  it('returns warning when expected tag prefix missing', () => {
    const result = checkTagCoverage({
      function_type: 'reference',
      tags: ['open-source'],
    });
    expect(result.level).toBe('warning');
    expect(result.message).toContain('client:');
  });

  it('returns info for function types with no expectations', () => {
    const result = checkTagCoverage({
      function_type: 'introduction',
      tags: [],
    });
    expect(result.level).toBe('info');
  });

  it('handles missing tags array gracefully', () => {
    const result = checkTagCoverage({ function_type: 'commercial', tags: [] });
    expect(result.level).toBe('warning');
    expect(result.message).toContain('produit:');
  });

  it('returns ok for technical with tech: and produit: tags', () => {
    const result = checkTagCoverage({
      function_type: 'technical',
      tags: ['tech:apache-james', 'produit:linshare'],
    });
    expect(result.level).toBe('ok');
  });

  it('returns warning when only one of two required prefixes present (technical)', () => {
    const result = checkTagCoverage({
      function_type: 'technical',
      tags: ['tech:apache-james'],
    });
    expect(result.level).toBe('warning');
  });
});

describe('computeQualitySignals', () => {
  it('returns 3 flags for a clean block', () => {
    const result = computeQualitySignals(
      {
        type: 'argument',
        body: 'Twake Mail est une solution de messagerie souveraine.',
        domain: 'twake-mail',
        function_type: 'commercial',
        tags: ['produit:twake-mail'],
      },
      null,
    );
    expect(result).toHaveLength(3);
    expect(result.find((f) => f.type === 'duplicate_check')?.level).toBe('ok');
    expect(result.find((f) => f.type === 'subject_coherence')?.level).toBe('ok');
  });

  it('returns error-level duplicate_check when dupResult is provided', () => {
    const result = computeQualitySignals(
      { type: 'argument', body: 'Open source réel, sans dual licensing.', domain: 'twake-mail' },
      { id: 'frag-1', score: 1.0 },
    );
    const dupFlag = result.find((f) => f.type === 'duplicate_check');
    expect(dupFlag?.level).toBe('error');
    expect(dupFlag?.message).toContain('frag-1');
  });

  it('handles missing tags gracefully', () => {
    const result = computeQualitySignals(
      { type: 'argument', body: 'Contenu quelconque.', domain: 'unknown' },
      null,
    );
    expect(result).toHaveLength(3);
    expect(() => result).not.toThrow();
  });
});
