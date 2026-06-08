import { useState } from 'react';
import { useAddFragmentToSection, useFragmentCollections } from '@/api/hooks/use-plans';
import { useSearchFragments } from '@/api/hooks/use-fragments';
import { useCollection } from '@/lib/collection-context';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/lib/i18n';
import { toast } from 'sonner';
import { Table2, FileText } from 'lucide-react';
import { useSchemaLabel } from '@/components/payload-editor';

type Mode = 'library' | 'manual' | 'collection';

export function AddFragmentDialog({
  open,
  onOpenChange,
  planId,
  sectionId,
  onAttachCollection,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  planId: string;
  sectionId: string;
  onAttachCollection?: (collectionId: string) => void;
}) {
  const { t } = useI18n();
  const { activeCollection } = useCollection();
  const [mode, setMode] = useState<Mode>('library');
  const [query, setQuery] = useState('');
  const [body, setBody] = useState('');
  const add = useAddFragmentToSection(planId);
  const search = useSearchFragments(activeCollection, query);
  const { data: collections = [] } = useFragmentCollections();
  const getSchemaLabel = useSchemaLabel();

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

  function attachCollection(collectionId: string) {
    onAttachCollection?.(collectionId);
    toast.success(t('planGeneration', 'collectionAttached'));
    close();
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
          {onAttachCollection && (
            <Button
              size="sm"
              variant={mode === 'collection' ? 'default' : 'ghost'}
              onClick={() => setMode('collection')}
            >
              <Table2 className="h-3.5 w-3.5 mr-1.5" />
              {t('planGeneration', 'addFromCollection')}
            </Button>
          )}
        </div>

        {mode === 'library' ? (
          <div className="space-y-3 min-w-0">
            <Input
              placeholder={t('planGeneration', 'libraryQueryPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            <div className="max-h-80 overflow-y-auto overflow-x-hidden space-y-2 min-w-0">
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
                    className="block w-full min-w-0 text-left p-3 border rounded hover:bg-muted transition-colors disabled:opacity-50 overflow-hidden"
                  >
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <span className="font-medium text-sm truncate min-w-0">
                        {f.title ?? f.id}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {f.type}
                      </span>
                    </div>
                    {f.body_excerpt && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2 break-words">
                        {f.body_excerpt}
                      </p>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        ) : mode === 'manual' ? (
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
        ) : (
          <div className="space-y-3 min-w-0">
            <p className="text-sm text-muted-foreground">
              {t('planGeneration', 'collectionPickerHint')}
            </p>
            <div className="max-h-80 overflow-y-auto overflow-x-hidden space-y-1.5 min-w-0">
              {collections.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('planGeneration', 'collectionPickerEmpty')}
                </p>
              ) : (
                collections.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => attachCollection(c.id)}
                    className="block w-full min-w-0 text-left p-3 border rounded hover:bg-muted transition-colors overflow-hidden"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Table2 className="h-4 w-4 text-primary shrink-0" />
                      <span className="font-medium text-sm truncate flex-1 min-w-0">
                        {c.title}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {c.member_ids.length} lignes
                      </span>
                      {c.payload_schema && (
                        <Badge variant="outline" className="text-xs shrink-0 border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                          {getSchemaLabel(c.payload_schema)}
                        </Badge>
                      )}
                      {c.source_document && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0 max-w-[140px] truncate">
                          <FileText className="h-3 w-3 shrink-0" />
                          {c.source_document}
                        </span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
