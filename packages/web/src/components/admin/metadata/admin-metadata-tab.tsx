import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Check, X, Loader2 } from 'lucide-react';
import { useMetadataProposals, useBulkAction } from '@/api/hooks/use-metadata-proposals';
import { useI18n } from '@/lib/i18n';
import { ProposalsList } from './proposals-list';
import type { ProposalKind } from '@/types/admin-metadata';

export function AdminMetadataTab() {
  const [activeKind, setActiveKind] = useState<ProposalKind>('tag');
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const [availableIds, setAvailableIds] = useState<Array<string | number>>([]);
  const { t } = useI18n();

  const { data } = useMetadataProposals({ limit: 0 });
  const counts = data?.counts ?? { tags: 0, entities: 0, domains: 0, entities_by_type: {} as any };
  const bulkAction = useBulkAction();

  const handleBulk = (action: 'approve' | 'reject') => {
    if (selectedIds.size === 0) return;
    bulkAction.mutate(
      { action, items: Array.from(selectedIds).map((id) => ({ id, kind: activeKind })) },
      { onSuccess: () => setSelectedIds(new Set()) },
    );
  };

  const toggleSelection = (id: string | number) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedIds(next);
  };

  const isAllSelected = availableIds.length > 0 && availableIds.every((id) => selectedIds.has(id));

  const kinds: Array<{ key: ProposalKind; label: string; count: number }> = [
    { key: 'tag', label: t('admin', 'kindTags'), count: counts.tags },
    { key: 'entity', label: t('admin', 'kindEntities'), count: counts.entities },
    { key: 'domain', label: t('admin', 'kindDomains'), count: counts.domains },
  ];

  return (
    <div>
      <div className="flex gap-1 border-b mb-4">
        {kinds.map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => {
              setActiveKind(key);
              setSelectedIds(new Set());
            }}
            className={`px-4 py-2 text-sm border-b-2 transition-colors ${
              activeKind === key
                ? 'border-primary text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label} <span className="ml-1 opacity-70">({count})</span>
          </button>
        ))}
      </div>

      <div className="flex justify-end mb-2">
        <Button
          variant="outline"
          size="sm"
          disabled={availableIds.length === 0}
          onClick={() =>
            isAllSelected ? setSelectedIds(new Set()) : setSelectedIds(new Set(availableIds))
          }
        >
          {isAllSelected ? t('admin', 'deselectAll') : t('admin', 'selectAll')}
        </Button>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex gap-2 items-center mb-3 px-3 py-2 bg-muted rounded-md">
          <span className="text-sm text-muted-foreground flex-1">
            {selectedIds.size} {t('admin', 'selectedCount')}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={bulkAction.isPending}
            onClick={() => handleBulk('approve')}
          >
            {bulkAction.isPending ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Check className="h-4 w-4 mr-1.5" />
            )}
            {t('admin', 'bulkApprove')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={bulkAction.isPending}
            onClick={() => handleBulk('reject')}
            className="text-destructive hover:text-destructive"
          >
            <X className="h-4 w-4 mr-1.5" />
            {t('admin', 'bulkReject')}
          </Button>
        </div>
      )}

      <ProposalsList
        kind={activeKind}
        selectedIds={selectedIds}
        onToggle={toggleSelection}
        onAvailableIds={setAvailableIds}
        countsByType={activeKind === 'entity' ? counts.entities_by_type : undefined}
      />
    </div>
  );
}
