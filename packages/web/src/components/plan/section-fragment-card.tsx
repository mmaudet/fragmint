import { useState } from 'react';
import type { FragmentCandidate, SectionFragmentSelection } from '@/api/types';
import { useFragment } from '@/api/hooks/use-fragments';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Check, Pencil, Trash2, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ScoreBreakdown, type ScoreBreakdownData } from '@/components/score-breakdown';

export function SectionFragmentCard({
  candidate,
  collectionSlug,
  selection,
  onChange,
  onReject,
}: {
  candidate: FragmentCandidate;
  collectionSlug: string;
  selection: SectionFragmentSelection | undefined;
  onChange: (sel: SectionFragmentSelection | null) => void;
  onReject: () => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [editedBody, setEditedBody] = useState<string | null>(null);
  const [propose, setPropose] = useState(selection?.propose_to_library ?? false);

  const { data: fullFragment, isLoading: fragmentLoading } = useFragment(
    collectionSlug,
    editing || expanded ? candidate.fragment_id : null,
  );

  const approved = !!selection;

  const displayBody =
    editedBody ?? fullFragment?.body ?? selection?.body ?? candidate.body_excerpt ?? '';

  // Use vector_score for tier when available — RRF normalized scores compress to 0.91-1.0
  // making all results appear "strong". Raw cosine has better variance.
  // Fallback: candidate.score (covers agentic, vector-only, sqlite modes).
  const scoreForTier = candidate.score_breakdown?.vector_score ?? candidate.score;
  const displayScore = candidate.score_breakdown?.vector_score ?? candidate.score;

  const matchTier: 'strong' | 'medium' | 'weak' | 'unscored' =
    scoreForTier == null
      ? 'unscored'
      : scoreForTier >= 0.7
        ? 'strong'
        : scoreForTier >= 0.55
          ? 'medium'
          : 'weak';
  const matchLabel =
    matchTier === 'strong'
      ? t('planGeneration', 'matchStrong')
      : matchTier === 'medium'
        ? t('planGeneration', 'matchMedium')
        : matchTier === 'unscored'
          ? 'Non scoré'
          : t('planGeneration', 'matchWeak');
  const matchClass =
    matchTier === 'strong'
      ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
      : matchTier === 'medium'
        ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
        : matchTier === 'unscored'
          ? 'bg-muted text-muted-foreground/60'
          : 'bg-muted text-muted-foreground';

  function approve() {
    onChange({
      fragment_id: candidate.fragment_id,
      body: candidate.body_excerpt ?? '',
      edited: false,
      propose_to_library: false,
    });
  }

  function commitEdit() {
    onChange({
      fragment_id: candidate.fragment_id,
      body: displayBody,
      edited: editedBody !== null,
      propose_to_library: propose,
    });
    setEditing(false);
    setEditedBody(null);
  }

  function cancelEdit() {
    setEditing(false);
    setEditedBody(null);
  }

  const cardClass = approved
    ? 'border-emerald-500/50 bg-emerald-500/10'
    : 'border-amber-500/40 bg-amber-500/5';

  return (
    <Card className={cardClass}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm truncate">
            {candidate.title ?? candidate.fragment_id}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">
              {t('quality', candidate.quality as 'draft' | 'reviewed' | 'approved')}
            </Badge>
            {candidate.score_breakdown ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={`text-xs px-2 py-0.5 rounded cursor-help ${matchClass}`}>
                    {matchLabel}
                    {displayScore != null && (
                      <span className="ml-1 opacity-75">· {Math.round(displayScore * 100)}%</span>
                    )}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="left" className="p-0">
                  <ScoreBreakdown
                    breakdown={candidate.score_breakdown as ScoreBreakdownData}
                    score={candidate.score}
                    justification={candidate.justification}
                  />
                </TooltipContent>
              </Tooltip>
            ) : (
              <span
                className={`text-xs px-2 py-0.5 rounded ${matchClass}`}
                title={displayScore != null ? `cosine ${Math.round(displayScore * 100)}%` : 'non scoré'}
              >
                {matchLabel}
                {displayScore != null && (
                  <span className="ml-1 opacity-75">· {Math.round(displayScore * 100)}%</span>
                )}
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {editing ? (
          <>
            {fragmentLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading full content…
              </div>
            ) : (
              <Textarea
                rows={10}
                value={displayBody}
                onChange={(e) => setEditedBody(e.target.value)}
              />
            )}
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={propose}
                onChange={(e) => setPropose(e.target.checked)}
              />
              {t('planGeneration', 'proposeToLibrary')}
            </label>
            <div className="flex gap-2">
              <Button size="sm" onClick={commitEdit}>
                {t('planGeneration', 'approve')}
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelEdit}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            {expanded && fragmentLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Chargement…
              </div>
            ) : (
              <p className={`text-sm whitespace-pre-wrap ${expanded ? '' : 'line-clamp-3'}`}>
                {(selection?.edited ? selection.body : null) ??
                  fullFragment?.body ??
                  selection?.body ??
                  candidate.body_excerpt}
              </p>
            )}
            <button
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3 w-3" /> Show less
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" /> Show more
                </>
              )}
            </button>
            <div className="flex gap-2">
              {!approved && (
                <Button size="sm" onClick={approve}>
                  <Check className="h-4 w-4 mr-1" />
                  {t('planGeneration', 'approve')}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4 mr-1" />
                {t('planGeneration', 'edit')}
              </Button>
              <Button size="sm" variant="ghost" onClick={onReject}>
                <Trash2 className="h-4 w-4 mr-1" />
                {t('planGeneration', 'reject')}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
