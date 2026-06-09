import type { LlmClient } from '../services/llm-client.js';
import type { IndexService, IndexData } from '../services/index-service.js';
import { buildReadableIdMap, renderMarkdown, renderToc } from '../services/index-service.js';
import type { FragmentService } from '../services/fragment-service.js';
import type { PlanFilters } from '../schema/plan.js';
import type { FragmentRetriever, RetrievedFragment, SectionQuery } from './fragment-retriever.js';
import { TYPE_BOOST, enrichQueryWithFilters } from './fragment-retriever.js';

const PHASE2_SCORE_MIN = 0.3;
const BATCH_JUDGE_SIZE = 25; // max candidates per LLM call — above this, Phase 2 batches sequentially
const PHASE1_MULTIPLIER = 4; // phase1 cap = limit × PHASE1_MULTIPLIER
const PHASE0_THRESHOLD = 200; // fragments — below this, full index fits in context window
const PHASE1_TEMPERATURE = 0.1; // explicit temperature for Phase 1 selection (lower = more deterministic)
const SELF_CONSISTENCY_AGENT1_TEMP = 0.2;
const SELF_CONSISTENCY_AGENT2_TEMP = 0.4;
const STRONG_DISAGREEMENT_THRESHOLD = 0.3; // normalized 0-1 scale
const LLM_NEUTRAL_SCORE_RAW = 5; // 0-10, fallback when batch parse fails

export class AgenticRetriever implements FragmentRetriever {
  private selfConsistency: boolean;
  private minScore: number;

  constructor(
    private indexService: IndexService,
    private llm: LlmClient,
    private fragmentService: FragmentService,
    options: { selfConsistency?: boolean; minScore?: number } = {},
  ) {
    this.selfConsistency = options.selfConsistency ?? false;
    this.minScore = options.minScore ?? PHASE2_SCORE_MIN;
  }

