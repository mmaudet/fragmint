import { SupersedureTab } from '@/components/admin/supersedure/supersedure-tab';
import { useI18n } from '@/lib/i18n';

export default function AdminSupersedurePage() {
  const { t } = useI18n();
  return (
    <div className="p-6">
      <h1 className="text-2xl font-medium mb-1">Remplacements</h1>
      <p className="text-sm text-muted-foreground mb-2">
        Quand l&apos;ingestion détecte qu&apos;un fragment B semble remplacer un fragment A, une
        proposition est créée.
      </p>
      <ul className="text-sm text-muted-foreground mb-4 space-y-0.5 list-none">
        <li>
          <span className="font-medium text-foreground">{t('supersedure', 'confirm')}</span> — B remplace A&nbsp;: A est
          archivé, B devient la version de référence.
        </li>
        <li>
          <span className="font-medium text-foreground">{t('supersedure', 'coexist')}</span> — les deux fragments sont
          intentionnellement maintenus&nbsp;: aucun n&apos;est archivé.
        </li>
        <li>
          <span className="font-medium text-foreground">{t('supersedure', 'reject')}</span> — la proposition est
          incorrecte&nbsp;: les deux fragments n&apos;ont pas de lien de remplacement.
        </li>
      </ul>
      <div className="text-xs text-muted-foreground border rounded-md px-3 py-2.5 bg-muted/40 space-y-1 mb-6">
        <p className="font-medium text-foreground">{t('supersedure', 'legendTitle')}</p>
        <p>
          <span className="font-medium">Similarité shingles</span> — {t('supersedure', 'legendShingles')}
        </p>
        <p>
          <span className="font-medium">Similarité cosine</span> — {t('supersedure', 'legendCosine')}
        </p>
        <p>
          <span className="font-medium">Similarité hash</span> — {t('supersedure', 'legendHash')}
        </p>
        <p>
          <span className="font-medium">{t('supersedure', 'confidence')}</span> — {t('supersedure', 'legendLlm')}
        </p>
      </div>
      <SupersedureTab />
    </div>
  );
}
