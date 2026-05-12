import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useFragments,
  useFragment,
  useFragmentHistory,
  useReviewFragment,
  useApproveFragment,
} from '@/api/hooks/use-fragments';
import { useI18n } from '@/lib/i18n';
import { useCollection } from '@/lib/collection-context';
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
import { toast } from 'sonner';
import { CheckCircle, Eye, MessageSquare, BookOpen } from 'lucide-react';

type ActionMode = 'review' | 'approve';

export default function ValidationPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<ActionMode>('review');
  const navigate = useNavigate();
  const { t } = useI18n();
  const { activeCollection } = useCollection();

  const { data: draftFragments, isLoading: isLoadingDraft } = useFragments(activeCollection, {
    quality: 'draft',
  });
  const { data: reviewedFragments, isLoading: isLoadingReviewed } = useFragments(activeCollection, {
    quality: 'reviewed',
  });
  const { data: fragment, isLoading: isLoadingDetail } = useFragment(activeCollection, selectedId);
  const { data: history } = useFragmentHistory(activeCollection, selectedId);

  const reviewMutation = useReviewFragment(activeCollection);
  const approveMutation = useApproveFragment(activeCollection);

  const openSheet = (id: string, mode: ActionMode) => {
    setSelectedId(id);
    setActionMode(mode);
  };

  const handleReview = () => {
    if (!selectedId) return;
    reviewMutation.mutate(selectedId, {
      onSuccess: () => {
        toast.success('Fragment marqué comme reviewed');
        setSelectedId(null);
      },
      onError: () => toast.error('Erreur lors du passage en reviewed'),
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

  const handleRead = () => {
    if (!selectedId) return;
    setSelectedId(null);
    navigate('/fragments', { state: { fragmentId: selectedId } });
  };

  const isLoading = isLoadingDraft || isLoadingReviewed;

  return (
    <div className="p-6 space-y-10">
      <div>
        <h2 className="text-2xl font-bold">{t('validation', 'title')}</h2>
      </div>

      {/* Section 1 — À reviewer (draft) */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold">À reviewer</h3>
          {draftFragments && (
            <Badge variant="secondary">{draftFragments.length}</Badge>
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
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold">{t('validation', 'pendingApproval')}</h3>
          {reviewedFragments && (
            <Badge variant="secondary">{reviewedFragments.length}</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Fragments reviewés — prêts pour approbation finale.
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
                  <h4 className="text-sm font-medium mb-2">{t('common', 'content')}</h4>
                  <pre className="text-sm whitespace-pre-wrap bg-muted/50 rounded-md p-3 max-h-64 overflow-y-auto">
                    {fragment.body || fragment.body_excerpt || '—'}
                  </pre>
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

              <SheetFooter className="mt-6 flex gap-2">
                <Button variant="outline" onClick={handleRead}>
                  <Eye className="mr-2 h-4 w-4" />
                  {t('validation', 'read')}
                </Button>
                <Button variant="outline" onClick={handleRequestChange}>
                  <MessageSquare className="mr-2 h-4 w-4" />
                  {t('validation', 'requestChange')}
                </Button>
                {actionMode === 'review' ? (
                  <Button onClick={handleReview} disabled={reviewMutation.isPending}>
                    <BookOpen className="mr-2 h-4 w-4" />
                    {reviewMutation.isPending ? t('common', 'inProgress') : 'Marquer reviewed'}
                  </Button>
                ) : (
                  <Button onClick={handleApprove} disabled={approveMutation.isPending}>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    {approveMutation.isPending ? t('common', 'inProgress') : t('common', 'approve')}
                  </Button>
                )}
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