  async searchForSection(query: SectionQuery, limit = 5): Promise<RetrievedFragment[]> {
    // Soft-enrich query text with domain/tags hints (same pattern as hybrid).
    // These become readable hints in Phase 0/1/2 prompts without hard-constraining the LLM.
    const enrichedQuery: SectionQuery = {
      ...query,
      text: enrichQueryWithFilters(query.text, query.filters),
    };
    query = enrichedQuery;

    const indexData = await this.indexService.getData(false, query.collectionSlug ?? undefined, query.filters.lang ?? undefined);

    // Phase 0 — TOC filtering (only when no domain filter AND index large enough to justify it)
    let activeData = indexData;
    if (!query.filters.domain?.length && indexData.total > PHASE0_THRESHOLD) {
      const toc = renderToc(indexData);
      const combinations = new Set<string>(
        Object.entries(indexData.subjects).flatMap(([domain, subj]) =>
          Object.keys(subj.types).map((type) => `${domain}:${type}`),
        ),
      );
      // inferred_type is used only as a Phase 2 score boost (×TYPE_BOOST), NOT as a hard
      // pre-filter here. Restricting combinations to domain:inferred_type would cut cross-type
      // relevant fragments (e.g. pricing/engagement fragments for a methodology section).
      const selected = await this.selectDomainTypes(query, toc, combinations);
      const sectionLabel = query.text.replace(/\s+/g, ' ').slice(0, 60);
      const typeHint = query.inferred_type
        ? ` [inferred_type=${query.inferred_type}]`
        : ' [inferred_type=none]';
      if (selected) {
        console.info(
          `[retrieval][agentic-only][phase0] "${sectionLabel}"${typeHint} → ${selected.length} combinations: ${selected.join(', ')}`,
        );
        activeData = filterIndexData(indexData, selected);
      } else {
        console.info(
          `[retrieval][agentic-only][phase0] "${sectionLabel}"${typeHint} → fallback to full index (${indexData.total} fragments)`,
        );
      }
    } else {
      const reason = query.filters.domain?.length
        ? `domain filter: ${query.filters.domain.join(', ')}`
        : `index small (${indexData.total} <= ${PHASE0_THRESHOLD})`;
      console.debug(`[retrieval][agentic-only][phase0] skipped (${reason})`);
    }

    const indexMd = renderMarkdown(activeData);
    const idMap = buildReadableIdMap(activeData);

    const phase1Cap = Math.max(limit * PHASE1_MULTIPLIER, 8);
    const phase1Ids = await this.selectCandidates(query, indexMd, idMap, phase1Cap, limit);
    const phase1Set = new Set(phase1Ids);

    // Inject Pool A (forced/tag candidates) into Phase 2 pool.
    // Phase 1 selections first (LLM-ranked), then unique tag-forced.
    // Large pools are handled by chunked scoring in callBatchJudge.
    const forcedIds = (query.forced_candidates ?? []).map((c) => c.id);
    const forcedSet = new Set(forcedIds);
    const uniqueTagForced = forcedIds.filter(id => !phase1Set.has(id));
    const allCandidateIds = [...phase1Ids, ...uniqueTagForced];

    console.info(
      `[retrieval][agentic-only][phase1] section "${query.text.slice(0, 50)}" → ${phase1Ids.length} selected + ${allCandidateIds.length - phase1Ids.length} tag-forced (total=${allCandidateIds.length}, cap=${phase1Cap})`,
    );
    if (allCandidateIds.length === 0) return [];

    // Phase 2 — batch scoring on merged pool (LLM sees and judges all candidates)
    const scored = await this.batchScore(query, allCandidateIds);
    const kept = scored
      .filter((r) => r.score !== null && r.score >= this.minScore)
      .map((r) => {
        const typeMatch = !!query.inferred_type && r.type === query.inferred_type;
        const score = typeMatch && r.score != null ? r.score * TYPE_BOOST : r.score;
        return {
          ...r,
          score,
          retrieval_source: (
            phase1Set.has(r.fragment_id) && forcedSet.has(r.fragment_id) ? 'both' :
            forcedSet.has(r.fragment_id) ? 'tag' : 'vector'
          ) as 'vector' | 'tag' | 'both',
        };
      });

    console.info(
      `[retrieval][agentic-only][phase2] section "${query.text.slice(0, 50)}" ` +
        `kept ${kept.length}/${allCandidateIds.length} ` +
        `(threshold=${PHASE2_SCORE_MIN}, self-consistency=${this.selfConsistency})`,
    );

    // Type-boosted ranking before top-K slice: mirrors hybrid-retriever RANKING_TYPE_BOOST.
    // Without this, forced-only type-match fragments (lower base score) are squeezed out
    // by higher-scored cross-type candidates even after TYPE_BOOST is applied to their score.
    const RANKING_TYPE_BOOST = 2.5;
    const qualityRank = (q: string | undefined) => q === 'approved' ? 2 : q === 'reviewed' ? 1 : 0;
    const ranked = query.inferred_type
      ? [...kept].sort((a, b) => {
          const aBoost = a.type === query.inferred_type ? RANKING_TYPE_BOOST : 1.0;
          const bBoost = b.type === query.inferred_type ? RANKING_TYPE_BOOST : 1.0;
          const scoreDiff = (b.score ?? 0) * bBoost - (a.score ?? 0) * aBoost;
          if (scoreDiff !== 0) return scoreDiff;
          return qualityRank(b.quality ?? undefined) - qualityRank(a.quality ?? undefined);
        })
      : kept.sort((a, b) => {
          const diff = (b.score ?? 0) - (a.score ?? 0);
          if (diff !== 0) return diff;
          return qualityRank(b.quality ?? undefined) - qualityRank(a.quality ?? undefined);
        });
    return ranked.slice(0, limit);
  }

  // ── Phase 2 batch ────────────────────────────────────────────────────────────

