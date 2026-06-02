import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Check, Archive, Trash2 } from 'lucide-react';
import { StatusBadge } from './status-badge';
import { OriginBadge } from './origin-badge';
import { ConfirmModal } from './confirm-modal';
import { apiRequest } from '@/api/client';

export interface AdminFragment {
  id: string;
  title: string | null;
  body_excerpt: string | null;
  domain: string;
  type: string;
  lang: string;
  quality: string;
  origin: string;
  tags: string[];
  uses: number;
  updated_at: string;
  author: string;
  payload_schema?: string | null;
}

interface Props {
  fragment: AdminFragment;
  isSelected: boolean;
  onToggleSelect: () => void;
  onOpenDetail: () => void;
  onActionComplete: () => void;
}

export function AdminFragmentCard({
  fragment,
  isSelected,
  onToggleSelect,
  onOpenDetail,
  onActionComplete,
}: Props) {
  const [pendingAction, setPendingAction] = useState<'archive' | 'delete' | null>(null);
  const [loading, setLoading] = useState(false);

  const handleApprove = async () => {
    setLoading(true);
    try {
      await apiRequest('POST', `/v1/fragments/${fragment.id}/approve`);
      onActionComplete();
    } catch (e: any) {
      alert(`Erreur : ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleArchive = async () => {
    setLoading(true);
    try {
      await apiRequest('POST', `/v1/fragments/${fragment.id}/deprecate`);
      setPendingAction(null);
      onActionComplete();
    } catch (e: any) {
      alert(`Erreur : ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    setLoading(true);
    try {
      await apiRequest('DELETE', `/v1/fragments/${fragment.id}`);
      setPendingAction(null);
      onActionComplete();
    } catch (e: any) {
      alert(`Erreur : ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const updatedDate = new Date(fragment.updated_at).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <Card
      className={`p-4 cursor-pointer hover:bg-accent/30 transition-colors ${isSelected ? 'ring-2 ring-primary/40' : ''}`}
      onClick={onOpenDetail}
    >
      <div className="flex gap-3">
        {/* Checkbox — stopPropagation so card click doesn't fire */}
        <div className="mt-0.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={isSelected}
            onCheckedChange={onToggleSelect}
            className="h-4 w-4 border-2 border-muted-foreground data-[state=checked]:border-primary"
          />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-sm font-medium truncate">
              {fragment.title || <em className="font-normal text-muted-foreground">Sans titre</em>}
            </span>
            <StatusBadge quality={fragment.quality} />
            <OriginBadge origin={fragment.origin} />
            {(fragment.payload_schema || /^\|.+\|/.test(fragment.body_excerpt?.split('\n')[0] ?? '')) && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-teal-500/15 text-teal-700 dark:text-teal-300">
                📊 Tableau
              </span>
            )}
          </div>

          {fragment.body_excerpt && (
            <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
              {fragment.body_excerpt}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <code className="px-1.5 py-0.5 bg-muted rounded">{fragment.domain}</code>
            <span>{fragment.type}</span>
            <span>·</span>
            <span>{fragment.lang.toUpperCase()}</span>
            {fragment.tags.length > 0 && (
              <>
                <span>·</span>
                <span className="text-blue-600 dark:text-blue-400">
                  #{fragment.tags.slice(0, 2).join(' #')}
                  {fragment.tags.length > 2 && ` +${fragment.tags.length - 2}`}
                </span>
              </>
            )}
            <span>·</span>
            <span title={fragment.updated_at}>{updatedDate}</span>
          </div>
        </div>
      </div>

      {/* Action buttons — stopPropagation so card click doesn't fire */}
      <div className="flex gap-2 flex-wrap mt-3 ml-7" onClick={(e) => e.stopPropagation()}>
        {fragment.quality === 'reviewed' && (
          <Button size="sm" onClick={handleApprove} disabled={loading}>
            <Check className="h-3.5 w-3.5 mr-1.5" />
            Approuver
          </Button>
        )}
        {fragment.quality !== 'deprecated' && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPendingAction('archive')}
            disabled={loading}
            className="text-amber-700 hover:text-amber-700"
          >
            <Archive className="h-3.5 w-3.5 mr-1.5" />
            Archiver
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => setPendingAction('delete')}
          disabled={loading}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5 mr-1.5" />
          Supprimer
        </Button>
      </div>

      {pendingAction === 'archive' && (
        <ConfirmModal
          title="Archiver ce fragment ?"
          message={`"${fragment.title || fragment.id}" sera passé en statut deprecated et retiré de la composition.`}
          confirmLabel="Archiver"
          onConfirm={handleArchive}
          onClose={() => setPendingAction(null)}
        />
      )}
      {pendingAction === 'delete' && (
        <ConfirmModal
          title="Supprimer définitivement ?"
          message={`"${fragment.title || fragment.id}" sera supprimé du vault Git. Action irréversible.`}
          confirmLabel="Supprimer"
          variant="danger"
          onConfirm={handleDelete}
          onClose={() => setPendingAction(null)}
        />
      )}
    </Card>
  );
}
