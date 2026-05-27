import type { SearchService, SearchResult } from '../search/search-service.js';
import type { LlmClient } from '../services/llm-client.js';
import type { FragmentRetriever, RetrievedFragment, SectionQuery } from './fragment-retriever.js';

const PREFILTER_COUNT = 20;
const VECTOR_WEIGHT = 0.4;
const LLM_WEIGHT = 0.6;
const LLM_NEUTRAL_SCORE = 5;

export class HybridRetriever implements FragmentRetriever {
  constructor(
    private searchService: SearchService,
    private llm: LlmClient,
  ) {}

  async searchForSection(query: SectionQuery, limit = 5): Promise<RetrievedFragment[]> {
    const { text, filters, collectionSlug } = query;
    const candidates = await this.searchService.search(
      text,
      {
        domain: filters.domain?.length ? filters.domain : undefined,
        type: filters.type ? [filters.type] : undefined,
        lang: filters.lang,
        tags: filters.tags,
        collectionSlug: collectionSlug ?? undefined,
        quality_min: 'approved',
      },
      PREFILTER_COUNT,
    );
    console.debug(`[retrieval][hybrid] section "${text.slice(0, 50)}" → ${candidates.length} vector candidates`);

    if (candidates.length === 0) return [];

    if (candidates.length <= limit) {
      return candidates.map((c) => ({
        fragment_id: c.id,
        score: c.score,
        title: c.title,
        body_excerpt: c.body_excerpt,
        quality: c.quality,
      }));
    }

    const llmScores = await this.batchJudge(text, candidates);
    const scoreMap = new Map(llmScores);

    const reranked = candidates
      .map((c) => {
        const llmRaw = scoreMap.get(c.id) ?? LLM_NEUTRAL_SCORE;
        const llmNorm = Math.max(0, Math.min(10, llmRaw)) / 10;
        return {
          fragment_id: c.id,
          score: VECTOR_WEIGHT * c.score + LLM_WEIGHT * llmNorm,
          title: c.title,
          body_excerpt: c.body_excerpt,
          quality: c.quality,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    console.debug(`[retrieval][hybrid] section "${text.slice(0, 50)}" → returning top ${limit} after LLM re-rank`);
    return reranked;
  }

  private async batchJudge(
    sectionText: string,
    candidates: SearchResult[],
  ): Promise<Array<[string, number]>> {
    const list = candidates
      .map(
        (c, i) =>
          `${i + 1}. ID:${c.id}\nTitle: ${c.title ?? ''}\nExcerpt: ${(c.body_excerpt ?? '').slice(0, 120)}`,
      )
      .join('\n\n');

    const prompt = `Rate the relevance of each fragment for the following document section.

Section: "${sectionText}"

Fragments:
${list}

Return a JSON array where each item is {"id": "...", "score": 7}.
Score from 0 to 10. Include ALL ${candidates.length} fragments.
Return ONLY the JSON array, no other text.`;

    try {
      const response = await this.llm.chatMessages([{ role: 'user', content: prompt }]);
      const match = response.match(/\[[\s\S]*\]/);
      if (!match) return candidates.map((c) => [c.id, LLM_NEUTRAL_SCORE]);
      const parsed = JSON.parse(match[0]) as unknown[];
      if (!Array.isArray(parsed)) return candidates.map((c) => [c.id, LLM_NEUTRAL_SCORE]);
      return parsed
        .filter(
          (item): item is { id: string; score: number } =>
            typeof (item as Record<string, unknown>).id === 'string' &&
            typeof (item as Record<string, unknown>).score === 'number',
        )
        .map((item) => [item.id, item.score]);
    } catch {
      return candidates.map((c) => [c.id, LLM_NEUTRAL_SCORE]);
    }
  }
}
