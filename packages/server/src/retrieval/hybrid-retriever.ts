import { rrfFusion, normalizeRrfScore } from './rrf.js';
import type { SearchService, SearchResult } from '../search/search-service.js';
import type { LlmClient } from '../services/llm-client.js';
import type {
  FragmentRetriever,
  RetrievedFragment,
  ScoreBreakdown,
  SectionQuery,
} from './fragment-retriever.js';
import { enrichQueryWithFilters } from './fragment-retriever.js';

const PHASE1_MULTIPLIER = 4; // phase1 candidates = limit × PHASE1_MULTIPLIER
const LLM_NEUTRAL_SCORE = 5;

function resolveWeights(preset: string): [number, number] {
  switch (preset) {
    case 'vector-heavy':
      return [2, 1];
    case 'llm-heavy':
      return [1, 2];
    default: // 'balanced'
      return [1, 1];
  }
}

export class HybridRetriever implements FragmentRetriever {
  private weights: [number, number];

  constructor(
    private searchService: SearchService,
    private llm: LlmClient,
    private rrfK = 60,
    weightsPreset: string = 'balanced',
    private llmFloor = 3,
  ) {
    this.weights = resolveWeights(weightsPreset);
  }

  async searchForSection(query: SectionQuery, limit = 5): Promise<RetrievedFragment[]> {
    const { filters, collectionSlug } = query;
    // Domain and tags are soft hints — injected into query text, not hard filters.
    const enrichedText = enrichQueryWithFilters(query.text, filters);

    // Step 1 — Vector candidates (limit × PHASE1_MULTIPLIER), already sorted by cosine desc
    const phase1Count = Math.max(limit * PHASE1_MULTIPLIER, 8);
    const vectorCandidates = await this.searchService.search(
      enrichedText,
      {
        type: filters.type ? [filters.type] : undefined,
        lang: filters.lang,
        collectionSlug: collectionSlug ?? undefined,
        quality_min: 'approved',
      },
      phase1Count,
    );
    console.debug(
      `[retrieval][hybrid] section "${enrichedText.slice(0, 50)}" → ${vectorCandidates.length} vector candidates`,
    );

    if (vectorCandidates.length === 0) return [];

    // Keep raw vector scores for breakdown (before any RRF transformation)
    const vectorScoreMap = new Map(vectorCandidates.map((c) => [c.id, c.score]));

    // Step 2 — LLM batch judge → Map<id, llm_score_0_10>
    const llmScoreMap = await this.batchJudge(query, vectorCandidates);

    // Step 3 — Build 2 ranked lists
    // List 1: vector order (already sorted by cosine desc)
    const list1 = vectorCandidates.map((c) => ({ id: c.id, _data: c }));

    // List 2: same candidates sorted by LLM score desc
    const list2 = [...vectorCandidates]
      .sort((a, b) => (llmScoreMap.get(b.id) ?? LLM_NEUTRAL_SCORE) - (llmScoreMap.get(a.id) ?? LLM_NEUTRAL_SCORE))
      .map((c) => ({ id: c.id, _data: c }));

    // Step 4 — RRF fusion
    const fused = rrfFusion([list1, list2], this.rrfK, this.weights);

    // Step 5 — Apply LLM floor: drop fragments where LLM explicitly rejected (llm_score < floor)
    // This respects the LLM judge's explicit rejection even if cosine rank is high.
    // Applied after RRF ordering, before slicing to limit — so top-N is filled with valid fragments.
    const floorFiltered = this.llmFloor > 0
      ? fused.filter(({ item }) => {
          const llmScore = llmScoreMap.get(item.id) ?? LLM_NEUTRAL_SCORE;
          if (llmScore < this.llmFloor) {
            console.debug(
              `[retrieval][hybrid] fragment ${item.id.slice(0, 8)} dropped by LLM floor (llm=${llmScore} < ${this.llmFloor})`,
            );
            return false;
          }
          return true;
        })
      : fused;

    // Step 6 — Build result with score_breakdown
    const list1IndexMap = new Map(list1.map((item, i) => [item.id, i + 1]));
    const list2IndexMap = new Map(list2.map((item, i) => [item.id, i + 1]));

    const results = floorFiltered.slice(0, limit).map(({ item, rrf_score }) => {
      const c = item._data;
      const vectorScore = Math.min(1.0, vectorScoreMap.get(c.id) ?? 0);
      const llmScore = llmScoreMap.get(c.id) ?? LLM_NEUTRAL_SCORE;
      const vectorRank = list1IndexMap.get(c.id) ?? 0;
      const llmRank = list2IndexMap.get(c.id) ?? 0;
      const normalizedScore = normalizeRrfScore(rrf_score, this.weights, this.rrfK);

      const breakdown: ScoreBreakdown = {
        method: 'hybrid_rrf',
        vector_score: vectorScore,
        vector_rank: vectorRank,
        llm_score: llmScore,
        llm_rank: llmRank,
        rrf_score,
        rrf_k: this.rrfK,
      };

      return {
        fragment_id: c.id,
        score: normalizedScore,
        title: c.title,
        body_excerpt: c.body_excerpt,
        quality: c.quality,
        type: c.type,
        score_breakdown: breakdown,
      } satisfies RetrievedFragment;
    });

    console.debug(
      `[retrieval][hybrid] section "${enrichedText.slice(0, 50)}" → returning top ${results.length} after RRF`,
    );
    return results;
  }

