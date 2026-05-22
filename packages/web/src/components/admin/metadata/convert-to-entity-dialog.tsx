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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convert tag to entity</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <Label>Entity type</Label>
            <Select value={entityType} onValueChange={(v) => setEntityType(v as EntityType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENTITY_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className="capitalize">
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Canonical name</Label>
            <Input value={canonicalName} onChange={(e) => setCanonicalName(e.target.value)} />
          </div>
          <div>
            <Label>Aliases (comma-separated)</Label>
            <Input
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              placeholder="e.g. James, Apache James"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
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
            Convert & Validate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
