import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useSupersedureProposals } from '@/api/hooks/use-supersedure-proposals';
import { useI18n } from '@/lib/i18n';
import type { SupersedureProposal } from '@/types/admin-supersedure';
import { SupersedureProposalCard } from './supersedure-proposal-card';
import { SupersedureDiffSheet } from './supersedure-diff-sheet';

interface Props {
  status: string;
}

export function SupersedureProposalList({ status }: Props) {
  const { t } = useI18n();
  const { data, isLoading } = useSupersedureProposals(status);
  const [diffProposal, setDiffProposal] = useState<SupersedureProposal | null>(null);

  const proposals = data ?? [];

  return (
    <>
      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : proposals.length === 0 ? (
        <p className="text-center py-8 text-sm text-muted-foreground">
          {t('supersedure', 'empty')}
        </p>
      ) : (
        <div className="space-y-3">
          {proposals.map((p) => (
            <SupersedureProposalCard
              key={p.id}
              proposal={p}
              onViewDiff={() => setDiffProposal(p)}
            />
          ))}
        </div>
      )}

      <SupersedureDiffSheet
        proposal={diffProposal}
        open={diffProposal !== null}
        onOpenChange={(open) => {
          if (!open) setDiffProposal(null);
        }}
      />
    </>
  );
}
