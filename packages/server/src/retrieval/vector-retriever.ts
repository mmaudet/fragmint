import type { SearchService } from '../search/search-service.js';
import type { FragmentRetriever, RetrievedFragment, SectionQuery } from './fragment-retriever.js';

const SCORE_THRESHOLD = 0.2;

export class VectorRetriever implements FragmentRetriever {
  constructor(private searchService: SearchService) {}

  async searchForSection(query: SectionQuery, limit = 5): Promise<RetrievedFragment[]> {
    const { text, filters, collectionSlug } = query;
    const results = await this.searchService.search(
      text,
      {
        domain: filters.domain?.length ? filters.domain : undefined,
        type: filters.type ? [filters.type] : undefined,
        lang: filters.lang,
        tags: filters.tags,
        collectionSlug: collectionSlug ?? undefined,
        quality_min: 'reviewed',
      },
      limit,
    );
    const filtered = results
      .filter((r) => r.score >= SCORE_THRESHOLD)
      .map((r) => ({
        fragment_id: r.id,
        score: r.score,
        title: r.title,
        body_excerpt: r.body_excerpt,
        quality: r.quality,
      }));
    console.debug(`[retrieval][vector-only] section "${text.slice(0, 50)}" → ${filtered.length} candidates after threshold`);
    return filtered;
  }
}
