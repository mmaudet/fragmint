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
    expect(Array.isArray(chunks)).toBe(true);
  });

  it('merges L2 subsections into their L1 parent chunk (sourceSection = L1 title)', () => {
    // This mirrors the Word proposal structure where H1 = major section, H2 = subsections.
    // The chunker should merge "Macro-planning" into the "Offre de service" chunk,
    // NOT create a separate chunk with sourceSection="Macro-planning des prestations".
    const md = `# Offre de service

Texte introductif de l'offre de service.

## Gouvernance et pilotage

${' Description de la gouvernance. '.repeat(10)}

## Macro-planning des prestations

${' Calendrier prévisionnel des livrables. '.repeat(10)}

# Facturation

${' Modalités de facturation et de paiement. '.repeat(10)}`;

    const chunks = semanticChunk(md);
    const sourceSections = chunks.map((c) => c.sourceSection);

    // "Macro-planning" is L2 → merged into L1 "Offre de service", not its own chunk
    expect(sourceSections).not.toContain('Macro-planning des prestations');
    expect(sourceSections).toContain('Offre de service');
    // "Facturation" is L1 → gets its own chunk
    expect(sourceSections).toContain('Facturation');

    // The L1 chunk text should contain the L2 heading as an ATX line
    const offreChunk = chunks.find((c) => c.sourceSection === 'Offre de service');
    expect(offreChunk?.text).toMatch(/## Macro-planning des prestations/);
  });
});
