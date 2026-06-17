import { describe, it, expect } from 'vitest';
import { inferPayloadSchema } from './payload-inference.js';

describe('inferPayloadSchema', () => {
  it('détecte sla-row-v1 depuis des headers SLA', () => {
    const table = {
      headers: ['Niveau', 'Prise en charge', 'Résolution', 'Pénalité'],
      rows: [],
    };
    expect(inferPayloadSchema(table)).toBe('sla-row-v1');
  });

  it('détecte pricing-line-v1 depuis des headers de prix', () => {
    const table = {
      headers: ['Libellé', 'Quantité', 'Prix unitaire', 'Total'],
      rows: [],
    };
    expect(inferPayloadSchema(table)).toBe('pricing-line-v1');
  });

  it('retourne generic-row-v1 pour des headers inconnus', () => {
    const table = {
      headers: ['Foo', 'Bar', 'Baz'],
      rows: [],
    };
    expect(inferPayloadSchema(table)).toBe('generic-row-v1');
  });

  it('détecte reference-v1 depuis des headers de référence client', () => {
    const table = {
      headers: ['Client', 'Projet', 'Année', 'Technologie'],
      rows: [],
    };
    expect(inferPayloadSchema(table)).toBe('reference-v1');
  });
});
