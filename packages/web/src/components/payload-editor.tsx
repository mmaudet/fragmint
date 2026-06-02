import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Field definitions per schema id
type FieldDef = { key: string; label: string; type: 'text' | 'number' };

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

interface Props {
  schemaId: string;
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  disabled?: boolean;
}

export function PayloadEditor({ schemaId, value, onChange, disabled = false }: Props) {
  const knownFields = SCHEMA_FIELDS[schemaId];

  // For generic-row-v1 or unknown schemas: show all keys as text inputs
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
      {fields.map((f) => (
        <div key={f.key} className="space-y-1">
          <Label className="text-xs text-muted-foreground">{f.label}</Label>
          <Input
            type={f.type === 'number' ? 'number' : 'text'}
            value={value[f.key] != null ? String(value[f.key]) : ''}
            onChange={(e) => handleChange(f.key, e.target.value, f.type)}
            disabled={disabled}
            className="h-7 text-xs"
          />
        </div>
      ))}
    </div>
  );
}
