import type { DetectedTable } from './table-detector.js';

const SCHEMA_SIGNALS: Record<string, string[]> = {
  'pricing-line-v1': ['libelle', 'quantite', 'prix', 'pu', 'total', 'montant', 'unite', 'tarif'],
  'sla-row-v1': ['sla', 'niveau', 'priseen', 'resolution', 'prise', 'penalite', 'disponibilite', 'delai'],
  'reference-v1': ['client', 'projet', 'annee', 'reference', 'technologie', 'date', 'montant'],
};

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function inferPayloadSchema(table: DetectedTable): string {
  const normalized = table.headers.map(normalizeHeader);

  let bestSchema = 'generic-row-v1';
  let bestScore = 0;

  for (const [schemaId, signals] of Object.entries(SCHEMA_SIGNALS)) {
    const hits = signals.filter((signal) =>
      normalized.some((h) => h.includes(signal))
    ).length;
    const score = hits / signals.length;

    if (score > bestScore) {
      bestScore = score;
      bestSchema = schemaId;
    }
  }

  return bestSchema;
}
