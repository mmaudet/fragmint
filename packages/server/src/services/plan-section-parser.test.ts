import { describe, it, expect } from 'vitest';
import { parsePlanSections, sectionStableId } from './plan-section-parser.js';

describe('parsePlanSections', () => {
  it('splits a markdown plan into H2 sections', () => {
    const md = `## Introduction\n\nThis section introduces the product.\n\n## Pricing\n\nAll prices in euros.`;
    const sections = parsePlanSections(md);
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe('Introduction');
    expect(sections[0].description).toBe('This section introduces the product.');
    expect(sections[1].title).toBe('Pricing');
    expect(sections[1].description).toBe('All prices in euros.');
  });

  it('returns one synthetic section when no H2 is present', () => {
    const md = `Overview\n\nSome free-form text without headings.`;
    const sections = parsePlanSections(md);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Overview');
    expect(sections[0].description).toBe('Some free-form text without headings.');
  });

  it('preserves deeper headings inside the section body', () => {
    const md = `## Section 1\n\nIntro\n\n### Subheading\n\nMore text.`;
    const sections = parsePlanSections(md);
    expect(sections).toHaveLength(1);
    expect(sections[0].description).toContain('### Subheading');
  });

  it('trims whitespace in title and description', () => {
    const md = `##   Hello    \n\n   World   \n`;
    const sections = parsePlanSections(md);
    expect(sections[0].title).toBe('Hello');
    expect(sections[0].description).toBe('World');
  });

  it('handles an empty description', () => {
    const md = `## Empty\n\n## NotEmpty\n\nBody.`;
    const sections = parsePlanSections(md);
    expect(sections[0].description).toBe('');
    expect(sections[1].description).toBe('Body.');
  });

  it('produces stable IDs based on title + index', () => {
    const md = `## A\n\nText\n\n## B\n\nText`;
    const s1 = parsePlanSections(md);
    const s2 = parsePlanSections(md);
    expect(s1[0].id).toBe(s2[0].id);
    expect(s1[1].id).toBe(s2[1].id);
    expect(s1[0].id).not.toBe(s1[1].id);
  });

  it('changes the ID if the title is renamed', () => {
    const a = parsePlanSections('## A\n\nText');
    const b = parsePlanSections('## A renamed\n\nText');
    expect(a[0].id).not.toBe(b[0].id);
  });

  it('returns an empty array for an empty input', () => {
    expect(parsePlanSections('')).toEqual([]);
    expect(parsePlanSections('   \n\n  ')).toEqual([]);
  });

  it('extracts **Type:** slug and strips it from description', () => {
    const md = `## Introduction\n**Type:** introduction\nContexte de la réponse.`;
    const [s] = parsePlanSections(md);
    expect(s.inferred_type).toBe('introduction');
    expect(s.description).toBe('Contexte de la réponse.');
    expect(s.description).not.toContain('**Type:**');
  });

  it('extracts types across multiple sections independently', () => {
    const md = `## Intro\n**Type:** introduction\nSection 1.\n\n## Pricing\n**Type:** pricing\nSection 2.`;
    const [s1, s2] = parsePlanSections(md);
    expect(s1.inferred_type).toBe('introduction');
    expect(s2.inferred_type).toBe('pricing');
    expect(s1.description).toBe('Section 1.');
    expect(s2.description).toBe('Section 2.');
  });

  it('leaves inferred_type undefined when no **Type:** line is present', () => {
    const md = `## Pricing\nAll prices in euros.`;
    const [s] = parsePlanSections(md);
    expect(s.inferred_type).toBeUndefined();
  });
});

describe('sectionStableId', () => {
  it('is deterministic for the same inputs', () => {
    expect(sectionStableId('Title', 0)).toBe(sectionStableId('Title', 0));
  });
  it('changes with index', () => {
    expect(sectionStableId('Title', 0)).not.toBe(sectionStableId('Title', 1));
  });
});
