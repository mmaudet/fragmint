import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';

export function useSectionTopK() {
  return useQuery({
    queryKey: ['admin', 'retrieval', 'top-k'],
    queryFn: () => apiRequest<{ top_k: number }>('GET', '/v1/admin/retrieval/top-k'),
    staleTime: 1000 * 60,
  });
}

export function useSetSectionTopK() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (top_k: number) =>
      apiRequest<{ top_k: number }>('POST', '/v1/admin/retrieval/top-k', { top_k }),
    onSuccess: (data) => {
      qc.setQueryData(['admin', 'retrieval', 'top-k'], data);
    },
  });
}
