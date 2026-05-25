import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useRenameProposal } from '@/api/hooks/use-metadata-proposals';
import { useI18n } from '@/lib/i18n';
import type { MetadataProposal } from '@/types/admin-metadata';

interface Props {
  proposal: MetadataProposal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RenameDialog({ proposal, open, onOpenChange }: Props) {
  const [newName, setNewName] = useState(proposal.name);
  const rename = useRenameProposal();
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin', 'renameDialogTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <Label>{t('admin', 'renameDialogCurrentLabel')}</Label>
            <Input value={proposal.name} disabled />
          </div>
          <div>
            <Label>{t('admin', 'renameDialogNewLabel')}</Label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="kebab-case-name"
            />
            <p className="text-xs text-muted-foreground mt-1">{t('admin', 'renameDialogHint')}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common', 'cancel')}
          </Button>
          <Button
            onClick={() =>
              rename.mutate(
                { id: proposal.id, kind: proposal.kind, new_name: newName },
                { onSuccess: () => onOpenChange(false) },
              )
            }
            disabled={rename.isPending || newName === proposal.name}
          >
            {t('admin', 'renameDialogSave')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
