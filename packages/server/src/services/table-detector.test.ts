import { describe, it, expect } from 'vitest';
import { detectTables } from './table-detector.js';

const MD_WITH_PIPE_TABLE = `
# Engagements SLA

| Niveau | Prise en charge | Résolution |
|--------|----------------|------------|
| Critique | 30min | 8h |
| Majeur | 2h | 24h |

Autre prose ici.
`;

// Pandoc grid table with = separator (simple format)
const MD_WITH_GRID_TABLE = `
## Proposition financière

+----+---------------------------+-----------------+-----------------+---------+
| N° | Désignation               | Nombre d'unités | Prix unitaire   | Prix HT |
+====+===========================+=================+=================+=========+
| 1  | Prestation complète       | 1               | 6 000,00 €      | 6 000,00 € |
+----+---------------------------+-----------------+-----------------+---------+
| 2  | Remise exceptionnelle 35% | 1               | -2 100,00 €     | -2 100,00 € |
+----+---------------------------+-----------------+-----------------+---------+

Suite du document.
`;

// Real Pandoc output format with :== alignment markers
const MD_WITH_GRID_ALIGNMENT = `
## Contacts

+-----------------------+-----------------------+-----------------------+
| Société               | Nom                   | Courriel              |
+:======================+:=====================:+:======================+
| GPSM GSO-LAB          | Christophe Hanrion    | c.hanrion@gso.com     |
+-----------------------+-----------------------+-----------------------+

Texte après.
`;

const MD_WITH_GRID_NO_HEADER_SEP = `
+----------+--------------------+
| Société  | GPSM GSO-LAB       |
+----------+--------------------+
| Nom      | Christophe Hanrion |
+----------+--------------------+
| Téléphone| +33 6 44 23 61 16  |
+----------+--------------------+
`;

describe('detectTables — pipe tables', () => {
  it('détecte un tableau pipe avec header et 2 lignes', () => {
    const { tables } = detectTables(MD_WITH_PIPE_TABLE);
    expect(tables).toHaveLength(1);
    expect(tables[0].headers).toEqual(['Niveau', 'Prise en charge', 'Résolution']);
    expect(tables[0].rows).toHaveLength(2);
    expect(tables[0].rows[0]).toEqual({ 'Niveau': 'Critique', 'Prise en charge': '30min', 'Résolution': '8h' });
    expect(tables[0].precedingHeading).toBe('Engagements SLA');
  });

  it('retire les tableaux pipe du markdown nettoyé', () => {
    const { cleanedMarkdown } = detectTables(MD_WITH_PIPE_TABLE);
    expect(cleanedMarkdown).not.toContain('| Critique');
    expect(cleanedMarkdown).toContain('Autre prose ici.');
  });

  it('markdown sans tableau retourne []', () => {
    expect(detectTables('Pas de tableau ici.').tables).toHaveLength(0);
  });
});

describe('detectTables — grid tables (Pandoc +---+)', () => {
  it('détecte un grid table avec séparateur header ====', () => {
    const { tables } = detectTables(MD_WITH_GRID_TABLE);
    expect(tables).toHaveLength(1);
    expect(tables[0].headers).toContain('Désignation');
    expect(tables[0].rows).toHaveLength(2);
    expect(tables[0].rows[0]['Désignation']).toBe('Prestation complète');
    expect(tables[0].precedingHeading).toBe('Proposition financière');
  });

  it('retire les grid tables du markdown nettoyé', () => {
    const { cleanedMarkdown } = detectTables(MD_WITH_GRID_TABLE);
    expect(cleanedMarkdown).not.toContain('+====+');
    expect(cleanedMarkdown).not.toContain('Prestation complète');
    expect(cleanedMarkdown).toContain('Suite du document.');
  });

  it('détecte un grid table sans séparateur header (tableau de contact)', () => {
    const { tables } = detectTables(MD_WITH_GRID_NO_HEADER_SEP);
    // Grid table without header separator: treated as data rows
    expect(tables).toHaveLength(1);
    expect(tables[0].rows.length).toBeGreaterThan(0);
  });

  it('strip le grid table même si non parseable (nettoyage markdown)', () => {
    const { cleanedMarkdown } = detectTables(MD_WITH_GRID_NO_HEADER_SEP);
    expect(cleanedMarkdown).not.toContain('+----+');
    expect(cleanedMarkdown).not.toContain('GPSM GSO-LAB');
  });

  it('parse un grid table avec séparateur :== (format alignement Pandoc réel)', () => {
    const { tables, cleanedMarkdown } = detectTables(MD_WITH_GRID_ALIGNMENT);
    expect(tables).toHaveLength(1);
    expect(tables[0].headers).toContain('Société');
    expect(tables[0].rows).toHaveLength(1);
    expect(tables[0].rows[0]['Société']).toBe('GPSM GSO-LAB');
    expect(cleanedMarkdown).not.toContain('+:===');
    expect(cleanedMarkdown).toContain('Texte après.');
  });
});
