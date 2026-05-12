import { useI18n } from '@/lib/i18n';

export default function PlanGenerationPage() {
  const { t } = useI18n();
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">{t('planGeneration', 'title')}</h1>
      <p className="text-muted-foreground mt-2">Coming next.</p>
    </div>
  );
}