  /**
   * Scores all candidate fragments in a single LLM batch call (two calls when
   * self-consistency is enabled). Returns one RetrievedFragment per candidate.
   */
  private async batchScore(
    query: SectionQuery,
    fragmentIds: string[],
  ): Promise<RetrievedFragment[]> {
    // Load all fragments in parallel — no LLM cost
    const loaded = await Promise.all(
      fragmentIds.map(async (id) => ({ id, frag: await this.fragmentService.getById(id) })),
    );
    const valid = loaded.filter(
      (x): x is { id: string; frag: NonNullable<typeof x.frag> } => x.frag !== null,
    );
    if (valid.length === 0) return [];

    if (this.selfConsistency) {
      // Two batch calls in parallel at different temperatures
      const [judgements1, judgements2] = await Promise.all([
        this.callBatchJudge(query, valid, SELF_CONSISTENCY_AGENT1_TEMP),
        this.callBatchJudge(query, valid, SELF_CONSISTENCY_AGENT2_TEMP),
      ]);

      const j1Failed = judgements1 === null;
      const j2Failed = judgements2 === null;

      if (j1Failed && j2Failed) {
        // Both agents failed hard — no scoring signal at all, fall back to Phase 1 order
        console.warn(
          `[retrieval][agentic-only][phase2] both judge calls failed — ` +
            `returning ${valid.length} candidates in Phase 1 order (unscored)`,
        );
        return valid.map(({ id, frag }) => buildResult(id, frag, LLM_NEUTRAL_SCORE_RAW, undefined));
      }

      if (j1Failed || j2Failed) {
        // One agent failed — degrade gracefully: use surviving scores without min
        const surviving = (j1Failed ? judgements2 : judgements1)!;
        console.warn(
          `[retrieval][agentic-only][phase2] one judge call failed — ` +
            `using surviving agent scores directly (no self-consistency min)`,
        );
        return valid.map(({ id, frag }) => {
          const j = surviving.get(id) ?? { score: LLM_NEUTRAL_SCORE_RAW };
          return buildResult(id, frag, j.score, j.reason);
        });
      }

      // Both succeeded — normal self-consistency min logic
      return valid.map(({ id, frag }) => {
        const j1 = judgements1.get(id) ?? { score: LLM_NEUTRAL_SCORE_RAW };
        const j2 = judgements2.get(id) ?? { score: LLM_NEUTRAL_SCORE_RAW };

        // Normalize to 0-1 for STRONG_DISAGREEMENT comparison
        const norm1 = j1.score / 10;
        const norm2 = j2.score / 10;
        const finalNorm = (norm1 + norm2) / 2;
        const disagreement = Math.abs(norm1 - norm2);

        if (disagreement > STRONG_DISAGREEMENT_THRESHOLD) {
          console.warn(
            `[retrieval][agentic-only][phase2][${id.slice(0, 8)}] ` +
              `STRONG_DISAGREEMENT: scores=${norm1.toFixed(2)}/${norm2.toFixed(2)} ` +
              `(diff=${disagreement.toFixed(2)}, threshold=${STRONG_DISAGREEMENT_THRESHOLD})`,
          );
        } else {
          console.debug(
            `[retrieval][agentic-only][phase2][${id.slice(0, 8)}] ` +
              `agent1=${norm1.toFixed(2)} agent2=${norm2.toFixed(2)} → final=${finalNorm.toFixed(2)} (avg)`,
          );
        }

        // Justification comes from the more pessimistic agent
        const pessimistic = norm1 <= norm2 ? j1 : j2;
        return buildResult(id, frag, Math.round(finalNorm * 10), pessimistic.reason, disagreement);
      });
    }

    // Single batch call (no self-consistency)
    const judgements = await this.callBatchJudge(query, valid);
    if (judgements === null) {
      console.warn(
        `[retrieval][agentic-only][phase2] judge call failed — ` +
          `returning ${valid.length} candidates in Phase 1 order (unscored)`,
      );
      return valid.map(({ id, frag }) => buildResult(id, frag, LLM_NEUTRAL_SCORE_RAW, undefined));
    }
    return valid.map(({ id, frag }) => {
      const j = judgements.get(id) ?? { score: LLM_NEUTRAL_SCORE_RAW };
      return buildResult(id, frag, j.score, j.reason);
    });
  }

