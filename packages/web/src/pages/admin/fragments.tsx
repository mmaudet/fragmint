import { useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, PenLine, CheckCircle, Archive, LayoutGrid } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import {
  FragmentsToolbar,
  DEFAULT_FILTERS,
  type FragmentsFilters,
} from '@/components/admin/fragments-toolbar';
import { AdminFragmentCard, type AdminFragment } from '@/components/admin/fragment-card';
import { FragmentsBulkActions } from '@/components/admin/fragments-bulk-actions';
import { FragmentDetailDrawer } from '@/components/admin/fragment-detail-drawer';
import { apiRequest } from '@/api/client';

const LIMIT = 50;

// Quality stat cards — ordered by admin workflow priority
const QUALITY_CARDS = [
  {
    value: 'reviewed',
    label: 'Reviewed',
    sublabel: 'à valider',
    icon: Clock,
    iconColor: 'text-blue-500',
    activeClass: 'border-blue-400 dark:border-blue-600',
    countColor: 'text-blue-700 dark:text-blue-300',
  },
  {
    value: 'draft',
    label: 'Draft',
    sublabel: 'en cours',
    icon: PenLine,
    iconColor: 'text-muted-foreground',
    activeClass: 'border-gray-400 dark:border-gray-500',
    countColor: 'text-gray-700 dark:text-gray-300',
  },
  {
    value: 'approved',
    label: 'Approved',
    sublabel: 'validés',
    icon: CheckCircle,
    iconColor: 'text-green-600',
    activeClass: 'border-green-400 dark:border-green-600',
    countColor: 'text-green-700 dark:text-green-300',
  },
  {
    value: 'deprecated',
    label: 'Archivé',
    sublabel: 'retirés',
    icon: Archive,
    iconColor: 'text-amber-500',
    activeClass: 'border-amber-400 dark:border-amber-600',
    countColor: 'text-amber-700 dark:text-amber-300',
  },
  {
    value: 'all',
    label: 'Tous',
    sublabel: 'au total',
    icon: LayoutGrid,
    iconColor: 'text-primary',
    activeClass: 'border-primary/60',
    countColor: 'text-foreground',
  },
] as const;

