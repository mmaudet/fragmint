import { useState } from 'react';
import {
  useFragment,
  useFragmentHistory,
  useReviewFragment,
  useApproveFragment,
  useUpdateFragment,
  useDeleteFragment,
} from '@/api/hooks/use-fragments';
import { useDomains, useTypes, useTags } from '@/api/hooks/use-taxonomy';
import { Link } from 'react-router-dom';
import { useI18n } from '@/lib/i18n';
import { useCollection } from '@/lib/collection-context';
import { useCurrentUser, canDelete } from '@/api/hooks/use-current-user';
import { QualityBadge } from '@/components/quality-badge';
import { FragmentMetaEditor, type MetaEdits } from '@/components/fragment-meta-editor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetClose,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { toast } from 'sonner';
import { AlertTriangle, Save, Trash2 } from 'lucide-react';
import { PayloadEditor } from '@/components/payload-editor';

interface FragmentDetailProps {
  fragmentId: string | null;
  open: boolean;
  onClose: () => void;
}

function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      return JSON.parse(raw) as string[];
    } catch {
      return [];
    }
  }
  return [];
}

export function FragmentDetail({ fragmentId, open, onClose }: FragmentDetailProps) {
  const { t } = useI18n();
  const { activeCollection } = useCollection();
  const { data: fragment, isLoading, isFetching } = useFragment(activeCollection, fragmentId);
  const { data: history } = useFragmentHistory(activeCollection, fragmentId);
  const reviewMutation = useReviewFragment(activeCollection);
  const approveMutation = useApproveFragment(activeCollection);
  const updateMutation = useUpdateFragment(activeCollection);
  const deleteMutation = useDeleteFragment(activeCollection);
  const { data: currentUser } = useCurrentUser();
  const { data: domainsData } = useDomains();
  const { data: typesData } = useTypes();
  const { data: tagsData } = useTags();
  const domains = (domainsData ?? []).map((d) => d.slug);
  const types = (typesData ?? []).map((t) => t.slug);
  const availableTags = (tagsData ?? []).map((t) => t.slug);

  const [editType, setEditType] = useState('');
  const [editDomain, setEditDomain] = useState('');
  const [editLang, setEditLang] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editBody, setEditBody] = useState('');

  const [dirty, setDirty] = useState(false);
  const [initializedFor, setInitializedFor] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const initEdits = (f: NonNullable<typeof fragment>) => {
    setEditType(f.type ?? '');
    setEditDomain(f.domain ?? '');
    setEditLang(f.lang ?? '');
    setEditTags(parseTags(f.tags));
    setEditBody(f.body ?? f.body_excerpt ?? '');

    setDirty(false);
  };

  // Initialize only when fragmentId changes, not on refetch after save
  if (fragment && fragmentId !== initializedFor && !isFetching) {
    setInitializedFor(fragmentId);
    initEdits(fragment);
  }

  const handleSave = () => {
    if (!fragmentId) return;
    updateMutation.mutate(
      {
        id: fragmentId,
        input: {
          body: editBody,
          domain: editDomain,
          type: editType,
          lang: editLang,
          tags: editTags,
        },
      },
      {
        onSuccess: () => {
          toast.success(t('fragments', 'updateSuccess'));
          close();
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : t('fragments', 'updateError')),
      },
    );
  };

  const saveIfDirty = (then: () => void) => {
    if (!fragmentId) return;
    if (!dirty) {
      then();
      return;
    }
    updateMutation.mutate(
      {
        id: fragmentId,
        input: {
          body: editBody,
          domain: editDomain,
          type: editType,
          lang: editLang,
          tags: editTags,
        },
      },
      {
        onSuccess: () => {
          setDirty(false);
          then();
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : t('fragments', 'updateError')),
      },
    );
  };

  const close = () => {
    setDirty(false);
    setInitializedFor(null);
    setConfirmingDelete(false);
    onClose();
  };

  const handleDelete = () => {
    if (!fragmentId) return;
    deleteMutation.mutate(fragmentId, {
      onSuccess: () => {
        toast.success(t('fragments', 'deleteSuccess'));
        close();
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : 'Erreur'),
    });
  };

  const handleReview = () =>
    saveIfDirty(() => {
      if (!fragmentId) return;
      reviewMutation.mutate(fragmentId, {
        onSuccess: () => {
          toast.success(t('fragments', 'reviewSuccess'));
          close();
        },
        onError: () => toast.error(t('fragments', 'reviewError')),
      });
    });

  const handleApprove = () =>
    saveIfDirty(() => {
      if (!fragmentId) return;
      approveMutation.mutate(fragmentId, {
        onSuccess: () => {
          toast.success(t('fragments', 'approveSuccess'));
          close();
        },
        onError: () => toast.error(t('fragments', 'approveError')),
      });
    });

  const hasAction = fragment && (fragment.quality === 'draft' || fragment.quality === 'reviewed');
  const showFooter = dirty || !!hasAction || (!!fragment && canDelete(currentUser));

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setDirty(false);
          setInitializedFor(null);
          onClose();
        }
      }}
    >
      <SheetContent side="right" className="w-[500px] sm:max-w-lg flex flex-col p-0 gap-0">
        {/* Sticky header — same pattern as admin drawer */}
        <div className="sticky top-0 bg-background border-b px-5 py-3 flex items-center justify-between z-10 shrink-0">
          <SheetClose asChild>
            <button className="text-sm hover:underline text-muted-foreground">
              ← {t('common', 'close')}
            </button>
          </SheetClose>
          {fragment && <QualityBadge quality={fragment.quality} />}
        </div>

        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : fragment ? (
            <>
              <SheetHeader>
                <div className="flex items-center gap-2">
                  <SheetTitle className="text-base truncate">
                    {fragment.title || t('common', 'noTitle')}
                  </SheetTitle>
                </div>
                <SheetDescription asChild>
                  <div className="flex items-center gap-1 flex-wrap mt-1">
                    <Badge
                      variant="outline"
                      className="text-xs border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
                    >
                      {fragment.type}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="text-xs border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300"
                    >
                      {fragment.domain}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {fragment.lang}
                    </Badge>
                    {(fragment.payload_schema || /^\|.+\|/.test(fragment.body ?? fragment.body_excerpt ?? '')) && (
                      <Badge
                        variant="outline"
                        className="text-xs border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                      >
                        📊 {fragment.payload_schema ?? 'tableau'}
                      </Badge>
                    )}
                  </div>
                </SheetDescription>
              </SheetHeader>

              {fragment.harvest_near_dup && (() => {
                const score = fragment.harvest_near_dup.score ?? 0;
                const level = score >= 0.95 ? 'exact' : score >= 0.80 ? 'high' : 'moderate';
                const labelText = level === 'exact' ? 'Doublon quasi-exact' : level === 'high' ? 'Forte similarité' : 'Proche de';
                const bannerCn = level === 'exact'
                  ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
                  : level === 'high'
                  ? 'border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200'
                  : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200';
                return (
                  <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${bannerCn}`}>
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      <strong>{labelText}</strong> lors du harvest —{' '}
                      {fragment.harvest_near_dup!.score != null && (
                        <strong>{Math.round(fragment.harvest_near_dup!.score * 100)}%</strong>
                      )}
                      {fragment.harvest_near_dup!.method && (
                        <span className="opacity-70"> ({fragment.harvest_near_dup!.method})</span>
                      )}{' '}
                      avec{' '}
                      <Link
                        to={`/fragments?fragment=${fragment.harvest_near_dup!.fragment_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs underline underline-offset-2 hover:opacity-70"
                      >
                        {fragment.harvest_near_dup!.fragment_id.slice(0, 8)}…
                      </Link>
                    </span>
                  </div>
                );
              })()}

              <FragmentMetaEditor
                edits={{
                  type: editType,
                  domain: editDomain,
                  lang: editLang,
                  tags: editTags,
                  body: editBody,
                }}
                types={types}
                domains={domains}
                availableTags={availableTags}
                onChange={(m: MetaEdits) => {
                  setEditType(m.type);
                  setEditDomain(m.domain);
                  setEditLang(m.lang);
                  setEditTags(m.tags);
                  setEditBody(m.body);
                  setDirty(true);
                }}
              />

              {fragment.payload && fragment.payload_schema && (() => {
                let parsed: Record<string, unknown> = {};
                try { parsed = JSON.parse(fragment.payload); } catch { /* ignore */ }
                return (
                  <>
                    <Separator />
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        Données structurées{' '}
                        <span className="ml-2 bg-muted px-1.5 py-0.5 rounded text-xs">{fragment.payload_schema}</span>
                      </p>
                      <PayloadEditor
                        schemaId={fragment.payload_schema}
                        value={parsed}
                        onChange={() => {}}
                        disabled={true}
                      />
                    </div>
                  </>
                );
              })()}

              <Separator />

              <div>
                <h4 className="text-sm font-medium mb-2">{t('common', 'metadata')}</h4>
                <table className="text-sm w-full">
                  <tbody>
                    {(
                      [
                        [t('common', 'author'), fragment.author],
                        [
                          t('common', 'createdAt'),
                          new Date(fragment.created_at).toLocaleDateString('fr-FR'),
                        ],
                        [
                          t('common', 'updatedAt'),
                          new Date(fragment.updated_at).toLocaleDateString('fr-FR'),
                        ],
                        [t('common', 'uses'), String(fragment.uses)],
                        [t('common', 'file'), fragment.file_path],
                        ...(fragment.origin_source
                          ? [
                              [
                                'Source',
                                fragment.origin_source +
                                  (fragment.origin_page != null ? ` · p. ${fragment.origin_page}` : ''),
                              ] as const,
                            ]
                          : []),
                      ] as const
                    ).map(([label, value]) => (
                      <tr key={label} className="border-b last:border-0">
                        <td className="py-1.5 pr-4 text-muted-foreground font-medium whitespace-nowrap">
                          {label}
                        </td>
                        <td className="py-1.5 break-all">{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {history && history.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h4 className="text-sm font-medium mb-2">{t('common', 'history')}</h4>
                    <ul className="space-y-2">
                      {history.map((entry) => (
                        <li key={entry.commit} className="text-sm">
                          <span className="text-muted-foreground">
                            {new Date(entry.date).toLocaleDateString('fr-FR')}
                          </span>
                          <span className="mx-1.5">&mdash;</span>
                          <span>{entry.message}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="pt-6 text-sm text-muted-foreground">{t('common', 'notFound')}</div>
          )}
        </div>

        {showFooter && (
          <div className="border-t p-4 flex flex-col gap-2">
            {dirty && (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={handleSave}
                disabled={updateMutation.isPending}
              >
                <Save className="h-3.5 w-3.5 mr-1" />
                {updateMutation.isPending ? t('common', 'inProgress') : t('common', 'save')}
              </Button>
            )}
            {fragment?.quality === 'draft' && (
              <Button className="w-full" onClick={handleReview} disabled={reviewMutation.isPending}>
                {reviewMutation.isPending
                  ? t('common', 'inProgress')
                  : t('fragments', 'markReviewed')}
              </Button>
            )}
            {fragment?.quality === 'reviewed' && (
              <Button
                className="w-full"
                onClick={handleApprove}
                disabled={approveMutation.isPending}
              >
                {approveMutation.isPending ? t('common', 'inProgress') : t('common', 'approve')}
              </Button>
            )}
            {fragment && canDelete(currentUser) && (
              <div className="flex gap-2 pt-1 border-t mt-1">
                {confirmingDelete ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => setConfirmingDelete(false)}
                    >
                      {t('common', 'cancel')}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="flex-1"
                      onClick={handleDelete}
                      disabled={deleteMutation.isPending}
                    >
                      {t('fragments', 'confirmDelete')}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setConfirmingDelete(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    {t('fragments', 'delete')}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
