import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import type { HarvestCandidate } from '@/api/types';

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return (value as T) ?? fallback;
}

function normalizeCandidate(c: any): HarvestCandidate {
  return {
    ...c,
    quality_signals: parseJson(c.quality_signals, []),
    tags: parseJson(c.tags, []),
  };
}

export function usePendingCandidates(
  params: {
    job_id?: string;
    trust_level?: 'high' | 'mixed' | 'low';
    limit?: number;
  } = {},
) {
  const qs = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  ).toString();
  return useQuery<HarvestCandidate[]>({
    queryKey: ['admin', 'harvest', 'candidates', params],
    queryFn: () =>
      apiRequest<any[]>('GET', `/v1/admin/harvest/candidates?${qs}`).then((rows) =>
        rows.map(normalizeCandidate),
      ),
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

export function useBulkRejectCandidates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (candidate_ids: string[]) =>
      apiRequest('POST', '/v1/admin/harvest/candidates/bulk-reject', { candidate_ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'harvest'] }),
  });
}
