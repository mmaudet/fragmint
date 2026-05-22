import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useReferenceLookup } from '@/api/hooks/use-reference-lookup';
import type { ReferenceItem } from '@/api/hooks/use-reference-lookup';

interface Props {
  kind: 'domain' | 'tag' | 'function' | 'entity';
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function AutocompleteSelect({ kind, value, onChange, placeholder }: Props) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 300);
  const { data = [] } = useReferenceLookup(kind, debouncedQuery);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const select = (item: ReferenceItem) => {
    setQuery(item.slug);
    onChange(item.slug);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
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
      {open && data.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto">
          {data.map((item) => (
            <button
              key={item.slug}
              type="button"
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent"
              onMouseDown={() => select(item)}
            >
              {item.label}
              {item.type && <span className="ml-1 text-xs text-muted-foreground">({item.type})</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
