import { useState } from 'react';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Lock, Globe, Users, Layers } from 'lucide-react';
import { useCollections, useCreateCollection, useUpdateCollection, useDeleteCollection } from '@/api/hooks/use-collections';
import type { CollectionWithRole } from '@/api/types';
import type { CreateCollectionInput, UpdateCollectionInput } from '@/api/hooks/use-collections';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

const TYPE_ICONS: Record<string, React.ElementType> = {
  system: Layers,
  team: Users,
  personal: Globe,
};

const TYPE_LABELS: Record<string, string> = {
  system: 'Système',
  team: 'Équipe',
  personal: 'Personnel',
};

interface FormState {
  slug: string;
  name: string;
  type: 'system' | 'team' | 'personal';
  description: string;
  read_only: boolean;
}

const EMPTY_FORM: FormState = { slug: '', name: '', type: 'team', description: '', read_only: false };

export default function AdminCollectionsPage() {
  const { data: collections = [], isLoading } = useCollections();
  const createMutation = useCreateCollection();
  const updateMutation = useUpdateCollection();
  const deleteMutation = useDeleteCollection();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CollectionWithRole | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<CollectionWithRole | null>(null);

  const openCreate = () => {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (col: CollectionWithRole) => {
    setEditTarget(col);
    setForm({
      slug: col.slug,
      name: col.name,
      type: col.type,
      description: col.description ?? '',
      read_only: col.read_only,
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim() || (!editTarget && !form.slug.trim())) return;

    try {
      if (editTarget) {
        const input: UpdateCollectionInput = {
          name: form.name,
          description: form.description || undefined,
          read_only: form.read_only ? 1 : 0,
        };
        await updateMutation.mutateAsync({ slug: editTarget.slug, input });
        toast.success('Collection mise à jour');
      } else {
        const input: CreateCollectionInput = {
          slug: form.slug.trim().toLowerCase().replace(/\s+/g, '-'),
          name: form.name,
          type: form.type,
          description: form.description || undefined,
        };
        await createMutation.mutateAsync(input);
        toast.success('Collection créée');
      }
      setDialogOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? 'Erreur');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.slug);
      toast.success('Collection supprimée');
      setDeleteTarget(null);
    } catch (e: any) {
      toast.error(e.message ?? 'Erreur');
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Collections</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Groupes de fragments par équipe, projet ou usage.
          </p>
        </div>
        <Button onClick={openCreate} size="sm">
          <Plus className="h-4 w-4 mr-1" />
          Nouvelle collection
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : collections.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border rounded-lg">
          <Layers className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Aucune collection.</p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-40">Slug</TableHead>
                <TableHead>Nom</TableHead>
                <TableHead className="w-32">Type</TableHead>
                <TableHead className="w-36">Accès</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {collections.map((col) => {
                const Icon = TYPE_ICONS[col.type] ?? Globe;
                return (
                  <TableRow key={col.slug}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{col.slug}</TableCell>
                    <TableCell className="font-medium">{col.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs gap-1">
                        <Icon className="h-3 w-3" />
                        {TYPE_LABELS[col.type] ?? col.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {col.read_only ? (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                          <Lock className="h-3 w-3" /> Lecture seule
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Lecture/écriture</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                      {col.description ?? '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(col)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteTarget(col)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Modifier la collection' : 'Nouvelle collection'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!editTarget && (
              <div className="space-y-1.5">
                <Label htmlFor="slug">Slug</Label>
                <Input
                  id="slug"
                  placeholder="ex: twake-commercial"
                  value={form.slug}
                  onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">Identifiant unique, non modifiable après création.</p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="name">Nom</Label>
              <Input
                id="name"
                placeholder="ex: Twake — équipe commerciale"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            {!editTarget && (
              <div className="space-y-1.5">
                <Label htmlFor="type">Type</Label>
                <Select
                  value={form.type}
                  onValueChange={(v) => setForm((f) => ({ ...f, type: v as FormState['type'] }))}
                >
                  <SelectTrigger id="type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="team">Équipe</SelectItem>
                    <SelectItem value="personal">Personnel</SelectItem>
                    <SelectItem value="system">Système</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="description">Description (optionnel)</Label>
              <Input
                id="description"
                placeholder="Usage ou périmètre de cette collection"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            {editTarget && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="read_only"
                  checked={form.read_only}
                  onChange={(e) => setForm((f) => ({ ...f, read_only: e.target.checked }))}
                  className="h-4 w-4"
                />
                <Label htmlFor="read_only" className="font-normal cursor-pointer">Lecture seule</Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button onClick={handleSubmit} disabled={isPending || !form.name.trim() || (!editTarget && !form.slug.trim())}>
              {editTarget ? 'Enregistrer' : 'Créer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Supprimer la collection ?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            La collection <span className="font-mono font-medium">{deleteTarget?.slug}</span> sera supprimée.
            Les fragments qu'elle contient ne seront pas supprimés.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Annuler</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteMutation.isPending}>
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
