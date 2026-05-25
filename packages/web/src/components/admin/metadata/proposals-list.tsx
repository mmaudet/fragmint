import { useState, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useMetadataProposals } from '@/api/hooks/use-metadata-proposals';
import { useI18n } from '@/lib/i18n';
import { ProposalCard } from './proposal-card';
import type { ProposalKind, EntityType } from '@/types/admin-metadata';
import type { TrustSource } from '@/types/trust-source';

const ENTITY_TYPES: EntityType[] = [
  'client',
  'product',
  'technology',
  'partner',
  'certification',
  'regulation',
  'metric',
];

interface Props {
  kind: ProposalKind;
  selectedIds: Set<string | number>;
  onToggle: (id: string | number) => void;
  onAvailableIds?: (ids: Array<string | number>) => void;
  countsByType?: Record<EntityType, number>;
}

export function ProposalsList({ kind, selectedIds, onToggle, onAvailableIds, countsByType }: Props) {
  const [search, setSearch] = useState('');
  const [authorFilter, setAuthorFilter] = useState('');
  const [entityType, setEntityType] = useState<EntityType | undefined>(undefined);
  const [trustFilter, setTrustFilter] = useState<TrustSource | 'all'>('all');
  const [sortBy, setSortBy] = useState<'date' | 'usage' | 'name'>('date');
  const { t } = useI18n();

  const { data, isLoading } = useMetadataProposals({
    kind,
    entity_type: kind === 'entity' ? entityType : undefined,
    search: search || undefined,
    trust_source: trustFilter !== 'all' ? trustFilter : undefined,
    sort: sortBy,
  });

  const allProposals = data?.proposals ?? [];

  const uniqueAuthors = useMemo(() => {
    const names = new Set(allProposals.map((p) => p.proposed_by_display ?? p.proposed_by).filter(Boolean));
    return [...names] as string[];
  }, [allProposals]);

  const visibleProposals = useMemo(() => {
    if (!authorFilter.trim()) return allProposals;
    const q = authorFilter.toLowerCase();
    return allProposals.filter((p) =>
      (p.proposed_by_display ?? p.proposed_by ?? '').toLowerCase().includes(q),
    );
  }, [allProposals, authorFilter]);

  useEffect(() => {
    onAvailableIds?.(visibleProposals.map((p) => p.id));
  }, [visibleProposals, onAvailableIds]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input
          type="text"
          placeholder={t('admin', 'filterSearch')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 border rounded-md text-sm bg-background"
        />
        <input
          type="text"
          placeholder={t('admin', 'filterAuthor')}
          value={authorFilter}
          onChange={(e) => setAuthorFilter(e.target.value)}
          list={`authors-${kind}`}
          className="px-3 py-1.5 border rounded-md text-sm bg-background"
        />
        <datalist id={`authors-${kind}`}>
          {uniqueAuthors.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <select
          value={trustFilter}
          onChange={(e) => setTrustFilter(e.target.value as TrustSource | 'all')}
          className="px-3 py-1.5 border rounded-md text-sm bg-background"
        >
          <option value="all">{t('admin', 'filterAll')}</option>
          <option value="human-direct">{t('admin', 'trustHuman')}</option>
          <option value="llm-confirmed">{t('admin', 'trustLlmConfirmed')}</option>
          <option value="llm-inferred">{t('admin', 'trustLlmInferred')}</option>
          <option value="llm-deviation">{t('admin', 'trustLlmDeviation')}</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="px-3 py-1.5 border rounded-md text-sm bg-background"
        >
          <option value="date">{t('admin', 'sortDate')}</option>
          <option value="name">{t('admin', 'sortName')}</option>
          <option value="usage">{t('admin', 'sortUsage')}</option>
        </select>
      </div>

      {kind === 'entity' && (
        <div className="flex gap-1 mb-3 flex-wrap">
          <Button
            variant={entityType === undefined ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setEntityType(undefined)}
            className="text-xs"
          >
            {t('admin', 'filterAll')}
          </Button>
          {ENTITY_TYPES.map((et) => (
            <Button
              key={et}
              variant={entityType === et ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setEntityType(et)}
              className="text-xs capitalize"
            >
              {et}s <span className="ml-1.5 opacity-70">({countsByType?.[et] ?? 0})</span>
            </Button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : visibleProposals.length === 0 ? (
        <p className="text-center py-8 text-sm text-muted-foreground">
          {t('admin', 'noProposals')}
        </p>
      ) : (
        <div className="space-y-3">
          {visibleProposals.map((p) => (
            <ProposalCard
              key={`${p.kind}-${p.id}`}
              proposal={p}
              selected={selectedIds.has(p.id)}
              onToggle={() => onToggle(p.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
