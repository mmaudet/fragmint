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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useConvertToEntity } from '@/api/hooks/use-metadata-proposals';
import { useI18n } from '@/lib/i18n';
import type { MetadataProposal, EntityType } from '@/types/admin-metadata';

const ENTITY_TYPES: EntityType[] = [
  'client',
  'product',
  'technology',
  'partner',
  'certification',
  'regulation',
  'metric',
];

interface Props {
  proposal: MetadataProposal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConvertToEntityDialog({ proposal, open, onOpenChange }: Props) {
  const [entityType, setEntityType] = useState<EntityType>('technology');
  const [canonicalName, setCanonicalName] = useState(proposal.name);
  const [aliases, setAliases] = useState('');
  const convert = useConvertToEntity();
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin', 'convertDialogTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <Label>{t('admin', 'convertDialogEntityType')}</Label>
            <Select value={entityType} onValueChange={(v) => setEntityType(v as EntityType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENTITY_TYPES.map((type) => (
                  <SelectItem key={type} value={type} className="capitalize">
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('admin', 'convertDialogCanonical')}</Label>
            <Input value={canonicalName} onChange={(e) => setCanonicalName(e.target.value)} />
          </div>
          <div>
            <Label>{t('admin', 'convertDialogAliases')}</Label>
            <Input
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              placeholder={t('admin', 'convertDialogAliasesPlaceholder')}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common', 'cancel')}
          </Button>
          <Button
            onClick={() =>
              convert.mutate(
                {
                  id: String(proposal.id),
                  entity_type: entityType,
                  canonical_name: canonicalName,
                  aliases: aliases
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                },
                { onSuccess: () => onOpenChange(false) },
              )
            }
            disabled={convert.isPending}
          >
            {t('admin', 'convertDialogSubmit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
