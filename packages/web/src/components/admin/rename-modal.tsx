import { useState, useEffect } from 'react';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useActiveJobs } from '@/contexts/active-jobs-context';
import { useI18n } from '@/lib/i18n';
import { apiRequest, getToken } from '@/api/client';

type ReferentialType = 'domain' | 'tag' | 'entity' | 'type' | 'function';

interface RenameImpact {
  affected_fragments: number;
  affected_candidates: number;
  fragments_will_recalculate_signals: boolean;
  estimated_recalc_duration_seconds: number;
}

interface Props {
  type: ReferentialType;
  item: { id: string | number; label: string };
  onClose: () => void;
  onSuccess: () => void;
}

export function RenameModal({ type, item, onClose, onSuccess }: Props) {
  const [newValue, setNewValue] = useState(item.label);
  const [impact, setImpact] = useState<RenameImpact | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debouncedValue = useDebouncedValue(newValue, 500);
  const { addJob } = useActiveJobs();
  const { t } = useI18n();

  useEffect(() => {
    if (!debouncedValue || debouncedValue === item.label) { setImpact(null); setError(null); return; }
    const token = getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    fetch(`/v1/admin/referential/${type}/${item.id}/rename-impact`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ new_value: debouncedValue }),
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.error) { setError(json.error); setImpact(null); }
        else { setImpact(json.data); setError(null); }
      })
      .catch(() => setError(t('admin', 'renameNetworkError')));
  }, [debouncedValue, item.id, item.label, type]);

  const handleRename = async () => {
    setLoading(true);
    try {
      const result = await apiRequest<{ recalculation_job_id?: string }>('POST', `/v1/admin/referential/${type}/${item.id}/rename`, { new_value: newValue });
      if (result?.recalculation_job_id) {
        addJob({ id: result.recalculation_job_id, label: `Recalcul signaux après renommage de "${item.label}"` });
      }
      onSuccess();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background rounded-lg p-6 max-w-md w-full shadow-xl">
        <h2 className="text-lg font-semibold mb-4">{t('admin', 'renameTitle')}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">{t('admin', 'renameCurrent')}</label>
            <code className="block px-3 py-2 bg-muted rounded text-sm">{item.label}</code>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t('admin', 'renameNew')}</label>
            <input
              type="text"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              className="w-full px-3 py-2 border rounded-md text-sm"
              autoFocus
            />
          </div>
          {error && <div className="p-3 bg-destructive/10 border border-destructive/30 rounded text-sm text-destructive">{error}</div>}
          {impact && impact.affected_fragments > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded text-sm">
              <p className="font-medium text-amber-900">{t('admin', 'renameImpact')}</p>
              <ul className="mt-1 text-amber-700 list-disc list-inside">
                <li>{impact.affected_fragments} {t('admin', 'renameFragmentsUpdated')}</li>
                {impact.affected_candidates > 0 && <li>{impact.affected_candidates} {t('admin', 'renameCandidates')}</li>}
                {impact.fragments_will_recalculate_signals && (
                  <li>{t('admin', 'renameRecalc')} (~{impact.estimated_recalc_duration_seconds}s)</li>
                )}
              </ul>
            </div>
          )}
          {impact && impact.affected_fragments === 0 && (
            <div className="p-3 bg-green-50 border border-green-200 rounded text-sm text-green-700">
              {t('admin', 'renameNoImpact')}
            </div>
          )}
        </div>
        <div className="mt-6 flex gap-2 justify-end">
          <button onClick={onClose} disabled={loading} className="px-4 py-2 border rounded-md text-sm hover:bg-muted">
            {t('common', 'cancel')}
          </button>
          <button
            onClick={handleRename}
            disabled={loading || !!error || newValue === item.label || !newValue}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-50"
          >
            {loading ? t('admin', 'renameInProgress') : t('admin', 'rename')}
          </button>
        </div>
      </div>
    </div>
  );
}