export default function AdminFragmentsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Derive from URL param so the drawer is deep-linkable (?fragment=<id>)
  const drawerFragmentId = searchParams.get('fragment') ?? null;
  const openFragmentDrawer = useCallback(
    (id: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('fragment', id);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const closeFragmentDrawer = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('fragment');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);
  const [page, setPage] = useState(0);

  // Filters derived directly from URL — no separate React state.
  // No quality param → default to 'reviewed'. 'quality=all' → no filter.
  const filters: FragmentsFilters = {
    quality: searchParams.get('quality') ?? DEFAULT_FILTERS.quality,
    domain: searchParams.get('domain') ?? '',
    type: searchParams.get('type') ?? '',
    lang: searchParams.get('lang') ?? '',
    origin: searchParams.get('origin') ?? '',
    search: searchParams.get('search') ?? '',
    sort: searchParams.get('sort') ?? DEFAULT_FILTERS.sort,
  };

  const updateFilters = useCallback(
    (updates: Partial<FragmentsFilters>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          (Object.keys(updates) as Array<keyof FragmentsFilters>).forEach((key) => {
            const val = updates[key];
            if (key === 'quality') {
              // 'all' stored explicitly to distinguish from "unset" (which defaults to reviewed)
              if (!val || val === 'all') {
                next.set('quality', 'all');
              } else {
                next.set('quality', val);
              }
            } else if (val) {
              next.set(key, val);
            } else {
              next.delete(key);
            }
          });
          return next;
        },
        { replace: true },
      );
      setSelectedIds(new Set());
      setPage(0);
    },
    [setSearchParams],
  );

  const apiQuality = filters.quality === 'all' ? '' : filters.quality;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-fragments', filters, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        sort: filters.sort,
        limit: String(LIMIT),
        offset: String(page * LIMIT),
      });
      if (apiQuality) params.set('quality', apiQuality);
      if (filters.domain) params.set('domain', filters.domain);
      if (filters.type) params.set('type', filters.type);
      if (filters.lang) params.set('lang', filters.lang);
      if (filters.origin) params.set('origin', filters.origin);
      if (filters.search) params.set('search', filters.search);
      return apiRequest<{
        items: AdminFragment[];
        pagination: { total: number; limit: number; offset: number; has_more: boolean };
        stats: { total: number; by_status: Record<string, number> };
      }>('GET', `/v1/admin/fragments?${params}`);
    },
  });

  const items = data?.items ?? [];
  const pagination = data?.pagination;
  const stats = data?.stats;

  const allSelected = items.length > 0 && items.every((f) => selectedIds.has(f.id));
  const someSelected = items.some((f) => selectedIds.has(f.id));

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const onBulkComplete = () => {
    setSelectedIds(new Set());
    refetch();
    queryClient.invalidateQueries({ queryKey: ['admin-fragments'] });
  };

  return (
    <div className="min-h-full bg-muted/20">
      {/* Header */}
      <div className="bg-background border-b px-8 py-8">
        <h1 className="text-2xl font-bold mb-2">Fragments</h1>
        <div className="text-sm text-muted-foreground leading-relaxed space-y-1">
          <p>
            Bibliothèque complète de tous les fragments du vault, toutes collections confondues. Le
            cycle de vie d'un fragment est :{' '}
            <span className="font-medium text-foreground/80">Draft</span> (rédigé par un
            contributeur)
            {' →'}{' '}
            <span className="inline-flex px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
              Reviewed
            </span>{' '}
            (soumis à validation){' →'}{' '}
            <span className="inline-flex px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
              Approved
            </span>{' '}
            (utilisable dans les plans).
          </p>
          <p>
            <span className="font-medium text-foreground/80">Votre rôle :</span> approuver les
            fragments{' '}
            <span className="inline-flex px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
              Reviewed
            </span>
            , archiver les obsolètes, ou supprimer les erreurs. Les{' '}
            <span className="font-medium text-foreground/80">Drafts</span> sont visibles pour
            supervision mais seuls les contributeurs peuvent les soumettre en review.
          </p>
        </div>
      </div>

      <div className="px-8 py-6 space-y-6">
        {/* Stat cards — clicking filters the list */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {QUALITY_CARDS.map(
            ({ value, label, sublabel, icon: Icon, iconColor, activeClass, countColor }) => {
              // 'all' sums by_status (always global) — stats.total is filtered by current query.
              const count =
                value === 'all'
                  ? Object.values(stats?.by_status ?? {}).reduce(
                      (sum: number, n: number) => sum + n,
                      0,
                    )
                  : (stats?.by_status[value] ?? 0);
              const isActive = filters.quality === value;
              return (
                <button
                  key={value}
                  onClick={() => updateFilters({ quality: value })}
                  className="text-left"
                >
                  <Card
                    className={`bg-background transition-all hover:shadow-sm ${isActive ? `border-2 ${activeClass}` : 'hover:border-muted-foreground/30'}`}
                  >
                    <CardContent className="pt-5 pb-4">
                      <Icon
                        className={`h-5 w-5 mb-3 ${isActive ? iconColor : 'text-muted-foreground/60'}`}
                      />
                      <p
                        className={`text-2xl font-bold ${isActive ? countColor : count === 0 ? 'text-muted-foreground/40' : ''}`}
                      >
                        {count}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">{sublabel}</p>
                    </CardContent>
                  </Card>
                </button>
              );
            },
          )}
        </div>

        {/* Toolbar: search + domain + type + origin + lang + sort */}
        <FragmentsToolbar filters={filters} onFiltersChange={updateFilters} />

        {/* Bulk actions (shown when items are selected) */}
        {selectedIds.size > 0 && (
          <FragmentsBulkActions
            selectedIds={Array.from(selectedIds)}
            onComplete={onBulkComplete}
            onCancel={() => setSelectedIds(new Set())}
          />
        )}

        {/* Fragment list */}
        {isLoading ? (
          <p className="text-muted-foreground text-sm">Chargement…</p>
        ) : items.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            Aucun fragment ne correspond aux filtres
          </div>
        ) : (
          <div className="space-y-2">
            {/* Select-all row */}
            <div className="flex items-center gap-2 px-1 py-1 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected && !allSelected;
                }}
                onChange={() =>
                  allSelected
                    ? setSelectedIds(new Set())
                    : setSelectedIds(new Set(items.map((f) => f.id)))
                }
                aria-label="Tout sélectionner"
              />
              <span>
                {allSelected
                  ? `Tous les ${items.length} sélectionnés`
                  : someSelected
                    ? `${selectedIds.size} / ${items.length} sélectionnés`
                    : `${pagination?.total ?? items.length} fragments`}
              </span>
            </div>

            {items.map((fragment) => (
              <AdminFragmentCard
                key={fragment.id}
                fragment={fragment}
                isSelected={selectedIds.has(fragment.id)}
                onToggleSelect={() => toggleSelect(fragment.id)}
                onOpenDetail={() => openFragmentDrawer(fragment.id)}
                onActionComplete={onBulkComplete}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {pagination && pagination.total > LIMIT && (
          <div className="flex items-center justify-between border-t pt-3">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 border rounded text-sm disabled:opacity-40 hover:bg-muted"
            >
              ← Précédent
            </button>
            <span className="text-sm text-muted-foreground">
              Page {page + 1} · {pagination.total} fragments
            </span>
            <button
              onClick={() => setPage(page + 1)}
              disabled={!pagination.has_more}
              className="px-3 py-1.5 border rounded text-sm disabled:opacity-40 hover:bg-muted"
            >
              Suivant →
            </button>
          </div>
        )}
      </div>

      {/* Fragment detail drawer */}
      {drawerFragmentId && (
        <FragmentDetailDrawer
          fragmentId={drawerFragmentId}
          onClose={closeFragmentDrawer}
          onUpdate={onBulkComplete}
        />
      )}
    </div>
  );
}
