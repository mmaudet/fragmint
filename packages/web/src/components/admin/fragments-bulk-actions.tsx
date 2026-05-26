// packages/web/src/components/admin/fragments-bulk-actions.tsx
import { useState } from 'react';
import { ConfirmModal } from './confirm-modal';
import { apiRequest } from '@/api/client';

interface Props {
  selectedIds: string[];
  onComplete: () => void;
  onCancel: () => void;
}

type BulkAction = 'approve' | 'archive' | 'delete';

const ENDPOINTS: Record<BulkAction, { method: string; path: string }> = {
  approve: { method: 'POST', path: '/v1/fragments/bulk-approve' },
  archive: { method: 'POST', path: '/v1/admin/fragments/bulk-archive' },
  delete: { method: 'POST', path: '/v1/fragments/bulk-delete' },
};

export function FragmentsBulkActions({ selectedIds, onComplete, onCancel }: Props) {
  const [pendingAction, setPendingAction] = useState<BulkAction | null>(null);
  const [loading, setLoading] = useState(false);

  const executeAction = async (action: BulkAction) => {
    setLoading(true);
    try {
      await apiRequest(ENDPOINTS[action].method, ENDPOINTS[action].path, { ids: selectedIds });
      setPendingAction(null);
      onComplete();
    } catch (e: any) {
      alert(`Erreur : ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const n = selectedIds.length;

  return (
    <div className="flex items-center justify-between bg-primary/5 border border-primary/20 rounded-lg px-4 py-2.5">
      <span className="text-sm font-medium">
        {n} fragment{n > 1 ? 's' : ''} sélectionné{n > 1 ? 's' : ''}
      </span>

      <div className="flex gap-2">
        <button
          onClick={() => setPendingAction('approve')}
          disabled={loading}
          className="px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
        >
          Approuver
        </button>
        <button
          onClick={() => setPendingAction('archive')}
          disabled={loading}
          className="px-3 py-1.5 bg-amber-600 text-white text-sm rounded hover:bg-amber-700 disabled:opacity-50"
        >
          Archiver
        </button>
        <button
          onClick={() => setPendingAction('delete')}
          disabled={loading}
          className="px-3 py-1.5 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50"
        >
          Supprimer
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 border text-sm rounded hover:bg-muted"
        >
          Désélectionner
        </button>
      </div>

      {pendingAction === 'approve' && (
        <ConfirmModal
          title="Approuver les fragments ?"
          message={`${n} fragment${n > 1 ? 's' : ''} seront approuvés. Les fragments non "reviewed" seront ignorés par le serveur.`}
          confirmLabel={`Approuver ${n}`}
          onConfirm={() => executeAction('approve')}
          onClose={() => setPendingAction(null)}
        />
      )}
      {pendingAction === 'archive' && (
        <ConfirmModal
          title="Archiver les fragments ?"
          message={`${n} fragment${n > 1 ? 's' : ''} passeront en "deprecated" et ne seront plus utilisables en composition.`}
          confirmLabel={`Archiver ${n}`}
          onConfirm={() => executeAction('archive')}
          onClose={() => setPendingAction(null)}
        />
      )}
      {pendingAction === 'delete' && (
        <ConfirmModal
          title="Supprimer définitivement ?"
          message={`${n} fragment${n > 1 ? 's' : ''} seront supprimés du vault Git. Action irréversible.`}
          confirmLabel={`Supprimer ${n}`}
          variant="danger"
          onConfirm={() => executeAction('delete')}
          onClose={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}
