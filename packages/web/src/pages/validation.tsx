import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useFragments,
  useFragment,
  useFragmentHistory,
  useReviewFragment,
  useApproveFragment,
  useUpdateFragment,
} from '@/api/hooks/use-fragments';
import { apiRequest, collectionApiUrl } from '@/api/client';
import { useI18n } from '@/lib/i18n';
import { useCollection } from '@/lib/collection-context';
import { useCurrentUser, canEditFragment, canReview, canApprove } from '@/api/hooks/use-current-user';
import { FragmentCard } from '@/components/fragment-card';
import { QualityBadge } from '@/components/quality-badge';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { CheckCircle, MessageSquare, BookOpen, Pencil, Save, X } from 'lucide-react';

type ActionMode = 'review' | 'approve';

function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string' && raw.length > 0) {
    try { return JSON.parse(raw) as string[]; } catch { return []; }
  }
  return [];
}

export default function ValidationPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<ActionMode>('review');
  const [editMode, setEditMode] = useState(false);
  const [editBody, setEditBody] = useState('');
  const [editDomain, setEditDomain] = useState('');
  const [editTags, setEditTags] = useState('');
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set());
  const [selectedReviewedIds, setSelectedReviewedIds] = useState<Set<string>>(new Set());
  const { t } = useI18n();
  const { activeCollection } = useCollection();

  const { data: draftFragments, isLoading: isLoadingDraft } = useFragments(activeCollection, {
    quality: 'draft',
    limit: 500,
  });
  const { data: reviewedFragments, isLoading: isLoadingReviewed } = useFragments(activeCollection, {
    quality: 'reviewed',
    limit: 500,
  });
  const { data: fragment, isLoading: isLoadingDetail } = useFragment(activeCollection, selectedId);
  const { data: history } = useFragmentHistory(activeCollection, selectedId);

  const reviewMutation = useReviewFragment(activeCollection);
  const approveMutation = useApproveFragment(activeCollection);
  const updateMutation = useUpdateFragment(activeCollection);
  const { data: currentUser } = useCurrentUser();
  const queryClient = useQueryClient();

  const openSheet = (id: string, mode: ActionMode) => {
    setSelectedId(id);
    setActionMode(mode);
    setEditMode(false);
  };

  const startEdit = () => {
    if (!fragment) return;
    setEditBody(fragment.body ?? fragment.body_excerpt ?? '');
    setEditDomain(fragment.domain ?? '');
    const rawTags = fragment.tags;
    setEditTags(Array.isArray(rawTags) ? rawTags.join(', ') : typeof rawTags === 'string' ? rawTags : '');
    setEditMode(true);
  };

  const handleSave = () => {
    if (!selectedId) return;
    const tags = editTags.split(',').map((t) => t.trim()).filter(Boolean);
    updateMutation.mutate(
      { id: selectedId, input: { body: editBody, domain: editDomain, tags } },
      {
        onSuccess: () => {
          toast.success(t('fragments', 'updateSuccess'));
          setEditMode(false);
        },
        onError: () => toast.error(t('fragments', 'updateError')),
      },
    );
  };

  const handleReview = () => {
    if (!selectedId) return;
    reviewMutation.mutate(selectedId, {
      onSuccess: () => {
        toast.success(t('fragments', 'reviewSuccess'));
        setSelectedId(null);
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : t('fragments', 'reviewError')),
    });
  };

  const handleApprove = () => {
    if (!selectedId) return;
    approveMutation.mutate(selectedId, {
      onSuccess: () => {
        toast.success(t('validation', 'approveSuccess'));
        setSelectedId(null);
      },
      onError: () => toast.error(t('validation', 'approveError')),
    });
  };

  const handleRequestChange = () => {
    toast.info(t('validation', 'changeRequested'));
    setSelectedId(null);
  };

  const toggleDraft = (id: string) =>
    setSelectedDraftIds((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const toggleReviewed = (id: string) =>
    setSelectedReviewedIds((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const handleBulkReview = async () => {
    const ids = Array.from(selectedDraftIds);
    if (!ids.length) return;
    let failed = 0;
    for (const id of ids) {
      try {
        await apiRequest('POST', collectionApiUrl(activeCollection, `/fragments/${id}/review`));
      } catch {
        failed++;
      }
    }
    setSelectedDraftIds(new Set());
    await queryClient.invalidateQueries({ queryKey: ['fragments'] });
    if (failed > 0) toast.error(`${failed} échec(s) sur ${ids.length}`);
    else toast.success(`${ids.length} fragment(s) marqués comme vérifiés`);
  };

  const handleBulkApprove = async () => {
    const ids = Array.from(selectedReviewedIds);
    if (!ids.length) return;
    let failed = 0;
    for (const id of ids) {
      try {
        await apiRequest('POST', collectionApiUrl(activeCollection, `/fragments/${id}/approve`));
      } catch {
        failed++;
      }
    }
    setSelectedReviewedIds(new Set());
    await queryClient.invalidateQueries({ queryKey: ['fragments'] });
    if (failed > 0) toast.error(`${failed} échec(s) sur ${ids.length}`);
    else toast.success(`${ids.length} fragment(s) approuvés`);
  };

  const isLoading = isLoadingDraft || isLoadingReviewed;

  return (
    <div className="p-6 space-y-10">
      <div>
        <h2 className="text-2xl font-bold">{t('validation', 'title')}</h2>
      </div>

      {/* Section 1 — À reviewer (draft) */}
      <section className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="text-lg font-semibold">{t('validation', 'pendingReview')}</h3>
          {draftFragments && <Badge variant="secondary">{draftFragments.length}</Badge>}
          {selectedDraftIds.size > 0 && (
            <Button size="sm" onClick={handleBulkReview} disabled={reviewMutation.isPending}>
              <BookOpen className="mr-2 h-3.5 w-3.5" />
              {t('fragments', 'markReviewed')} ({selectedDraftIds.size})
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Fragments ingérés par le harvester — à relire avant validation.
        </p>
        {isLoadingDraft ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full rounded-lg" />
            ))}
          </div>
        ) : draftFragments && draftFragments.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {draftFragments.map((f) => (
              <FragmentCard
                key={f.id}
                fragment={f}
                onClick={() => openSheet(f.id, 'review')}
                selected={f.id === selectedId}
                checked={selectedDraftIds.has(f.id)}
                onCheckedChange={canReview(currentUser) ? () => toggleDraft(f.id) : undefined}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-4">Aucun fragment en attente de review.</p>
        )}
      </section>

      <Separator />

      {/* Section 2 — À approuver (reviewed) */}
      <section className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="text-lg font-semibold">{t('validation', 'pendingApproval')}</h3>
          {reviewedFragments && <Badge variant="secondary">{reviewedFragments.length}</Badge>}
          {selectedReviewedIds.size > 0 && (
            <Button size="sm" onClick={handleBulkApprove} disabled={approveMutation.isPending}>
              <CheckCircle className="mr-2 h-3.5 w-3.5" />
              {t('common', 'approve')} ({selectedReviewedIds.size})
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Fragments vérifiés — prêts pour approbation finale.
        </p>
        {isLoadingReviewed ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full rounded-lg" />
            ))}
          </div>
        ) : reviewedFragments && reviewedFragments.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {reviewedFragments.map((f) => (
              <FragmentCard
                key={f.id}
                fragment={f}
                onClick={() => openSheet(f.id, 'approve')}
                selected={f.id === selectedId}
                checked={selectedReviewedIds.has(f.id)}
                onCheckedChange={canApprove(currentUser) ? () => toggleReviewed(f.id) : undefined}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-4">{t('validation', 'noFragmentsPending')}</p>
        )}
      </section>

      {/* Detail Drawer */}
      <Sheet open={!!selectedId} onOpenChange={(v) => !v && setSelectedId(null)}>
        <SheetContent side="right" className="w-[500px] sm:max-w-lg overflow-y-auto">
          {isLoadingDetail ? (
            <div className="space-y-4 pt-6">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : fragment ? (
            <>
              <SheetHeader>
                <div className="flex items-center gap-2">
                  <SheetTitle className="flex-1">
                    {fragment.title || t('common', 'noTitle')}
                  </SheetTitle>
                  <QualityBadge quality={fragment.quality} />
                </div>
                <SheetDescription>
                  {fragment.type} &middot; {fragment.domain} &middot; {fragment.lang}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium">{t('common', 'content')}</h4>
                    {!editMode && (
                      <Button variant="ghost" size="sm" onClick={startEdit}>
                        <Pencil className="h-3 w-3 mr-1" />
                        Éditer
                      </Button>
                    )}
                  </div>
                  {editMode ? (
                    <div className="space-y-3">
                      <Textarea
                        className="font-mono text-sm min-h-48"
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-muted-foreground mb-1 block">{t('common', 'domain')}</label>
                          <Input value={editDomain} onChange={(e) => setEditDomain(e.target.value)} className="text-sm" />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground mb-1 block">{t('common', 'tags')} (virgule)</label>
                          <Input value={editTags} onChange={(e) => setEditTags(e.target.value)} className="text-sm" placeholder="tag1, tag2" />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending}>
                          <Save className="h-3 w-3 mr-1" />
                          {updateMutation.isPending ? t('common', 'inProgress') : t('common', 'save')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditMode(false)}>
                          <X className="h-3 w-3 mr-1" />
                          Annuler
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <pre className="text-sm whitespace-pre-wrap bg-muted/50 rounded-md p-3 max-h-64 overflow-y-auto">
                      {fragment.body || fragment.body_excerpt || '—'}
                    </pre>
                  )}
                </div>

                <Separator />

                <div>
                  <h4 className="text-sm font-medium mb-2">{t('common', 'metadata')}</h4>
                  <table className="text-sm w-full">
                    <tbody>
                      {(
                        [
                          [t('common', 'author'), fragment.author],
                          [t('common', 'domain'), fragment.domain],
                          [t('common', 'type'), fragment.type],
                          [t('common', 'language'), fragment.lang],
                          [
                            t('common', 'createdAt'),
                            new Date(fragment.created_at).toLocaleDateString('fr-FR'),
                          ],
                          [
                            t('common', 'updatedAt'),
                            new Date(fragment.updated_at).toLocaleDateString('fr-FR'),
                          ],
                        ] as const
                      ).map(([label, value]) => (
                        <tr key={label} className="border-b last:border-0">
                          <td className="py-1.5 pr-4 text-muted-foreground font-medium">{label}</td>
                          <td className="py-1.5 break-all">{value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {(() => { const tags = parseTags(fragment.tags); return tags.length > 0 ? (
                  <>
                    <Separator />
                    <div>
                      <h4 className="text-sm font-medium mb-2">{t('common', 'tags')}</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {tags.map((tag) => (
                          <Badge key={tag} variant="secondary">{tag}</Badge>
                        ))}
                      </div>
                    </div>
                  </>
                ) : null; })()}

                {history && history.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <h4 className="text-sm font-medium mb-2">{t('validation', 'gitHistory')}</h4>
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
              </div>

              <SheetFooter className="sticky bottom-0 bg-background border-t mt-6 pt-4 flex flex-row justify-between">
                <div>
                  {!canEditFragment(currentUser, fragment.author) && (
                    <Button variant="ghost" onClick={handleRequestChange}>
                      <MessageSquare className="mr-2 h-4 w-4" />
                      {t('validation', 'requestChange')}
                    </Button>
                  )}
                </div>
                <div>
                  {actionMode === 'review' ? (
                    <Button onClick={handleReview} disabled={reviewMutation.isPending}>
                      <BookOpen className="mr-2 h-4 w-4" />
                      {reviewMutation.isPending ? t('common', 'inProgress') : t('fragments', 'markReviewed')}
                    </Button>
                  ) : (
                    <Button onClick={handleApprove} disabled={approveMutation.isPending}>
                      <CheckCircle className="mr-2 h-4 w-4" />
                      {approveMutation.isPending ? t('common', 'inProgress') : t('common', 'approve')}
                    </Button>
                  )}
                </div>
              </SheetFooter>
            </>
          ) : (
            <div className="pt-6 text-sm text-muted-foreground">{t('common', 'notFound')}</div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
