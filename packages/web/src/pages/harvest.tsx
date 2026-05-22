import { useState, useRef, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useI18n } from '@/lib/i18n';
import { useCollection } from '@/lib/collection-context';
import { CollectionSelector } from '@/components/collection-selector';
import { useStartHarvest, useHarvestJob, useValidateCandidates } from '@/api/hooks/use-harvest';
import { useDomains, useTypes } from '@/api/hooks/use-taxonomy';
import { CandidateCard } from '@/components/candidate-card';
import { CandidateDetailSheet } from '@/components/candidate-detail-sheet';
import type { CandidateEdits } from '@/components/candidate-detail-sheet';
import { UploadHintsForm } from '@/components/harvest/upload-hints-form';
import type { UploadHints } from '@/types/trust-source';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Upload, Loader2, CheckCircle, XCircle, AlertTriangle, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HarvestCandidate } from '@/api/types';

export default function HarvestPage() {
  const { t } = useI18n();
  const { activeCollection, setActiveCollection } = useCollection();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const urlJobId = searchParams.get('job');
  const [files, setFiles] = useState<File[]>([]);
  const [uploadHints, setUploadHints] = useState<UploadHints>({});
  const [dragOver, setDragOver] = useState(false);
  const [decisions, _setDecisions] = useState<Record<string, 'accepted' | 'rejected'>>(() => {
    if (!urlJobId) return {};
    try { return JSON.parse(sessionStorage.getItem(`harvest-decisions-${urlJobId}`) ?? '{}'); } catch { return {}; }
  });
  const [modifications, _setModifications] = useState<Record<string, CandidateEdits>>(() => {
    if (!urlJobId) return {};
    try { return JSON.parse(sessionStorage.getItem(`harvest-mods-${urlJobId}`) ?? '{}'); } catch { return {}; }
  });
  const [selectedCandidate, setSelectedCandidate] = useState<HarvestCandidate | null>(null);
  const [candidatePage, setCandidatePage] = useState(0);
  const [candidatePageSize, setCandidatePageSize] = useState(24);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const jobId = urlJobId;
  const setJobId = (id: string | null) => {
    if (id) setSearchParams({ job: id }, { replace: true });
    else setSearchParams({}, { replace: true });
  };

  const setDecisions = (updater: Record<string, 'accepted' | 'rejected'> | ((prev: Record<string, 'accepted' | 'rejected'>) => Record<string, 'accepted' | 'rejected'>)) => {
    _setDecisions((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (jobId) sessionStorage.setItem(`harvest-decisions-${jobId}`, JSON.stringify(next));
      return next;
    });
  };

  const setModifications = (updater: Record<string, CandidateEdits> | ((prev: Record<string, CandidateEdits>) => Record<string, CandidateEdits>)) => {
    _setModifications((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (jobId) sessionStorage.setItem(`harvest-mods-${jobId}`, JSON.stringify(next));
      return next;
    });
  };

  const queryClient = useQueryClient();
  const startHarvest = useStartHarvest(activeCollection);
  const { data: job, isLoading: jobLoading } = useHarvestJob(activeCollection, jobId);
  const validateMutation = useValidateCandidates(activeCollection);

  if (job?.collection_slug && job.collection_slug !== activeCollection) {
    setActiveCollection(job.collection_slug);
  }

  const resolvedDecisions = useMemo<Record<string, 'accepted' | 'rejected'>>(() => {
    if (Object.keys(decisions).length > 0) return decisions;
    if (!job?.candidates) return decisions;
    const fromDb: Record<string, 'accepted' | 'rejected'> = {};
    for (const c of job.candidates) {
      if (c.status === 'accepted' || c.status === 'rejected') fromDb[c.id] = c.status;
    }
    return Object.keys(fromDb).length > 0 ? fromDb : decisions;
  }, [decisions, job]);

  const { data: domainsData } = useDomains();
  const { data: typesData } = useTypes();
  const domains = (domainsData ?? []).map((d) => d.slug);
  const types = (typesData ?? []).map((t) => t.slug);

  const handleFiles = useCallback((newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles).filter((f) => f.name.endsWith('.docx'));
    setFiles((prev) => [...prev, ...arr]);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const handleAnalyze = () => {
    if (files.length === 0) return;
    startHarvest.mutate(
      { files, uploadHints },
      {
        onSuccess: (data) => setJobId(data.job_id),
        onError: (err) => toast.error(err.message),
      },
    );
  };

  const setDecision = (id: string, decision: 'accepted' | 'rejected') => {
    setDecisions((prev) => ({ ...prev, [id]: decision }));
  };

  const acceptAll = () => {
    if (!job?.candidates) return;
    const all: Record<string, 'accepted' | 'rejected'> = {};
    for (const c of job.candidates) {
      if (c.status === 'pending') all[c.id] = 'accepted';
    }
    setDecisions(all);
  };

  const rejectAll = () => {
    if (!job?.candidates) return;
    const all: Record<string, 'accepted' | 'rejected'> = {};
    for (const c of job.candidates) {
      if (c.status === 'pending') all[c.id] = 'rejected';
    }
    setDecisions(all);
  };

  const handleCommit = () => {
    if (!jobId) return;
    const accepted: string[] = [];
    const modified: Array<{ id: string } & CandidateEdits> = [];
    const rejected = Object.entries(resolvedDecisions)
      .filter(([, v]) => v === 'rejected')
      .map(([k]) => k);

    for (const [id, decision] of Object.entries(resolvedDecisions)) {
      if (decision !== 'accepted') continue;
      const edits = modifications[id];
      if (edits && Object.keys(edits).length > 0) {
        modified.push({ id, ...edits });
      } else {
        accepted.push(id);
      }
    }

    validateMutation.mutate(
      { jobId, accepted, rejected, modified, merged: [] },
      {
        onSuccess: (data) => {
          sessionStorage.removeItem(`harvest-decisions-${jobId}`);
          sessionStorage.removeItem(`harvest-mods-${jobId}`);
          queryClient.invalidateQueries({ queryKey: ['harvest-job', activeCollection, jobId] });
          toast.success(`${data.committed} ${t('harvest', 'committed')}`);
          navigate(`/harvest/${jobId}/debrief`);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  // ─── Phase 1: Upload ───
  if (!jobId) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-6">
          <h2 className="text-2xl font-bold">{t('harvest', 'title')}</h2>
          <CollectionSelector />
        </div>

        <div
          className={cn(
            'border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors',
            dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50',
          )}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">{t('harvest', 'dropzone')}</p>
          <p className="text-xs text-muted-foreground mt-1">{t('harvest', 'formats')}</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
        </div>

        {files.length > 0 && (
          <div className="space-y-2">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span>{f.name}</span>
                <Badge variant="outline" className="text-xs">{(f.size / 1024).toFixed(0)} KB</Badge>
              </div>
            ))}
          </div>
        )}

        <UploadHintsForm hints={uploadHints} onChange={setUploadHints} />

        <Button onClick={handleAnalyze} disabled={files.length === 0 || startHarvest.isPending} className="w-full">
          {startHarvest.isPending ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t('harvest', 'analyzing')}</>
          ) : (
            <><Upload className="h-4 w-4 mr-2" />{t('harvest', 'analyze')}</>
          )}
        </Button>
      </div>
    );
  }

  // ─── Phase 2: Candidate Review ───

  if (jobLoading || job?.status === 'processing') {
    return (
      <div className="p-6 space-y-6">
        <h2 className="text-2xl font-bold">{t('harvest', 'title')}</h2>
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>{t('harvest', 'analyzing')}</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (job?.status === 'error') {
    return (
      <div className="p-6 space-y-6">
        <h2 className="text-2xl font-bold">{t('harvest', 'title')}</h2>
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          <span>{t('harvest', 'error')}: {job.error}</span>
        </div>
        <Button variant="outline" onClick={() => { setJobId(null); setFiles([]); }}>
          {t('harvest', 'uploadTitle')}
        </Button>
      </div>
    );
  }

  const candidates = job?.candidates ?? [];
  const stats = job?.stats;
  const acceptedCount = Object.values(resolvedDecisions).filter((v) => v === 'accepted').length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-6">
        <h2 className="text-2xl font-bold">{t('harvest', 'title')}</h2>
        <CollectionSelector />
      </div>

      {stats && (
        <div className="grid gap-4 md:grid-cols-4">
          {[
            { label: t('harvest', 'total'), value: stats.total, color: '' },
            { label: t('harvest', 'duplicates'), value: stats.duplicates, color: 'text-amber-600' },
            { label: t('harvest', 'lowConfidence'), value: stats.low_confidence, color: 'text-red-600' },
            { label: t('harvest', 'valid'), value: stats.valid, color: 'text-green-600' },
          ].map(({ label, value, color }) => (
            <Card key={label}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {candidates.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={acceptAll}>
            <CheckCircle className="h-4 w-4 mr-1" />{t('harvest', 'acceptAll')}
          </Button>
          <Button variant="outline" size="sm" onClick={rejectAll}>
            <XCircle className="h-4 w-4 mr-1" />{t('harvest', 'rejectAll')}
          </Button>
          <Button
            size="sm"
            onClick={handleCommit}
            disabled={acceptedCount === 0 || validateMutation.isPending}
          >
            {validateMutation.isPending
              ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              : <CheckCircle className="h-4 w-4 mr-1" />}
            {t('harvest', 'commit')} ({acceptedCount})
          </Button>
        </div>
      )}

      {(() => {
        const pageCount = Math.ceil(candidates.length / candidatePageSize);
        const paginated = candidates.slice(candidatePage * candidatePageSize, (candidatePage + 1) * candidatePageSize);
        return (
          <>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {paginated.map((c) => (
                <CandidateCard
                  key={c.id}
                  candidate={c}
                  decision={resolvedDecisions[c.id]}
                  onAccept={() => setDecision(c.id, 'accepted')}
                  onReject={() => setDecision(c.id, 'rejected')}
                  onClick={() => setSelectedCandidate(c)}
                />
              ))}
            </div>
            {pageCount > 1 && (
              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>{t('common', 'show')}</span>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={candidatePageSize}
                    onChange={(e) => { setCandidatePageSize(Number(e.target.value)); setCandidatePage(0); }}
                  >
                    {[24, 48, 96].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <span>{t('common', 'perPage')}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Button variant="outline" size="sm" disabled={candidatePage === 0} onClick={() => setCandidatePage((p) => p - 1)}>
                    {t('common', 'previous')}
                  </Button>
                  <span className="text-sm text-muted-foreground">Page {candidatePage + 1} / {pageCount}</span>
                  <Button variant="outline" size="sm" disabled={candidatePage >= pageCount - 1} onClick={() => setCandidatePage((p) => p + 1)}>
                    {t('common', 'next')}
                  </Button>
                </div>
              </div>
            )}
          </>
        );
      })()}

      <CandidateDetailSheet
        candidate={selectedCandidate}
        edits={selectedCandidate ? (modifications[selectedCandidate.id] ?? {}) : {}}
        decision={selectedCandidate ? resolvedDecisions[selectedCandidate.id] : undefined}
        domains={domains}
        types={types}
        onEditsChange={(edits) => {
          if (selectedCandidate) setModifications((prev) => ({ ...prev, [selectedCandidate.id]: edits }));
        }}
        onAccept={() => selectedCandidate && setDecision(selectedCandidate.id, 'accepted')}
        onReject={() => selectedCandidate && setDecision(selectedCandidate.id, 'rejected')}
        onClose={() => setSelectedCandidate(null)}
      />
    </div>
  );
}
