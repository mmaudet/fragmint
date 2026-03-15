import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, collectionApiUrl, getToken } from '@/api/client';
import type { HarvestJobWithCandidates, ValidateResult } from '@/api/types';

export function useHarvestJob(collectionSlug: string, jobId: string | null) {
  return useQuery({
    queryKey: ['harvest-job', collectionSlug, jobId],
    queryFn: () => apiRequest<HarvestJobWithCandidates>('GET', collectionApiUrl(collectionSlug, `/harvest/${jobId}`)),
    enabled: !!jobId,
    refetchInterval: (query) => {
      return query.state.data?.status === 'processing' ? 2000 : false;
    },
  });
}

export function useStartHarvest(collectionSlug: string) {
  return useMutation({
    mutationFn: async ({ files, minConfidence }: { files: File[]; minConfidence: number }) => {
      const form = new FormData();
      for (const file of files) {
        form.append('files', file);
      }
      form.append('options', JSON.stringify({ min_confidence: minConfidence }));

      const token = getToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(collectionApiUrl(collectionSlug, '/harvest'), { method: 'POST', headers, body: form });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      return json.data as { job_id: string; status: string; files: string[] };
    },
  });
}

export function useValidateCandidates(collectionSlug: string) {
  return useMutation({
    mutationFn: ({ jobId, ...body }: { jobId: string; accepted: string[]; rejected: string[]; modified?: any[]; merged?: any[] }) =>
      apiRequest<ValidateResult>('POST', collectionApiUrl(collectionSlug, `/harvest/${jobId}/validate`), body),
  });
}
