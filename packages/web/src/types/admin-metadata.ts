import type { TrustSource } from './trust-source';

export type ProposalKind = 'tag' | 'domain' | 'entity';

export type EntityType =
  | 'client'
  | 'product'
  | 'technology'
  | 'partner'
  | 'certification'
  | 'regulation'
  | 'metric';

export interface ProposalFlag {
  type: 'warning' | 'info';
  label: string;
  suggestion?: string;
  merge_target?: string;
  reclassify_to?: EntityType;
}

export interface MetadataProposal {
  id: string | number;
  kind: ProposalKind;
  name: string;
  label?: string;
  entity_type?: EntityType;
  usage_count: number;
  validated: boolean;
  proposed_by: string;
  created_at: string;
  preview?: string;
  flags: ProposalFlag[];
  trust_source?: TrustSource;
}

export interface ProposalCounts {
  tags: number;
  entities: number;
  domains: number;
  entities_by_type: Record<EntityType, number>;
}

export interface ProposalsResponse {
  proposals: MetadataProposal[];
  total: number;
  counts: ProposalCounts;
}

export interface ValidatedReferenceValue {
  id: string | number;
  slug?: string;
  name?: string;
  label: string;
  type?: EntityType;
  canonical_name?: string;
  usage_count: number;
}
