import { describe, it, expect } from 'vitest';
import { determineTrustSource, computeTrustSources, overallTrustSource } from '../trust-source.js';

describe('determineTrustSource', () => {
  it('returns llm-inferred when no hint provided', () => {
    expect(determineTrustSource(undefined, 'twake-mail')).toBe('llm-inferred');
    expect(determineTrustSource(null, 'twake-mail')).toBe('llm-inferred');
    expect(determineTrustSource('', 'twake-mail')).toBe('llm-inferred');
  });

  it('returns llm-confirmed when hint is present and LLM agrees', () => {
    expect(determineTrustSource('twake-mail', 'twake-mail')).toBe('llm-confirmed');
    expect(determineTrustSource('new-product', 'new-product')).toBe('llm-confirmed');
  });

  it('returns llm-deviation when hint is present but LLM disagrees', () => {
    expect(determineTrustSource('liveoffice', 'something-else')).toBe('llm-deviation');
    expect(determineTrustSource('new-product', 'other-thing')).toBe('llm-deviation');
  });

  it('handles array hints: llm-confirmed when hint arrays match', () => {
    expect(determineTrustSource(['twake-mail', 'liveoffice'], ['twake-mail', 'liveoffice'])).toBe('llm-confirmed');
    expect(determineTrustSource(['new-a', 'new-b'], ['new-a', 'new-b'])).toBe('llm-confirmed');
  });

  it('handles array hints: llm-deviation when LLM adds or removes items', () => {
    expect(determineTrustSource(['new-a'], ['new-a', 'extra'])).toBe('llm-deviation');
  });
});

describe('computeTrustSources', () => {
  it('returns llm-confirmed for a domain hint that the LLM echoes back', () => {
    const result = computeTrustSources(
      { domain: 'twake-mail' },
      { domain: 'twake-mail', function_type: 'commercial', audience: [], maturity: 'production', tags: [] },
      { domain: ['twake-mail'], function_type: [], tags: [] },
    );
    expect(result.domain).toBe('llm-confirmed');
  });

  it('returns llm-inferred for fields with no hint', () => {
    const result = computeTrustSources(
      {},
      { domain: 'anything', function_type: 'commercial', audience: [], maturity: 'production', tags: [] },
      { domain: [], function_type: [], tags: [] },
    );
    expect(result.domain).toBe('llm-inferred');
    expect(result.function_type).toBe('llm-inferred');
  });
});

describe('overallTrustSource', () => {
  it('returns llm-deviation if any field has llm-deviation', () => {
    expect(overallTrustSource({ domain: 'llm-deviation', function_type: 'human-direct' })).toBe('llm-deviation');
  });

  it('returns llm-inferred if any field has llm-inferred but none have llm-deviation', () => {
    expect(overallTrustSource({ domain: 'llm-inferred', function_type: 'llm-confirmed' })).toBe('llm-inferred');
  });

  it('returns human-direct when all fields are human-direct', () => {
    expect(overallTrustSource({ domain: 'human-direct', maturity: 'human-direct' })).toBe('human-direct');
  });
});
