import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, Plus } from 'lucide-react';
import { AutocompleteSelect } from './autocomplete-select';

interface EntityEntry {
  id: string;
  name: string;
}

interface Props {
  values: EntityEntry[];
  onChange: (values: EntityEntry[]) => void;
}

export function EntitySelector({ values, onChange }: Props) {
  const [pending, setPending] = useState('');

  const add = (name?: string) => {
    const v = (name ?? pending).trim();
    if (!v) return;
    onChange([...values, { id: crypto.randomUUID(), name: v }]);
    setPending('');
  };

  const remove = (id: string) => onChange(values.filter((v) => v.id !== id));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {values.map((e) => (
          <Badge key={e.id} variant="secondary" className="text-xs gap-1">
            {e.name}
            <button type="button" onClick={() => remove(e.id)}>
              <X className="h-2.5 w-2.5" />
            </button>
          </Badge>
        ))}
      </div>
      <div className="flex gap-2">
        <AutocompleteSelect
          kind="entity"
          value={pending}
          onChange={setPending}
          placeholder="Search or type a new entity..."
          valueField="label"
          allowCreate
          onConfirm={(v) => add(v)}
        />
        <Button type="button" size="sm" variant="outline" onClick={() => add()}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
