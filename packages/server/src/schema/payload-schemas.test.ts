import { describe, it, expect } from 'vitest';
import { getPayloadSchema, listPayloadSchemas } from './payload-schemas.js';

describe('payload-schemas', () => {
  it('toBody pricing-line-v1 avec quantite et prix', () => {
    const schema = getPayloadSchema('pricing-line-v1')!;
    expect(schema.toBody({ libelle: 'Support N2', quantite: 2, prix_unitaire: 450, unite: '€/jour' }))
      .toBe('Support N2 — 2 × 450 €/jour');
  });

  it('toBody sla-row-v1', () => {
    const schema = getPayloadSchema('sla-row-v1')!;
    expect(schema.toBody({ niveau: 'Critique', prise_en_charge: '30min', resolution: '8h' }))
      .toBe('Niveau Critique : prise en charge sous 30min, résolution sous 8h.');
  });

  it('getPayloadSchema inconnu retourne null', () => {
    expect(getPayloadSchema('unknown-schema')).toBeNull();
  });

  it('listPayloadSchemas retourne 4 schemas', () => {
    expect(listPayloadSchemas().length).toBeGreaterThanOrEqual(4);
  });
});
