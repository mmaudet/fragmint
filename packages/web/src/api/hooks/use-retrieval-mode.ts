import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';

export type RetrievalMode = 'vector-only' | 'agentic-only' | 'hybrid';

interface RetrievalModeResponse {
  mode: RetrievalMode;
}

export function useRetrievalMode() {
  return useQuery({
    queryKey: ['retrieval-mode'],
    queryFn: () => apiRequest<RetrievalModeResponse>('GET', '/v1/admin/retrieval/mode'),
    staleTime: 1000 * 60,
  });
}

export function useSetRetrievalMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mode: RetrievalMode) =>
      apiRequest<{ mode: RetrievalMode; retriever_type: string }>(
        'POST',
        '/v1/admin/retrieval/mode',
        { mode },
      ),
    onSuccess: (data) => {
      qc.setQueryData(['retrieval-mode'], { mode: data.mode });
    },
  });
}
