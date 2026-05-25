import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import { useI18n } from '@/lib/i18n';

const STATUS_KEYS: Record<string, 'statusActive' | 'statusPending' | 'statusArchived' | 'statusRejected'> = {
  active: 'statusActive',
  pending: 'statusPending',
  archived: 'statusArchived',
  rejected: 'statusRejected',
};

const TRUST_KEYS: Record<string, 'trustHuman' | 'trustLlmConfirmed' | 'trustLlmInferred' | 'trustLlmDeviation'> = {
  'human-direct': 'trustHuman',
  'llm-confirmed': 'trustLlmConfirmed',
  'llm-inferred': 'trustLlmInferred',
  'llm-deviation': 'trustLlmDeviation',
};

const QUALITY_KEYS: Record<string, 'qualityDraft' | 'qualityReviewed' | 'qualityApproved'> = {
  draft: 'qualityDraft',
  reviewed: 'qualityReviewed',
  approved: 'qualityApproved',
};

export function ReferentialItemDetailPage() {
  const { type, id } = useParams<{ type: string; id: string }>();
  const { t } = useI18n();

  const { data, isLoading } = useQuery({
    queryKey: ['referential-detail', type, id],
    queryFn: () => apiRequest<any>('GET', `/v1/admin/referential/${type}/${id}`),
  });

  if (isLoading) return <div className="p-6 text-muted-foreground">{t('common', 'loading')}</div>;
  if (!data) return <div className="p-6 text-muted-foreground">Item non trouvé</div>;

  const { item, linked_fragments, rename_history } = data;

  const statusKey = STATUS_KEYS[item.status];
  const trustKey = TRUST_KEYS[item.trustSource];

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <Link
        to={item.status === 'pending' ? '/admin/metadata?tab=validation' : '/admin/metadata?tab=referential'}
        className="text-sm text-primary hover:underline"
      >
        ← {item.status === 'pending' ? t('admin', 'backToValidation') : t('admin', 'backToReferential')}
      </Link>

      <header>
        <h1 className="text-2xl font-bold">
          {item.label}
          <span className="ml-3 text-sm font-normal text-muted-foreground">({type})</span>
        </h1>
      </header>

      <section>
        <h2 className="font-semibold mb-2 text-sm">{t('admin', 'detailDetails')}</h2>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted-foreground">{t('admin', 'detailStatus')}</dt>
          <dd>{statusKey ? t('admin', statusKey) : item.status}</dd>
          <dt className="text-muted-foreground">{t('admin', 'detailTrustSource')}</dt>
          <dd>{trustKey ? t('admin', trustKey) : item.trustSource}</dd>
          <dt className="text-muted-foreground">{t('admin', 'detailUsages')}</dt>
          <dd>{item.usageCount} fragments</dd>
          <dt className="text-muted-foreground">{t('admin', 'detailCreatedBy')}</dt>
          <dd>{item.proposedByDisplay ?? item.proposedBy}</dd>
          <dt className="text-muted-foreground">{t('admin', 'detailCreatedAt')}</dt>
          <dd>{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '—'}</dd>
        </dl>
      </section>

      <section>
        <h2 className="font-semibold mb-1 text-sm">
          {t('admin', 'linkedFragments')} ({linked_fragments?.length ?? 0})
        </h2>
        <p className="text-xs text-muted-foreground mb-2">{t('admin', 'linkedFragmentsHint')}</p>
        {!linked_fragments?.length ? (
          <p className="text-muted-foreground text-sm">{t('admin', 'noLinkedFragments')}</p>
        ) : (
          <ul className="space-y-1">
            {linked_fragments.map((f: any) => {
              const qualityKey = QUALITY_KEYS[f.quality];
              return (
                <li key={f.id} className="text-sm">
                  <Link to={`/fragments`} className="text-primary hover:underline line-clamp-1">
                    {f.title || f.id}
                  </Link>
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({qualityKey ? t('admin', qualityKey) : f.quality})
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {rename_history && rename_history.length > 0 && (
        <section>
          <h2 className="font-semibold mb-2 text-sm">{t('admin', 'renameHistory')}</h2>
          <ul className="space-y-2 text-sm">
            {rename_history.map((r: any) => (
              <li key={r.id} className="border-l-2 border-muted pl-3">
                <span className="font-mono">{r.old_value}</span> → <span className="font-mono">{r.new_value}</span>
                <p className="text-xs text-muted-foreground">
                  Par {r.renamed_by} le {new Date(r.renamed_at).toLocaleString()} · {r.affected_fragments} fragments
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
