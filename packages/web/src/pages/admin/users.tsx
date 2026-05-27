import { useState } from 'react';
import { toast } from 'sonner';
import {
  Plus,
  Pencil,
  Trash2,
  Users,
  ShieldCheck,
  ShieldOff,
  UserCheck,
  UserX,
} from 'lucide-react';
import { useUsers, useCreateUser, useUpdateUser, useDeleteUser } from '@/api/hooks/use-users';
import type { AdminUser } from '@/api/types';
import type { UpdateUserInput, CreateUserInput } from '@/api/hooks/use-users';
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

interface EditFormState {
  display_name: string;
  role: string;
  active: boolean;
}

interface CreateFormState {
  login: string;
  password: string;
  display_name: string;
  role: string;
  active: boolean;
}

const EMPTY_CREATE: CreateFormState = {
  login: '',
  password: '',
  display_name: '',
  role: 'reader',
  active: true,
};

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

export default function AdminUsersPage() {
  const { data: users = [], isLoading } = useUsers();
  const createMutation = useCreateUser();
  const updateMutation = useUpdateUser();
  const deleteMutation = useDeleteUser();

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormState>(EMPTY_CREATE);

  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [editForm, setEditForm] = useState<EditFormState>({
    display_name: '',
    role: 'reader',
    active: true,
  });
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);

  const activeCount = users.filter((u) => u.active === 1).length;
  const inactiveCount = users.filter((u) => u.active === 0).length;

  const openEdit = (u: AdminUser) => {
    setEditTarget(u);
    setEditForm({ display_name: u.display_name, role: u.role, active: u.active === 1 });
  };

  const handleCreate = async () => {
    if (!createForm.login.trim() || !createForm.password || !createForm.display_name.trim()) return;
    try {
      const input: CreateUserInput = {
        login: createForm.login.trim(),
        password: createForm.password,
        display_name: createForm.display_name.trim(),
        role: createForm.role,
        active: createForm.active ? 1 : 0,
      };
      await createMutation.mutateAsync(input);
      toast.success('Utilisateur créé');
      setCreateOpen(false);
      setCreateForm(EMPTY_CREATE);
    } catch (e: any) {
      toast.error(e.message ?? 'Erreur');
    }
  };

  const handleEditSubmit = async () => {
    if (!editTarget || !editForm.display_name.trim()) return;
    try {
      const input: UpdateUserInput = {
        display_name: editForm.display_name,
        role: editForm.role,
        active: editForm.active ? 1 : 0,
      };
      await updateMutation.mutateAsync({ id: editTarget.id, input });
      toast.success('Utilisateur mis à jour');
      setEditTarget(null);
    } catch (e: any) {
      toast.error(e.message ?? 'Erreur');
    }
  };

  const handleToggleActive = async (u: AdminUser) => {
    const newActive = u.active === 1 ? 0 : 1;
    try {
      await updateMutation.mutateAsync({ id: u.id, input: { active: newActive } });
      toast.success(newActive === 1 ? 'Compte activé' : 'Compte désactivé');
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
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Utilisateurs</h1>
          <p className="text-sm text-muted-foreground mt-1">Gestion des comptes et des rôles.</p>
          {users.length > 0 && (
            <div className="flex gap-3 mt-2">
              <span className="text-xs text-emerald-600 font-medium">
                {activeCount} actif{activeCount > 1 ? 's' : ''}
              </span>
              {inactiveCount > 0 && (
                <span className="text-xs text-amber-600 font-medium">
                  {inactiveCount} inactif{inactiveCount > 1 ? 's' : ''} — en attente d'activation
                </span>
              )}
            </div>
          )}
        </div>
        <Button
          size="sm"
          onClick={() => {
            setCreateForm(EMPTY_CREATE);
            setCreateOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1" />
          Créer un utilisateur
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : users.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border rounded-lg">
          <Users className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Aucun utilisateur.</p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-36">Login</TableHead>
                <TableHead>Nom affiché</TableHead>
                <TableHead className="w-28">Rôle</TableHead>
                <TableHead className="w-24">Statut</TableHead>
                <TableHead className="w-24">Créé le</TableHead>
                <TableHead className="w-36">Dernière connexion</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id} className={u.active === 0 ? 'opacity-60' : undefined}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {u.login}
                  </TableCell>
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
                      <span className="inline-flex items-center gap-1 text-xs text-amber-600 font-medium">
                        <ShieldOff className="h-3 w-3" /> Inactif
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(u.created_at)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(u.last_login)}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`h-7 w-7 ${u.active === 0 ? 'text-emerald-600 hover:text-emerald-700' : 'text-amber-600 hover:text-amber-700'}`}
                        title={u.active === 1 ? 'Désactiver' : 'Activer'}
                        onClick={() => handleToggleActive(u)}
                        disabled={updateMutation.isPending}
                      >
                        {u.active === 1 ? (
                          <UserX className="h-3.5 w-3.5" />
                        ) : (
                          <UserCheck className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => openEdit(u)}
                      >
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
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={(v) => !v && setCreateOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Créer un utilisateur</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-login">Login</Label>
              <Input
                id="new-login"
                placeholder="ex: jdupont"
                value={createForm.login}
                onChange={(e) => setCreateForm((f) => ({ ...f, login: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-display_name">Nom affiché</Label>
              <Input
                id="new-display_name"
                placeholder="ex: Jean Dupont"
                value={createForm.display_name}
                onChange={(e) => setCreateForm((f) => ({ ...f, display_name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-password">Mot de passe</Label>
              <Input
                id="new-password"
                type="password"
                placeholder="6 caractères minimum"
                value={createForm.password}
                onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-role">Rôle</Label>
              <Select
                value={createForm.role}
                onValueChange={(v) => setCreateForm((f) => ({ ...f, role: v }))}
              >
                <SelectTrigger id="new-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="new-active"
                checked={createForm.active}
                onChange={(e) => setCreateForm((f) => ({ ...f, active: e.target.checked }))}
                className="h-4 w-4"
              />
              <Label htmlFor="new-active" className="font-normal cursor-pointer">
                Compte actif immédiatement
                {!createForm.active && (
                  <span className="ml-1.5 text-xs text-amber-600">(en attente d'activation)</span>
                )}
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Annuler
            </Button>
            <Button
              onClick={handleCreate}
              disabled={
                createMutation.isPending ||
                !createForm.login.trim() ||
                !createForm.password ||
                !createForm.display_name.trim()
              }
            >
              Créer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                value={editForm.display_name}
                onChange={(e) => setEditForm((f) => ({ ...f, display_name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role">Rôle</Label>
              <Select
                value={editForm.role}
                onValueChange={(v) => setEditForm((f) => ({ ...f, role: v }))}
              >
                <SelectTrigger id="role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="active"
                checked={editForm.active}
                onChange={(e) => setEditForm((f) => ({ ...f, active: e.target.checked }))}
                className="h-4 w-4"
              />
              <Label htmlFor="active" className="font-normal cursor-pointer">
                Compte actif
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              Annuler
            </Button>
            <Button
              onClick={handleEditSubmit}
              disabled={updateMutation.isPending || !editForm.display_name.trim()}
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
            Le compte <span className="font-mono font-medium">{deleteTarget?.login}</span> sera
            définitivement supprimé.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Annuler
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
