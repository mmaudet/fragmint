import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';

export interface HarvestDebrief {
  job_id: string;
  job_status: string;
  had_hints: boolean;
  fragments: {
    total: number;
    by_trust: { high: number; mixed: number; low: number };
  };
  metadata: {
    auto_validated: number;
    to_review: number;
    breakdown: Record<string, number>;
  };
}

export function useHarvestDebrief(jobId: string | null) {
  return useQuery<HarvestDebrief>({
    queryKey: ['harvest-debrief', jobId],
    queryFn: () => {
      if (!jobId) throw new Error('jobId is required');
      return apiRequest('GET', `/v1/harvest/jobs/${jobId}/debrief`);
    },
    enabled: !!jobId,
  });
}
