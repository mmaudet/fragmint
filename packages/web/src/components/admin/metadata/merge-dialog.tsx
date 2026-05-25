import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  useMergeProposal,
  useSetAsAlias,
  useValidatedReferenceValues,
} from '@/api/hooks/use-metadata-proposals';
import type { MetadataProposal } from '@/types/admin-metadata';

interface Props {
  proposal: MetadataProposal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MergeDialog({ proposal, open, onOpenChange }: Props) {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | number | null>(null);
  const { data: validated } = useValidatedReferenceValues(proposal.kind, proposal.entity_type);
  const merge = useMergeProposal();
  const setAlias = useSetAsAlias();
  const { t } = useI18n();

  const isAliasMode =
    proposal.kind === 'entity' && proposal.flags.some((f) => f.label.startsWith('Canonical:'));
  const filtered = (validated ?? []).filter(
    (v) =>
      (v.canonical_name || v.label || v.name || '').toLowerCase().includes(search.toLowerCase()) &&
      v.id !== proposal.id,
  );

  const handleAction = () => {
    if (!selectedId) return;
    if (isAliasMode) {
      setAlias.mutate(
        { id: Number(proposal.id), canonical_entity_id: Number(selectedId) },
        { onSuccess: () => onOpenChange(false) },
      );
    } else {
      merge.mutate(
        { id: proposal.id, kind: proposal.kind, target_id: selectedId },
        { onSuccess: () => onOpenChange(false) },
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isAliasMode ? 'Set as alias of...' : `Merge "${proposal.name}" with...`}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <Input
            placeholder={t('admin', 'mergeSearchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="max-h-60 overflow-y-auto space-y-1 border rounded p-2">
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground p-2">No matching values.</p>
            ) : (
              filtered.map((v) => (
                <div
                  key={v.id}
                  onClick={() => setSelectedId(v.id)}
                  className={`p-2 rounded cursor-pointer text-sm ${
                    selectedId === v.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                  }`}
                >
                  {v.canonical_name || v.label || v.name}
                  <span className="text-xs opacity-70 ml-2">({v.usage_count} fragments)</span>
                </div>
              ))
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleAction}
            disabled={!selectedId || merge.isPending || setAlias.isPending}
          >
            {isAliasMode ? 'Set as alias' : 'Merge'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
