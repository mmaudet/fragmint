import type { SearchService } from '../search/search-service.js';
import type {
  FragmentRetriever,
  RetrievedFragment,
  ScoreBreakdown,
  SectionQuery,
} from './fragment-retriever.js';
import { enrichQueryWithFilters } from './fragment-retriever.js';

const SCORE_THRESHOLD = 0.2;

export class VectorRetriever implements FragmentRetriever {
  constructor(private searchService: SearchService) {}

  async searchForSection(query: SectionQuery, limit = 5): Promise<RetrievedFragment[]> {
    const { filters, collectionSlug } = query;
    // forced_candidates intentionally ignored — vector-only is a pure semantic baseline.
    // Tag-first only applies to modes with a LLM judge (hybrid, agentic).
    const enrichedText = enrichQueryWithFilters(query.text, filters);
    const results = await this.searchService.search(
      enrichedText,
      {
        type: filters.type ? [filters.type] : undefined,
        lang: filters.lang,
        collectionSlug: collectionSlug ?? undefined,
        quality_min: 'approved',
      },
      limit,
    );

    const filtered = results
      .filter((r) => r.score == null || r.score >= SCORE_THRESHOLD)
      .map((r): RetrievedFragment => {
        const cappedScore = r.score != null ? Math.min(1.0, r.score) : null;
        const breakdown: ScoreBreakdown = cappedScore != null
          ? { method: 'vector', vector_score: cappedScore }
          : { method: 'sqlite_like' };
        return {
          fragment_id: r.id,
          score: cappedScore,
          title: r.title,
          body_excerpt: r.body_excerpt,
          quality: r.quality,
          type: r.type,
          score_breakdown: breakdown,
          retrieval_source: 'vector',
        };
      });

    console.debug(
      `[retrieval][vector-only] section "${enrichedText.slice(0, 50)}" → ${filtered.length} candidates after threshold`,
    );
    return filtered;
  }
}
