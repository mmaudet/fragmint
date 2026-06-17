import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/lib/i18n';

type FieldDef = { key: string; label: string; type: 'text' | 'number' };

// Schemas with known, useful structured fields (shown in UI as "Données structurées")
// Generic/fallback schemas like generic-row-v1 are excluded — their data is already
// visible as a rendered HTML table in the Corps field.
export const STRUCTURED_SCHEMAS = new Set(['pricing-line-v1', 'sla-row-v1', 'reference-v1']);

const SCHEMA_LABELS: Record<string, { fr: string; en: string }> = {
  'pricing-line-v1': { fr: 'Ligne tarif / compétences', en: 'Pricing / skills row' },
  'sla-row-v1': { fr: 'Ligne SLA / engagement', en: 'SLA / commitment row' },
  'reference-v1': { fr: 'Référence technique', en: 'Technical reference' },
  'generic-row-v1': { fr: 'Ligne de données', en: 'Data row' },
};

export function schemaLabel(schemaId: string | null | undefined, lang: string = 'fr'): string {
  if (!schemaId) return lang === 'en' ? 'Tabular data' : 'Données tabulaires';
  const entry = SCHEMA_LABELS[schemaId];
  if (!entry) return schemaId;
  return lang === 'en' ? entry.en : entry.fr;
}

export function useSchemaLabel() {
  const { lang } = useI18n();
  return (schemaId: string | null | undefined) => schemaLabel(schemaId, lang);
}

/** Returns true only if the payload has at least one non-empty value for a known schema field. */
export function hasPayloadContent(schemaId: string, value: Record<string, unknown>): boolean {
  const fields = SCHEMA_FIELDS[schemaId];
  if (!fields) return Object.values(value).some((v) => v != null && v !== '');
  return fields.some((f) => {
    const v = value[f.key];
    return v != null && v !== '';
  });
}

const SCHEMA_FIELDS: Record<string, FieldDef[]> = {
  'pricing-line-v1': [
    { key: 'libelle', label: 'Libellé', type: 'text' },
    { key: 'quantite', label: 'Quantité', type: 'number' },
    { key: 'prix_unitaire', label: 'Prix unitaire', type: 'number' },
    { key: 'unite', label: 'Unité', type: 'text' },
    { key: 'total', label: 'Total', type: 'number' },
  ],
  'sla-row-v1': [
    { key: 'niveau', label: 'Niveau', type: 'text' },
    { key: 'prise_en_charge', label: 'Prise en charge', type: 'text' },
    { key: 'resolution', label: 'Résolution', type: 'text' },
    { key: 'penalite', label: 'Pénalité', type: 'text' },
    { key: 'disponibilite', label: 'Disponibilité', type: 'text' },
  ],
  'reference-v1': [
    { key: 'client', label: 'Client', type: 'text' },
    { key: 'projet', label: 'Projet', type: 'text' },
    { key: 'annee', label: 'Année', type: 'text' },
    { key: 'montant', label: 'Montant', type: 'text' },
    { key: 'technologie', label: 'Technologie', type: 'text' },
  ],
};

function displayValue(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') return JSON.stringify(v, null, 2);
  return String(v);
}

function isComplex(v: unknown): boolean {
  return typeof v === 'object' && v !== null;
}

interface Props {
  schemaId: string;
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  disabled?: boolean;
}

export function PayloadEditor({ schemaId, value, onChange, disabled = false }: Props) {
  const knownFields = SCHEMA_FIELDS[schemaId];
  const fields: FieldDef[] = knownFields ?? Object.keys(value).map((k) => ({
    key: k,
    label: k,
    type: 'text' as const,
  }));

  if (fields.length === 0) return null;

  const handleChange = (key: string, raw: string, type: 'text' | 'number') => {
    const parsed = type === 'number' ? (raw === '' ? '' : Number(raw)) : raw;
    onChange({ ...value, [key]: parsed });
  };

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
      {fields.map((f) => {
        const val = value[f.key];
        const complex = isComplex(val);
        return (
          <div key={f.key} className={`space-y-1 ${complex ? 'col-span-2' : ''}`}>
            <Label className="text-xs text-muted-foreground">{f.label}</Label>
            {complex ? (
              <pre className="text-xs bg-muted/40 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">
                {displayValue(val)}
              </pre>
            ) : (
              <Input
                type={f.type === 'number' ? 'number' : 'text'}
                value={val != null ? String(val) : ''}
                onChange={(e) => handleChange(f.key, e.target.value, f.type)}
                disabled={disabled}
                className="h-7 text-xs"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
