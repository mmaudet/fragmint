import { useState, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { usePlans, useDeletePlan } from '@/api/hooks/use-plans';
import { useUsers } from '@/api/hooks/use-users';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { Trash2, PenLine, ArrowUpDown } from 'lucide-react';
import { toast } from 'sonner';
import type { PlanStatus } from '@/api/types';

const STATUS_CONFIG: Record<PlanStatus, { label: string; className: string }> = {
  draft:               { label: 'Brouillon',          className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' },
  plan_generated:      { label: 'Plan généré',        className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  plan_validated:      { label: 'Plan validé',        className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' },
  fragments_validated: { label: 'Fragments validés',  className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' },
  completed:           { label: 'Terminé',            className: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
};

function StatusBadge({ status }: { status: PlanStatus }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, className: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`inline-flex w-fit px-2 py-0.5 rounded text-xs font-medium ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

type SortKey = 'updated_at' | 'created_at' | 'title' | 'status' | 'owner';

export function PlanList({ onCreate }: { onCreate: () => void }) {
  const { data: plans = [], isLoading } = usePlans();
  const { data: users = [] } = useUsers();
  const displayName = (login: string) =>
    users.find((u) => u.login === login)?.display_name ?? login;
  const remove = useDeletePlan();
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const search = searchParams.get('q') ?? '';
  const statusFilter = searchParams.get('status') ?? 'all';
  const sortKey = (searchParams.get('sort') ?? 'updated_at') as SortKey;
  const sortDir = (searchParams.get('dir') ?? 'desc') as 'asc' | 'desc';

  function setParam(key: string, value: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (!value || value === 'all') next.delete(key);
      else next.set(key, value);
      return next;
    }, { replace: true });
  }

  function toggleSort(key: SortKey) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (prev.get('sort') === key) {
        next.set('dir', prev.get('dir') === 'desc' ? 'asc' : 'desc');
      } else {
        next.set('sort', key);
        next.set('dir', 'desc');
      }
      return next;
    }, { replace: true });
  }

  const filtered = useMemo(() => {
    let list = plans;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.title?.toLowerCase().includes(q));
    }
    if (statusFilter !== 'all') list = list.filter((p) => p.status === statusFilter);
    return [...list].sort((a, b) => {
      const av = a[sortKey] ?? '', bv = b[sortKey] ?? '';
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [plans, search, statusFilter, sortKey, sortDir]);

  function SortTh({ col, label }: { col: SortKey; label: string }) {
    const active = sortKey === col;
    return (
      <th
        className="text-left px-4 py-2 text-xs font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground whitespace-nowrap"
        onClick={() => toggleSort(col)}
      >
        <span className="flex items-center gap-1">
          {label}
          <ArrowUpDown className={`h-3 w-3 ${active ? 'opacity-80' : 'opacity-30'}`} />
        </span>
      </th>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Plans</h1>
        <Button onClick={onCreate}>+ {t('planGeneration', 'newPlan')}</Button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Rechercher un plan…"
          value={search}
          onChange={(e) => setParam('q', e.target.value)}
          className="px-3 py-1.5 border rounded-md text-sm bg-background w-64 focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <select
          value={statusFilter}
          onChange={(e) => setParam('status', e.target.value)}
          className="px-3 py-1.5 border rounded-md text-sm bg-background"
        >
          <option value="all">Tous les statuts</option>
          {(Object.keys(STATUS_CONFIG) as PlanStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} plan{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          {plans.length === 0 ? "Aucun plan pour l'instant." : 'Aucun plan ne correspond aux filtres.'}
        </div>
      ) : (
        <div className="border rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b">
              <tr>
                <SortTh col="title" label="Nom" />
                <SortTh col="status" label="Statut" />
                <SortTh col="owner" label="Créé par" />
                <SortTh col="created_at" label="Créé" />
                <SortTh col="updated_at" label="Modifié" />
                <th className="px-4 py-2 w-20" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((p) => {
                const planUrl = `/plans?id=${p.id}`;
                const isConfirming = confirmingId === p.id;
                return (
                  <tr
                    key={p.id}
                    className={`hover:bg-muted/20 transition-colors group ${isConfirming ? 'bg-destructive/5' : ''}`}
                  >
                    {/* Name — real <Link> so browser shows URL + ctrl+click works */}
                    <td className="px-4 py-3 font-medium max-w-0 w-full">
                      <Link
                        to={planUrl}
                        className="block truncate"
                        title={p.title}
                      >
                        {p.title || <em className="text-muted-foreground font-normal">Sans titre</em>}
                      </Link>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {displayName(p.owner)}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(p.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(p.updated_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3">
                      {isConfirming ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => {
                              setConfirmingId(null);
                              remove.mutate(p.id, {
                                onError: (err: any) => toast.error(`Erreur: ${err.message ?? err}`),
                              });
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-destructive text-white hover:bg-destructive/90 transition-colors"
                          >
                            <Trash2 className="h-3 w-3" />
                            Supprimer
                          </button>
                          <button
                            onClick={() => setConfirmingId(null)}
                            className="px-2 py-1 text-xs rounded border hover:bg-muted transition-colors"
                          >
                            Annuler
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <Link
                            to={planUrl}
                            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            title="Éditer"
                          >
                            <PenLine className="h-3.5 w-3.5" />
                          </Link>
                          <button
                            onClick={() => setConfirmingId(p.id)}
                            className="p-1.5 rounded hover:bg-destructive/10 text-destructive transition-colors"
                            title="Supprimer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
