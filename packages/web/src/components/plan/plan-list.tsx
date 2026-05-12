import { useNavigate } from 'react-router-dom';
import { usePlans, useDeletePlan } from '@/api/hooks/use-plans';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/lib/i18n';
import { Trash2 } from 'lucide-react';

export function PlanList({ onCreate }: { onCreate: () => void }) {
  const { data: plans, isLoading } = usePlans();
  const remove = useDeletePlan();
  const nav = useNavigate();
  const { t } = useI18n();

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
          {(plans ?? []).map((p) => (
            <Card key={p.id} className="cursor-pointer hover:shadow-md">
              <CardHeader>
                <CardTitle className="truncate">{p.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Badge variant="secondary">{p.status}</Badge>
                <p className="text-xs text-muted-foreground">
                  Updated {new Date(p.updated_at).toLocaleString()}
                </p>
                <div className="flex gap-2 pt-2">
                  <Button size="sm" onClick={() => nav(`/plan-generation?id=${p.id}`)}>
                    Open
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove.mutate(p.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
