import { describe, it, expect } from 'vitest';
import {
  normalizeForComparison,
  detectExactDuplicate,
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

