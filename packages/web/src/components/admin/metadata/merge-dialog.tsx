import { useState } from 'react';
import { toast } from 'sonner';
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
import { ExternalLink } from 'lucide-react';
import {
  useMergeProposal,
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
  const { data: validated } = useValidatedReferenceValues(proposal.kind);
  const merge = useMergeProposal();
  const { t } = useI18n();

  const cleanName = (proposal.name ?? '').replace(/^NEW:\s*/i, '');

  const filtered = (validated ?? []).filter(
    (v) =>
      (v.label || v.name || '').toLowerCase().includes(search.toLowerCase()) &&
      v.id !== proposal.id,
  );

  const handleAction = () => {
    if (!selectedId) return;
    merge.mutate(
      { id: proposal.id, kind: proposal.kind, target_id: selectedId },
      {
        onSuccess: () => {
          toast.success('Fusion effectuée');
          onOpenChange(false);
        },
        onError: (e: any) => toast.error(`Erreur : ${e.message ?? 'Fusion impossible'}`),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* stopPropagation prevents dialog clicks from bubbling to the card underneath */}
      <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>
            {`Fusionner "${cleanName}" avec...`}
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
              <p className="text-sm text-muted-foreground p-2">Aucun résultat.</p>
            ) : (
              filtered.map((v) => {
                const label = v.label || v.name || String(v.id);
                const count = v.usage_count ?? 0;
                const viewHref = `/ui/admin/referential?item=${proposal.kind}/${v.id}`;
                return (
                  <div
                    key={v.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedId(v.id);
                    }}
                    className={`flex items-center justify-between p-2 rounded cursor-pointer text-sm group ${
                      selectedId === v.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                    }`}
                  >
                    <span>
                      {label}
                      <span
                        className={`text-xs ml-2 ${selectedId === v.id ? 'opacity-70' : 'text-muted-foreground'}`}
                      >
                        ({count} {count === 1 ? 'fragment' : 'fragments'})
                      </span>
                    </span>
                    <a
                      href={viewHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Voir le tag"
                      onClick={(e) => e.stopPropagation()}
                      className={`ml-2 shrink-0 opacity-0 group-hover:opacity-60 hover:opacity-100 ${selectedId === v.id ? 'text-primary-foreground' : 'text-muted-foreground'}`}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                );
              })
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            onClick={handleAction}
            disabled={!selectedId || merge.isPending}
          >
            Fusionner
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
