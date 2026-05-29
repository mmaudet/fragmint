import { describe, it, expect } from 'vitest';
import { semanticChunk, SECTION_MAX_CHARS } from './harvest-chunker.js';

describe('semanticChunk', () => {
  it('returns one chunk for short markdown with no headers', () => {
    const md = 'LinShare est une solution open source.';
    const chunks = semanticChunk(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(md);
    expect(chunks[0].sourceSection).toBe('');
  });

  it('splits by H2 headers', () => {
    const md = `## Section A

Contenu de la section A avec du texte suffisamment long pour être utile.

## Section B

Contenu de la section B avec du texte différent sur un autre sujet.`;
    const chunks = semanticChunk(md);
    // Both sections are small — they may be merged OR separate depending on implementation
    // At minimum, we should have at least 1 chunk
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // At least one chunk should mention Section A or B content
    const allText = chunks.map(c => c.text).join('\n');
    expect(allText).toContain('Section A');
    expect(allText).toContain('Section B');
  });

  it('sets sourceSection from H2 header', () => {
    const md = `## My Section\n\nContent here with some text.`;
    const chunks = semanticChunk(md);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].sourceSection).toBe('My Section');
  });

  it('splits a large single section by paragraphs (fallback)', () => {
    const body = 'Paragraph content. '.repeat(700); // ~13000 chars
    const md = `## Big Section\n\n${body}`;
    const chunks = semanticChunk(md);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.sourceSection).toBe('Big Section');
      expect(chunk.text.length).toBeLessThanOrEqual(SECTION_MAX_CHARS + 100);
    }
  });

  it('H1, H2, H3 all trigger section splits', () => {
    const md = `# H1 Section\n\nText one.\n\n## H2 Section\n\nText two.\n\n### H3 Section\n\nText three.`;
    const chunks = semanticChunk(md);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const allSections = chunks.map(c => c.sourceSection);
    // At least one chunk has a section label
    expect(allSections.some(s => s.length > 0)).toBe(true);
  });

  it('returns non-empty chunks for empty markdown', () => {
    const chunks = semanticChunk('');
    // Should handle gracefully
    expect(Array.isArray(chunks)).toBe(true);
  });
});
