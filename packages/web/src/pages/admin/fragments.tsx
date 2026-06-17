import { useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, PenLine, CheckCircle, Archive, LayoutGrid, Table2, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import {
  FragmentsToolbar,
  DEFAULT_FILTERS,
  type FragmentsFilters,
} from '@/components/admin/fragments-toolbar';
import { AdminFragmentCard, type AdminFragment } from '@/components/admin/fragment-card';
import { FragmentsBulkActions } from '@/components/admin/fragments-bulk-actions';
import { FragmentDetailDrawer } from '@/components/admin/fragment-detail-drawer';
import { CollectionsView } from '@/components/admin/collections-view';
import { apiRequest } from '@/api/client';
import { cn } from '@/lib/utils';

const LIMIT = 50;

// Quality stat cards — ordered by admin workflow priority
const QUALITY_CARDS = [
  {
    value: 'all',
    sublabel: 'au total',
    icon: LayoutGrid,
    iconColor: 'text-primary',
    activeClass: 'border-primary/60',
    countColor: 'text-foreground',
  },
  {
    value: 'reviewed',
    sublabel: 'à valider',
    icon: Clock,
    iconColor: 'text-blue-500',
    activeClass: 'border-blue-400 dark:border-blue-600',
    countColor: 'text-blue-700 dark:text-blue-300',
  },
  {
    value: 'draft',
    sublabel: 'en cours',
    icon: PenLine,
    iconColor: 'text-muted-foreground',
    activeClass: 'border-gray-400 dark:border-gray-500',
    countColor: 'text-gray-700 dark:text-gray-300',
  },
  {
    value: 'approved',
    sublabel: 'validés',
    icon: CheckCircle,
    iconColor: 'text-green-600',
    activeClass: 'border-green-400 dark:border-green-600',
    countColor: 'text-green-700 dark:text-green-300',
  },
  {
    value: 'deprecated',
    sublabel: 'retirés',
    icon: Archive,
    iconColor: 'text-amber-500',
    activeClass: 'border-amber-400 dark:border-amber-600',
    countColor: 'text-amber-700 dark:text-amber-300',
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
  // Page derived from URL — 1-indexed in URL, 0-indexed internally.
  const page = Math.max(0, Number(searchParams.get('page') ?? '1') - 1);
  const setPage = useCallback(
    (p: number) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (p <= 0) next.delete('page');
          else next.set('page', String(p + 1));
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

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
          next.delete('page'); // reset to page 1 on filter change
          return next;
        },
        { replace: true },
      );
      setSelectedIds(new Set());
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
    queryClient.invalidateQueries({ queryKey: ['admin', 'fragments', 'pending-count'] });
  };

  const [approveAllLoading, setApproveAllLoading] = useState(false);
  const [selectAllLoading, setSelectAllLoading] = useState(false);

  const handleSelectAllPages = useCallback(async () => {
    setSelectAllLoading(true);
    try {
      const params = new URLSearchParams({ limit: '5000', offset: '0' });
      if (apiQuality) params.set('quality', apiQuality);
      if (filters.domain) params.set('domain', filters.domain);
      if (filters.type) params.set('type', filters.type);
      if (filters.lang) params.set('lang', filters.lang);
      if (filters.origin) params.set('origin', filters.origin);
      if (filters.search) params.set('search', filters.search);
      const result = await apiRequest<{ items: { id: string }[] }>(
        'GET',
        `/v1/admin/fragments?${params}`,
      );
      setSelectedIds(new Set(result.items.map((f) => f.id)));
    } catch (e: any) {
      alert(`Erreur : ${e.message}`);
    } finally {
      setSelectAllLoading(false);
    }
  }, [apiQuality, filters]);

  const handleApproveAll = useCallback(async () => {
    setApproveAllLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.domain) params.set('domain', filters.domain);
      if (filters.type) params.set('type', filters.type);
      if (filters.lang) params.set('lang', filters.lang);
      if (filters.origin) params.set('origin', filters.origin);
      const qs = params.toString() ? `?${params}` : '';
      const result = await apiRequest<{ job_id: string | null; count: number }>(
        'POST',
        `/v1/admin/fragments/bulk-approve-all${qs}`,
      );
      if (result?.job_id) {
        // Poll until done
        for (let i = 0; i < 300; i++) {
          await new Promise((r) => setTimeout(r, 800));
          const job = await apiRequest<{ status: string }>('GET', `/v1/jobs/${result.job_id}`);
          if (job.status === 'done' || job.status === 'error') break;
        }
      }
      onBulkComplete();
    } catch (e: any) {
      alert(`Erreur : ${e.message}`);
    } finally {
      setApproveAllLoading(false);
    }
  }, [filters, onBulkComplete]);

  const view = searchParams.get('view') ?? 'fragments';
  const setView = useCallback(
    (v: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (v === 'fragments') next.delete('view');
          else next.set('view', v);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return (
    <div className="min-h-full bg-muted/20">
      {/* Header */}
      <div className="bg-background border-b px-8 pt-8 pb-0">
        <h1 className="text-2xl font-bold mb-2">Fragments</h1>
        <div className="text-sm text-muted-foreground leading-relaxed space-y-1 mb-5">
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
            {' '}Les lignes de tableaux détectés à l'ingestion sont aussi des fragments — visibles ici et regroupés par tableau dans l'onglet <span className="font-medium text-foreground/80">Tableaux structurés</span>.
          </p>
        </div>

        {/* Stat cards — above both tabs, includes tabular fragments */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 py-5">
          {QUALITY_CARDS.map(
            ({ value, sublabel, icon: Icon, iconColor, activeClass, countColor }) => {
              const count =
                value === 'all'
                  ? Object.values(stats?.by_status ?? {}).reduce(
                      (sum: number, n: number) => sum + n,
                      0,
                    )
                  : (stats?.by_status[value] ?? 0);
              const isActive = view === 'fragments' && filters.quality === value;
              return (
                <button
                  key={value}
                  onClick={() => {
                    if (view !== 'fragments') setView('fragments');
                    updateFilters({ quality: value });
                  }}
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

        {/* View switcher tabs */}
        <div className="flex gap-0 border-b -mb-px">
          <button
            onClick={() => setView('fragments')}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
              view === 'fragments'
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/50',
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Fragments
          </button>
          <button
            onClick={() => setView('tableaux')}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
              view === 'tableaux'
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/50',
            )}
          >
            <Table2 className="h-3.5 w-3.5" />
            Tableaux structurés
          </button>
        </div>
      </div>

      {view === 'tableaux' ? (
        <div className="px-8 py-6">
          <CollectionsView />
        </div>
      ) : (
      <>
      <div className="px-8 py-6 space-y-6">
        {/* Toolbar: search + domain + type + origin + lang + sort */}
        <FragmentsToolbar filters={filters} onFiltersChange={updateFilters} />

        {/* Bulk actions (shown when items are selected) */}
        {selectedIds.size > 0 && (
          <FragmentsBulkActions
            selectedIds={Array.from(selectedIds)}
            onComplete={onBulkComplete}
            onCancel={() => setSelectedIds(new Set())}
            showApprove={filters.quality === 'reviewed'}
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
                checked={someSelected}
                ref={(el) => {
                  if (el) el.indeterminate = selectAllLoading;
                }}
                onChange={() => {
                  if (someSelected) {
                    setSelectedIds(new Set());
                  } else {
                    handleSelectAllPages();
                  }
                }}
                aria-label="Tout sélectionner"
              />
              <span>
                {selectAllLoading
                  ? 'Sélection en cours…'
                  : selectedIds.size > 0
                    ? `${selectedIds.size} sélectionné${selectedIds.size > 1 ? 's' : ''}`
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
      </>
      )}
    </div>
  );
}
