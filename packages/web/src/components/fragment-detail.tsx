import { useFragment, useFragmentHistory, useReviewFragment, useApproveFragment } from '@/api/hooks/use-fragments';
import { QualityBadge } from '@/components/quality-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { toast } from 'sonner';

interface FragmentDetailProps {
  fragmentId: string | null;
  open: boolean;
  onClose: () => void;
}

export function FragmentDetail({ fragmentId, open, onClose }: FragmentDetailProps) {
  const { data: fragment, isLoading } = useFragment(fragmentId);
  const { data: history } = useFragmentHistory(fragmentId);
  const reviewMutation = useReviewFragment();
  const approveMutation = useApproveFragment();

  const handleReview = () => {
    if (!fragmentId) return;
    reviewMutation.mutate(fragmentId, {
      onSuccess: () => toast.success('Fragment marqué comme reviewed'),
      onError: () => toast.error('Erreur lors du review'),
    });
  };

  const handleApprove = () => {
    if (!fragmentId) return;
    approveMutation.mutate(fragmentId, {
      onSuccess: () => toast.success('Fragment approuvé'),
      onError: () => toast.error("Erreur lors de l'approbation"),
    });
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-[500px] sm:max-w-lg overflow-y-auto">
        {isLoading ? (
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
                <SheetTitle className="flex-1">{fragment.title || 'Sans titre'}</SheetTitle>
                <QualityBadge quality={fragment.quality} />
              </div>
              <SheetDescription>
                {fragment.type} &middot; {fragment.domain} &middot; {fragment.lang}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-6">
              {/* Body */}
              <div>
                <h4 className="text-sm font-medium mb-2">Contenu</h4>
                <pre className="text-sm whitespace-pre-wrap bg-muted/50 rounded-md p-3 max-h-64 overflow-y-auto">
                  {fragment.body || fragment.body_excerpt || '—'}
                </pre>
              </div>

              <Separator />

              {/* Metadata */}
              <div>
                <h4 className="text-sm font-medium mb-2">Métadonnées</h4>
                <table className="text-sm w-full">
                  <tbody>
                    {([
                      ['Domaine', fragment.domain],
                      ['Type', fragment.type],
                      ['Langue', fragment.lang],
                      ['Auteur', fragment.author],
                      ['Créé le', new Date(fragment.created_at).toLocaleDateString('fr-FR')],
                      ['Mis à jour', new Date(fragment.updated_at).toLocaleDateString('fr-FR')],
                      ['Utilisations', String(fragment.uses)],
                      ['Fichier', fragment.file_path],
                    ] as const).map(([label, value]) => (
                      <tr key={label} className="border-b last:border-0">
                        <td className="py-1.5 pr-4 text-muted-foreground font-medium">{label}</td>
                        <td className="py-1.5 break-all">{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Tags */}
              {fragment.tags && fragment.tags.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h4 className="text-sm font-medium mb-2">Tags</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {fragment.tags.map((tag) => (
                        <Badge key={tag} variant="secondary">{tag}</Badge>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* History */}
              {history && history.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h4 className="text-sm font-medium mb-2">Historique</h4>
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

            {/* Actions */}
            {(fragment.quality === 'draft' || fragment.quality === 'reviewed') && (
              <SheetFooter className="mt-6">
                {fragment.quality === 'draft' && (
                  <Button
                    onClick={handleReview}
                    disabled={reviewMutation.isPending}
                  >
                    {reviewMutation.isPending ? 'En cours...' : 'Marquer reviewed'}
                  </Button>
                )}
                {fragment.quality === 'reviewed' && (
                  <Button
                    onClick={handleApprove}
                    disabled={approveMutation.isPending}
                  >
                    {approveMutation.isPending ? 'En cours...' : 'Approuver'}
                  </Button>
                )}
              </SheetFooter>
            )}
          </>
        ) : (
          <div className="pt-6 text-sm text-muted-foreground">Fragment introuvable.</div>
        )}
      </SheetContent>
    </Sheet>
  );
}
