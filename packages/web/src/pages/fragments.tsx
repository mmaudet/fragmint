import { useState, useCallback } from 'react';
import { useFragments, useSearchFragments } from '@/api/hooks/use-fragments';
import { FragmentCard } from '@/components/fragment-card';
import { FragmentDetail } from '@/components/fragment-detail';
import { SearchInput } from '@/components/search-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const PAGE_SIZE = 20;
const FRAGMENT_TYPES = ['introduction', 'argument', 'pricing', 'clause', 'faq', 'conclusion', 'bio', 'témoignage'];
const QUALITY_VALUES = ['draft', 'reviewed', 'approved'];
const LANG_VALUES = ['fr', 'en'];

export default function FragmentsPage() {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [domain, setDomain] = useState('');
  const [lang, setLang] = useState('');
  const [quality, setQuality] = useState('');
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filters = {
    ...(type && { type }),
    ...(domain && { domain }),
    ...(lang && { lang }),
    ...(quality && { quality }),
    limit: PAGE_SIZE,
    offset,
  };

  const fragmentsQuery = useFragments(search ? {} : filters);
  const searchQuery = useSearchFragments(search, filters);

  const data = search ? searchQuery.data : fragmentsQuery.data;
  const isLoading = search ? searchQuery.isLoading : fragmentsQuery.isLoading;

  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    setOffset(0);
  }, []);

  const handleFilterChange = useCallback(
    (setter: (v: string) => void) => (value: string) => {
      setter(value === '__all__' ? '' : value);
      setOffset(0);
    },
    [],
  );

  const page = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="p-6 space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-2xl font-bold">Bibliothèque</h2>
        <div className="w-72">
          <SearchInput value={search} onChange={handleSearch} placeholder="Rechercher un fragment..." />
        </div>
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap gap-3">
        <Select value={type || '__all__'} onValueChange={handleFilterChange(setType)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Tous les types</SelectItem>
            {FRAGMENT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={quality || '__all__'} onValueChange={handleFilterChange(setQuality)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Qualité" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Toutes qualités</SelectItem>
            {QUALITY_VALUES.map((q) => (
              <SelectItem key={q} value={q}>{q}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={lang || '__all__'} onValueChange={handleFilterChange(setLang)}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="Langue" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Toutes langues</SelectItem>
            {LANG_VALUES.map((l) => (
              <SelectItem key={l} value={l}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={domain || '__all__'} onValueChange={handleFilterChange(setDomain)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Domaine" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Tous domaines</SelectItem>
            <SelectItem value="openrag">openrag</SelectItem>
            <SelectItem value="saas">saas</SelectItem>
            <SelectItem value="consulting">consulting</SelectItem>
            <SelectItem value="general">general</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Fragment list */}
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      ) : data && data.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((fragment) => (
            <FragmentCard
              key={fragment.id}
              fragment={fragment}
              selected={fragment.id === selectedId}
              onClick={() => setSelectedId(fragment.id)}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          Aucun fragment trouvé
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-center gap-4">
        <Button
          variant="outline"
          size="sm"
          disabled={offset === 0}
          onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
        >
          Précédent
        </Button>
        <span className="text-sm text-muted-foreground">Page {page}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={!data || data.length < PAGE_SIZE}
          onClick={() => setOffset((o) => o + PAGE_SIZE)}
        >
          Suivant
        </Button>
      </div>

      {/* Detail drawer */}
      <FragmentDetail
        fragmentId={selectedId}
        open={selectedId !== null}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
