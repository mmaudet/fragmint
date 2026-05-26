import { useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Check, X, Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useBulkAction } from '@/api/hooks/use-metadata-proposals';
import { UnifiedMetadataCard } from './unified-metadata-card';
import type { ProposalKind, UnifiedMetadataItem } from '@/types/admin-metadata';

const PAGE_SIZE_OPTIONS = [50, 100, 200];

const ENTITY_TYPES = ['client', 'product', 'technology', 'partner', 'certification', 'regulation', 'metric'] as const;

const KIND_DESC_KEYS: Record<ProposalKind, string> = {
  tag: 'descKindTag',
  entity: 'descKindEntity',
  domain: 'descKindDomain',
  type: 'descKindType',
};

export function UnifiedMetadataList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[1]);
  const { t } = useI18n();
  const bulkAction = useBulkAction();
  const queryClient = useQueryClient();

  // All filter state lives in the URL.
  const activeKind = (searchParams.get('kind') ?? 'tag') as ProposalKind;
  const statusFilter = searchParams.get('status') ?? 'all';
  const trustFilter = searchParams.get('trust') ?? 'all';
  const search = searchParams.get('search') ?? '';
  const entityType = searchParams.get('category') ?? '';
  const sortBy = (searchParams.get('sort') ?? 'created') as 'usage' | 'name' | 'created';
  const onlySimilar = searchParams.get('similar') === 'true';

  const updateFilters = useCallback(
    (updates: Record<string, string | null>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          Object.entries(updates).forEach(([key, val]) => {
            if (val === null || val === '' || val === 'all' && key !== 'status') {
              next.delete(key);
            } else {
              next.set(key, val);
            }
          });
          return next;
        },
        { replace: true },
      );
      setSelectedIds(new Set());
      setPage(1);
    },
    [setSearchParams],
  );

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['referential', activeKind, statusFilter, trustFilter, search, entityType, sortBy, page, pageSize],
    queryFn: () => {
      const order = sortBy === 'name' ? 'asc' : 'desc';
      const offset = (page - 1) * pageSize;
      const params = new URLSearchParams({ status: statusFilter, search, sort: sortBy, order, limit: String(pageSize), offset: String(offset) });
      if (entityType) params.set('category', entityType);
      if (trustFilter !== 'all') params.set('trust_source', trustFilter);
      return apiRequest<any>('GET', `/v1/admin/referential/${activeKind}?${params}`);
    },
  });

  // Fetch pending counts for all kinds in one parallel batch so every tab badge
  // shows its own real count, independent of which tab is currently active.
  const { data: pendingCounts, refetch: refetchCounts } = useQuery({
    queryKey: ['referential-pending-counts'],
    queryFn: async () => {
      const [tag, entity, domain, type] = await Promise.all([
        apiRequest<any>('GET', '/v1/admin/referential/tag?status=pending&limit=1&offset=0'),
        apiRequest<any>('GET', '/v1/admin/referential/entity?status=pending&limit=1&offset=0'),
        apiRequest<any>('GET', '/v1/admin/referential/domain?status=pending&limit=1&offset=0'),
        apiRequest<any>('GET', '/v1/admin/referential/type?status=pending&limit=1&offset=0'),
      ]);
      return {
        tag:    (tag?.stats?.byStatus?.pending    ?? 0) as number,
        entity: (entity?.stats?.byStatus?.pending ?? 0) as number,
        domain: (domain?.stats?.byStatus?.pending ?? 0) as number,
        type:   (type?.stats?.byStatus?.pending   ?? 0) as number,
      };
    },
    staleTime: 30_000,
  });

  const allItems: UnifiedMetadataItem[] = data?.items ?? [];
  // Client-side filter for "similar only" — flags are already computed in the API response.
  const items = onlySimilar
    ? allItems.filter((i) => (i as any).flags?.some((f: any) => f.label?.toLowerCase().startsWith('similar')))
    : allItems;
  const stats = data?.stats;
  const isPendingView = statusFilter === 'pending';
  const isAllSelected = items.length > 0 && items.every((i) => selectedIds.has(i.id));

  const kinds: Array<{ key: ProposalKind; label: string }> = [
    { key: 'tag', label: t('admin', 'kindTags') },
    { key: 'entity', label: t('admin', 'kindEntities') },
    { key: 'domain', label: t('admin', 'kindDomains') },
    { key: 'type', label: t('admin', 'kindTypes') },
  ];

  const handleBulk = (action: 'approve' | 'reject') => {
    if (selectedIds.size === 0) return;
    bulkAction.mutate(
      { action, items: Array.from(selectedIds).map((id) => ({ id, kind: activeKind })) },
      { onSuccess: () => { setSelectedIds(new Set()); refetch(); refetchCounts(); } },
    );
  };

  return (
    <div className="space-y-4">
      {/* Contextual description + trust source legend */}
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {t('admin', KIND_DESC_KEYS[activeKind] as any)}
        </p>
        <div className="text-xs text-muted-foreground border rounded-md px-3 py-2.5 bg-muted/40 space-y-1">
          <p className="font-medium text-foreground">{t('admin', 'trustLegendTitle')}</p>
          <p><span className="font-medium">{t('admin', 'filterTrustHuman')}</span> — {t('admin', 'trustLegendHuman')}</p>
          <p><span className="font-medium">{t('admin', 'filterTrustLlmInferred')}</span> — {t('admin', 'trustLegendInferred')}</p>
          <p><span className="font-medium">{t('admin', 'filterTrustLlmConfirmed')}</span> — {t('admin', 'trustLegendConfirmed')}</p>
          <p><span className="font-medium">{t('admin', 'filterTrustLlmDeviation')}</span> — {t('admin', 'trustLegendDeviation')}</p>
        </div>
      </div>

      {/* Kind sub-tabs */}
      <div className="flex gap-1 border-b">
        {kinds.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => updateFilters({ kind: key, category: null, similar: null })}
            className={`px-4 py-2 text-sm border-b-2 transition-colors ${
              activeKind === key
                ? 'border-primary text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
            {statusFilter === 'pending' && (
              <span className="ml-1.5 opacity-70">
                ({pendingCounts?.[key] ?? '…'})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            placeholder={t('admin', 'filterSearch')}
            value={search}
            onChange={(e) => updateFilters({ search: e.target.value })}
            className="px-3 py-1.5 border rounded-md text-sm bg-background"
          />
          <select
            value={statusFilter}
            onChange={(e) => updateFilters({ status: e.target.value })}
            className="px-3 py-1.5 border rounded-md text-sm bg-background"
          >
            <option value="pending">{t('admin', 'filterStatusPending')}</option>
            <option value="active">{t('admin', 'filterStatusActive')}</option>
            <option value="all">{t('admin', 'filterStatusAll')}</option>
            <option value="archived">{t('admin', 'filterStatusArchived')}</option>
            <option value="rejected">{t('admin', 'filterStatusRejected')}</option>
          </select>
          {activeKind === 'entity' && (
            <select
              value={entityType}
              onChange={(e) => updateFilters({ category: e.target.value })}
              className="px-3 py-1.5 border rounded-md text-sm bg-background"
            >
              <option value="">{t('admin', 'filterAllEntities')}</option>
              {ENTITY_TYPES.map((et) => <option key={et} value={et}>{et}</option>)}
            </select>
          )}
          <select
            value={trustFilter}
            onChange={(e) => updateFilters({ trust: e.target.value })}
            className="px-3 py-1.5 border rounded-md text-sm bg-background"
          >
            <option value="all">{t('admin', 'filterTrustAll')}</option>
            <option value="human-direct">{t('admin', 'filterTrustHuman')}</option>
            <option value="llm-inferred">{t('admin', 'filterTrustLlmInferred')}</option>
            <option value="llm-confirmed">{t('admin', 'filterTrustLlmConfirmed')}</option>
            <option value="llm-deviation">{t('admin', 'filterTrustLlmDeviation')}</option>
          </select>
          {isPendingView && (
            <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={onlySimilar}
                onChange={(e) => updateFilters({ similar: e.target.checked ? 'true' : null })}
                className="rounded"
              />
              {t('admin', 'filterSimilarOnly')}
            </label>
          )}
          <select
            value={sortBy}
            onChange={(e) => updateFilters({ sort: e.target.value })}
            className="px-3 py-1.5 border rounded-md text-sm bg-background"
          >
            <option value="created">{t('admin', 'sortDate')}</option>
            <option value="name">{t('admin', 'sortName')}</option>
            <option value="usage">{t('admin', 'sortUsage')}</option>
          </select>
        </div>
        {isPendingView && (
          <Button
            variant="outline"
            size="sm"
            disabled={items.length === 0}
            onClick={() => isAllSelected ? setSelectedIds(new Set()) : setSelectedIds(new Set(items.map((i) => i.id)))}
          >
            {isAllSelected ? t('admin', 'deselectAll') : t('admin', 'selectAll')}
          </Button>
        )}
      </div>

      {/* Bulk action bar */}
      {isPendingView && selectedIds.size > 0 && (
        <div className="flex gap-2 items-center px-3 py-2 bg-muted rounded-md">
          <span className="text-sm text-muted-foreground flex-1">
            {selectedIds.size} {t('admin', 'selectedCount')}
          </span>
          <Button variant="outline" size="sm" disabled={bulkAction.isPending} onClick={() => handleBulk('approve')}>
            {bulkAction.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Check className="h-4 w-4 mr-1.5" />}
            {t('admin', 'bulkApprove')}
          </Button>
          <Button variant="outline" size="sm" disabled={bulkAction.isPending} onClick={() => handleBulk('reject')} className="text-destructive hover:text-destructive">
            <X className="h-4 w-4 mr-1.5" />{t('admin', 'bulkReject')}
          </Button>
        </div>
      )}

      {/* Stats */}
      {stats && statusFilter === 'all' && (
        <p className="text-xs text-muted-foreground">
          {stats.byStatus.active} {t('admin', 'statsActive')}
          {stats.byStatus.pending > 0 && <> · <span className="text-amber-600 font-medium">{stats.byStatus.pending} {t('admin', 'statsPending')}</span></>}
          {stats.byStatus.archived > 0 && <> · {stats.byStatus.archived} {t('admin', 'statsArchived')}</>}
          {stats.byStatus.rejected > 0 && <> · {stats.byStatus.rejected} {t('admin', 'statsRejected')}</>}
          {stats.total > PAGE_SIZE_OPTIONS[0] && <> · {stats.total} {t('admin', 'statsResults')}</>}
        </p>
      )}
      {!isLoading && statusFilter !== 'all' && stats && (
        <p className="text-xs text-muted-foreground">
          {onlySimilar
            ? `${items.length} ${t('admin', 'statsResults')}`
            : `${stats.byStatus[statusFilter as keyof typeof stats.byStatus] ?? items.length} ${t('admin', 'statsResults')}`}
        </p>
      )}

      {/* List */}
      {isLoading ? (
        <div className="text-sm text-muted-foreground py-4">{t('common', 'loading')}</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">{t('admin', 'noResults')}</div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <UnifiedMetadataCard
              key={`${activeKind}-${item.id}`}
              item={item}
              kind={activeKind}
              selected={selectedIds.has(item.id)}
              onToggle={isPendingView ? () => {
                const next = new Set(selectedIds);
                next.has(item.id) ? next.delete(item.id) : next.add(item.id);
                setSelectedIds(next);
              } : undefined}
              onRefresh={() => {
                setSelectedIds(new Set());
                refetch();
                queryClient.invalidateQueries({ queryKey: ['referential-pending-counts'] });
              }}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {stats && (() => {
        const total = onlySimilar
          ? items.length
          : statusFilter === 'all'
            ? stats.total
            : (stats.byStatus[statusFilter as keyof typeof stats.byStatus] ?? 0);
        const totalPages = Math.ceil(total / pageSize);
        if (total <= PAGE_SIZE_OPTIONS[0]) return null;
        return (
          <div className="flex items-center justify-between gap-4 pt-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{t('common', 'show')}</span>
              <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); setSelectedIds(new Set()); }}>
                <SelectTrigger className="h-8 w-20 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((s) => (
                    <SelectItem key={s} value={String(s)} className="text-xs">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span>{t('common', 'perPage')}</span>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-3 ml-auto">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                  {t('common', 'previous')}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {t('common', 'page')} {page} / {totalPages}
                </span>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                  {t('common', 'next')}
                </Button>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
