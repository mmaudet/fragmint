import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { Check, X, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HarvestCandidate } from '@/api/types';

interface CandidateCardProps {
  candidate: HarvestCandidate;
  decision?: 'accepted' | 'rejected';
  onAccept: () => void;
  onReject: () => void;
  onClick?: () => void;
}

export function CandidateCard({ candidate, decision, onAccept, onReject, onClick }: CandidateCardProps) {
  const { t } = useI18n();

  return (
    <Card
      className={cn(
        'transition-colors',
        decision === 'accepted' && 'bg-green-50 dark:bg-green-950/30',
        decision === 'rejected' && 'opacity-50',
        onClick && 'cursor-pointer hover:shadow-md',
      )}
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-bold text-sm leading-tight">{candidate.title}</h3>
          {candidate.duplicate_of ? (
            <Badge className="text-xs shrink-0 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
              Doublon
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs shrink-0 text-muted-foreground">
              OK
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-1 mt-1">
          <Badge variant="outline" className="text-xs border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
            {candidate.type}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {candidate.lang}
          </Badge>
          {candidate.domain && candidate.domain !== candidate.type && (
            <Badge variant="outline" className="text-xs border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300">
              {candidate.domain}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground line-clamp-3">{candidate.body}</p>

        {candidate.duplicate_of && (
          <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" />
            <span>{t('harvest', 'duplicateWarning')}</span>
            {candidate.duplicate_score != null && (
              <span>({Math.round(candidate.duplicate_score * 100)}%)</span>
            )}
          </div>
        )}

        {candidate.status === 'pending' && !decision && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={(e) => { e.stopPropagation(); onAccept(); }}>
              <Check className="h-3 w-3 mr-1" />
              {t('harvest', 'accept')}
            </Button>
            <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={(e) => { e.stopPropagation(); onReject(); }}>
              <X className="h-3 w-3 mr-1" />
              {t('harvest', 'reject')}
            </Button>
          </div>
        )}

        {decision && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={decision === 'accepted' ? 'default' : 'outline'}
              className="flex-1 text-xs"
              onClick={(e) => { e.stopPropagation(); onAccept(); }}
            >
              <Check className="h-3 w-3 mr-1" />
              {t('harvest', 'accept')}
            </Button>
            <Button
              size="sm"
              variant={decision === 'rejected' ? 'destructive' : 'outline'}
              className="flex-1 text-xs"
              onClick={(e) => { e.stopPropagation(); onReject(); }}
            >
              <X className="h-3 w-3 mr-1" />
              {t('harvest', 'reject')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
