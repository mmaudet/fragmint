import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useMetadataProposals } from '@/api/hooks/use-metadata-proposals';
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
  search: string;
  selectedIds: Set<string | number>;
  onToggle: (id: string | number) => void;
  countsByType?: Record<EntityType, number>;
}

export function ProposalsList({ kind, search, selectedIds, onToggle, countsByType }: Props) {
  const [entityType, setEntityType] = useState<EntityType | undefined>(undefined);
  const [trustFilter, setTrustFilter] = useState<TrustSource | 'all'>('all');
  const { data, isLoading } = useMetadataProposals({
    kind,
    entity_type: kind === 'entity' ? entityType : undefined,
    search: search || undefined,
    trust_source: trustFilter !== 'all' ? trustFilter : undefined,
  });

  return (
    <div>
      {kind === 'entity' && (
        <div className="flex gap-1 mb-4 flex-wrap">
          <Button
            variant={entityType === undefined ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setEntityType(undefined)}
            className="text-xs"
          >
            All
          </Button>
          {ENTITY_TYPES.map((t) => (
            <Button
              key={t}
              variant={entityType === t ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setEntityType(t)}
              className="text-xs capitalize"
            >
              {t}s <span className="ml-1.5 opacity-70">({countsByType?.[t] ?? 0})</span>
            </Button>
          ))}
        </div>
      )}
      <div className="flex gap-1 mb-3">
        {([
          ['all', 'All'],
          ['llm-deviation', '⚠ Deviations'],
          ['llm-inferred', 'Inferred'],
          ['llm-confirmed', '✓ Confirmed'],
        ] as [TrustSource | 'all', string][]).map(([val, label]) => (
          <Button
            key={val}
            variant={trustFilter === val ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setTrustFilter(val)}
            className="text-xs"
          >
            {label}
          </Button>
        ))}
      </div>
      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : data?.proposals.length === 0 ? (
        <p className="text-center py-8 text-sm text-muted-foreground">
          No pending {kind} proposals.
        </p>
      ) : (
        <div className="space-y-3">
          {data?.proposals.map((p) => (
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
