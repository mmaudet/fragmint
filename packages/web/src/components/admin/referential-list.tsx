import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import { useI18n } from '@/lib/i18n';
import { ReferentialItemCard } from './referential-item-card';

type ReferentialType = 'domain' | 'tag' | 'entity' | 'type' | 'function';
type StatusFilter = 'all' | 'pending' | 'active' | 'archived' | 'rejected';

interface Props {
  type: ReferentialType;
}

export function ReferentialList({ type }: Props) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sortBy, setSortBy] = useState<'usage' | 'name' | 'created'>('usage');
  const { t } = useI18n();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['referential', type, statusFilter, search, categoryFilter, sortBy],
    queryFn: async () => {
      const params = new URLSearchParams({
        status: statusFilter,
        search,
        sort: sortBy,
        order: sortBy === 'created' ? 'desc' : 'desc',
      });
      if (categoryFilter) params.set('category', categoryFilter);
      return apiRequest<any>('GET', `/v1/admin/referential/${type}?${params}`);
    },
  });

  if (isLoading)
    return <div className="text-muted-foreground text-sm">{t('common', 'loading')}</div>;

  const items: any[] = data?.items ?? [];
  const stats = data?.stats;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="text"
            placeholder={t('admin', 'filterSearch')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-1.5 border rounded-md text-sm bg-background"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="px-3 py-1.5 border rounded-md text-sm bg-background"
          >
            <option value="all">{t('admin', 'filterStatusAll')}</option>
            <option value="pending">{t('admin', 'filterStatusPending')}</option>
            <option value="active">{t('admin', 'filterStatusActive')}</option>
            <option value="archived">{t('admin', 'filterStatusArchived')}</option>
            <option value="rejected">{t('admin', 'filterStatusRejected')}</option>
          </select>
          {type === 'entity' && (
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-1.5 border rounded-md text-sm bg-background"
            >
              <option value="">{t('admin', 'filterAllEntities')}</option>
              <option value="client">Clients</option>
              <option value="product">Produits</option>
              <option value="technology">Technologies</option>
              <option value="partner">Partenaires</option>
              <option value="certification">Certifications</option>
              <option value="regulation">Régulations</option>
            </select>
          )}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="px-3 py-1.5 border rounded-md text-sm bg-background"
          >
            <option value="created">{t('admin', 'sortDate')}</option>
            <option value="name">{t('admin', 'sortName')}</option>
            <option value="usage">{t('admin', 'sortUsage')}</option>
          </select>
        </div>
        {stats && (
          <div className="text-sm text-muted-foreground">
            {stats.byStatus.active} {t('admin', 'statsActive')}
            {stats.byStatus.pending > 0 && (
              <>
                {' '}
                ·{' '}
                <span className="text-amber-600 font-medium">
                  {stats.byStatus.pending} {t('admin', 'statsPending')}
                </span>
              </>
            )}
            {stats.byStatus.rejected > 0 && (
              <>
                {' '}
                · {stats.byStatus.rejected} {t('admin', 'statsRejected')}
              </>
            )}
            {stats.byStatus.archived > 0 && (
              <>
                {' '}
                · {stats.byStatus.archived} {t('admin', 'statsArchived')}
              </>
            )}
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          {t('admin', 'noResults')}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item: any) => (
            <ReferentialItemCard
              key={`${type}-${item.id}`}
              type={type}
              item={item}
              onChange={() => refetch()}
            />
          ))}
        </div>
      )}
    </div>
  );
}