  /**
   * One LLM call that scores all candidates simultaneously.
   * Returns Map<fragment_id, { score: 0-10, reason? }> on success (null entries get neutral
   * fallback score), or null on hard failure (exception, no JSON, no UUID matches).
   *
   * null signals total failure so callers can fall back to Phase 1 ordering rather than
   * treating all-neutral as a valid scoring result.
   */
  private async callBatchJudge(
    query: SectionQuery,
    candidates: Array<{
      id: string;
      frag: { title: string | null; body?: string | null; body_excerpt?: string | null };
    }>,
    temperature?: number,
  ): Promise<Map<string, { score: number; reason?: string }> | null> {
    // If too many candidates, split into sequential chunks to stay within LLM context limits.
    // Sequential (not parallel) keeps us within the section-level semaphore budget —
    // parallel chunks would multiply concurrent LLM calls beyond FRAGMINT_LLM_CONCURRENCY.
    if (candidates.length > BATCH_JUDGE_SIZE) {
      const merged = new Map<string, { score: number; reason?: string }>();
      for (let i = 0; i < candidates.length; i += BATCH_JUDGE_SIZE) {
        const chunkResult = await this.callBatchJudge(query, candidates.slice(i, i + BATCH_JUDGE_SIZE), temperature);
        if (chunkResult) for (const [id, v] of chunkResult) merged.set(id, v);
      }
      return merged.size > 0 ? merged : null;
    }

    const neutral = (): { score: number; reason?: string } => ({ score: LLM_NEUTRAL_SCORE_RAW });
    const candidateIds = new Set(candidates.map(({ id }) => id));

    const list = candidates
      .map(
        ({ id, frag }, i) =>
          `${i + 1}. ID:${id}\nTitle: ${frag.title ?? ''}\nExcerpt: ${((frag.body ?? frag.body_excerpt) ?? '').slice(0, 200)}`,
      )
      .join('\n\n');

    const contextLine = query.spec_context
      ? `\nBackground (document context): "${query.spec_context.slice(0, 300)}"\n`
      : '';

    const prompt = `Evaluate the relevance of each fragment for the following document section.
Section: "${query.text}"
${contextLine}
Fragments:
${list}

Score each fragment 0 to 10 based solely on content relevance to the section:
9-10 = directly addresses the section topic
7-8 = clearly relevant
5-6 = partially relevant, related topic
3-4 = tangentially related
0-2 = not relevant

Return a JSON array: [{"id": "...", "score": N, "reason": "one sentence"}, ...]
Include ALL ${candidates.length} fragments. Return ONLY the JSON array.`;

    try {
      const response = await this.llm.chatMessages(
        [{ role: 'user', content: prompt }],
        temperature !== undefined ? { temperature } : undefined,
      );
      const match = response.match(/\[[\s\S]*\]/);
      if (!match) {
        console.warn('[agentic][batch-judge] no JSON array in response — hard failure');
        return null;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        console.warn('[agentic][batch-judge] malformed JSON — hard failure');
        return null;
      }
      if (!Array.isArray(parsed)) {
        console.warn('[agentic][batch-judge] non-array JSON — hard failure');
        return null;
      }

      const result = new Map(candidates.map(({ id }) => [id, neutral()]));
      let matchedCount = 0;
      for (const item of parsed) {
        const it = item as Record<string, unknown>;
        if (typeof it.id === 'string' && typeof it.score === 'number') {
          if (candidateIds.has(it.id)) matchedCount++;
          result.set(it.id, {
            score: Math.max(0, Math.min(10, it.score)),
            reason: typeof it.reason === 'string' ? it.reason : undefined,
          });
        }
      }

      if (matchedCount === 0) {
        // LLM echoed wrong IDs (e.g. readable IDs from Phase 1 instead of UUIDs)
        console.warn(
          `[agentic][batch-judge] 0/${candidates.length} candidate UUIDs matched — hard failure`,
        );
        return null;
      }

      return result;
    } catch (err) {
      console.warn('[agentic][batch-judge] LLM call failed', err);
      return null;
    }
  }

  // ── Phase 1 helpers ──────────────────────────────────────────────────────────

  private async selectDomainTypes(
    query: SectionQuery,
    toc: string,
    availableCombinations: Set<string>,
  ): Promise<string[] | null> {
    const typeHint = query.inferred_type
      ? `\nSection type hint (non-binding): "${query.inferred_type}" — include at least one combination of this type if available, but do not exclude other relevant types.`
      : '';
    const prompt = `You are a document composition assistant.

Section to populate: "${query.text}"
${query.filters.lang ? `Language: ${query.filters.lang}` : ''}${typeHint}

Fragment library table of contents:
${toc}

Select the domain:type combinations most relevant for this section.
Return ONLY a JSON array: ["domain:type", ...] (e.g. ["twake-mail:argument", "linshare:use-case"])`;

    try {
      const response = await this.llm.chatMessages(
        [{ role: 'user', content: prompt }],
        { temperature: PHASE1_TEMPERATURE },
      );
      const match = response.match(/\[[\s\S]*?\]/);
      if (!match) return null;
      const parsed = JSON.parse(match[0]);
      if (!Array.isArray(parsed)) return null;
      const valid = (parsed as unknown[]).filter(
        (s): s is string => typeof s === 'string' && availableCombinations.has(s),
      );
      return valid.length > 0 ? valid : null;
    } catch {
      return null;
    }
  }