  private async batchJudge(
    query: SectionQuery,
    candidates: SearchResult[],
  ): Promise<Map<string, number>> {
    const defaultMap = new Map(candidates.map((c) => [c.id, LLM_NEUTRAL_SCORE]));

    const list = candidates
      .map(
        (c, i) =>
          `${i + 1}. ID:${c.id} [type: ${c.type}] [domain: ${c.domain}]\nTitle: ${c.title ?? ''}\nExcerpt: ${(c.body_excerpt ?? '').slice(0, 120)}`,
      )
      .join('\n\n');

    // spec_context prevents the LLM from judging fragments without document context
    // (eval 2026-05-27 Bug 2: without this, RGPD ranked #1 for "Présentation LinShare")
    const contextLine = query.spec_context
      ? `\nDocument context (spec): "${query.spec_context.slice(0, 300)}"\n`
      : '';

    const prompt = `Rate the relevance of each fragment for the following document section.
${contextLine}
Section: "${query.text}"
${query.inferred_type ? `Expected fragment type for this section: ${query.inferred_type}` : ''}

Fragments (each has [type:] and [domain:] — use them to assess fit):
${list}

Score each fragment from 0 to 10. Be strict and discriminating:
9-10 = perfect fit for this section (type matches AND content directly relevant)
7-8 = good fit
5-6 = partial fit
3-4 = weak fit
0-2 = poor fit or type mismatch for this section

Return a JSON array where each item is {"id": "...", "score": N}.
Include ALL ${candidates.length} fragments. Return ONLY the JSON array.`;

    try {
      const response = await this.llm.chatMessages([{ role: 'user', content: prompt }]);
      const match = response.match(/\[[\s\S]*\]/);
      if (!match) return defaultMap;
      const parsed = JSON.parse(match[0]) as unknown[];
      if (!Array.isArray(parsed)) return defaultMap;
      const result = new Map(candidates.map((c) => [c.id, LLM_NEUTRAL_SCORE]));
      for (const item of parsed) {
        if (
          typeof (item as Record<string, unknown>).id === 'string' &&
          typeof (item as Record<string, unknown>).score === 'number'
        ) {
          result.set(
            (item as { id: string }).id,
            Math.max(0, Math.min(10, (item as { score: number }).score)),
          );
        }
      }
      return result;
    } catch (err) {
      console.warn(
        '[hybrid][batch-judge] LLM response unparseable, falling back to neutral score 5 — hybrid degraded to vector-only',
        err,
      );
      return defaultMap;
    }
  }
}
