import { useState } from 'react';
import type { FragmentCandidate, SectionFragmentSelection } from '@/api/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Check, X, Pencil } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export function SectionFragmentCard({
  candidate,
  selection,
  onChange,
}: {
  candidate: FragmentCandidate;
  selection: SectionFragmentSelection | undefined;
  onChange: (sel: SectionFragmentSelection | null) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(selection?.body ?? candidate.body_excerpt ?? '');
  const [propose, setPropose] = useState(selection?.propose_to_library ?? false);
  const approved = !!selection;

  function approve() {
    onChange({
      fragment_id: candidate.fragment_id,
      body: candidate.body_excerpt ?? '',
      edited: false,
      propose_to_library: false,
    });
  }

  function reject() { onChange(null); }

  function commitEdit() {
    onChange({
      fragment_id: candidate.fragment_id,
      body,
      edited: true,
      propose_to_library: propose,
    });
    setEditing(false);
  }

  return (
    <Card className={approved ? 'border-primary' : ''}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm truncate">{candidate.title ?? candidate.fragment_id}</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{candidate.quality}</Badge>
            <span className="text-xs text-muted-foreground">score {candidate.score.toFixed(2)}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {editing ? (
          <>
            <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={propose}
                onChange={(e) => setPropose(e.target.checked)}
              />
              {t('planGeneration', 'proposeToLibrary')}
            </label>
            <div className="flex gap-2">
              <Button size="sm" onClick={commitEdit}>{t('planGeneration', 'approve')}</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm whitespace-pre-wrap line-clamp-3">
              {selection?.body ?? candidate.body_excerpt}
            </p>
            <div className="flex gap-2">
              {approved ? (
                <Button size="sm" variant="ghost" onClick={reject}><X className="h-4 w-4" /></Button>
              ) : (
                <Button size="sm" onClick={approve}><Check className="h-4 w-4 mr-1" />{t('planGeneration', 'approve')}</Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4 mr-1" />{t('planGeneration', 'edit')}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
