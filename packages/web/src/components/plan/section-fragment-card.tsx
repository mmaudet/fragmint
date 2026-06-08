import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import type { FragmentCandidate, SectionFragmentSelection } from '@/api/types';
import { useFragment } from '@/api/hooks/use-fragments';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Check, Pencil, Trash2, Loader2, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
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
  const [isClamped, setIsClamped] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [editedBody, setEditedBody] = useState<string | null>(null);
  const [propose, setPropose] = useState(selection?.propose_to_library ?? false);

  const { data: fullFragment, isLoading: fragmentLoading } = useFragment(
    collectionSlug,
    editing || expanded ? candidate.fragment_id : null,
  );

  const approved = !!selection;

  const cleanTitle = (candidate.title ?? '').replace(/^[-–]\s+/, '');
  const rawBody = editedBody ?? fullFragment?.body ?? selection?.body ?? candidate.body_excerpt ?? '';
  // Strip title only for the edit textarea, to avoid showing it twice when editing.
  const strippedBody = rawBody.startsWith(cleanTitle) && cleanTitle.length > 0
    ? rawBody.slice(cleanTitle.length).replace(/^\n+/, '')
    : rawBody;
  // Edit textarea uses stripped body.
  const displayBody = strippedBody;
  // Card display: same source hierarchy as before, but fix mid-word truncation on excerpts.
  const cardBody = (() => {
    const fullSrc = (selection?.edited ? selection.body : null) ?? fullFragment?.body ?? selection?.body;
    if (fullSrc) return fullSrc;
    const excerpt = candidate.body_excerpt ?? '';
    const trimmed = excerpt.trimEnd();
    if (!trimmed) return '';
    const last = trimmed.slice(-1);
    if ('.!?,;:)»"\']'.includes(last)) return excerpt;
    const lastSpace = trimmed.lastIndexOf(' ');
    return (lastSpace > 10 ? trimmed.slice(0, lastSpace) : trimmed) + '…';
  })();

  // Show toggle: always if excerpt (full body may have more), or after expand.
  // After full body is loaded, only show "Show less" if it's longer than the excerpt.
  const excerptLen = (candidate.body_excerpt ?? '').length;
  const fullBodyLonger = !!fullFragment?.body && fullFragment.body.length > excerptLen + 20;
  const showToggle = expanded ? fullBodyLonger : (isClamped || cardBody.endsWith('…'));

  useLayoutEffect(() => {
    if (expanded) return;
    const el = contentRef.current;
    if (!el) return;
    setIsClamped(el.scrollHeight > el.clientHeight + 2);
  }, [cardBody, expanded]);

  const displayScore = candidate.score_breakdown?.vector_score ?? candidate.score;

  // confidence_level (LLM judge signal) is the primary badge.
  // Falls back to vector_score tier when no LLM judge ran (vector-only, sqlite).
  const cl = candidate.confidence_level;
  const vectorScore = candidate.score_breakdown?.vector_score;
  const hasConflict = cl === 'low' && vectorScore != null && vectorScore > 0.7;

  const confidenceLabel = cl === 'high'
    ? t('planGeneration', 'confidenceHigh')
    : cl === 'medium'
      ? t('planGeneration', 'confidenceMedium')
      : cl === 'low'
        ? t('planGeneration', 'confidenceLow')
        : cl === 'unknown'
          ? t('planGeneration', 'confidenceUnknown')
          : t('planGeneration', 'matchUnscored');

  const confidenceClass = cl === 'high'
    ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded'
    : cl === 'medium'
      ? 'bg-blue-500/20 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded'
      : cl === 'low'
        ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded'
        : 'text-muted-foreground/40';

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
          <div className="min-w-0 flex-1">
            <CardTitle className="text-sm leading-snug">
              {(candidate.title ?? candidate.fragment_id).replace(/^[-–]\s+/, '')}
            </CardTitle>
            {candidate.type && (
              <span className="text-[11px] text-muted-foreground/70 font-normal">{candidate.type}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {(/^\|.+\|/m.test(candidate.body_excerpt ?? '') || /<table[\s>]/i.test(candidate.body_excerpt ?? '')) && (
              <span className="text-xs px-2 py-0.5 rounded bg-teal-500/15 text-teal-700 dark:text-teal-300">
                📊 Tableau
              </span>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={`text-xs cursor-help ${confidenceClass}`}>
                  {cl === 'unknown' || cl == null
                    ? (displayScore != null && Math.round(displayScore * 100) > 0
                        ? `Cosine · ${Math.round(displayScore * 100)}%`
                        : confidenceLabel)
                    : confidenceLabel}
                </span>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-xs p-2 text-xs">
                {hasConflict ? (
                  <p>{t('planGeneration', 'confidenceConflictTooltip')}</p>
                ) : candidate.score_breakdown ? (
                  <ScoreBreakdown
                    breakdown={candidate.score_breakdown as ScoreBreakdownData}
                    score={candidate.score}
                    justification={candidate.justification}
                  />
                ) : (
                  <p>{displayScore != null ? `cosine ${Math.round(displayScore * 100)}%` : 'non scoré'}</p>
                )}
              </TooltipContent>
            </Tooltip>
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
              <div ref={contentRef} className={`text-sm prose prose-sm max-w-none dark:prose-invert prose-table:text-xs prose-td:p-1 prose-th:p-1 ${expanded ? '' : 'line-clamp-3'}`}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw]}
                  components={{
                    a: ({ href, children }) =>
                      href?.startsWith('#') ? (
                        <span>{children}</span>
                      ) : (
                        <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
                      ),
                  }}
                >
                  {cardBody}
                </ReactMarkdown>
              </div>
            )}
            {showToggle && (
              <button
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? (
                  <><ChevronUp className="h-3 w-3" /> Show less</>
                ) : (
                  <><ChevronDown className="h-3 w-3" /> Show more</>
                )}
              </button>
            )}
            <div className="flex items-center gap-2 flex-wrap">
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
              <Button size="sm" variant="ghost" onClick={onReject} className="text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4 mr-1" />
                {t('planGeneration', 'reject')}
              </Button>
              <a
                href={`/ui/fragments?fragment=${candidate.fragment_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto text-xs text-muted-foreground/60 hover:text-muted-foreground flex items-center gap-1"
              >
                <ExternalLink className="h-3 w-3" />
                Voir le fragment
              </a>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
