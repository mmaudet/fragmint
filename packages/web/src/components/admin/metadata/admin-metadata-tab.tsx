import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Check, X, Loader2 } from 'lucide-react';
import { useMetadataProposals, useBulkAction } from '@/api/hooks/use-metadata-proposals';
import { ProposalsList } from './proposals-list';
import type { ProposalKind } from '@/types/admin-metadata';

export function AdminMetadataTab() {
  const [activeKind, setActiveKind] = useState<ProposalKind>('tag');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());

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

  return (
    <Tabs
      value={activeKind}
      onValueChange={(v: string) => {
        setActiveKind(v as ProposalKind);
        setSelectedIds(new Set());
      }}
    >
      <TabsList>
        <TabsTrigger value="tag">
          Tags <span className="ml-1.5 text-xs opacity-70">({counts.tags})</span>
        </TabsTrigger>
        <TabsTrigger value="entity">
          Entities <span className="ml-1.5 text-xs opacity-70">({counts.entities})</span>
        </TabsTrigger>
        <TabsTrigger value="domain">
          Domains <span className="ml-1.5 text-xs opacity-70">({counts.domains})</span>
        </TabsTrigger>
      </TabsList>

      <div className="flex gap-2 items-center mt-4 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search proposals..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={selectedIds.size === 0 || bulkAction.isPending}
          onClick={() => handleBulk('approve')}
        >
          {bulkAction.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Check className="h-4 w-4 mr-2" />
          )}
          Bulk approve ({selectedIds.size})
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={selectedIds.size === 0 || bulkAction.isPending}
          onClick={() => handleBulk('reject')}
          className="text-destructive hover:text-destructive"
        >
          <X className="h-4 w-4 mr-2" />
          Bulk reject ({selectedIds.size})
        </Button>
      </div>

      {(['tag', 'entity', 'domain'] as ProposalKind[]).map((k) => (
        <TabsContent key={k} value={k}>
          <ProposalsList
            kind={k}
            search={search}
            selectedIds={selectedIds}
            onToggle={toggleSelection}
            countsByType={k === 'entity' ? counts.entities_by_type : undefined}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}
