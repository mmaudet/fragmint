import { AlertTriangle, Check, ExternalLink, GitMerge, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { useI18n } from '@/lib/i18n';
import {
  useConfirmProposal,
  useCoexistProposal,
  useRejectProposal,
} from '@/api/hooks/use-supersedure-proposals';
import type { SupersedureProposal } from '@/types/admin-supersedure';

interface Props {
  proposal: SupersedureProposal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type DiffPart = { value: string; added?: boolean; removed?: boolean };

function wordDiff(a: string, b: string): DiffPart[] {
  const tokA = a.split(/(\s+)/);
  const tokB = b.split(/(\s+)/);
  const result: DiffPart[] = [];
  let i = 0,
    j = 0;
  while (i < tokA.length || j < tokB.length) {
    if (i < tokA.length && j < tokB.length && tokA[i] === tokB[j]) {
      result.push({ value: tokA[i] });
      i++;
      j++;
    } else if (j < tokB.length && (i >= tokA.length || tokB[j] !== tokA[i])) {
      result.push({ value: tokB[j], added: true });
      j++;
    } else {
      result.push({ value: tokA[i], removed: true });
      i++;
    }
  }
  return result;
}

function InlineDiff({ oldText, newText }: { oldText: string; newText: string }) {
  const parts = wordDiff(oldText, newText);

  const oldParts = parts.filter((p) => !p.added);
  const newParts = parts.filter((p) => !p.removed);

  return (
    <div className="grid grid-cols-2 divide-x text-xs font-mono">
      <div className="p-3 leading-relaxed whitespace-pre-wrap">
        {oldParts.map((part, i) => (
          <span key={i} className={part.removed ? 'bg-red-100 text-red-800 rounded px-0.5' : ''}>
            {part.value}
          </span>
        ))}
      </div>
      <div className="p-3 leading-relaxed whitespace-pre-wrap">
        {newParts.map((part, i) => (
          <span key={i} className={part.added ? 'bg-green-100 text-green-800 rounded px-0.5' : ''}>
            {part.value}
          </span>
        ))}
      </div>
    </div>
  );
}

export function SupersedureDiffSheet({ proposal, open, onOpenChange }: Props) {
  const { t } = useI18n();
  const confirm = useConfirmProposal();
  const coexist = useCoexistProposal();
  const reject = useRejectProposal();

  const isPending = confirm.isPending || coexist.isPending || reject.isPending;

  const handleAction = (action: 'confirm' | 'coexist' | 'reject', id: string) => {
    const mutation = action === 'confirm' ? confirm : action === 'coexist' ? coexist : reject;
    mutation.mutate(id, { onSuccess: () => onOpenChange(false) });
  };

  const oldText = proposal?.old_fragment?.body_excerpt ?? '';
  const newText = proposal?.new_fragment?.body_excerpt ?? '';
  const elementsLost = proposal?.elements_lost_in_new
    ? (() => {
        try {
          return JSON.parse(proposal.elements_lost_in_new) as string[];
        } catch {
          return [proposal.elements_lost_in_new];
        }
      })()
    : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-4xl overflow-y-auto flex flex-col">
        <SheetHeader className="mb-3">
          <SheetTitle className="text-base">{t('supersedure', 'viewDiff')}</SheetTitle>
          {proposal && (
            <div className="space-y-1 text-sm">
              <div className="flex items-start gap-1.5">
                <span className="text-xs font-medium text-green-700 bg-green-50 px-1.5 py-0.5 rounded shrink-0 mt-0.5">
                  {t('supersedure', 'newFragment')}
                </span>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-sm text-foreground truncate">
                    {proposal.new_fragment?.title ??
                      proposal.new_fragment?.body_excerpt?.slice(0, 60) ??
                      proposal.new_fragment_id}
                  </span>
                  <a
                    href={`/ui/admin/fragments?fragment=${proposal.new_fragment_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline flex items-center gap-1 w-fit"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Ouvrir le fragment
                  </a>
                </div>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="text-xs font-medium text-red-700 bg-red-50 px-1.5 py-0.5 rounded shrink-0 mt-0.5">
                  {t('supersedure', 'oldFragment')}
                </span>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-sm text-muted-foreground truncate">
                    {proposal.old_fragment?.title ??
                      proposal.old_fragment?.body_excerpt?.slice(0, 60) ??
                      proposal.old_fragment_id}
                  </span>
                  <a
                    href={`/ui/admin/fragments?fragment=${proposal.old_fragment_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline flex items-center gap-1 w-fit"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Ouvrir le fragment
                  </a>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <Badge variant="outline" className="text-xs">
                  {t('supersedure', 'similarity')}: {(proposal.similarity_score * 100).toFixed(0)}%
                </Badge>
                <Badge
                  variant={
                    proposal.llm_confidence >= 0.85
                      ? 'default'
                      : proposal.llm_confidence >= 0.65
                        ? 'warning'
                        : 'destructive'
                  }
                  className="text-xs"
                >
                  {t('supersedure', 'confidence')}: {(proposal.llm_confidence * 100).toFixed(0)}%
                </Badge>
              </div>
            </div>
          )}
        </SheetHeader>

        {elementsLost && elementsLost.length > 0 && (
          <div className="mb-4 rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900">
            <div className="flex items-center gap-1.5 font-medium mb-1">
              <AlertTriangle className="h-4 w-4" />
              {t('supersedure', 'elementsLostWarning')}
            </div>
            <ul className="list-disc list-inside space-y-0.5">
              {elementsLost.map((el, i) => (
                <li key={i}>{el}</li>
              ))}
            </ul>
          </div>
        )}

        {proposal?.llm_reasoning && (
          <p className="mb-4 text-sm text-muted-foreground italic">"{proposal.llm_reasoning}"</p>
        )}

        <div className="flex-1 min-h-0 border rounded overflow-hidden">
          <div className="grid grid-cols-2 divide-x bg-muted/40 text-xs font-medium text-muted-foreground border-b">
            <div className="px-3 py-1.5">{t('supersedure', 'oldFragment')}</div>
            <div className="px-3 py-1.5">{t('supersedure', 'newFragment')}</div>
          </div>
          <div className="overflow-auto max-h-[60vh]">
            <InlineDiff oldText={oldText} newText={newText} />
          </div>
        </div>

        {proposal && proposal.status === 'pending' && (
          <SheetFooter className="mt-4 flex gap-2 justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleAction('reject', proposal.id)}
              disabled={isPending}
              className="text-destructive hover:text-destructive"
            >
              <X className="h-3.5 w-3.5 mr-1.5" />
              {t('supersedure', 'reject')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleAction('coexist', proposal.id)}
              disabled={isPending}
            >
              <GitMerge className="h-3.5 w-3.5 mr-1.5" />
              {t('supersedure', 'coexist')}
            </Button>
            <Button
              size="sm"
              onClick={() => handleAction('confirm', proposal.id)}
              disabled={isPending}
            >
              <Check className="h-3.5 w-3.5 mr-1.5" />
              {t('supersedure', 'confirm')}
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
