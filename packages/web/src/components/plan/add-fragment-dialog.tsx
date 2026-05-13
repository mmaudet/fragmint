import { useState } from 'react';
import { useAddFragmentToSection } from '@/api/hooks/use-plans';
import { useSearchFragments } from '@/api/hooks/use-fragments';
import { useCollection } from '@/lib/collection-context';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { toast } from 'sonner';

type Mode = 'library' | 'manual';

export function AddFragmentDialog({
  open,
  onOpenChange,
  planId,
  sectionId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  planId: string;
  sectionId: string;
}) {
  const { t } = useI18n();
  const { activeCollection } = useCollection();
  const [mode, setMode] = useState<Mode>('library');
  const [query, setQuery] = useState('');
  const [body, setBody] = useState('');
  const add = useAddFragmentToSection(planId);
  const search = useSearchFragments(activeCollection, query);

  function close() {
    onOpenChange(false);
    setQuery('');
    setBody('');
  }

  async function pickFromLibrary(fragmentId: string) {
    try {
      await add.mutateAsync({ sectionId, fragment_id: fragmentId });
      toast.success(t('planGeneration', 'fragmentAdded'));
      close();
    } catch (e: any) {
      toast.error(`${t('planGeneration', 'addFragmentError')}: ${e.message ?? e}`);
    }
  }

  async function submitManual() {
    if (!body.trim()) {
      toast.error(t('planGeneration', 'manualBodyRequired'));
      return;
    }
    try {
      await add.mutateAsync({ sectionId, manual: { body: body.trim() } });
      toast.success(t('planGeneration', 'fragmentAdded'));
      close();
    } catch (e: any) {
      toast.error(`${t('planGeneration', 'addFragmentError')}: ${e.message ?? e}`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('planGeneration', 'addFragment')}</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 border-b pb-3">
          <Button
            size="sm"
            variant={mode === 'library' ? 'default' : 'ghost'}
            onClick={() => setMode('library')}
          >
            {t('planGeneration', 'addFromLibrary')}
          </Button>
          <Button
            size="sm"
            variant={mode === 'manual' ? 'default' : 'ghost'}
            onClick={() => setMode('manual')}
          >
            {t('planGeneration', 'addManually')}
          </Button>
        </div>

        {mode === 'library' ? (
          <div className="space-y-3">
            <Input
              placeholder={t('planGeneration', 'libraryQueryPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            <div className="max-h-80 overflow-y-auto space-y-2">
              {query.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('planGeneration', 'libraryQueryHint')}
                </p>
              ) : search.isLoading ? (
                <p className="text-sm text-muted-foreground">…</p>
              ) : (search.data?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('planGeneration', 'librarySearchEmpty')}
                </p>
              ) : (
                search.data!.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => pickFromLibrary(f.id)}
                    disabled={add.isPending}
                    className="w-full text-left p-3 border rounded hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm truncate">{f.title ?? f.id}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {f.type} · {f.quality}
                      </span>
                    </div>
                    {f.body_excerpt && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {f.body_excerpt}
                      </p>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Textarea
              rows={10}
              placeholder={t('planGeneration', 'manualBodyPlaceholder')}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              autoFocus
            />
            <div className="flex justify-end">
              <Button onClick={submitManual} disabled={add.isPending}>
                {t('planGeneration', 'addAndSelect')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
