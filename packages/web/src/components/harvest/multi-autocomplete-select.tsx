import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useReferenceLookup } from '@/api/hooks/use-reference-lookup';
import type { ReferenceItem } from '@/api/hooks/use-reference-lookup';
import { tagDisplayLabel } from '@/lib/tag-display';

const TAG_PREFIXES = [
  { value: 'client', label: 'Client' },
  { value: 'produit', label: 'Produit' },
  { value: 'tech', label: 'Technologie' },
  { value: 'partner', label: 'Partenaire' },
  { value: 'cert', label: 'Certification' },
  { value: 'reg', label: 'Règlementation' },
];

interface Props {
  kind: 'domain' | 'tag' | 'function';
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  allowCreate?: boolean;
  knownSlugs?: string[];
}

export function MultiAutocompleteSelect({
  kind,
  values,
  onChange,
  placeholder,
  allowCreate,
  knownSlugs,
}: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [pendingTag, setPendingTag] = useState<string | null>(null);
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

  // Reset highlight when suggestions change
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [data]);

  const add = (item: ReferenceItem) => {
    if (!values.includes(item.slug)) onChange([...values, item.slug]);
    setQuery('');
    setOpen(false);
  };

  const addFreeText = () => {
    const v = query.trim().toLowerCase().replace(/\s+/g, '-');
    if (!v || values.includes(v)) return;
    setQuery('');
    setOpen(false);
    if (kind === 'tag' && !v.includes(':')) {
      setPendingTag(v);
    } else {
      onChange([...values, v]);
    }
  };

  const confirmPending = (prefix: string | null) => {
    if (!pendingTag) return;
    const final = prefix ? `${prefix}:${pendingTag}` : pendingTag;
    if (!values.includes(final)) onChange([...values, final]);
    setPendingTag(null);
  };

  const remove = (slug: string) => onChange(values.filter((v) => v !== slug));

  const filteredItems = data.filter((item) => !values.includes(item.slug));
  const showCreate =
    allowCreate &&
    open &&
    query.trim().length > 0 &&
    filteredItems.length === 0 &&
    debouncedQuery === query;

  const isKnown = (v: string) => !knownSlugs || knownSlugs.includes(v);

  const totalItems = filteredItems.length + (showCreate ? 1 : 0);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || totalItems === 0) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (allowCreate && query.trim()) addFreeText();
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
      if (highlightedIndex >= 0 && highlightedIndex < filteredItems.length) {
        add(filteredItems[highlightedIndex]);
      } else if (highlightedIndex === filteredItems.length && showCreate) {
        addFreeText();
      } else if (allowCreate && query.trim()) {
        addFreeText();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setHighlightedIndex(-1);
    }
  };

  return (
    <div ref={ref} className="relative">
      <div className="flex flex-wrap gap-1 mb-1">
        {values.map((v) => (
          <Badge
            key={v}
            variant="secondary"
            className={`text-xs gap-1 ${!isKnown(v) ? 'border border-dashed border-blue-400 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/30' : ''}`}
          >
            {kind === 'tag' ? tagDisplayLabel(v) : v}
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
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="text-sm"
      />
      {pendingTag && (
        <div className="mt-1 p-2 border rounded-md bg-muted/40 space-y-1.5">
          <p className="text-xs text-muted-foreground">
            Catégorie pour <code className="font-medium text-foreground">{pendingTag}</code> ?
          </p>
          <div className="flex flex-wrap gap-1">
            {TAG_PREFIXES.map((p) => (
              <button
                key={p.value}
                type="button"
                className="text-xs px-2 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-900/50"
                onMouseDown={() => confirmPending(p.value)}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground hover:bg-muted/80"
              onMouseDown={() => confirmPending(null)}
            >
              Sans catégorie
            </button>
          </div>
        </div>
      )}
      {open && (filteredItems.length > 0 || showCreate) && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto">
          {filteredItems.map((item, idx) => (
            <button
              key={item.slug}
              type="button"
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent ${highlightedIndex === idx ? 'bg-accent' : ''}`}
              onMouseDown={() => add(item)}
            >
              {item.label}
            </button>
          ))}
          {showCreate && (
            <button
              type="button"
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent text-blue-600 dark:text-blue-400 italic ${highlightedIndex === filteredItems.length ? 'bg-accent' : ''}`}
              onMouseDown={addFreeText}
            >
              Créer &ldquo;{query.trim()}&rdquo;
            </button>
          )}
        </div>
      )}
    </div>
  );
}
