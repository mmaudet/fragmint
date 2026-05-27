import type { PlanFilters } from '../schema/plan.js';

export interface SectionQuery {
  text: string;
  filters: PlanFilters;
  collectionSlug: string | null;
  inferred_type?: string;
  /** Full AO / spec prompt — passed to LLM-based retrievers for context-aware ranking */
  spec_context?: string;
}

export interface RetrievedFragment {
  fragment_id: string;
  score: number;
  title: string | null;
  body_excerpt: string | null;
  quality: string;
  justification?: string;
}

export interface FragmentRetriever {
  searchForSection(query: SectionQuery, limit?: number): Promise<RetrievedFragment[]>;
}
