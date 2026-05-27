// packages/web/src/components/admin/fragments-toolbar.tsx
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';

export interface FragmentsFilters {
  quality: string;
  domain: string;
  type: string;
  lang: string;
  origin: string;
  search: string;
  sort: string;
}

export const DEFAULT_FILTERS: FragmentsFilters = {
  quality: 'reviewed', // default: what needs admin attention
  domain: '',
  type: '',
  lang: '',
  origin: '',
  search: '',
  sort: 'date_desc',
};

interface Props {
  filters: FragmentsFilters;
  onFiltersChange: (updates: Partial<FragmentsFilters>) => void;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function FragmentsToolbar({ filters, onFiltersChange }: Props) {
  const [localSearch, setLocalSearch] = useState(filters.search);
  const debouncedSearch = useDebounce(localSearch, 300);

  useEffect(() => {
    if (debouncedSearch !== filters.search) {
      onFiltersChange({ search: debouncedSearch });
    }
  }, [debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: domains } = useQuery({
    queryKey: ['references', 'subjects'],
    queryFn: async () => {
      const data = await apiRequest<Array<{ slug: string; label: string }>>(
        'GET',
        '/v1/references/subjects',
      );
      return data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: types } = useQuery({
    queryKey: ['fragment-types'],
    queryFn: async () => {
      const data = await apiRequest<Array<{ slug: string; label: string }>>(
        'GET',
        '/v1/fragment-types',
      );
      return data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Search */}
      <input
        type="text"
        placeholder="Rechercher titre ou contenu…"
        value={localSearch}
        onChange={(e) => setLocalSearch(e.target.value)}
        className="px-3 py-1.5 border rounded-md text-sm flex-1 min-w-[180px] bg-background"
      />

      {/* Domain */}
      <select
        value={filters.domain}
        onChange={(e) => onFiltersChange({ domain: e.target.value })}
        className="px-2 py-1.5 border rounded-md text-sm bg-background"
      >
        <option value="">Tous domaines</option>
        {domains?.map((d) => (
          <option key={d.slug} value={d.slug}>
            {d.label}
          </option>
        ))}
      </select>

      {/* Type */}
      <select
        value={filters.type}
        onChange={(e) => onFiltersChange({ type: e.target.value })}
        className="px-2 py-1.5 border rounded-md text-sm bg-background"
      >
        <option value="">Tous types</option>
        {types?.map((t) => (
          <option key={t.slug} value={t.slug}>
            {t.label}
          </option>
        ))}
      </select>

      {/* Origin */}
      <select
        value={filters.origin}
        onChange={(e) => onFiltersChange({ origin: e.target.value })}
        className="px-2 py-1.5 border rounded-md text-sm bg-background"
      >
        <option value="">Toutes origines</option>
        <option value="manual">Manuel</option>
        <option value="harvested">Harvest</option>
        <option value="generated">Généré</option>
      </select>

      {/* Lang */}
      <select
        value={filters.lang}
        onChange={(e) => onFiltersChange({ lang: e.target.value })}
        className="px-2 py-1.5 border rounded-md text-sm bg-background"
      >
        <option value="">Toutes langues</option>
        <option value="fr">FR</option>
        <option value="en">EN</option>
        <option value="es">ES</option>
        <option value="pt">PT</option>
      </select>

      {/* Sort */}
      <select
        value={filters.sort}
        onChange={(e) => onFiltersChange({ sort: e.target.value })}
        className="px-2 py-1.5 border rounded-md text-sm bg-background"
      >
        <option value="date_desc">Plus récent</option>
        <option value="date_asc">Plus ancien</option>
        <option value="title_asc">Titre A→Z</option>
        <option value="title_desc">Titre Z→A</option>
        <option value="usage_desc">Plus utilisés</option>
      </select>
    </div>
  );
}
