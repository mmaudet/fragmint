import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlans, useDeletePlan } from '@/api/hooks/use-plans';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/lib/i18n';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';

export function PlanList({ onCreate }: { onCreate: () => void }) {
  const { data: plans, isLoading } = usePlans();
  const remove = useDeletePlan();
  const nav = useNavigate();
  const { t } = useI18n();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  function requestDelete(id: string) {
    setConfirmingId(id);
  }

  function confirmDelete(id: string) {
    setConfirmingId(null);
    remove.mutate(id, {
      onError: (err: any) =>
        toast.error(`${t('planGeneration', 'deleteError')}: ${err.message ?? err}`),
    });
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('planGeneration', 'title')}</h1>
        <Button onClick={onCreate}>+ {t('planGeneration', 'newPlan')}</Button>
      </div>
      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (plans ?? []).length === 0 ? (
        <p className="text-muted-foreground">No plans yet.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(plans ?? []).map((p) => {
            const isConfirming = confirmingId === p.id;
            return (
              <Card
                key={p.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => !isConfirming && nav(`/plan-generation?id=${p.id}`)}
              >
                <CardHeader>
                  <CardTitle className="truncate">{p.title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Badge variant="secondary">{p.status}</Badge>
                  <p className="text-xs text-muted-foreground">
                    Updated {new Date(p.updated_at).toLocaleString()}
                  </p>

                  {isConfirming ? (
                    <div className="pt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                      <p className="text-sm text-destructive">
                        {t('planGeneration', 'deleteConfirmPrompt')}
                      </p>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => confirmDelete(p.id)}
                          disabled={remove.isPending}
                        >
                          {t('planGeneration', 'confirmDelete')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmingId(null)}
                        >
                          {t('planGeneration', 'cancel')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2 pt-2" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => requestDelete(p.id)}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        aria-label={t('planGeneration', 'confirmDelete')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
