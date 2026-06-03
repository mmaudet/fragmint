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
    // Domain and tags are soft hints — injected into query text, not hard filters.
    const enrichedText = enrichQueryWithFilters(query.text, filters);
    const searchFilters = {
      type: filters.type ? [filters.type] : undefined,
      lang: filters.lang,
      collectionSlug: collectionSlug ?? undefined,
      quality_min: 'approved' as const,
    };

    const vectorResults = await this.searchService.search(enrichedText, searchFilters, limit);
    const keywordResults = await this.searchService.keywordSearch(enrichedText, searchFilters, limit);

    const seen = new Set(vectorResults.map((r) => r.id));
    const results = [...vectorResults, ...keywordResults.filter((r) => !seen.has(r.id))];

    const filtered = results
      // null score = SQLite LIKE result → always pass through (no threshold)
      // non-null score = Milvus cosine → apply threshold
      .filter((r) => r.score == null || r.score >= SCORE_THRESHOLD)
      .map((r) => {
        const cappedScore = r.score != null ? Math.min(1.0, r.score) : null;
        const breakdown: ScoreBreakdown = r.score != null
          ? { method: 'vector', vector_score: cappedScore! }
          : { method: 'sqlite_like' };

        return {
          fragment_id: r.id,
          score: cappedScore,
          title: r.title,
          body_excerpt: r.body_excerpt,
          quality: r.quality,
          type: r.type,
          score_breakdown: breakdown,
        } satisfies RetrievedFragment;
      });

    console.debug(
      `[retrieval][vector-only] section "${enrichedText.slice(0, 50)}" → ${filtered.length} candidates after threshold`,
    );
    return filtered;
  }
}
