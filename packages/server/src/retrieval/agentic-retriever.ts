import type { LlmClient } from '../services/llm-client.js';
import type { IndexService } from '../services/index-service.js';
import type { FragmentService } from '../services/fragment-service.js';
import type { PlanFilters } from '../schema/plan.js';
import type { FragmentRetriever, RetrievedFragment, SectionQuery } from './fragment-retriever.js';

const PHASE2_SCORE_MIN = 0.3;
const PHASE1_MULTIPLIER = 3;

export class AgenticRetriever implements FragmentRetriever {
  constructor(
    private indexService: IndexService,
    private llm: LlmClient,
    private fragmentService: FragmentService,
  ) {}

  async searchForSection(query: SectionQuery, limit = 5): Promise<RetrievedFragment[]> {
    const indexMd = (await this.indexService.getIndex('md', query.collectionSlug ?? undefined)) as string;
    const phase1Count = limit * PHASE1_MULTIPLIER;

    const candidateIds = await this.selectCandidates(query, indexMd, phase1Count);
    console.debug(`[retrieval][agentic-only] section "${query.text.slice(0, 50)}" → phase1 selected ${candidateIds.length} candidates`);
    if (candidateIds.length === 0) return [];

    const scored = (
      await Promise.all(candidateIds.map((id) => this.judgeFragment(query, id)))
    ).filter((r): r is RetrievedFragment => r !== null && r.score >= PHASE2_SCORE_MIN);
    console.debug(`[retrieval][agentic-only] section "${query.text.slice(0, 50)}" → phase2 kept ${scored.length}/${candidateIds.length} (score >= ${PHASE2_SCORE_MIN})`);

    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  private async selectCandidates(
    query: SectionQuery,
    indexMd: string,
    count: number,
  ): Promise<string[]> {
    const filtersLine = buildFiltersDesc(query.filters);
    const collectionLine = query.collectionSlug ? `Collection: ${query.collectionSlug}` : '';
    const prompt = `You are a document composition assistant with access to a fragment library.

Section to populate: "${query.text}"
${query.inferred_type ? `Preferred fragment type: ${query.inferred_type}` : ''}
${filtersLine}
${collectionLine}

Fragment index (readable_id then UUID then title):
${indexMd}

Select the ${count} most relevant fragment UUIDs for this section.
Return ONLY a JSON array of UUID strings: ["uuid1", "uuid2", ...]`;

    try {
      const response = await this.llm.chatMessages([{ role: 'user', content: prompt }]);
      const match = response.match(/\[[\s\S]*?\]/);
      if (!match) return [];
      const parsed = JSON.parse(match[0]);
      if (!Array.isArray(parsed)) return [];
      return (parsed as unknown[])
        .filter((id): id is string => typeof id === 'string')
        .slice(0, count);
    } catch {
      return [];
    }
  }

  private async judgeFragment(
    query: SectionQuery,
    fragmentId: string,
  ): Promise<RetrievedFragment | null> {
    const fragment = await this.fragmentService.getById(fragmentId);
    if (!fragment) return null;

    const prompt = `Evaluate whether this content fragment is relevant for a document section.

Section: "${query.text}"
Fragment title: "${fragment.title ?? ''}"
Fragment body (excerpt):
${(fragment.body ?? '').slice(0, 800)}

Score relevance from 0 to 10 (integer). 7+ = good fit. 3 or below = poor fit.
Return ONLY JSON: {"score": 8, "reason": "..."}`;

    try {
      const response = await this.llm.chatMessages([{ role: 'user', content: prompt }]);
      const match = response.match(/\{[\s\S]*?\}/);
      if (!match) return null;
      const parsed = JSON.parse(match[0]) as { score?: unknown; reason?: unknown };
      const rawScore = typeof parsed.score === 'number' ? parsed.score : 0;
      const normalizedScore = Math.max(0, Math.min(10, rawScore)) / 10;
      return {
        fragment_id: fragmentId,
        score: normalizedScore,
        title: fragment.title ?? null,
        body_excerpt: (fragment.body ?? '').slice(0, 200),
        quality: fragment.quality,
        justification: typeof parsed.reason === 'string' ? parsed.reason : undefined,
      };
    } catch {
      return null;
    }
  }
}

function buildFiltersDesc(filters: PlanFilters): string {
  const parts: string[] = [];
  if (filters.lang) parts.push(`Language: ${filters.lang}`);
  if (filters.domain?.length) parts.push(`Domain(s): ${filters.domain.join(', ')}`);
  if (filters.type) parts.push(`Type: ${filters.type}`);
  if (filters.tags?.length) parts.push(`Tags: ${filters.tags.join(', ')}`);
  return parts.join('\n');
}
