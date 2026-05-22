import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useReferenceLookup } from '@/api/hooks/use-reference-lookup';
import type { ReferenceItem } from '@/api/hooks/use-reference-lookup';

interface Props {
  kind: 'domain' | 'tag' | 'function' | 'entity';
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}

export function MultiAutocompleteSelect({ kind, values, onChange, placeholder }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 300);
  const { data = [] } = useReferenceLookup(kind, debouncedQuery);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const add = (item: ReferenceItem) => {
    if (!values.includes(item.slug)) onChange([...values, item.slug]);
    setQuery('');
    setOpen(false);
  };

  const remove = (slug: string) => onChange(values.filter((v) => v !== slug));

  const filteredItems = data.filter((item) => !values.includes(item.slug));

  return (
    <div ref={ref} className="relative">
      <div className="flex flex-wrap gap-1 mb-1">
        {values.map((v) => (
          <Badge key={v} variant="secondary" className="text-xs gap-1">
            {v}
            <button type="button" onClick={() => remove(v)}>
              <X className="h-2.5 w-2.5" />
            </button>
          </Badge>
        ))}
      </div>
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="text-sm"
      />
      {open && filteredItems.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto">
          {filteredItems.map((item) => (
            <button
              key={item.slug}
              type="button"
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent"
              onMouseDown={() => add(item)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
