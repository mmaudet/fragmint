import { useParams, Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useHarvestDebrief } from '@/api/hooks/use-harvest-debrief';

export default function AdminHarvestJobPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { data, isLoading } = useHarvestDebrief(jobId ?? null);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Job introuvable.</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/admin/harvest">Retour</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Job {data.job_id}</h1>
          <p className="text-sm text-muted-foreground">Statut : {data.job_status}</p>
        </div>
        <Button asChild variant="outline">
          <Link to={`/admin/harvest?job_id=${jobId}`}>Voir les candidats</Link>
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Trust haut</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">{data.fragments.by_trust.high}</div>
            <p className="text-xs text-muted-foreground">Validation rapide</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Trust mixte</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-amber-600">{data.fragments.by_trust.mixed}</div>
            <p className="text-xs text-muted-foreground">Déviations à examiner</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Trust bas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600">{data.fragments.by_trust.low}</div>
            <p className="text-xs text-muted-foreground">Vérification approfondie</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Métadonnées émergentes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Auto-validées</span>
            <span className="font-medium text-green-600">{data.metadata.auto_validated}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">À examiner en queue admin</span>
            <span className="font-medium text-amber-600">{data.metadata.to_review}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Breakdown par trust source</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          {Object.entries(data.metadata.breakdown).map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <span className="text-muted-foreground">{k}</span>
              <span className="font-medium">{v as number}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
