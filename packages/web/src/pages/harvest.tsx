import { useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '@/lib/i18n';
import { useStartHarvest, useHarvestJob, useValidateCandidates } from '@/api/hooks/use-harvest';
import { CandidateCard } from '@/components/candidate-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Upload, Loader2, CheckCircle, XCircle, AlertTriangle, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function HarvestPage() {
  const { t } = useI18n();

  // Phase state
  const [jobId, setJobId] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [minConfidence, setMinConfidence] = useState(0.65);
  const [dragOver, setDragOver] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, 'accepted' | 'rejected'>>({});
  const [commitResult, setCommitResult] = useState<{ committed: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startHarvest = useStartHarvest();
  const { data: job, isLoading: jobLoading } = useHarvestJob(jobId);
  const validateMutation = useValidateCandidates();

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
      { files, minConfidence },
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
    const accepted = Object.entries(decisions)
      .filter(([, v]) => v === 'accepted')
      .map(([k]) => k);
    const rejected = Object.entries(decisions)
      .filter(([, v]) => v === 'rejected')
      .map(([k]) => k);

    validateMutation.mutate(
      { jobId, accepted, rejected },
      {
        onSuccess: (data) => {
          setCommitResult({ committed: data.committed });
          toast.success(`${data.committed} ${t('harvest', 'committed')}`);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  // ─── Phase 1: Upload ───
  if (!jobId) {
    return (
      <div className="p-6 space-y-6 max-w-2xl mx-auto">
        <div>
          <h2 className="text-2xl font-bold">{t('harvest', 'title')}</h2>
          <p className="text-muted-foreground mt-1">{t('harvest', 'uploadTitle')}</p>
        </div>

        {/* Dropzone */}
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

        {/* Selected files */}
        {files.length > 0 && (
          <div className="space-y-2">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span>{f.name}</span>
                <Badge variant="outline" className="text-xs">
                  {(f.size / 1024).toFixed(0)} KB
                </Badge>
              </div>
            ))}
          </div>
        )}

        {/* Confidence slider */}
        <div className="space-y-2">
          <label className="text-sm font-medium">
            {t('harvest', 'confidence')}: {Math.round(minConfidence * 100)}%
          </label>
          <input
            type="range"
            min="0.5"
            max="0.95"
            step="0.05"
            value={minConfidence}
            onChange={(e) => setMinConfidence(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>

        {/* Analyze button */}
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

  // Loading / processing
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

  // Error
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

  // Done - show candidates
  const candidates = job?.candidates ?? [];
  const stats = job?.stats;

  const acceptedCount = Object.values(decisions).filter((v) => v === 'accepted').length;

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold">{t('harvest', 'title')}</h2>

      {/* Stats row */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t('harvest', 'total')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{stats.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t('harvest', 'duplicates')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-amber-600">{stats.duplicates}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t('harvest', 'lowConfidence')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-red-600">{stats.low_confidence}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t('harvest', 'valid')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-green-600">{stats.valid}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Commit result */}
      {commitResult && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-200">
          <CheckCircle className="h-5 w-5" />
          <span className="font-medium">
            {commitResult.committed} {t('harvest', 'committed')}
          </span>
          <Link to="/validation">
            <Button variant="outline" size="sm">
              {t('harvest', 'goToValidation')}
            </Button>
          </Link>
        </div>
      )}

      {/* Actions */}
      {!commitResult && candidates.length > 0 && (
        <div className="flex flex-wrap gap-2">
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
      )}

      {/* Candidate grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {candidates.map((c) => (
          <CandidateCard
            key={c.id}
            candidate={c}
            decision={decisions[c.id]}
            onAccept={() => setDecision(c.id, 'accepted')}
            onReject={() => setDecision(c.id, 'rejected')}
          />
        ))}
      </div>
    </div>
  );
}
