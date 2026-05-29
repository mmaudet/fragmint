import { useI18n } from '@/lib/i18n';
import { UnifiedMetadataList } from '@/components/admin/metadata/unified-metadata-list';

export default function AdminMetadataPage() {
  const { t } = useI18n();

  return (
    <div className="p-6">
      <h1 className="text-2xl font-medium mb-4">{t('admin', 'metadataTitle')}</h1>
      <UnifiedMetadataList />
    </div>
  );
}
