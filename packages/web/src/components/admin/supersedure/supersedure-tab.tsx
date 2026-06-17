import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSupersedureStats } from '@/api/hooks/use-supersedure-proposals';
import { useI18n } from '@/lib/i18n';
import { SupersedureProposalList } from './supersedure-proposal-list';

const STATUS_FILTERS = ['pending', 'confirmed', 'rejected', 'coexist'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export function SupersedureTab() {
  const { t } = useI18n();
  const { data: stats } = useSupersedureStats();
  const [status, setStatus] = useState<StatusFilter>('pending');

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-medium">{t('supersedure', 'title')}</h2>
        <div className="flex gap-1.5 flex-wrap">
          {stats && (
            <>
              <Badge variant="destructive" className="text-xs">
                {stats.pending} pending
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {stats.total} total
              </Badge>
            </>
          )}
        </div>
      </div>

      <div className="flex gap-1 mb-4 flex-wrap">
        {STATUS_FILTERS.map((s) => (
          <Button
            key={s}
            variant={status === s ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setStatus(s)}
            className="text-xs capitalize"
          >
            {s}
            {stats && <span className="ml-1.5 opacity-70">({stats[s] ?? 0})</span>}
          </Button>
        ))}
      </div>

      <SupersedureProposalList status={status} />
    </div>
  );
}