  private async selectCandidates(
    query: SectionQuery,
    indexMd: string,
    idMap: Map<string, string>,
    phase1Cap = 20,
    targetCount = 5,
  ): Promise<string[]> {
    const filtersLine = buildFiltersDesc(query.filters);
    const collectionLine = query.collectionSlug ? `Collection: ${query.collectionSlug}` : '';
    const minCount = Math.max(targetCount, 3);
    const maxCount = phase1Cap;
    const prompt = `You are a document composition assistant with access to a fragment library.

Section to populate: "${query.text}"
${filtersLine}
${collectionLine}

Fragment library index (organized by domain → type, with \`type:\` explicit on each fragment line):
${indexMd}

Rank the most relevant fragment IDs for this section, from most to least relevant.
The goal is to surface ${targetCount} high-quality fragments for this section.
Return between ${minCount} and ${maxCount} IDs — your choice based on how many are genuinely useful.
Do not pad with weak fragments. Do not truncate good ones.
Instructions:
- Use the section title and description to judge relevance by content and domain, not by type.
- Use entities and tags to further refine relevance.
Return ONLY a JSON array of ID strings, best first: ["TM-arg-001", "LC-intro-003", ...]`;

    try {
      const response = await this.llm.chatMessages(
        [{ role: 'user', content: prompt }],
        { temperature: PHASE1_TEMPERATURE },
      );
      const match = response.match(/\[[\s\S]*?\]/);
      if (!match) return [];
      const parsed = JSON.parse(match[0]);
      if (!Array.isArray(parsed)) return [];
      return (parsed as unknown[])
        .filter((id): id is string => typeof id === 'string')
        .map((id) => idMap.get(id) ?? id)
        .filter((id) => id.length > 0)
        .slice(0, phase1Cap);
    } catch {
      return [];
    }
  }
}

// ── Module-level helpers ─────────────────────────────────────────────────────

function buildResult(
  id: string,
  frag: {
    title: string | null;
    body?: string | null;
    body_excerpt?: string | null;
    quality: string;
    type?: string;
    payload_schema?: string | null;
  },
  rawScore: number,
  reason?: string,
  consistencyDelta?: number,
): RetrievedFragment {
  return {
    fragment_id: id,
    score: rawScore / 10,
    title: frag.title ?? null,
    body_excerpt: ((frag.body ?? frag.body_excerpt) ?? '').slice(0, 200),
    quality: frag.quality,
    type: frag.type,
    payload_schema: frag.payload_schema ?? null,
    justification: reason,
    score_breakdown: {
      method: 'agentic' as const,
      llm_score: rawScore,
      consistency_delta: consistencyDelta,
    },
  };
}

function filterIndexData(data: IndexData, selected: string[]): IndexData {
  const selSet = new Set(selected);
  const subjects: IndexData['subjects'] = {};
  for (const [domain, subj] of Object.entries(data.subjects)) {
    const types: typeof subj.types = {};
    for (const [type, frags] of Object.entries(subj.types)) {
      if (selSet.has(`${domain}:${type}`)) types[type] = frags;
    }
    if (Object.keys(types).length > 0) {
      const count = Object.values(types).reduce((acc, f) => acc + f.length, 0);
      subjects[domain] = { ...subj, types, count };
    }
  }
  const total = Object.values(subjects).reduce((acc, s) => acc + s.count, 0);
  return { ...data, subjects, total };
}

function buildFiltersDesc(filters: PlanFilters): string {
  const parts: string[] = [];
  if (filters.lang) parts.push(`Language: ${filters.lang}`);
  // Domain filter is NOT injected here: it creates a hard bias in Phase 1 that prevents
  // relevant cross-domain fragments from being selected. Pool A handles domain forcing.
  if (filters.type) parts.push(`Type: ${filters.type}`);
  if (filters.tags?.length) parts.push(`Tags: ${filters.tags.join(', ')}`);
  return parts.join('\n');
}
