import { useState } from 'react';
import type { FragmentCandidate, SectionFragmentSelection } from '@/api/types';
import { useFragment } from '@/api/hooks/use-fragments';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Check, Pencil, Trash2, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

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

  const matchTier: 'strong' | 'medium' | 'weak' =
    candidate.score >= 0.7 ? 'strong' : candidate.score >= 0.55 ? 'medium' : 'weak';
  const matchLabel =
    matchTier === 'strong'
      ? t('planGeneration', 'matchStrong')
      : matchTier === 'medium'
        ? t('planGeneration', 'matchMedium')
        : t('planGeneration', 'matchWeak');
  const matchClass =
    matchTier === 'strong'
      ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
      : matchTier === 'medium'
        ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
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
            <Badge variant="secondary">{candidate.quality}</Badge>
            <span
              className={`text-xs px-2 py-0.5 rounded ${matchClass}`}
              title={`score ${candidate.score.toFixed(2)}`}
            >
              {matchLabel}
            </span>
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
