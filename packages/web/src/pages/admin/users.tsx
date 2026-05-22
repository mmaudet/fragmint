import { useState } from 'react';
import { toast } from 'sonner';
import { Pencil, Trash2, Users, ShieldCheck, ShieldOff } from 'lucide-react';
import { useUsers, useUpdateUser, useDeleteUser } from '@/api/hooks/use-users';
import type { AdminUser } from '@/api/types';
import type { UpdateUserInput } from '@/api/hooks/use-users';
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

const ROLES = ['reader', 'contributor', 'expert', 'admin'] as const;

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400',
  expert: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-400',
  contributor: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-400',
  reader: 'bg-muted text-muted-foreground',
};

interface FormState {
  display_name: string;
  role: string;
  active: boolean;
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export default function AdminUsersPage() {
  const { data: users = [], isLoading } = useUsers();
  const updateMutation = useUpdateUser();
  const deleteMutation = useDeleteUser();

  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [form, setForm] = useState<FormState>({ display_name: '', role: 'reader', active: true });
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);

  const openEdit = (u: AdminUser) => {
    setEditTarget(u);
    setForm({ display_name: u.display_name, role: u.role, active: u.active === 1 });
  };

  const handleSubmit = async () => {
    if (!editTarget || !form.display_name.trim()) return;
    try {
      const input: UpdateUserInput = {
        display_name: form.display_name,
        role: form.role,
        active: form.active ? 1 : 0,
      };
      await updateMutation.mutateAsync({ id: editTarget.id, input });
      toast.success('Utilisateur mis à jour');
      setEditTarget(null);
    } catch (e: any) {
      toast.error(e.message ?? 'Erreur');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      toast.success('Utilisateur supprimé');
      setDeleteTarget(null);
    } catch (e: any) {
      toast.error(e.message ?? 'Erreur');
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Utilisateurs</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gestion des comptes et des rôles.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : users.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border rounded-lg">
          <Users className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Aucun utilisateur.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Login</TableHead>
              <TableHead>Nom affiché</TableHead>
              <TableHead>Rôle</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Créé le</TableHead>
              <TableHead>Dernière connexion</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id} className={u.active === 0 ? 'opacity-50' : undefined}>
                <TableCell className="font-mono text-xs text-muted-foreground">{u.login}</TableCell>
                <TableCell className="font-medium">{u.display_name}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={`text-xs ${ROLE_COLORS[u.role] ?? ''}`}>
                    {u.role}
                  </Badge>
                </TableCell>
                <TableCell>
                  {u.active === 1 ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                      <ShieldCheck className="h-3 w-3" /> Actif
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <ShieldOff className="h-3 w-3" /> Désactivé
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDate(u.created_at)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDate(u.last_login)}</TableCell>
                <TableCell>
                  <div className="flex gap-1 justify-end">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(u)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(u)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={(v) => !v && setEditTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Modifier l'utilisateur</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Login</Label>
              <p className="text-sm font-mono text-muted-foreground">{editTarget?.login}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="display_name">Nom affiché</Label>
              <Input
                id="display_name"
                value={form.display_name}
                onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role">Rôle</Label>
              <Select
                value={form.role}
                onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}
              >
                <SelectTrigger id="role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="active"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                className="h-4 w-4"
              />
              <Label htmlFor="active" className="font-normal cursor-pointer">Compte actif</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Annuler</Button>
            <Button
              onClick={handleSubmit}
              disabled={updateMutation.isPending || !form.display_name.trim()}
            >
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Supprimer l'utilisateur ?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Le compte <span className="font-mono font-medium">{deleteTarget?.login}</span> sera définitivement supprimé.
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
