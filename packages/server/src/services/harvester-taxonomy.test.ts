import { describe, it, expect } from 'vitest';
import {
  HARVESTER_TYPES,
  DEFAULT_FRAGMENT_TYPE,
  coerceFragmentType,
} from './harvester-taxonomy.js';
import { FRAGMENT_TYPES } from '../schema/fragment.js';

describe('harvester taxonomy', () => {
  it('HARVESTER_TYPES stays in sync with FRAGMENT_TYPES', () => {
    expect([...HARVESTER_TYPES].sort()).toEqual([...FRAGMENT_TYPES].sort());
  });

  describe('coerceFragmentType', () => {
    it('passes through a valid type unchanged', () => {
      for (const t of HARVESTER_TYPES) {
        expect(coerceFragmentType(t)).toBe(t);
      }
    });

    it('normalizes case and whitespace', () => {
      expect(coerceFragmentType('  Argument ')).toBe('argument');
      expect(coerceFragmentType('CONCLUSION')).toBe('conclusion');
    });

    it('maps known LLM aliases onto the closest valid type', () => {
      expect(coerceFragmentType('description')).toBe('introduction');
      expect(coerceFragmentType('use-case')).toBe('cas-usage');
      expect(coerceFragmentType('testimonial')).toBe('témoignage');
    });

    it('falls back to the default for unknown / empty values', () => {
      expect(coerceFragmentType('other')).toBe(DEFAULT_FRAGMENT_TYPE);
      expect(coerceFragmentType('unknown')).toBe(DEFAULT_FRAGMENT_TYPE);
      expect(coerceFragmentType('totally-made-up')).toBe(DEFAULT_FRAGMENT_TYPE);
      expect(coerceFragmentType('')).toBe(DEFAULT_FRAGMENT_TYPE);
      expect(coerceFragmentType(null)).toBe(DEFAULT_FRAGMENT_TYPE);
      expect(coerceFragmentType(undefined)).toBe(DEFAULT_FRAGMENT_TYPE);
    });

    it('only ever returns a value that passes the fragment schema enum', () => {
      const samples = ['argument', 'description', 'other', '', 'xyz', '  FAQ  ', null, undefined];
      for (const s of samples) {
        expect(FRAGMENT_TYPES).toContain(coerceFragmentType(s));
      }
    });
  });
});
