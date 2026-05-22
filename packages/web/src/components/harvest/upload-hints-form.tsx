import { useState, useRef } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { AutocompleteSelect } from './autocomplete-select';
import { MultiAutocompleteSelect } from './multi-autocomplete-select';
import { EntitySelector } from './entity-selector';
import type { UploadHints } from '@/types/trust-source';

interface Props {
  hints: UploadHints;
  onChange: (hints: UploadHints) => void;
}

export function UploadHintsForm({ hints, onChange }: Props) {
  const [open, setOpen] = useState(false);

  const set = <K extends keyof UploadHints>(key: K, value: UploadHints[K]) => {
    onChange({ ...hints, [key]: value });
  };

  const entityIdsRef = useRef<Map<string, string>>(new Map());
  const toStableEntries = (names: string[]) =>
    names.map((name) => {
      if (!entityIdsRef.current.has(name)) entityIdsRef.current.set(name, crypto.randomUUID());
      return { id: entityIdsRef.current.get(name)!, name };
    });

  return (
    <div className="border rounded-md bg-muted/30">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium"
        onClick={() => setOpen((o) => !o)}
      >
        <span>Hints (optional — improves classification trust)</span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t">
          <div className="mt-3">
            <label className="text-xs text-muted-foreground mb-1 block">Domain</label>
            <AutocompleteSelect
              kind="domain"
              value={hints.domain ?? ''}
              onChange={(v) => set('domain', v || undefined)}
              placeholder="e.g. twake-mail"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Tags (suggested)</label>
            <MultiAutocompleteSelect
              kind="tag"
              values={hints.tags ?? []}
              onChange={(v) => set('tags', v.length ? v : undefined)}
              placeholder="Search tags..."
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Entities mentioned</label>
            <EntitySelector
              values={toStableEntries(hints.entities ?? [])}
              onChange={(entries) => set('entities', entries.map((e) => e.name))}
            />
          </div>
        </div>
      )}
    </div>
  );
}
