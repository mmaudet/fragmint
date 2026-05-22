import { FragmentMetaEditor, type MetaEdits } from '@/components/fragment-meta-editor';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, X, AlertTriangle, Save, CheckCircle2, XCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import type { HarvestCandidate } from '@/api/types';

export interface CandidateEdits {
  type?: string;
  domain?: string;
  lang?: string;
  tags?: string[];
  body?: string;
}

interface Props {
  candidate: HarvestCandidate | null;
  edits: CandidateEdits;
  decision?: 'accepted' | 'rejected';
  domains: string[];
  types: string[];
  onEditsChange: (edits: CandidateEdits) => void;
  onAccept: () => void;
  onReject: () => void;
  onClose: () => void;
}

export function CandidateDetailSheet({
  candidate,
  edits,
  decision,
  domains,
  types,
  onEditsChange,
  onAccept,
  onReject,
  onClose,
}: Props) {
  const { t } = useI18n();

  if (!candidate) return null;

  const current = { ...candidate, ...edits };

  const confidenceColor =
    candidate.confidence >= 0.8
      ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
      : candidate.confidence >= 0.65
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
        : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';

  return (
    <Sheet open={!!candidate} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-[480px] sm:max-w-lg overflow-y-auto flex flex-col gap-4">
        <SheetHeader>
          <SheetTitle>{candidate.title}</SheetTitle>
          <Badge className={cn('text-xs w-fit', confidenceColor)}>
            {Math.round(candidate.confidence * 100)}%
          </Badge>
        </SheetHeader>

        <FragmentMetaEditor
          edits={{
            type: current.type,
            domain: current.domain,
            lang: current.lang,
            tags: current.tags ?? [],
            body: current.body ?? '',
          }}
          types={types}
          domains={domains}
          onChange={(m: MetaEdits) =>
            onEditsChange({
              ...edits,
              type: m.type,
              domain: m.domain,
              lang: m.lang,
              tags: m.tags,
              body: m.body,
            })
          }
        />

        {candidate.duplicate_of && (
          <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" />
            <span>
              {t('harvest', 'duplicateWarning')} (
              {Math.round((candidate.duplicate_score ?? 0) * 100)}%)
            </span>
          </div>
        )}

        {candidate.quality_signals && candidate.quality_signals.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Signaux qualitatifs</p>
            {candidate.quality_signals.map((s) => (
              <div key={s.type} className={cn(
                'flex items-start gap-2 text-xs rounded px-2 py-1',
                s.level === 'ok' && 'text-green-700 bg-green-50 dark:text-green-300 dark:bg-green-950/30',
                s.level === 'warning' && 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/30',
                s.level === 'error' && 'text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-950/30',
                s.level === 'info' && 'text-muted-foreground bg-muted/40',
              )}>
                {s.level === 'ok' ? (
                  <CheckCircle2 className="h-3 w-3 shrink-0 mt-0.5" />
                ) : s.level === 'warning' ? (
                  <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                ) : s.level === 'error' ? (
                  <XCircle className="h-3 w-3 shrink-0 mt-0.5" />
                ) : (
                  <Info className="h-3 w-3 shrink-0 mt-0.5" />
                )}
                <span>{s.message}</span>
              </div>
            ))}
          </div>
        )}

        {candidate.judge_result && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Évaluation LLM-as-judge
            </p>
            <div className={cn(
              'text-xs rounded px-3 py-2 font-medium',
              candidate.judge_result.overall_recommendation === 'accept' && 'bg-green-50 text-green-800 dark:bg-green-950/30',
              candidate.judge_result.overall_recommendation === 'review' && 'bg-amber-50 text-amber-800 dark:bg-amber-950/30',
              candidate.judge_result.overall_recommendation === 'reject' && 'bg-red-50 text-red-800 dark:bg-red-950/30',
            )}>
              {candidate.judge_result.overall_recommendation.toUpperCase()} — {candidate.judge_result.overall_reason}
            </div>
            {(['reusability', 'semantic_coherence', 'classification_accuracy'] as const).map((dim) => {
              const v = candidate.judge_result![dim];
              return (
                <div key={dim} className="text-xs text-muted-foreground">
                  <span className="font-medium capitalize">{dim.replace(/_/g, ' ')}</span>
                  {' '}
                  <span className={cn(
                    v.verdict === 'pass' && 'text-green-700',
                    v.verdict === 'partial' && 'text-amber-700',
                    v.verdict === 'fail' && 'text-red-700',
                  )}>[{v.verdict}]</span>
                  {' '}{v.reason}
                </div>
              );
            })}
          </div>
        )}

        <Button variant="outline" size="sm" className="w-full" onClick={onClose}>
          <Save className="h-3.5 w-3.5 mr-1" />
          {t('harvest', 'saveEdits')}
        </Button>
        <div className="flex gap-2">
          <Button
            className="flex-1"
            variant={decision === 'accepted' ? 'default' : 'outline'}
            onClick={() => {
              onAccept();
              onClose();
            }}
          >
            <Check className="h-4 w-4 mr-1" />
            {t('harvest', 'accept')}
          </Button>
          <Button
            className="flex-1"
            variant={decision === 'rejected' ? 'destructive' : 'outline'}
            onClick={() => {
              onReject();
              onClose();
            }}
          >
            <X className="h-4 w-4 mr-1" />
            {t('harvest', 'reject')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
