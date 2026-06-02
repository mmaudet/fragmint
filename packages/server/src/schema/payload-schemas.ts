import { z } from 'zod';

export interface PayloadSchemaDefinition {
  id: string;
  label: string;
  fields: z.ZodObject<z.ZodRawShape>;
  toBody: (payload: Record<string, unknown>) => string;
}

const pricingLineSchema = z.object({
  libelle: z.string().default(''),
  quantite: z.coerce.number().optional(),
  prix_unitaire: z.coerce.number().optional(),
  unite: z.string().optional(),
  total: z.coerce.number().optional(),
});

const slaRowSchema = z.object({
  niveau: z.string().default(''),
  prise_en_charge: z.string().default(''),
  resolution: z.string().default(''),
  penalite: z.string().optional(),
  disponibilite: z.string().optional(),
});

const referenceSchema = z.object({
  client: z.string().default(''),
  projet: z.string().default(''),
  annee: z.string().optional(),
  montant: z.string().optional(),
  technologie: z.string().optional(),
});

const genericRowSchema = z.object({}).catchall(z.string());

export const PAYLOAD_SCHEMAS: Record<string, PayloadSchemaDefinition> = {
  'pricing-line-v1': {
    id: 'pricing-line-v1',
    label: 'Ligne de prix',
    fields: pricingLineSchema,
    toBody: (p) => {
      const parts = [p.libelle ?? ''];
      if (p.quantite != null && p.prix_unitaire != null)
        parts.push(`${p.quantite} × ${p.prix_unitaire} ${p.unite ?? '€'}`);
      else if (p.prix_unitaire != null) parts.push(`${p.prix_unitaire} ${p.unite ?? '€'}`);
      return parts.filter(s => s !== '').join(' — ');
    },
  },
  'sla-row-v1': {
    id: 'sla-row-v1',
    label: 'Engagement SLA',
    fields: slaRowSchema,
    toBody: (p) =>
      `Niveau ${p.niveau} : prise en charge sous ${p.prise_en_charge}, résolution sous ${p.resolution}.${p.penalite ? ` Pénalité : ${p.penalite}.` : ''}`,
  },
  'reference-v1': {
    id: 'reference-v1',
    label: 'Référence client',
    fields: referenceSchema,
    toBody: (p) =>
      `${p.client} — ${p.projet}${p.annee ? ` (${p.annee})` : ''}${p.technologie ? ` · ${p.technologie}` : ''}`,
  },
  'generic-row-v1': {
    id: 'generic-row-v1',
    label: 'Ligne générique',
    fields: genericRowSchema,
    toBody: (p) => Object.entries(p).map(([k, v]) => `${k}: ${v}`).join(' | '),
  },
};

export function getPayloadSchema(id: string): PayloadSchemaDefinition | null {
  return PAYLOAD_SCHEMAS[id] ?? null;
}

export function listPayloadSchemas(): PayloadSchemaDefinition[] {
  return Object.values(PAYLOAD_SCHEMAS);
}
