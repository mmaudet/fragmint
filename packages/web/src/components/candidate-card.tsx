import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { Check, X, AlertTriangle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HarvestCandidate } from '@/api/types';
import { PayloadEditor } from '@/components/payload-editor';

function getSimilarityLevel(
  score: number | null | undefined,
): 'exact' | 'high' | 'moderate' | null {
  if (score == null) return null;
  if (score >= 0.95) return 'exact';
  if (score >= 0.8) return 'high';
  if (score >= 0.7) return 'moderate';
  return null;
}

const SIMILARITY_BADGE: Record<
  'exact' | 'high' | 'moderate',
  { label: string; className: string }
> = {
  exact: {
    label: 'Doublon',
    className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  },
  high: {
    label: 'Forte sim.',
    className: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  },
  moderate: {
    label: 'Proche de',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  },
};

interface CandidateCardProps {
  candidate: HarvestCandidate;
  decision?: 'accepted' | 'rejected';
  onAccept: () => void;
  onReject: () => void;
  onClick?: () => void;
}

export function CandidateCard({
  candidate,
  decision,
  onAccept,
  onReject,
  onClick,
}: CandidateCardProps) {
  const { t } = useI18n();
  const simLevel = getSimilarityLevel(candidate.duplicate_score);
  const pct =
    candidate.duplicate_score != null ? Math.round(candidate.duplicate_score * 100) : null;

  const methodLabel =
    candidate.duplicate_method === 'hash'
      ? 'hash exact'
      : candidate.duplicate_method === 'shingles'
        ? `Jaccard shingles (${pct}%)`
        : candidate.duplicate_method === 'cosine'
          ? `similarité sémantique (${pct}%)`
          : pct != null
            ? `similarité ${pct}%`
            : null;

  const tooltip =
    simLevel && candidate.duplicate_of && pct != null
      ? simLevel === 'exact'
        ? `Doublon quasi-exact de ${candidate.duplicate_of}${methodLabel ? ` — ${methodLabel}` : ''}`
        : simLevel === 'high'
          ? `Forte similarité avec ${candidate.duplicate_of}${methodLabel ? ` — ${methodLabel}` : ''}`
          : `Similarité modérée avec ${candidate.duplicate_of}${methodLabel ? ` — ${methodLabel}` : ''}`
      : undefined;

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
          {simLevel ? (
            <Badge
              className={cn('text-xs shrink-0', SIMILARITY_BADGE[simLevel].className)}
            >
              {SIMILARITY_BADGE[simLevel].label}{pct != null ? ` ${pct}%` : ''}
            </Badge>
          ) : (
            <Badge
              className={cn(
                'text-xs shrink-0',
                candidate.confidence >= 0.8
                  ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                  : candidate.confidence >= 0.65
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
                    : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
              )}
              title="Confiance LLM : auto-évaluation de la classification (type, domaine, tags, entités)"
            >
              {Math.round(candidate.confidence * 100)}%
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-1 mt-1">
          <Badge
            variant="outline"
            className="text-xs border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
          >
            {candidate.type}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {candidate.lang}
          </Badge>
          {candidate.domain && candidate.domain !== candidate.type && (
            <Badge
              variant="outline"
              className="text-xs border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300"
            >
              {candidate.domain}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {candidate.source_section && (
          <span className="text-xs text-muted-foreground truncate block max-w-full">
            📄 {candidate.source_section}
          </span>
        )}
        {/^\|.+\|/.test(candidate.body?.split('\n')[0] ?? '') ? (
          <p className="text-xs text-muted-foreground italic">📊 Tableau structuré ({candidate.payload_schema ?? 'données'})</p>
        ) : (
          <p className="text-xs text-muted-foreground line-clamp-3">{candidate.body}</p>
        )}

        {candidate.payload_schema && candidate.payload && (() => {
          let parsed: Record<string, unknown> = {};
          try { parsed = JSON.parse(candidate.payload); } catch { /* ignore */ }
          return (
            <div className="space-y-1 pt-1 border-t">
              <p className="text-xs text-muted-foreground font-medium">
                Données structurées{' '}
                <span className="bg-muted px-1.5 py-0.5 rounded text-xs">{candidate.payload_schema}</span>
              </p>
              <PayloadEditor
                schemaId={candidate.payload_schema}
                value={parsed}
                onChange={() => {}}
                disabled={true}
              />
            </div>
          );
        })()}

        {simLevel && candidate.duplicate_of && pct != null && (
          <div
            className={cn(
              'flex items-center gap-1 text-xs',
              simLevel === 'exact'
                ? 'text-red-600 dark:text-red-400'
                : simLevel === 'high'
                  ? 'text-orange-600 dark:text-orange-400'
                  : 'text-blue-600 dark:text-blue-400',
            )}
          >
            {simLevel === 'moderate' ? (
              <Info className="h-3 w-3 shrink-0" />
            ) : (
              <AlertTriangle className="h-3 w-3 shrink-0" />
            )}
            <span className="truncate">
              {simLevel === 'exact' ? 'Doublon quasi-exact' : simLevel === 'high' ? 'Forte similarité' : 'Proche de'}
              {' — '}<strong>{pct}%</strong>
              {candidate.duplicate_method && <span className="opacity-70"> ({candidate.duplicate_method})</span>}
              {' avec '}
              <a
                href={`/ui/fragments?fragment=${candidate.duplicate_of}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono underline underline-offset-2 hover:opacity-80"
                onClick={(e) => e.stopPropagation()}
              >
                {candidate.duplicate_of.slice(0, 8)}…
              </a>
            </span>
          </div>
        )}

        {(candidate.quality_signals ?? [])
          .filter(
            (s) => s.type !== 'duplicate_check' && (s.level === 'warning' || s.level === 'error'),
          )
          .map((s) => (
            <div
              key={s.type}
              className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"
            >
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span className="truncate">{s.message}</span>
            </div>
          ))}

        {candidate.status === 'pending' && !decision && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onAccept();
              }}
            >
              <Check className="h-3 w-3 mr-1" />
              {t('harvest', 'accept')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onReject();
              }}
            >
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
              onClick={(e) => {
                e.stopPropagation();
                onAccept();
              }}
            >
              <Check className="h-3 w-3 mr-1" />
              {t('harvest', 'accept')}
            </Button>
            <Button
              size="sm"
              variant={decision === 'rejected' ? 'destructive' : 'outline'}
              className="flex-1 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onReject();
              }}
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
