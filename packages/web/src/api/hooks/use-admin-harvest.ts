import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import type { HarvestCandidate } from '@/api/types';

export function usePendingCandidates(params: {
  job_id?: string;
  trust_level?: 'high' | 'mixed' | 'low';
  limit?: number;
} = {}) {
  const qs = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  ).toString();
  return useQuery<HarvestCandidate[]>({
    queryKey: ['admin', 'harvest', 'candidates', params],
    queryFn: () => apiRequest('GET', `/v1/admin/harvest/candidates?${qs}`),
  });
}

export function useBulkAcceptCandidates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (candidate_ids: string[]) =>
      apiRequest('POST', '/v1/admin/harvest/candidates/bulk-accept', { candidate_ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'harvest'] }),
  });
}
