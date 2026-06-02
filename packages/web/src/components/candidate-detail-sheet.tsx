import { Link } from 'react-router-dom';
import { FragmentMetaEditor, type MetaEdits } from '@/components/fragment-meta-editor';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useEffect, useRef, useState } from 'react';
import {
  Check,
  X,
  AlertTriangle,
  Save,
  CheckCircle2,
  XCircle,
  Info,
  Wand2,
  RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { tagDisplayLabel } from '@/lib/tag-display';
import type { HarvestCandidate, SuggestedMetadata } from '@/api/types';

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
  availableTags?: string[];
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
  availableTags,
  onEditsChange,
  onAccept,
  onReject,
  onClose,
}: Props) {
  const { t } = useI18n();
  const appliedSuggestionsRef = useRef<SuggestedMetadata | null>(null);

  // Auto-apply LLM suggestions when a new candidate opens
  useEffect(() => {
    if (!candidate?.judge_result?.suggested_metadata) return;
    const s = candidate.judge_result.suggested_metadata;
    appliedSuggestionsRef.current = s;
    onEditsChange({
      ...edits,
      ...(s.type && { type: s.type }),
      ...(s.domain && { domain: s.domain }),
      ...(s.tags && { tags: s.tags }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate?.id]);

  if (!candidate) return null;

  const current = { ...candidate, ...edits };
  const appliedSuggestions = appliedSuggestionsRef.current;

  const confidenceColor =
    candidate.confidence >= 0.8
      ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
      : candidate.confidence >= 0.65
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
        : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';

  return (
    <Sheet open={!!candidate} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="w-[480px] sm:max-w-lg overflow-y-auto flex flex-col gap-4"
      >
        <SheetHeader>
          <SheetTitle>{candidate.title}</SheetTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={cn('text-xs', confidenceColor)}>
              {Math.round(candidate.confidence * 100)}%
            </Badge>
            <span className="text-xs text-muted-foreground">
              Confiance LLM sur la classification —{' '}
              {candidate.confidence >= 0.95
                ? 'très élevée (métadonnées sans ambiguïté)'
                : candidate.confidence >= 0.8
                  ? 'élevée (légère incertitude sur un champ)'
                  : candidate.confidence >= 0.65
                    ? 'modérée (vérifier type / domaine)'
                    : 'faible (métadonnées à revoir)'}
            </span>
          </div>
        </SheetHeader>

        {candidate.duplicate_of && (() => {
          const score = candidate.duplicate_score ?? 0;
          const pct = Math.round(score * 100);
          const level = score >= 0.95 ? 'exact' : score >= 0.8 ? 'high' : 'moderate';
          const config = {
            exact: {
              label: 'Doublon quasi-exact',
              bannerCn: 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200',
              icon: <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />,
            },
            high: {
              label: 'Forte similarité',
              bannerCn: 'border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200',
              icon: <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />,
            },
            moderate: {
              label: 'Proche de',
              bannerCn: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
              icon: <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />,
            },
          }[level];
          return (
            <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${config.bannerCn}`}>
              {config.icon}
              <span>
                <strong>{config.label}</strong>
                {' — '}
                <strong>{pct}%</strong>
                {candidate.duplicate_method && (
                  <span className="opacity-70"> ({candidate.duplicate_method})</span>
                )}
                {' avec '}
                <a
                  href={`/ui/fragments?fragment=${candidate.duplicate_of}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs underline underline-offset-2 hover:opacity-70"
                  onClick={(e) => e.stopPropagation()}
                >
                  {candidate.duplicate_of.slice(0, 8)}…
                </a>
              </span>
            </div>
          );
        })()}

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
          availableTags={availableTags}
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

        {candidate.quality_signals && candidate.quality_signals.filter((s) => s.type !== 'duplicate_check').length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t('harvest', 'qualitySignals')}
            </p>
            {candidate.quality_signals.filter((s) => s.type !== 'duplicate_check').map((s) => (
              <div
                key={s.type}
                className={cn(
                  'flex items-start gap-2 text-xs rounded px-2 py-1',
                  s.level === 'ok' &&
                    'text-green-700 bg-green-50 dark:text-green-300 dark:bg-green-950/30',
                  s.level === 'warning' &&
                    'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/30',
                  s.level === 'error' &&
                    'text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-950/30',
                  s.level === 'info' && 'text-muted-foreground bg-muted/40',
                )}
              >
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
              {t('harvest', 'llmJudge')}
            </p>
            <div
              className={cn(
                'text-xs rounded px-3 py-2 font-medium',
                candidate.judge_result.overall_recommendation === 'accept' &&
                  'bg-green-50 text-green-800 dark:bg-green-950/30',
                candidate.judge_result.overall_recommendation === 'review' &&
                  'bg-amber-50 text-amber-800 dark:bg-amber-950/30',
                candidate.judge_result.overall_recommendation === 'reject' &&
                  'bg-red-50 text-red-800 dark:bg-red-950/30',
              )}
            >
              {candidate.judge_result.overall_recommendation.toUpperCase()} —{' '}
              {candidate.judge_result.overall_reason}
            </div>
            {(['reusability', 'semantic_coherence', 'classification_accuracy'] as const).map(
              (dim) => {
                const v = candidate.judge_result![dim];
                return (
                  <div key={dim} className="text-xs text-muted-foreground">
                    <span className="font-medium capitalize">{dim.replace(/_/g, ' ')}</span>{' '}
                    <span
                      className={cn(
                        v.verdict === 'pass' && 'text-green-700',
                        v.verdict === 'partial' && 'text-amber-700',
                        v.verdict === 'fail' && 'text-red-700',
                      )}
                    >
                      [{v.verdict}]
                    </span>{' '}
                    {v.reason}
                  </div>
                );
              },
            )}

            {appliedSuggestions && (
              <div className="mt-2 rounded border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 px-3 py-2 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-blue-800 dark:text-blue-200 flex items-center gap-1">
                    <Wand2 className="h-3 w-3" />
                    {t('harvest', 'llmApplied')}
                  </p>
                  <button
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5"
                    onClick={() => {
                      appliedSuggestionsRef.current = null;
                      onEditsChange({
                        ...edits,
                        type: candidate.type,
                        domain: candidate.domain,
                        tags: candidate.tags,
                      });
                    }}
                  >
                    <RotateCcw className="h-2.5 w-2.5" />
                    {t('harvest', 'revertSuggestions')}
                  </button>
                </div>
                <p className="text-xs text-blue-700 dark:text-blue-300 italic">
                  {appliedSuggestions.reason}
                </p>
                <div className="flex flex-wrap gap-1">
                  {appliedSuggestions.type && (
                    <Badge
                      variant="outline"
                      className="text-xs border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300"
                    >
                      {t('harvest', 'suggestedType')}: {appliedSuggestions.type}
                    </Badge>
                  )}
                  {appliedSuggestions.domain && (
                    <Badge
                      variant="outline"
                      className="text-xs border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300"
                    >
                      {t('harvest', 'suggestedDomain')}: {appliedSuggestions.domain}
                    </Badge>
                  )}
                  {(appliedSuggestions.tags ?? []).map((tag) => (
                    <Badge
                      key={tag}
                      variant="outline"
                      className="text-xs border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300"
                    >
                      #{tagDisplayLabel(tag)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
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
