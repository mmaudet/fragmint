import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useReferenceLookup } from '@/api/hooks/use-reference-lookup';
import type { ReferenceItem } from '@/api/hooks/use-reference-lookup';

interface Props {
  kind: 'domain' | 'tag' | 'function' | 'entity';
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  valueField?: 'slug' | 'label';
  allowCreate?: boolean;
  chipMode?: boolean;
  onConfirm?: (value: string) => void;
}

export function AutocompleteSelect({
  kind,
  value,
  onChange,
  placeholder,
  valueField = 'slug',
  allowCreate,
  chipMode,
  onConfirm,
}: Props) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const debouncedQuery = useDebouncedValue(query, 300);
  const { data = [] } = useReferenceLookup(kind, debouncedQuery);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Reset highlight when suggestions change
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [data]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const select = (item: ReferenceItem) => {
    const v = valueField === 'label' ? item.label || item.slug : item.slug;
    onChange(v);
    onConfirm?.(v);
    setQuery(onConfirm ? '' : v);
    setHighlightedIndex(-1);
    setOpen(false);
  };

  const create = () => {
    const v = query.trim();
    if (!v) return;
    onChange(v);
    onConfirm?.(v);
    setQuery(onConfirm ? '' : v);
    setHighlightedIndex(-1);
    setOpen(false);
  };

  const clear = () => {
    setQuery('');
    onChange('');
  };

  const showCreate =
    allowCreate && open && query.trim().length > 0 && data.length === 0 && debouncedQuery === query;

  // Total navigable items: data items + optional "create" entry
  const totalItems = data.length + (showCreate ? 1 : 0);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || totalItems === 0) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (allowCreate && query.trim()) create();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((i) => (i + 1) % totalItems);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((i) => (i - 1 + totalItems) % totalItems);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < data.length) {
        select(data[highlightedIndex]);
      } else if (highlightedIndex === data.length && showCreate) {
        create();
      } else if (allowCreate && query.trim()) {
        create();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setHighlightedIndex(-1);
    }
  };

  // Chip mode: once confirmed, show a removable badge instead of input
  if (chipMode && value.trim()) {
    return (
      <div className="flex flex-wrap gap-1">
        <Badge variant="secondary" className="text-xs gap-1 px-2 py-1">
          {value}
          <button type="button" onClick={clear} className="ml-1">
            <X className="h-2.5 w-2.5" />
          </button>
        </Badge>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="text-sm"
      />
      {open && (data.length > 0 || showCreate) && (
        <div
          ref={listRef}
          className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto"
        >
          {data.map((item, idx) => (
            <button
              key={item.slug}
              type="button"
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent ${highlightedIndex === idx ? 'bg-accent' : ''}`}
              onMouseDown={() => select(item)}
            >
              {item.label}
              {item.type && (
                <span className="ml-1 text-xs text-muted-foreground">({item.type})</span>
              )}
            </button>
          ))}
          {showCreate && (
            <button
              type="button"
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent text-blue-600 dark:text-blue-400 italic ${highlightedIndex === data.length ? 'bg-accent' : ''}`}
              onMouseDown={create}
            >
              Créer &ldquo;{query.trim()}&rdquo;
            </button>
          )}
        </div>
      )}
    </div>
  );
}
