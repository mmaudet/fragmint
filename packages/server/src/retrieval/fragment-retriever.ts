import type { PlanFilters } from '../schema/plan.js';

export interface SectionQuery {
  text: string;
  filters: PlanFilters;
  collectionSlug: string | null;
  inferred_type?: string;
  /**
   * First ~300 chars of the plan spec_prompt.
   * Prevents LLM reranking from judging fragments without document context
   * (Bug 2 — eval 2026-05-27: RGPD ranked #1 for "Présentation LinShare" without this).
   * Propagated from plan-service via p.state.spec_prompt.slice(0, 300).
   */
  spec_context?: string;
}

/**
 * Score breakdown for a retrieved fragment.
 * All fields optional — only the ones relevant to the retrieval method are set.
 */
export interface ScoreBreakdown {
  /** Which retrieval path produced this result. */
  method: 'vector' | 'agentic' | 'hybrid_rrf' | 'sqlite_like';
  /** Raw cosine similarity from Milvus (0-1, capped at 1.0). */
  vector_score?: number;
  /** Rank of this fragment in the vector list (1-based). */
  vector_rank?: number;
  /** LLM relevance score (0-10 integer). */
  llm_score?: number;
  /** Rank of this fragment in the LLM-sorted list (1-based). */
  llm_rank?: number;
  /** Raw RRF score before normalization. */
  rrf_score?: number;
  /** k parameter used in RRF computation. */
  rrf_k?: number;
}

export interface RetrievedFragment {
  fragment_id: string;
  /** null when source is SQLite LIKE fallback (no real ranking). */
  score: number | null;
  title: string | null;
  body_excerpt: string | null;
  quality: string;
  justification?: string;
  score_breakdown?: ScoreBreakdown;
}

export interface FragmentRetriever {
  searchForSection(query: SectionQuery, limit?: number): Promise<RetrievedFragment[]>;
}
