import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import type { SupersedureProposal, SupersedureStatsResponse } from '@/types/admin-supersedure';

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['supersedure'] });
}

export function useSupersedureProposals(status = 'pending') {
  return useQuery<SupersedureProposal[]>({
    queryKey: ['supersedure', 'proposals', status],
    queryFn: () => apiRequest('GET', `/v1/admin/supersedure/proposals?status=${status}`),
  });
}

export function useSupersedureStats() {
  return useQuery<SupersedureStatsResponse>({
    queryKey: ['supersedure', 'stats'],
    queryFn: () => apiRequest('GET', '/v1/admin/supersedure/stats'),
  });
}

export function useConfirmProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest('POST', `/v1/admin/supersedure/proposals/${id}/confirm`),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useCoexistProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest('POST', `/v1/admin/supersedure/proposals/${id}/coexist`),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useRejectProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest('POST', `/v1/admin/supersedure/proposals/${id}/reject`),
    onSuccess: () => invalidateAll(qc),
  });
}
