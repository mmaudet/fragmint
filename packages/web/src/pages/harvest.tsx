import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useI18n } from '@/lib/i18n';
import { useCollection } from '@/lib/collection-context';
import { CollectionSelector } from '@/components/collection-selector';
import { useStartHarvest, useHarvestJob, useValidateCandidates, useDeleteHarvestJob } from '@/api/hooks/use-harvest';
import { useDomains, useTypes, useTags } from '@/api/hooks/use-taxonomy';
import { CandidateCard } from '@/components/candidate-card';
import { CandidateDetailSheet } from '@/components/candidate-detail-sheet';
import type { CandidateEdits } from '@/components/candidate-detail-sheet';
import { UploadHintsForm } from '@/components/harvest/upload-hints-form';
import type { UploadHints } from '@/types/trust-source';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Upload,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  FileText,
  FileSearch,
  Sparkles,
  Tags,
  ShieldCheck,
  X,
  Trash2,
  TableProperties,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HarvestCandidate } from '@/api/types';

const PIPELINE_STEPS = [
  { key: 'convert', icon: FileSearch, labelKey: 'stepConvert' as const },
  { key: 'segment', icon: Sparkles, labelKey: 'stepSegment' as const },
  { key: 'classify', icon: Tags, labelKey: 'stepClassify' as const },
  { key: 'judge', icon: ShieldCheck, labelKey: 'stepJudge' as const },
];

