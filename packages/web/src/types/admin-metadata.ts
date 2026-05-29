import type { TrustSource } from './trust-source';

export type ProposalKind = 'tag' | 'domain' | 'type';

export interface ProposalFlag {
  type: 'warning' | 'info';
  label: string;
  suggestion?: string;
  merge_target?: string;
}

export interface MetadataProposal {
  id: string | number;
  kind: ProposalKind;
  name: string;
  label?: string;
  usage_count: number;
  validated: boolean;
  proposed_by: string;
  proposed_by_role?: string | null;
  proposed_by_display?: string | null;
  created_at: string;
  preview?: string;
  flags: ProposalFlag[];
  trust_source?: TrustSource;
}

export interface ProposalCounts {
  tags: number;
  domains: number;
}

export interface PendingCounts {
  tags: number;
  domains: number;
  types: number;
  total: number;
}

export interface ProposalsResponse {
  proposals: MetadataProposal[];
  total: number;
  counts: ProposalCounts;
}

export interface UnifiedMetadataItem {
  id: string | number;
  label: string;
  status: 'pending' | 'active' | 'archived' | 'rejected';
  trustSource: string;
  usageCount: number;
  createdAt?: string;
  proposedBy?: string;
  proposedByDisplay?: string | null;
  proposedByRole?: string | null;
  category?: string;
  aliases?: string[];
  flags: ProposalFlag[];
  preview?: string;
  description?: string;
}

export interface ValidatedReferenceValue {
  id: string | number;
  slug?: string;
  name?: string;
  label: string;
  usage_count: number;
}
