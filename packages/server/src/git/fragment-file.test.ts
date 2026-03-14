import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFragment, writeFragment, generateId, deriveTitle } from './fragment-file.js';

describe('generateId', () => {
  it('returns a string starting with frag-', () => {
    const id = generateId();
    expect(id).toMatch(/^frag-[a-f0-9-]+$/);
  });
});

describe('deriveTitle', () => {
  it('extracts first heading', () => {
    expect(deriveTitle('# My Title\n\nSome body')).toBe('My Title');
  });

  it('falls back to first non-empty line', () => {
    expect(deriveTitle('Just a paragraph')).toBe('Just a paragraph');
  });

  it('handles empty body', () => {
    expect(deriveTitle('')).toBe('Untitled');
  });
});

describe('readFragment / writeFragment', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fragmint-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true });
  });

  it('writes and reads a fragment round-trip', () => {
    const frontmatter = {
      id: 'frag-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      type: 'introduction' as const,
      domain: 'souveraineté',
      tags: ['europe'],
      lang: 'fr',
      translation_of: null,
      quality: 'draft' as const,
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
      access: { read: ['*'], write: ['contributor'], approve: ['expert'] },
    };
    const body = '# Introduction\n\nSome content here.';

    const filePath = writeFragment(dir, frontmatter, body);
    expect(filePath).toMatch(/introduction-souverainete-fr-[a-f0-9]{8}\.md/);

    const result = readFragment(filePath);
    expect(result.frontmatter.id).toBe(frontmatter.id);
    expect(result.frontmatter.type).toBe('introduction');
    expect(result.body).toBe(body);
  });

  it('generates kebab-case filename', () => {
    const frontmatter = {
      id: 'frag-11111111-2222-3333-4444-555555555555',
      type: 'argument' as const,
      domain: 'openrag',
      tags: [],
      lang: 'en',
      translation_of: null,
      quality: 'draft' as const,
      author: 'test',
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
      access: { read: ['*'], write: ['contributor'], approve: ['expert'] },
    };

    const filePath = writeFragment(dir, frontmatter, 'body');
    expect(filePath).toMatch(/argument-openrag-en-[a-f0-9]{8}\.md/);
  });
});
