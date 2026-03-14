import { describe, it, expect } from 'vitest';
import { fragmentFrontmatterSchema, QUALITY_TRANSITIONS } from './fragment.js';

describe('fragmentFrontmatterSchema', () => {
  const validFragment = {
    id: 'frag-a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    type: 'introduction',
    domain: 'souveraineté',
    tags: ['souveraineté', 'europe'],
    lang: 'fr',
    translation_of: null,
    quality: 'draft',
    author: 'mmaudet',
    reviewed_by: null,
    approved_by: null,
    created_at: '2026-03-14',
    updated_at: '2026-03-14',
    valid_from: null,
    valid_until: null,
    parent_id: null,
    generation: 0,
    uses: 0,
    last_used: null,
    access: { read: ['*'], write: ['contributor', 'admin'], approve: ['expert', 'admin'] },
  };

  it('validates a correct fragment', () => {
    const result = fragmentFrontmatterSchema.safeParse(validFragment);
    expect(result.success).toBe(true);
  });

  it('rejects invalid id format', () => {
    const result = fragmentFrontmatterSchema.safeParse({ ...validFragment, id: 'bad-id' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid lang (not ISO 639-1)', () => {
    const result = fragmentFrontmatterSchema.safeParse({ ...validFragment, lang: 'fra' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown type', () => {
    const result = fragmentFrontmatterSchema.safeParse({ ...validFragment, type: 'unknown' });
    expect(result.success).toBe(false);
  });

  it('rejects negative generation', () => {
    const result = fragmentFrontmatterSchema.safeParse({ ...validFragment, generation: -1 });
    expect(result.success).toBe(false);
  });

  it('defaults origin to manual', () => {
    const result = fragmentFrontmatterSchema.parse(validFragment);
    expect(result.origin).toBe('manual');
  });
});

describe('QUALITY_TRANSITIONS', () => {
  it('allows draft -> reviewed', () => {
    expect(QUALITY_TRANSITIONS.draft).toContain('reviewed');
  });
  it('allows reviewed -> approved', () => {
    expect(QUALITY_TRANSITIONS.reviewed).toContain('approved');
  });
  it('allows approved -> deprecated', () => {
    expect(QUALITY_TRANSITIONS.approved).toContain('deprecated');
  });
  it('does not allow draft -> approved', () => {
    expect(QUALITY_TRANSITIONS.draft).not.toContain('approved');
  });
  it('deprecated is terminal', () => {
    expect(QUALITY_TRANSITIONS.deprecated).toEqual([]);
  });
});
