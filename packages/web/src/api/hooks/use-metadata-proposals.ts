import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import type {
  ProposalKind,
  ProposalsResponse,
  ValidatedReferenceValue,
  PendingCounts,
} from '@/types/admin-metadata';
import type { TrustSource } from '@/types/trust-source';

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['admin', 'metadata'] });
  qc.invalidateQueries({ queryKey: ['referential'] });
  qc.invalidateQueries({ queryKey: ['fragments'] });
}

export function useMetadataProposals(
  params: {
    kind?: ProposalKind;
    search?: string;
    limit?: number;
    offset?: number;
    trust_source?: TrustSource;
    sort?: 'date' | 'usage' | 'name';
  } = {},
) {
  const qs = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  ).toString();
  return useQuery<ProposalsResponse>({
    queryKey: ['admin', 'metadata', 'proposals', params],
    queryFn: () => apiRequest('GET', `/v1/admin/metadata/proposals?${qs}`),
  });
}

export function useValidatedReferenceValues(kind: ProposalKind) {
  return useQuery<ValidatedReferenceValue[]>({
    queryKey: ['admin', 'metadata', 'validated', kind],
    queryFn: () => {
      const p = new URLSearchParams({ kind });
      return apiRequest('GET', `/v1/admin/metadata/validated?${p}`);
    },
  });
}

export function useApproveProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, kind }: { id: string | number; kind: ProposalKind }) =>
      apiRequest('POST', `/v1/admin/metadata/proposals/${id}/approve`, { kind }),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useRejectProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, kind }: { id: string | number; kind: ProposalKind }) =>
      apiRequest('POST', `/v1/admin/metadata/proposals/${id}/reject`, { kind }),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useRenameProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: {
      id: string | number;
      kind: ProposalKind;
      new_name: string;
      new_label?: string;
    }) => apiRequest('POST', `/v1/admin/metadata/proposals/${p.id}/rename`, p),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useMergeProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { id: string | number; kind: ProposalKind; target_id: string | number }) =>
      apiRequest('POST', `/v1/admin/metadata/proposals/${p.id}/merge`, p),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useMetadataPendingCount() {
  return useQuery<PendingCounts>({
    queryKey: ['admin', 'metadata', 'pending-count'],
    queryFn: () => apiRequest('GET', '/v1/admin/metadata/pending-count'),
    staleTime: 1000 * 60,
    refetchInterval: 1000 * 60 * 5,
  });
}

export function useBulkAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: {
      action: 'approve' | 'reject';
      items: Array<{ id: string | number; kind: ProposalKind }>;
    }) => apiRequest('POST', `/v1/admin/metadata/bulk-action`, p),
    onSuccess: () => invalidateAll(qc),
  });
}
