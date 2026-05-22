import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Check, X, Edit, Combine, ArrowRight, AlertTriangle, Info } from 'lucide-react';
import { useApproveProposal, useRejectProposal } from '@/api/hooks/use-metadata-proposals';
import { RenameDialog } from './rename-dialog';
import { MergeDialog } from './merge-dialog';
import { ConvertToEntityDialog } from './convert-to-entity-dialog';
import type { MetadataProposal } from '@/types/admin-metadata';
import type { TrustSource } from '@/types/trust-source';

interface Props {
  proposal: MetadataProposal;
  selected: boolean;
  onToggle: () => void;
}

export function ProposalCard({ proposal, selected, onToggle }: Props) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const approve = useApproveProposal();
  const reject = useRejectProposal();

  return (
    <Card className="p-4">
      <div className="flex gap-3">
        <Checkbox checked={selected} onCheckedChange={onToggle} className="mt-1" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <code className="text-sm font-medium px-1.5 py-0.5 bg-muted rounded">
              {proposal.name}
            </code>
            <Badge variant="secondary">
              {proposal.entity_type && <span className="mr-1">{proposal.entity_type}</span>}·{' '}
              {proposal.usage_count} fragments
            </Badge>
            <TrustSourceBadge source={proposal.trust_source} />
            {proposal.flags.map((flag, i) => (
              <Badge
                key={i}
                variant={flag.type === 'warning' ? 'destructive' : 'info'}
                className="text-xs"
              >
                {flag.type === 'warning' ? (
                  <AlertTriangle className="h-3 w-3 mr-1" />
                ) : (
                  <Info className="h-3 w-3 mr-1" />
                )}
                {flag.label}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            Proposed by {proposal.proposed_by} ·{' '}
            {new Date(proposal.created_at).toLocaleDateString()}
          </p>
          {proposal.preview && (
            <p className="text-sm text-muted-foreground italic mb-3 line-clamp-2">
              "{proposal.preview}"
            </p>
          )}
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              onClick={() => approve.mutate({ id: proposal.id, kind: proposal.kind })}
              disabled={approve.isPending}
            >
              <Check className="h-3.5 w-3.5 mr-1.5" />
              Approve
            </Button>
            {proposal.flags.some((f) => f.label === 'Possibly entity') &&
              proposal.kind === 'tag' && (
                <Button size="sm" variant="outline" onClick={() => setConvertOpen(true)}>
                  <ArrowRight className="h-3.5 w-3.5 mr-1.5" />
                  Convert to entity
                </Button>
              )}
            <Button size="sm" variant="outline" onClick={() => setRenameOpen(true)}>
              <Edit className="h-3.5 w-3.5 mr-1.5" />
              Rename
            </Button>
            <Button size="sm" variant="outline" onClick={() => setMergeOpen(true)}>
              <Combine className="h-3.5 w-3.5 mr-1.5" />
              Merge
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => reject.mutate({ id: proposal.id, kind: proposal.kind })}
              disabled={reject.isPending}
              className="text-destructive hover:text-destructive"
            >
              <X className="h-3.5 w-3.5 mr-1.5" />
              Reject
            </Button>
          </div>
        </div>
      </div>
      {renameOpen && <RenameDialog proposal={proposal} open onOpenChange={setRenameOpen} />}
      {mergeOpen && <MergeDialog proposal={proposal} open onOpenChange={setMergeOpen} />}
      {convertOpen && (
        <ConvertToEntityDialog proposal={proposal} open onOpenChange={setConvertOpen} />
      )}
    </Card>
  );
}

function TrustSourceBadge({ source }: { source?: TrustSource }) {
  if (!source || source === 'human-direct') return null;

  const config: Record<Exclude<TrustSource, 'human-direct'>, { label: string; className: string }> = {
    'llm-confirmed': { label: '✓ LLM confirmed', className: 'bg-green-100 text-green-800' },
    'llm-deviation': { label: '⚠ LLM deviation', className: 'bg-amber-100 text-amber-800' },
    'llm-inferred': { label: 'LLM inferred', className: 'bg-blue-100 text-blue-800' },
  };

  const c = config[source];
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${c.className}`}>
      {c.label}
    </span>
  );
}
