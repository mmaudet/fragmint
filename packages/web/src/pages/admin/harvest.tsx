import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { usePendingCandidates, useBulkAcceptCandidates } from '@/api/hooks/use-admin-harvest';
import { TrustBadge, getTrustLevel, type TrustLevel } from '@/components/admin/harvest/trust-badge';
import type { HarvestCandidate } from '@/api/types';

const TRUST_PRIORITY: Record<TrustLevel, number> = { high: 0, mixed: 1, low: 2 };

function signalSortKey(candidate: HarvestCandidate): number {
  const signals = candidate.quality_signals ?? [];
  if (signals.some((s) => s.level === 'error')) return -1000;
  const warningCount = signals.filter((s) => s.level === 'warning').length;
  if (warningCount > 0) return -warningCount;
  return 0;
}

export default function AdminHarvestPage() {
  const [trustFilter, setTrustFilter] = useState<TrustLevel | 'all'>('all');
  const { data: candidates = [], isLoading } = usePendingCandidates();
  const bulkAccept = useBulkAcceptCandidates();

  const sorted = useMemo(
    () =>
      [...candidates].sort((a, b) => {
        const signalDiff = signalSortKey(a) - signalSortKey(b);
        if (signalDiff !== 0) return signalDiff;
        return TRUST_PRIORITY[getTrustLevel(a.trust_sources_json)] - TRUST_PRIORITY[getTrustLevel(b.trust_sources_json)];
      }),
    [candidates],
  );

  const filtered = useMemo(
    () =>
      trustFilter === 'all'
        ? sorted
        : sorted.filter((c) => getTrustLevel(c.trust_sources_json) === trustFilter),
    [sorted, trustFilter],
  );

  const counts = useMemo(() => {
    const c = { all: candidates.length, high: 0, mixed: 0, low: 0 };
    for (const candidate of candidates) {
      c[getTrustLevel(candidate.trust_sources_json)]++;
    }
    return c;
  }, [candidates]);

  async function handleBulkAccept() {
    const ids = filtered.map((c) => c.id);
    try {
      await bulkAccept.mutateAsync(ids);
      toast.success(`${ids.length} fragments créés en draft`);
    } catch {
      toast.error('Erreur lors de la validation');
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Validation des candidats</h1>
        <p className="text-sm text-muted-foreground">Fragments extraits en attente de validation.</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {(
          [
            ['all', 'Tous'],
            ['high', '✓ Trust haut'],
            ['mixed', '⚠ Trust mixte'],
            ['low', '⊘ Trust bas'],
          ] as [TrustLevel | 'all', string][]
        ).map(([val, label]) => (
          <Button
            key={val}
            variant={trustFilter === val ? 'secondary' : 'ghost'}
            size="sm"
            className="text-xs"
            onClick={() => setTrustFilter(val)}
          >
            {label} ({counts[val]})
          </Button>
        ))}
      </div>

      {trustFilter === 'high' && filtered.length > 0 && (
        <Button onClick={handleBulkAccept} disabled={bulkAccept.isPending} size="sm">
          {bulkAccept.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Tout valider ces {filtered.length} fragments Trust haut
        </Button>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center">Aucun candidat en attente.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => (
            <div key={c.id} className="border rounded-lg p-4 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm truncate">{c.title}</span>
                  <TrustBadge trustSourcesJson={c.trust_sources_json} />
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {c.body?.slice(0, 120)}
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link to={`/admin/harvest/jobs/${c.job_id}`}>Détail job</Link>
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
