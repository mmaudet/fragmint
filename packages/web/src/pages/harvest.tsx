import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { UploadHintsForm } from '@/components/harvest/upload-hints-form';
import type { UploadHints } from '@/types/trust-source';
import { useI18n } from '@/lib/i18n';
import { useCollection } from '@/lib/collection-context';
import { CollectionSelector } from '@/components/collection-selector';
import { useStartHarvest, useHarvestJob } from '@/api/hooks/use-harvest';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Upload, Loader2, AlertTriangle, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function HarvestPage() {
  const { t } = useI18n();
  const { activeCollection, setActiveCollection } = useCollection();
  const [searchParams, setSearchParams] = useSearchParams();

  const navigate = useNavigate();
  const urlJobId = searchParams.get('job');
  const [files, setFiles] = useState<File[]>([]);
  const [uploadHints, setUploadHints] = useState<UploadHints>({});
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const jobId = urlJobId;
  const setJobId = (id: string | null) => {
    if (id) setSearchParams({ job: id }, { replace: true });
    else setSearchParams({}, { replace: true });
  };

  const startHarvest = useStartHarvest(activeCollection);
  const { data: job, isLoading: jobLoading } = useHarvestJob(activeCollection, jobId);

  useEffect(() => {
    if (job?.collection_slug && job.collection_slug !== activeCollection) {
      setActiveCollection(job.collection_slug);
    }
  }, [job?.collection_slug]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (job?.status === 'done' && jobId) {
      navigate(`/harvest/${jobId}/debrief`);
    }
  }, [job?.status, jobId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleAnalyze = async () => {
    if (files.length === 0) return;
    try {
      const result = await startHarvest.mutateAsync({ files, uploadHints });
      setJobId(result.job_id);
    } catch (e: any) {
      toast.error((e as Error).message ?? 'Upload failed');
    }
  };

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
                <span>{f.name}</span>
                <Badge variant="outline" className="text-xs">
                  {(f.size / 1024).toFixed(0)} KB
                </Badge>
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

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold">{t('harvest', 'title')}</h2>
      <div className="flex items-center gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>{t('harvest', 'analyzing')}</span>
      </div>
    </div>
  );
}
