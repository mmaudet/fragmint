import { CollectionsView } from '@/components/admin/collections-view';
import { useI18n } from '@/lib/i18n';

export default function AdminFragmentCollectionsPage() {
  const { t } = useI18n();
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('admin', 'tablesTitle')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('admin', 'tablesDesc')}</p>
      </div>
      <CollectionsView />
    </div>
  );
}
