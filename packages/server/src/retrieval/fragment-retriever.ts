import type { PlanFilters } from '../schema/plan.js';
import type { SearchResult } from '../search/search-service.js';

/**
 * Enrich a section query text with domain/tag context as soft hints.
 * Domain and tags are NOT passed as hard search filters — they are prepended
 * to the query so the embedding naturally biases toward matching fragments,
 * without excluding non-matching ones. Lang remains a hard filter.
 */
export function enrichQueryWithFilters(text: string, filters: PlanFilters): string {
  const parts: string[] = [];
  if (filters.domain?.length) parts.push(`Domaine : ${filters.domain.join(', ')}`);
  if (filters.tags?.length) parts.push(`Tags : ${filters.tags.join(', ')}`);
  if (parts.length === 0) return text;
  return `${parts.join('. ')}.\n${text}`;
}

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
  /**
   * Pool A — tag-matched candidates injected by plan-service before retrieval.
   * Retrievers must include these in the candidate pool so the LLM judge sees them.
   * Forced candidates bypass the score threshold but not the LLM judge floor.
   */
  forced_candidates?: SearchResult[];
}

/**
 * Score breakdown for a retrieved fragment.
 * All fields optional — only the ones relevant to the retrieval method are set.
 */
export interface ScoreBreakdown {
  /** Which retrieval path produced this result. */
  method: 'vector' | 'agentic' | 'hybrid_rrf' | 'sqlite_like' | 'tag_match';
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
  /** Absolute disagreement between self-consistency agents (agentic mode only, normalized 0-1). */
  consistency_delta?: number;
  /** Final score after LLM-weighting: rrf_normalized × (llm_score / 10). Absent when LLM judge failed. */
  final_score?: number;
}

export interface RetrievedFragment {
  fragment_id: string;
  /** null when source is SQLite LIKE fallback or tag-match (no real ranking). */
  score: number | null;
  title: string | null;
  body_excerpt: string | null;
  quality: string;
  type?: string;
  payload_schema?: string | null;
  justification?: string;
  score_breakdown?: ScoreBreakdown;
  /** Indicates whether this fragment came from the tag pool (A), vector pool (B), or both. */
  retrieval_source?: 'vector' | 'tag' | 'both';
}

export interface FragmentRetriever {
  searchForSection(query: SectionQuery, limit?: number): Promise<RetrievedFragment[]>;
  /** Optional batch variant: runs phases in parallel across all sections. */
  searchForSectionsBatch?(queries: SectionQuery[], limit: number, concurrency?: number): Promise<RetrievedFragment[][]>;
}

/** Multiplicative boost applied when a fragment's editorial type matches the section's inferred_type. */
export const TYPE_BOOST = 1.1;
