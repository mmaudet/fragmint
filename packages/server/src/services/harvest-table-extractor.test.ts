import { describe, it, expect } from 'vitest';
import { extractTablesFromMarkdown } from './harvest-table-extractor.js';
import { applyUploadHintsInPlace } from './harvest-hint-processor.js';

// GFM table with total rows — output of `pandoc --to gfm` on a complex Word table.
// The summary rows have empty cells in the first 3 columns (merged in Word).
const GFM_TABLE_WITH_TOTALS = `
## Détail trimestriel

L'offre présentée ci-dessous correspond à l'ensemble des prestations.

| **N°** | **Trimestre**         | **Volet A** |  **Volet B**  |     **Total HT** |
|:------:|-----------------------|------------:|:-------------:|-----------------:|
|   1    | T2 2026 · Onboarding  | 15 450,00 € |      \\-       |      15 450,00 € |
|   2    | T3 2026 · Inspiration | 25 800,00 € |  22 400,00 €  |      48 200,00 € |
|   3    | T4 2026 · Inspiration | 25 800,00 € |  22 400,00 €  |      48 200,00 € |
|        |                       |             | **Total HT**  | **304 650,00 €** |
|        |                       |             |    **TVA**    |  **60 930,00 €** |
|        |                       |             | **Total TTC** | **365 580,00 €** |

# Facturation
`;

const SIMPLE_TABLE = `
# Contacts

| Société | Nom | Email |
|---------|-----|-------|
| EONA-X | Simon Girardeau | s.girardeau@eona-x.eu |
`;

describe('extractTablesFromMarkdown', () => {
  it('captures GFM total rows (empty-cell rows at end of pricing table)', () => {
    const { specs } = extractTablesFromMarkdown(GFM_TABLE_WITH_TOTALS);

    expect(specs).toHaveLength(1);
    const rows = specs[0].table.rows;

    // 3 data rows + 3 total rows = 6
    expect(rows).toHaveLength(6);

    // Last 3 rows are the summary rows — at least one should mention "Total"
    const lastThree = rows.slice(-3).map((r) => Object.values(r).join(' '));
    expect(lastThree.some((r) => r.includes('Total'))).toBe(true);
  });

  it('strips the table from cleanedMarkdown', () => {
    const { cleanedMarkdown } = extractTablesFromMarkdown(GFM_TABLE_WITH_TOTALS);
    expect(cleanedMarkdown).not.toMatch(/^\|/m);
  });

  it('sets precedingHeading from the nearest heading before the table', () => {
    const { specs } = extractTablesFromMarkdown(GFM_TABLE_WITH_TOTALS);
    expect(specs[0].table.precedingHeading).toBe('Détail trimestriel');
  });

  it('detects a simple reference table', () => {
    const { specs } = extractTablesFromMarkdown(SIMPLE_TABLE);
    expect(specs).toHaveLength(1);
    expect(specs[0].table.headers).toContain('Société');
    expect(specs[0].table.rows).toHaveLength(1);
  });
});

describe('applyUploadHintsInPlace — domain override', () => {
  const makeBlock = (domain: string, body: string) => ({
    title: 'Test',
    body,
    type: 'other' as const,
    domain,
    lang: 'fr',
    tags: [] as string[],
    confidence: 0.8,
    new_proposals: { tags: [], domains: [] },
  });

  it('overrides domain to hint value when body contains the hint word and LLM said "other"', () => {
    const blocks = [makeBlock('other', 'LinTO est une solution de transcription.')];
    const overridden = applyUploadHintsInPlace(blocks, { domain: 'linto' }, new Set(), ['cloud']);
    expect(blocks[0].domain).toBe('linto');
    expect(overridden.has(0)).toBe(true);
  });

  it('does NOT override when body does not contain the hint word', () => {
    const blocks = [makeBlock('other', 'Modalités de paiement par virement bancaire.')];
    applyUploadHintsInPlace(blocks, { domain: 'linto' }, new Set(), ['cloud']);
    expect(blocks[0].domain).toBe('other');
  });

  it('does NOT override when hint domain is already in existingDomains', () => {
    // "linto" is a known domain → LLM already had it as an option, no need to override
    const blocks = [makeBlock('other', 'LinTO est une solution de transcription.')];
    applyUploadHintsInPlace(blocks, { domain: 'linto' }, new Set(), ['linto', 'cloud']);
    expect(blocks[0].domain).toBe('other');
  });

  it('does NOT override when LLM already assigned a non-"other" domain', () => {
    const blocks = [makeBlock('legal', 'LinTO est une solution de transcription.')];
    applyUploadHintsInPlace(blocks, { domain: 'linto' }, new Set(), ['cloud']);
    expect(blocks[0].domain).toBe('legal');
  });

  it('overrides multiple blocks independently', () => {
    const blocks = [
      makeBlock('other', 'LinTO transcription en temps réel.'),
      makeBlock('other', 'Modalités de paiement standard.'),
      makeBlock('other', 'Architecture LinTO distribuée.'),
    ];
    applyUploadHintsInPlace(blocks, { domain: 'linto' }, new Set(), []);
    expect(blocks[0].domain).toBe('linto');
    expect(blocks[1].domain).toBe('other'); // no "linto" in body
    expect(blocks[2].domain).toBe('linto');
  });
});
