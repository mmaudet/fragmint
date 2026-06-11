import { rrfFusion, normalizeRrfScore } from './rrf.js';
import type { SearchService, SearchResult } from '../search/search-service.js';
import type { LlmClient } from '../services/llm-client.js';
import type {
  FragmentRetriever,
  RetrievedFragment,
  ScoreBreakdown,
  SectionQuery,
} from './fragment-retriever.js';
import { enrichQueryWithFilters, TYPE_BOOST } from './fragment-retriever.js';

const PHASE1_MULTIPLIER = 4; // phase1 candidates = limit × PHASE1_MULTIPLIER

function resolveWeights(preset: string): [number, number] {
  switch (preset) {
    case 'vector-heavy':
      return [2, 1];
    case 'llm-heavy':
      return [1, 2];
    case 'literature':
      // Ratio 30/70 vecteur/LLM (Weighted RRF) — recommandé par la littérature
      // quand le LLM judge est plus fiable que le vecteur.
      // Seul le ratio compte : [3, 7] = [0.3, 0.7] = [30, 70].
      return [3, 7];
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
    weightsPreset: string = 'literature',
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

    // Step 1b — Merge Pool A (forced/tag candidates) into the judge pool
    const vectorIds = new Set(vectorCandidates.map((c) => c.id));
    const forcedOnly = (query.forced_candidates ?? []).filter((c) => !vectorIds.has(c.id));
    const allCandidates = [...vectorCandidates, ...forcedOnly];

    console.debug(
      `[retrieval][hybrid] section "${enrichedText.slice(0, 50)}" → ${vectorCandidates.length} vector + ${forcedOnly.length} tag-forced candidates`,
    );

    if (allCandidates.length === 0) return [];

    // Keep raw vector scores for breakdown (before any RRF transformation)
    const vectorScoreMap = new Map(vectorCandidates.map((c) => [c.id, c.score]));
    const forcedIds = new Set(forcedOnly.map((c) => c.id));

    // Step 2 — LLM batch judge on ALL candidates (vector + forced)
    const llmScoreMap = await this.batchJudge(query, allCandidates);

    // Step 3 — Build 2 ranked lists
    // List 1: vector order only (forced candidates absent → no vector rank contribution)
    const list1 = vectorCandidates.map((c) => ({ id: c.id, _data: c }));

    // List 2: only fragments the LLM actually judged, sorted by LLM score desc.
    // Fragments absent from llmScoreMap (judge failed) are excluded — they contribute
    // only via list1. This prevents a neutral fallback score from polluting LLM ranking.
    const list2 = [...allCandidates]
      .filter((c) => llmScoreMap.has(c.id))
      .sort((a, b) => llmScoreMap.get(b.id)! - llmScoreMap.get(a.id)!)
      .map((c) => ({ id: c.id, _data: c }));

    // Step 4 — RRF fusion
    const fused = rrfFusion([list1, list2], this.rrfK, this.weights);

    // Step 5 — Apply LLM floor + rejection policy.
    // judgeResponded = true when the LLM returned at least one score (partial responses
    // included). When false (total failure: 429, timeout, malformed JSON) we fall back to
    // vector-only and keep all fragments.
    // isTruncated = true when fewer than 90% of candidates were scored: the LLM likely hit
    // its output limit and dropped trailing fragments. In that case we cannot distinguish
    // "rejected" from "forgotten" — keep unscored fragments in the pool (vector rank only,
    // no LLM contribution).
    const judgeResponded = llmScoreMap.size > 0;
    const isTruncated = judgeResponded && llmScoreMap.size / allCandidates.length < 0.9;
    if (isTruncated) {
      console.warn(
        `[hybrid][judge] truncation detected: ${llmScoreMap.size}/${allCandidates.length} fragments scored — keeping non-scored fragments in pool`,
      );
    }

    // Re-inject forced-only candidates dropped by LLM truncation.
    // They have no vector rank (absent from list1) and no LLM score (absent from list2),
    // so they are invisible in fused — the isTruncated guard below never fires for them.
    const fusedFinal = isTruncated
      ? (() => {
          const fusedSet = new Set(fused.map(({ item }) => item.id));
          return [
            ...fused,
            ...forcedOnly
              .filter((c) => !llmScoreMap.has(c.id) && !fusedSet.has(c.id))
              .map((c) => ({ item: { id: c.id, _data: c }, rrf_score: 0 as number })),
          ];
        })()
      : fused;

    const floorFiltered = this.llmFloor > 0
      ? fusedFinal.filter(({ item }) => {
          const llmScore = llmScoreMap.get(item.id);
          if (judgeResponded && !llmScoreMap.has(item.id)) {
            if (isTruncated) {
              return true; // truncation — keep with vector rank only, no LLM contribution
            }
            console.debug(
              `[retrieval][hybrid] fragment ${item.id.slice(0, 8)} dropped — absent from LLM response (implicit rejection)`,
            );
            return false;
          }
          if (llmScore !== undefined && llmScore < this.llmFloor) {
            console.debug(
              `[retrieval][hybrid] fragment ${item.id.slice(0, 8)} dropped by LLM floor (llm=${llmScore} < ${this.llmFloor})`,
            );
            return false;
          }
          return true;
        })
      : fusedFinal;

    // Step 6 — Build result with score_breakdown
    const list1IndexMap = new Map(list1.map((item, i) => [item.id, i + 1]));
    const list2IndexMap = new Map(list2.map((item, i) => [item.id, i + 1]));

    const rankedFiltered = query.inferred_type
      ? [...floorFiltered].sort((a, b) => b.rrf_score - a.rrf_score)
      : floorFiltered;

    const results = rankedFiltered.slice(0, limit).map(({ item, rrf_score }) => {
      const c = item._data;
      const vectorScore = Math.min(1.0, vectorScoreMap.get(c.id) ?? 0);
      const llmScore = llmScoreMap.get(c.id); // undefined if judge failed for this fragment
      const vectorRank = list1IndexMap.get(c.id) ?? 0;
      const llmRank = list2IndexMap.get(c.id); // undefined if not in LLM-ranked list
      const normalizedScore = normalizeRrfScore(rrf_score, this.weights, this.rrfK);
      // Weight normalized RRF by LLM quality: prevents high RRF rank from masking low relevance.
      // Falls back to raw normalizedScore when LLM judge failed (llmScore undefined).
      const preBoostScore = llmScore !== undefined ? normalizedScore * (llmScore / 10) : normalizedScore;
      const typeMatch = !!query.inferred_type && c.type === query.inferred_type;
      const finalScore = typeMatch ? preBoostScore * TYPE_BOOST : preBoostScore;
      const inVector = vectorIds.has(c.id);
      const inForced = forcedIds.has(c.id);

      const breakdown: ScoreBreakdown = {
        method: 'hybrid_rrf',
        vector_score: vectorScore,
        vector_rank: vectorRank,
        llm_score: llmScore,   // undefined when judge failed — no fake neutral score
        llm_rank: llmRank,     // undefined when not in LLM-ranked list
        rrf_score,
        rrf_k: this.rrfK,
        final_score: llmScore !== undefined ? finalScore : undefined,
      };

      return {
        fragment_id: c.id,
        score: finalScore,
        title: c.title,
        body_excerpt: c.body_excerpt,
        quality: c.quality,
        type: c.type,
        payload_schema: c.payload_schema ?? null,
        score_breakdown: breakdown,
        retrieval_source: (inVector && inForced ? 'both' : inForced ? 'tag' : 'vector') as 'vector' | 'tag' | 'both',
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
    const list = candidates
      .map(
        (c, i) =>
          `${i + 1}. ID:${c.id} [domain: ${c.domain}]\nTitle: ${c.title ?? ''}\nExcerpt: ${(c.body_excerpt ?? '').slice(0, 300)}`,
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

Fragments (each has [domain:] for context):
${list}

Score each fragment from 0 to 10 based purely on content relevance to the section:
9-10 = excellent fit, directly addresses the section topic
7-8  = strong fit
5-6  = partial fit, related but not directly on-topic
3-4  = weak fit
0-2  = not relevant to the section

Return ONLY a JSON object mapping each fragment id to its score: {"frag-id-1": 9, "frag-id-2": 4, ...}
Include ALL ${candidates.length} fragments. No prose, no explanation.`;

    let response: string;
    try {
      response = await this.llm.chatMessages([{ role: 'user', content: prompt }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const cause = msg.includes('429') ? 'rate-limited (429)'
        : msg.includes('timeout') ? 'timeout'
        : msg.slice(0, 80);
      console.warn(`[hybrid][judge] LLM call failed (${cause}) — all fragments excluded from LLM ranking`);
      return new Map();
    }

    const result = new Map<string, number>();

    // Primary: compact dict format {"frag-id": score, ...}
    const objMatch = response.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        const parsed = JSON.parse(objMatch[0]) as unknown;
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const [id, score] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof score === 'number') {
              result.set(id, Math.max(0, Math.min(10, score)));
            }
          }
        }
      } catch {
        // fall through to array format
      }
    }

    // Fallback: array format [{"id": "...", "score": N}]
    if (result.size === 0) {
      const arrMatch = response.match(/\[[\s\S]*\]/);
      if (arrMatch) {
        try {
          const parsed = JSON.parse(arrMatch[0]) as unknown;
          if (Array.isArray(parsed)) {
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
          }
        } catch {
          // fall through
        }
      }
    }

    if (result.size === 0) {
      console.warn('[hybrid][judge] LLM returned no parseable scores — all fragments excluded from LLM ranking');
      return new Map();
    }

    for (const c of candidates) {
      if (!result.has(c.id)) {
        console.debug(`[hybrid][judge] fragment ${c.id.slice(0, 8)} absent from LLM response, excluded from LLM ranking`);
      }
    }

    return result;
  }
}
