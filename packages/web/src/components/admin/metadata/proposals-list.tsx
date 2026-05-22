import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useMetadataProposals } from '@/api/hooks/use-metadata-proposals';
import { ProposalCard } from './proposal-card';
import type { ProposalKind, EntityType } from '@/types/admin-metadata';

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
  const [entityType, setEntityType] = useState<EntityType>('client');
  const { data, isLoading } = useMetadataProposals({
    kind,
    entity_type: kind === 'entity' ? entityType : undefined,
    search: search || undefined,
  });

  return (
    <div>
      {kind === 'entity' && (
        <div className="flex gap-1 mb-4 flex-wrap">
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
