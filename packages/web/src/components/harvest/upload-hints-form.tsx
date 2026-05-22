import { useState, useRef } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AutocompleteSelect } from './autocomplete-select';
import { MultiAutocompleteSelect } from './multi-autocomplete-select';
import { EntitySelector } from './entity-selector';
import type { UploadHints } from '@/types/trust-source';

interface Props {
  hints: UploadHints;
  onChange: (hints: UploadHints) => void;
}

const AUDIENCE_OPTIONS = ['technical', 'decision-maker', 'user', 'legal'];
const MATURITY_OPTIONS = ['production', 'beta', 'roadmap', 'archive'];

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
          <div className="grid grid-cols-2 gap-4 mt-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Domain</label>
              <AutocompleteSelect
                kind="domain"
                value={hints.domain ?? ''}
                onChange={(v) => set('domain', v || undefined)}
                placeholder="e.g. twake-mail"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Function type</label>
              <AutocompleteSelect
                kind="function"
                value={hints.function_type ?? ''}
                onChange={(v) => set('function_type', v || undefined)}
                placeholder="e.g. commercial"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Maturity</label>
              <select
                className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                value={hints.maturity ?? ''}
                onChange={(e) => set('maturity', (e.target.value as UploadHints['maturity']) || undefined)}
              >
                <option value="">— select —</option>
                {MATURITY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Audience</label>
              <div className="flex flex-wrap gap-1">
                {AUDIENCE_OPTIONS.map((o) => (
                  <Button
                    key={o}
                    type="button"
                    size="sm"
                    variant={(hints.audience ?? []).includes(o) ? 'secondary' : 'ghost'}
                    className="text-xs h-7"
                    onClick={() => {
                      const current = hints.audience ?? [];
                      set('audience', current.includes(o) ? current.filter((a) => a !== o) : [...current, o]);
                    }}
                  >
                    {o}
                  </Button>
                ))}
              </div>
            </div>
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
