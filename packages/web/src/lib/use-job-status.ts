import { useState, useEffect } from 'react';

interface JobStatus {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'done' | 'error';
  total: number;
  done: number;
  error_count: number;
}

export function useJobStatus(jobId: string | null, pollInterval = 1000) {
  const [status, setStatus] = useState<JobStatus | null>(null);

  useEffect(() => {
    if (!jobId) {
      setStatus(null);
      return;
    }

    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const r = await fetch(`/v1/jobs/${jobId}`);
        if (!r.ok) return;
        const data = await r.json();
        if (!active) return;
        setStatus(data.data ?? data);
        if (data.data?.status === 'done' || data.data?.status === 'error') return;
      } catch {
        /* ignore */
      }
      if (active) timer = setTimeout(poll, pollInterval);
    };

    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [jobId, pollInterval]);

  return status;
}
