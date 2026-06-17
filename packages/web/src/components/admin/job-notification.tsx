import { useEffect } from 'react';
import { useJobStatus } from '@/lib/use-job-status';

interface Props {
  jobId: string;
  label: string;
  onComplete?: () => void;
}

export function JobNotification({ jobId, label, onComplete }: Props) {
  const status = useJobStatus(jobId);

  useEffect(() => {
    if (status?.status === 'done') {
      const t = setTimeout(() => onComplete?.(), 2000);
      return () => clearTimeout(t);
    }
  }, [status?.status, onComplete]);

  if (!status) return null;

  if (status.status === 'done') {
    return (
      <div className="fixed bottom-4 right-4 bg-green-50 border border-green-200 rounded-lg px-4 py-3 shadow-lg max-w-sm z-50">
        <p className="text-sm font-medium text-green-900">✓ {label} terminé</p>
        <p className="text-xs text-green-700">
          {status.done} fragments traités
          {status.error_count > 0 && ` (${status.error_count} erreurs)`}
        </p>
      </div>
    );
  }

  if (status.status === 'error') {
    return (
      <div className="fixed bottom-4 right-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 shadow-lg max-w-sm z-50">
        <p className="text-sm font-medium text-red-900">✕ {label} échoué</p>
      </div>
    );
  }

  const progress = status.total > 0 ? (status.done / status.total) * 100 : 0;
  return (
    <div className="fixed bottom-4 right-4 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 shadow-lg max-w-sm z-50">
      <p className="text-sm font-medium text-blue-900">{label} en cours...</p>
      <p className="text-xs text-blue-700">
        {status.done} / {status.total} fragments
      </p>
      <div className="mt-2 w-full bg-blue-200 rounded-full h-1">
        <div
          className="bg-blue-600 h-1 rounded-full transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
