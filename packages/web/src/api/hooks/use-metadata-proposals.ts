import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import type {
  ProposalKind,
  EntityType,
  ProposalsResponse,
  ValidatedReferenceValue,
} from '@/types/admin-metadata';

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['admin', 'metadata'] });
  qc.invalidateQueries({ queryKey: ['fragments'] });
}

export function useMetadataProposals(
  params: {
    kind?: ProposalKind;
    entity_type?: EntityType;
    search?: string;
    limit?: number;
    offset?: number;
  } = {},
) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][],
  ).toString();
  return useQuery<ProposalsResponse>({
    queryKey: ['admin', 'metadata', 'proposals', params],
    queryFn: () => apiRequest('GET', `/v1/admin/metadata/proposals?${qs}`),
  });
}

export function useValidatedReferenceValues(kind: ProposalKind, entity_type?: EntityType) {
  return useQuery<ValidatedReferenceValue[]>({
    queryKey: ['admin', 'metadata', 'validated', kind, entity_type],
    queryFn: () => {
      const p = new URLSearchParams({ kind });
      if (entity_type) p.set('entity_type', entity_type);
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

export function useConvertToEntity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: {
      id: string;
      entity_type: EntityType;
      canonical_name: string;
      aliases?: string[];
    }) => apiRequest('POST', `/v1/admin/metadata/proposals/${p.id}/convert-to-entity`, p),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useSetAsAlias() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { id: number; canonical_entity_id: number }) =>
      apiRequest('POST', `/v1/admin/metadata/proposals/${p.id}/set-as-alias`, p),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useReclassifyEntityType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { id: number; new_type: EntityType }) =>
      apiRequest('POST', `/v1/admin/metadata/proposals/${p.id}/reclassify-entity-type`, p),
    onSuccess: () => invalidateAll(qc),
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
