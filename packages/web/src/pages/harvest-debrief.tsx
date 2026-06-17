import { useParams, Link } from 'react-router-dom';
import { Loader2, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useHarvestDebrief } from '@/api/hooks/use-harvest-debrief';
import { useI18n } from '@/lib/i18n';

export default function HarvestDebriefPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { t } = useI18n();
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
        <p className="text-muted-foreground">No debrief available for this job.</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/harvest">Back to harvest</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-xl mx-auto space-y-6 text-center">
      <div className="flex justify-center">
        <CheckCircle className="h-12 w-12 text-green-500" />
      </div>
      <div>
        <h1 className="text-2xl font-medium">{t('harvest', 'debriefTitle')}</h1>
        <p className="text-muted-foreground mt-2">
          {data.fragments.total} fragments extraits.
          {data.had_hints && ` ${t('harvest', 'debriefHints')}`}
        </p>
        <p className="text-sm text-muted-foreground mt-3">{t('harvest', 'debriefNextStep')}</p>
      </div>
      <div className="flex justify-center gap-3">
        <Button asChild variant="outline">
          <Link to="/harvest">{t('harvest', 'newIngestion')}</Link>
        </Button>
        <Button asChild>
          <Link to="/validation">{t('harvest', 'goToValidation')}</Link>
        </Button>
      </div>
    </div>
  );
}
