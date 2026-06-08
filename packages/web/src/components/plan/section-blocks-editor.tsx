import { useState } from 'react';
import { Plus, X, Table2, AlignLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useFragmentCollections, useFragmentCollection } from '@/api/hooks/use-plans';
import type { SectionBlock } from '@/api/types';

interface Props {
  blocks: SectionBlock[];
  onChange: (blocks: SectionBlock[]) => void;
}

function TableBlockPicker({ onAdd }: { onAdd: (block: SectionBlock) => void }) {
  const [open, setOpen] = useState(false);
  const [collectionId, setCollectionId] = useState('');
  const [columnsInput, setColumnsInput] = useState('');
  const { data: collections = [] } = useFragmentCollections();
  const { data: selected } = useFragmentCollection(collectionId || null);

  function handleAdd() {
    if (!collectionId) return;
    const columns = columnsInput.trim()
      ? columnsInput.split(',').map((c) => c.trim()).filter(Boolean)
      : undefined;
    onAdd({ type: 'table', collection_id: collectionId, columns });
    setCollectionId('');
    setColumnsInput('');
    setOpen(false);
  }

  return (
    <>
      <DropdownMenuItem onSelect={() => setOpen(true)}>
        <Table2 className="h-3.5 w-3.5 mr-2" />
        Tableau (collection)
      </DropdownMenuItem>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Ajouter un bloc tableau</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Collection</Label>
              <Select value={collectionId} onValueChange={setCollectionId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Choisir une collection…" />
                </SelectTrigger>
                <SelectContent>
                  {collections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title}
                      {c.payload_schema && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {c.payload_schema}
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selected && selected.member_ids.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {selected.member_ids.length} ligne{selected.member_ids.length > 1 ? 's' : ''}
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs">
                Colonnes <span className="text-muted-foreground">(optionnel, séparées par virgule)</span>
              </Label>
              <Input
                className="mt-1 text-sm"
                placeholder="ex: Niveau, Prise en charge, Résolution"
                value={columnsInput}
                onChange={(e) => setColumnsInput(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Si vide, toutes les colonnes du payload seront affichées.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            <Button onClick={handleAdd} disabled={!collectionId}>Ajouter</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function SectionBlocksEditor({ blocks, onChange }: Props) {
  const { data: collections = [] } = useFragmentCollections();
  const collectionsById = Object.fromEntries(collections.map((c) => [c.id, c]));

  function addBlock(block: SectionBlock) {
    onChange([...blocks, block]);
  }

  function removeBlock(idx: number) {
    onChange(blocks.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Blocs de la section</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="h-7 text-xs">
              <Plus className="h-3.5 w-3.5 mr-1" />
              Bloc
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => addBlock({ type: 'prose' })}>
              <AlignLeft className="h-3.5 w-3.5 mr-2" />
              Texte (prose)
            </DropdownMenuItem>
            <TableBlockPicker onAdd={addBlock} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {blocks.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          Aucun bloc — la section utilise le mode prose par défaut.
        </p>
      )}

      {blocks.map((block, i) => (
        <div
          key={i}
          className="flex items-center gap-2 text-xs px-2 py-1.5 rounded border bg-muted/40"
        >
          {block.type === 'prose' ? (
            <>
              <AlignLeft className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">Texte</span>
            </>
          ) : (
            <>
              <Table2 className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="font-medium truncate">
                {collectionsById[block.collection_id]?.title ?? block.collection_id}
              </span>
              {block.columns && block.columns.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {block.columns.map((col) => (
                    <Badge key={col} variant="secondary" className="text-xs px-1 py-0">
                      {col}
                    </Badge>
                  ))}
                </div>
              )}
            </>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="ml-auto h-5 w-5 shrink-0"
            onClick={() => removeBlock(i)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}
