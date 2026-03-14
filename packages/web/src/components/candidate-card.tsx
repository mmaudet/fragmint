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
}

function confidenceColor(confidence: number) {
  if (confidence >= 0.8) return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
  if (confidence >= 0.65) return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200';
  return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
}

export function CandidateCard({ candidate, decision, onAccept, onReject }: CandidateCardProps) {
  const { t } = useI18n();

  return (
    <Card
      className={cn(
        'transition-colors',
        decision === 'accepted' && 'bg-green-50 dark:bg-green-950/30',
        decision === 'rejected' && 'opacity-50',
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-bold text-sm leading-tight">{candidate.title}</h3>
          <Badge className={cn('text-xs shrink-0', confidenceColor(candidate.confidence))}>
            {Math.round(candidate.confidence * 100)}%
          </Badge>
        </div>
        <div className="flex flex-wrap gap-1 mt-1">
          <Badge variant="outline" className="text-xs">{candidate.type}</Badge>
          <Badge variant="outline" className="text-xs">{candidate.lang}</Badge>
          {candidate.domain && (
            <Badge variant="outline" className="text-xs">{candidate.domain}</Badge>
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
            <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={onAccept}>
              <Check className="h-3 w-3 mr-1" />
              {t('harvest', 'accept')}
            </Button>
            <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={onReject}>
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
              onClick={onAccept}
            >
              <Check className="h-3 w-3 mr-1" />
              {t('harvest', 'accept')}
            </Button>
            <Button
              size="sm"
              variant={decision === 'rejected' ? 'destructive' : 'outline'}
              className="flex-1 text-xs"
              onClick={onReject}
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
