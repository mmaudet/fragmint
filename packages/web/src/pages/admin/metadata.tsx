import { useI18n } from '@/lib/i18n';
import { UnifiedMetadataList } from '@/components/admin/metadata/unified-metadata-list';
import { CooccurrenceHeatmap } from '@/components/admin/cooccurrence-heatmap';
import { Tooltip, TooltipContent } from '@/components/ui/tooltip';
import { useState } from 'react';

export default function AdminMetadataPage() {
  const { t } = useI18n();
  const [showCooccurrence, setShowCooccurrence] = useState(false);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-medium mb-4">{t('admin', 'metadataTitle')}</h1>
      <UnifiedMetadataList />
      <div className="pt-6 mt-6 border-t">
        <Tooltip>
          <button
            onClick={() => setShowCooccurrence(!showCooccurrence)}
            className="flex items-center gap-2 text-sm font-medium hover:text-primary"
          >
            {showCooccurrence ? '▼' : '▶'} {t('admin', 'cooccurrenceToggle')}
          </button>
          <TooltipContent side="right">{t('admin', 'cooccurrenceTooltip')}</TooltipContent>
        </Tooltip>
        {showCooccurrence && (
          <div className="mt-4">
            <CooccurrenceHeatmap />
          </div>
        )}
      </div>
    </div>
  );
}
