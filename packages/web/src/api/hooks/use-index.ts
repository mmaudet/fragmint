import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';

export interface IndexStatus {
  status: string;
  mode: 'milvus' | 'sqlite';
  milvus: boolean;
  embedding: boolean;
  retrieval_mode: string;
  last_run: string;
}

export function useIndexStatus() {
  return useQuery({
    queryKey: ['index-status'],
    queryFn: () => apiRequest<IndexStatus>('GET', '/v1/index/status'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useTriggerReindex() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<{ indexed: number; skipped: number }>('POST', '/v1/index/trigger'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['index-status'] });
    },
  });
}