function HarvestProcessingView({
  files,
  t,
}: {
  files: string[];
  t: ReturnType<typeof useI18n>['t'];
}) {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const durations = [4000, 20000, 15000, 8000];
    let step = 0;
    const advance = () => {
      step = Math.min(step + 1, PIPELINE_STEPS.length - 1);
      setActiveStep(step);
      if (step < PIPELINE_STEPS.length - 1) {
        setTimeout(advance, durations[step]);
      }
    };
    const timer = setTimeout(advance, durations[0]);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="p-6 space-y-8">
      <h2 className="text-2xl font-bold">{t('harvest', 'title')}</h2>

      <div className="flex flex-col gap-2 max-w-sm">
        {PIPELINE_STEPS.map((step, i) => {
          const Icon = step.icon;
          const isDone = i < activeStep;
          const isActive = i === activeStep;
          return (
            <div
              key={step.key}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-500',
                isDone && 'text-muted-foreground',
                isActive && 'bg-muted font-medium text-foreground',
                !isDone && !isActive && 'text-muted-foreground/40',
              )}
            >
              {isDone ? (
                <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
              ) : isActive ? (
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              ) : (
                <Icon className="h-4 w-4 shrink-0" />
              )}
              <span>{t('harvest', step.labelKey)}</span>
            </div>
          );
        })}
      </div>

      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((f) => (
            <div
              key={f}
              className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted rounded px-2 py-1"
            >
              <FileText className="h-3 w-3" />
              {f}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function HarvestPage() {
  const { t } = useI18n();
  const { activeCollection, setActiveCollection } = useCollection();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const jobId = searchParams.get('job');
  const [files, setFiles] = useState<File[]>([]);
  const [uploadHints, setUploadHints] = useState<UploadHints>({});
  const [dragOver, setDragOver] = useState(false);
  const [decisions, _setDecisions] = useState<Record<string, 'accepted' | 'rejected'>>(() => {
    if (!jobId) return {};
    try {
      return JSON.parse(sessionStorage.getItem(`harvest-decisions-${jobId}`) ?? '{}');
    } catch {
      return {};
    }
  });
  const [modifications, _setModifications] = useState<Record<string, CandidateEdits>>(() => {
    if (!jobId) return {};
    try {
      return JSON.parse(sessionStorage.getItem(`harvest-mods-${jobId}`) ?? '{}');
    } catch {
      return {};
    }
  });
  const [selectedCandidate, setSelectedCandidate] = useState<HarvestCandidate | null>(null);
  const candidatePage = Math.max(0, Number(searchParams.get('page') ?? '1') - 1);
  const setCandidatePage = useCallback(
    (p: number | ((prev: number) => number)) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const resolved = typeof p === 'function' ? p(Math.max(0, Number(prev.get('page') ?? '1') - 1)) : p;
          if (resolved <= 0) next.delete('page');
          else next.set('page', String(resolved + 1));
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const [candidatePageSize, setCandidatePageSize] = useState(24);
  const [showTabularOnly, setShowTabularOnly] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const setJobId = (id: string | null) => {
    if (id) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('job', id);
        next.delete('page');
        return next;
      }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  };

  const setDecisions = (
    updater:
      | Record<string, 'accepted' | 'rejected'>
      | ((
          prev: Record<string, 'accepted' | 'rejected'>,
        ) => Record<string, 'accepted' | 'rejected'>),
  ) => {
    _setDecisions((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (jobId) sessionStorage.setItem(`harvest-decisions-${jobId}`, JSON.stringify(next));
      return next;
    });
  };

  const setModifications = (
    updater:
      | Record<string, CandidateEdits>
      | ((prev: Record<string, CandidateEdits>) => Record<string, CandidateEdits>),
  ) => {
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
  const deleteJob = useDeleteHarvestJob(activeCollection);

  const handleAbandon = () => {
    if (!jobId) return;
    if (!window.confirm(t('harvest', 'abandonJobConfirm'))) return;
    deleteJob.mutate(jobId, {
      onSuccess: () => {
        sessionStorage.removeItem(`harvest-decisions-${jobId}`);
        sessionStorage.removeItem(`harvest-mods-${jobId}`);
        queryClient.removeQueries({ queryKey: ['harvest-job', activeCollection, jobId] });
        toast.success('Ingestion abandonnée');
        navigate('/harvest');
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Erreur lors de la suppression';
        toast.error(msg);
      },
    });
  };

  if (job?.collection_slug && job.collection_slug !== activeCollection) {
    setActiveCollection(job.collection_slug);
  }

  const resolvedDecisions = useMemo<Record<string, 'accepted' | 'rejected'>>(() => {
    let base: Record<string, 'accepted' | 'rejected'> = decisions;
    if (!Object.keys(decisions).length && job?.candidates) {
      const fromDb: Record<string, 'accepted' | 'rejected'> = {};
      for (const c of job.candidates) {
        if (c.status === 'accepted' || c.status === 'rejected') fromDb[c.id] = c.status;
      }
      if (Object.keys(fromDb).length > 0) base = fromDb;
    }
    // Tabular candidate with all rows unchecked → implicit rejection
    const result = { ...base };
    for (const [id, mods] of Object.entries(modifications)) {
      if (mods.row_selection && mods.row_selection.length > 0 && mods.row_selection.every((v) => !v)) {
        result[id] = 'rejected';
      }
    }
    return result;
  }, [decisions, job, modifications]);

  const { data: domainsData } = useDomains();
  const { data: typesData } = useTypes();
  const { data: tagsData } = useTags();
  const domains = (domainsData ?? []).map((d) => d.slug);
  const types = (typesData ?? []).map((t) => t.slug);
  const availableTags = (tagsData ?? []).map((t) => t.slug);

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
    const rowSelections: Record<string, boolean[]> = {};
    const rejected = Object.entries(resolvedDecisions)
      .filter(([, v]) => v === 'rejected')
      .map(([k]) => k);

    for (const [id, decision] of Object.entries(resolvedDecisions)) {
      if (decision !== 'accepted') continue;
      const { row_selection, ...otherEdits } = modifications[id] ?? {};
      if (row_selection) rowSelections[id] = row_selection;
      if (Object.keys(otherEdits).length > 0) {
        modified.push({ id, ...otherEdits });
      } else {
        accepted.push(id);
      }
    }

    validateMutation.mutate(
      { jobId, accepted, rejected, modified, merged: [], row_selections: rowSelections },
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

        <div className="rounded-md border border-muted bg-muted/30 px-4 py-3 space-y-1.5">
          <p className="text-sm font-medium">Comment fonctionne l'ingestion ?</p>
          <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
            <li>Déposez un ou plusieurs fichiers <strong>.docx</strong> ci-dessous.</li>
            <li>Fragmint convertit le document, segmente le texte et classe chaque fragment automatiquement.</li>
            <li>Vous validez chaque candidat : <strong>Accepter</strong> l'enregistre dans la bibliothèque, <strong>Rejeter</strong> l'écarte.</li>
            <li>Les tableaux détectés apparaissent avec un bandeau ambre — ouvrez-les pour choisir quelles lignes importer (chaque ligne = un fragment).</li>
          </ol>
        </div>

        <div
          className={cn(
            'border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors',
            dragOver
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 hover:border-primary/50',
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
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
                <span className="flex-1">{f.name}</span>
                <Badge variant="outline" className="text-xs">
                  {(f.size / 1024).toFixed(0)} KB
                </Badge>
                <button
                  type="button"
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                  aria-label={`Retirer ${f.name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <UploadHintsForm hints={uploadHints} onChange={setUploadHints} />

        <Button
          onClick={handleAnalyze}
          disabled={files.length === 0 || startHarvest.isPending}
          className="w-full"
        >
          {startHarvest.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              {t('harvest', 'analyzing')}
            </>
          ) : (
            <>
              <Upload className="h-4 w-4 mr-2" />
              {t('harvest', 'analyze')}
            </>
          )}
        </Button>
      </div>
    );
  }

  // ─── Phase 2: Candidate Review ───

  if (jobLoading || job?.status === 'processing') {
    return (
      <HarvestProcessingView
        files={job?.files ?? files.map((f) => f.name)}
        t={t as ReturnType<typeof useI18n>['t']}
      />
    );
  }

  if (job?.status === 'error') {
    return (
      <div className="p-6 space-y-6">
        <h2 className="text-2xl font-bold">{t('harvest', 'title')}</h2>
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          <span>
            {t('harvest', 'error')}: {job.error}
          </span>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setJobId(null);
            setFiles([]);
          }}
        >
          {t('harvest', 'uploadTitle')}
        </Button>
      </div>
    );
  }

  const isTabular = (c: HarvestCandidate) => {
    if (!c.payload_schema || !c.payload) return false;
    try { return Array.isArray(JSON.parse(c.payload)); } catch { return false; }
  };
  const allCandidates = job?.candidates ?? [];
  const tabularCount = allCandidates.filter(isTabular).length;
  const candidates = showTabularOnly ? allCandidates.filter(isTabular) : allCandidates;
  const stats = job?.stats;
  const acceptedCount = Object.values(resolvedDecisions).filter((v) => v === 'accepted').length;

  return (
    <div className="p-6 space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-6">
          <h2 className="text-2xl font-bold">{t('harvest', 'title')}</h2>
          <CollectionSelector />
          <Button
            variant="outline"
            size="sm"
            className="ml-auto text-destructive border-destructive/40 hover:bg-destructive/10"
            onClick={handleAbandon}
            disabled={deleteJob.isPending}
          >
            {deleteJob.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Trash2 className="h-4 w-4 mr-2" />
            )}
            {t('harvest', 'abandonJob')}
          </Button>
        </div>
        {job?.files && job.files.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {job.files.map((f) => (
              <span
                key={f}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-muted rounded px-2 py-1"
              >
                <FileText className="h-3 w-3 shrink-0" />
                {f}
              </span>
            ))}
          </div>
        )}
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { label: t('harvest', 'total'), value: stats.total, color: '' },
            { label: t('harvest', 'duplicates'), value: stats.duplicates, color: 'text-amber-600' },
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

      {allCandidates.length > 0 && (
        <div className="rounded-md border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 px-3 py-2.5 flex items-start gap-2 overflow-hidden">
          <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-800 dark:text-blue-200 min-w-0 leading-relaxed">
            <strong>{t('harvest', 'howToValidate')} :</strong>{' '}
            {t('harvest', 'howToValidateDesc')}{' '}
            <span className="inline-flex items-center gap-1 font-medium">
              <TableProperties className="h-3 w-3" /> {t('harvest', 'tabularBadge')}
            </span>{' — '}
            <strong>{t('harvest', 'howToValidateCommit')}</strong>{' '}
            {t('harvest', 'howToValidateSuffix')}
          </p>
        </div>
      )}

      {allCandidates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={showTabularOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowTabularOnly((v) => !v)}
            disabled={tabularCount === 0}
          >
            <TableProperties className="h-4 w-4 mr-1" />
            {t('harvest', 'tabularFilter')}{tabularCount > 0 ? ` (${tabularCount})` : ''}
          </Button>
          {showTabularOnly && (
            <span className="text-xs text-muted-foreground">
              — {candidates.length} {t('harvest', 'tabularFilter').toLowerCase()}{candidates.length > 1 ? '' : ''} {t('harvest', 'tabularShown')}{candidates.length > 1 ? 's' : ''}
            </span>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={acceptAll}>
              <CheckCircle className="h-4 w-4 mr-1" />
              {t('harvest', 'acceptAll')}
            </Button>
            <Button variant="outline" size="sm" onClick={rejectAll}>
              <XCircle className="h-4 w-4 mr-1" />
              {t('harvest', 'rejectAll')}
            </Button>
            <Button
              size="sm"
              onClick={handleCommit}
              disabled={acceptedCount === 0 || validateMutation.isPending}
            >
              {validateMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4 mr-1" />
              )}
              {t('harvest', 'commit')} ({acceptedCount})
            </Button>
          </div>
        </div>
      )}

      {(() => {
        const pageCount = Math.ceil(candidates.length / candidatePageSize);
        const paginated = candidates.slice(
          candidatePage * candidatePageSize,
          (candidatePage + 1) * candidatePageSize,
        );
        return (
          <>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {paginated.map((c) => (
                <CandidateCard
                  key={c.id}
                  candidate={c}
                  decision={resolvedDecisions[c.id]}
                  rowSelection={modifications[c.id]?.row_selection}
                  onAccept={() => setDecision(c.id, 'accepted')}
                  onReject={() => setDecision(c.id, 'rejected')}
                  onClick={() => setSelectedCandidate(c)}
                />
              ))}
            </div>
            {candidates.length > 24 && (
              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>{t('common', 'show')}</span>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={candidatePageSize}
                    onChange={(e) => {
                      setCandidatePageSize(Number(e.target.value));
                      setCandidatePage(0);
                    }}
                  >
                    {[24, 48, 96].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <span>{t('common', 'perPage')}</span>
                </div>
                {pageCount > 1 && (
                  <div className="flex items-center gap-3">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={candidatePage === 0}
                      onClick={() => setCandidatePage((p) => p - 1)}
                    >
                      {t('common', 'previous')}
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      Page {candidatePage + 1} / {pageCount}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={candidatePage >= pageCount - 1}
                      onClick={() => setCandidatePage((p) => p + 1)}
                    >
                      {t('common', 'next')}
                    </Button>
                  </div>
                )}
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
        availableTags={availableTags}
        onEditsChange={(edits) => {
          if (selectedCandidate)
            setModifications((prev) => ({ ...prev, [selectedCandidate.id]: edits }));
        }}
        onAccept={() => selectedCandidate && setDecision(selectedCandidate.id, 'accepted')}
        onReject={() => selectedCandidate && setDecision(selectedCandidate.id, 'rejected')}
        onClose={() => setSelectedCandidate(null)}
      />
    </div>
  );
}
