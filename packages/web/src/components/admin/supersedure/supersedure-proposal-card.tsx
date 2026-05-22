import { Check, Eye, GitMerge, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/lib/i18n';
import {
  useConfirmProposal,
  useCoexistProposal,
  useRejectProposal,
} from '@/api/hooks/use-supersedure-proposals';
import type { SupersedureProposal } from '@/types/admin-supersedure';

interface Props {
  proposal: SupersedureProposal;
  onViewDiff: () => void;
}

function confidenceVariant(c: number): 'default' | 'warning' | 'destructive' {
  if (c >= 0.85) return 'default';
  if (c >= 0.65) return 'warning';
  return 'destructive';
}

export function SupersedureProposalCard({ proposal, onViewDiff }: Props) {
  const { t } = useI18n();
  const confirm = useConfirmProposal();
  const coexist = useCoexistProposal();
  const reject = useRejectProposal();

  const isPending = confirm.isPending || coexist.isPending || reject.isPending;
  const isResolved = proposal.status !== 'pending';

  const newTitle =
    proposal.new_fragment?.title?.slice(0, 60) ??
    proposal.new_fragment?.body_excerpt?.slice(0, 60) ??
    proposal.new_fragment_id;
  const oldTitle =
    proposal.old_fragment?.title?.slice(0, 60) ??
    proposal.old_fragment?.body_excerpt?.slice(0, 60) ??
    proposal.old_fragment_id;

  return (
    <Card className="p-4">
      {/* Fragment pair */}
      <div className="flex items-start gap-2 mb-3 min-w-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-sm min-w-0">
            <span className="font-medium truncate">{newTitle}</span>
            <span className="text-muted-foreground shrink-0">→</span>
            <span className="text-muted-foreground truncate">{oldTitle}</span>
          </div>
          {proposal.llm_reasoning && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-1 italic">
              {proposal.llm_reasoning}
            </p>
          )}
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
          {proposal.created_at ? new Date(proposal.created_at).toLocaleDateString() : ''}
        </span>
      </div>

      {/* Badges row */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <Badge variant={confidenceVariant(proposal.llm_confidence)} className="text-xs">
          {t('supersedure', 'confidence')}: {(proposal.llm_confidence * 100).toFixed(0)}%
        </Badge>
        <Badge variant="outline" className="text-xs">
          {t('supersedure', 'similarity')}: {(proposal.similarity_score * 100).toFixed(0)}%
        </Badge>
        {proposal.new_fragment?.domain && (
          <Badge variant="secondary" className="text-xs">
            {proposal.new_fragment.domain}
          </Badge>
        )}
        {isResolved && (
          <Badge
            variant={
              proposal.status === 'confirmed'
                ? 'default'
                : proposal.status === 'coexist'
                  ? 'info'
                  : 'destructive'
            }
            className="text-xs capitalize"
          >
            {proposal.status}
          </Badge>
        )}
      </div>

      {/* Actions */}
      {!isResolved && (
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={onViewDiff}>
            <Eye className="h-3.5 w-3.5 mr-1.5" />
            {t('supersedure', 'viewDiff')}
          </Button>
          <Button size="sm" onClick={() => confirm.mutate(proposal.id)} disabled={isPending}>
            <Check className="h-3.5 w-3.5 mr-1.5" />
            {t('supersedure', 'confirm')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => coexist.mutate(proposal.id)}
            disabled={isPending}
          >
            <GitMerge className="h-3.5 w-3.5 mr-1.5" />
            {t('supersedure', 'coexist')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => reject.mutate(proposal.id)}
            disabled={isPending}
            className="text-destructive hover:text-destructive"
          >
            <X className="h-3.5 w-3.5 mr-1.5" />
            {t('supersedure', 'reject')}
          </Button>
        </div>
      )}
    </Card>
  );
}
