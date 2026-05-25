import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { usePendingCandidates, useBulkAcceptCandidates, useBulkRejectCandidates } from '@/api/hooks/use-admin-harvest';
import { TrustBadge, getTrustLevel, type TrustLevel } from '@/components/admin/harvest/trust-badge';
import { CandidateDetailSheet } from '@/components/candidate-detail-sheet';
import type { CandidateEdits } from '@/components/candidate-detail-sheet';
import { useDomains, useTypes } from '@/api/hooks/use-taxonomy';
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
  const [searchParams] = useSearchParams();
  const jobId = searchParams.get('job_id') ?? undefined;

  const [filter, setFilter] = useState<TrustLevel | 'all' | 'duplicates'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedCandidate, setSelectedCandidate] = useState<HarvestCandidate | null>(null);
  const [modifications, setModifications] = useState<Record<string, CandidateEdits>>({});

  const { data: candidates = [], isLoading } = usePendingCandidates({ job_id: jobId });
  const bulkAccept = useBulkAcceptCandidates();
  const bulkReject = useBulkRejectCandidates();
  const { data: domainsData } = useDomains();
  const { data: typesData } = useTypes();
  const domains = (domainsData ?? []).map((d) => d.slug);
  const types = (typesData ?? []).map((t) => t.slug);

  const sorted = useMemo(
    () =>
      [...candidates].sort((a, b) => {
        const signalDiff = signalSortKey(a) - signalSortKey(b);
        if (signalDiff !== 0) return signalDiff;
        return TRUST_PRIORITY[getTrustLevel(a.trust_sources_json)] - TRUST_PRIORITY[getTrustLevel(b.trust_sources_json)];
      }),
    [candidates],
  );

  const filtered = useMemo(() => {
    if (filter === 'all') return sorted;
    if (filter === 'duplicates') return sorted.filter((c) => !!c.duplicate_of);
    return sorted.filter((c) => getTrustLevel(c.trust_sources_json) === filter);
  }, [sorted, filter]);

  const counts = useMemo(() => {
    const c = { all: candidates.length, high: 0, mixed: 0, low: 0, duplicates: 0 };
    for (const candidate of candidates) {
      c[getTrustLevel(candidate.trust_sources_json)]++;
      if (candidate.duplicate_of) c.duplicates++;
    }
    return c;
  }, [candidates]);

  const allSelected = filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id));

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((c) => c.id)));
    }
  }

  function toggleOne(id: string, checked: boolean) {
    const next = new Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    setSelectedIds(next);
  }

  async function handleBulkAcceptSelected() {
    const ids = Array.from(selectedIds);
    try {
      await bulkAccept.mutateAsync(ids);
      setSelectedIds(new Set());
      toast.success(`${ids.length} fragments validés`);
    } catch {
      toast.error('Erreur lors de la validation');
    }
  }

  async function handleBulkRejectSelected() {
    const ids = Array.from(selectedIds);
    try {
      await bulkReject.mutateAsync(ids);
      setSelectedIds(new Set());
      toast.success(`${ids.length} candidats rejetés`);
    } catch {
      toast.error('Erreur lors du rejet');
    }
  }

  async function handleAcceptOne(candidate: HarvestCandidate) {
    try {
      await bulkAccept.mutateAsync([candidate.id]);
      setSelectedCandidate(null);
      toast.success('Fragment validé');
    } catch {
      toast.error('Erreur lors de la validation');
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Validation des candidats</h1>
        <p className="text-sm text-muted-foreground">
          {jobId ? `Job ${jobId}` : 'Fragments extraits en attente de validation.'}
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {(
          [
            ['all', 'Tous'],
            ['high', '✓ Trust haut'],
            ['mixed', '⚠ Trust mixte'],
            ['low', '⊘ Trust bas'],
            ['duplicates', 'Doublons'],
          ] as [TrustLevel | 'all' | 'duplicates', string][]
        ).map(([val, label]) => (
          <Button
            key={val}
            variant={filter === val ? 'secondary' : 'ghost'}
            size="sm"
            className="text-xs"
            onClick={() => { setFilter(val); setSelectedIds(new Set()); }}
          >
            {label} ({counts[val]})
          </Button>
        ))}
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 py-2 px-3 bg-muted/50 rounded-lg">
          <span className="text-sm font-medium">{selectedIds.size} sélectionné(s)</span>
          <Button size="sm" onClick={handleBulkAcceptSelected} disabled={bulkAccept.isPending || bulkReject.isPending}>
            {bulkAccept.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            Valider
          </Button>
          <Button size="sm" variant="destructive" onClick={handleBulkRejectSelected} disabled={bulkAccept.isPending || bulkReject.isPending}>
            {bulkReject.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            Rejeter
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            Désélectionner
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center">Aucun candidat en attente.</p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-3 px-4 py-2 text-xs text-muted-foreground">
            <Checkbox
              checked={allSelected}
              onCheckedChange={toggleAll}
            />
            <span>Tout sélectionner ({filtered.length})</span>
          </div>

          {filtered.map((c) => (
            <div
              key={c.id}
              className="border rounded-lg p-4 flex items-start gap-3 cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => setSelectedCandidate(c)}
            >
              <Checkbox
                checked={selectedIds.has(c.id)}
                onCheckedChange={(checked) => toggleOne(c.id, !!checked)}
                onClick={(e) => e.stopPropagation()}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm truncate">{c.title}</span>
                  <TrustBadge trustSourcesJson={c.trust_sources_json} />
                  {c.duplicate_of && (
                    <Badge variant="outline" className="text-xs gap-1 text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-300 dark:border-amber-700 dark:bg-amber-950/30">
                      <Copy className="h-2.5 w-2.5" />
                      Doublon
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {c.body?.slice(0, 120)}
                </p>
                {c.duplicate_of && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                    Doublon de : {c.duplicate_of}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <CandidateDetailSheet
        candidate={selectedCandidate}
        edits={selectedCandidate ? (modifications[selectedCandidate.id] ?? {}) : {}}
        decision={undefined}
        domains={domains}
        types={types}
        onEditsChange={(edits) => {
          if (selectedCandidate) setModifications((prev) => ({ ...prev, [selectedCandidate.id]: edits }));
        }}
        onAccept={() => selectedCandidate && handleAcceptOne(selectedCandidate)}
        onReject={() => setSelectedCandidate(null)}
        onClose={() => setSelectedCandidate(null)}
      />
    </div>
  );
}
