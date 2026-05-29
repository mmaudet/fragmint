import type { LlmClient } from '../services/llm-client.js';
import type { IndexService, IndexData } from '../services/index-service.js';
import { buildReadableIdMap, renderMarkdown, renderToc } from '../services/index-service.js';
import type { FragmentService } from '../services/fragment-service.js';
import type { PlanFilters } from '../schema/plan.js';
import type { FragmentRetriever, RetrievedFragment, SectionQuery } from './fragment-retriever.js';

const PHASE2_SCORE_MIN = 0.3;
const PHASE1_MULTIPLIER = 4; // phase1 cap = limit × PHASE1_MULTIPLIER
const PHASE0_THRESHOLD = 200; // fragments — below this, full index fits in context window
const PHASE1_TEMPERATURE = 0.1; // explicit temperature for Phase 1 selection (lower = more deterministic)
const SELF_CONSISTENCY_AGENT1_TEMP = 0.2;
const SELF_CONSISTENCY_AGENT2_TEMP = 0.4;
const STRONG_DISAGREEMENT_THRESHOLD = 0.3; // normalized 0-1 scale
const LLM_NEUTRAL_SCORE_RAW = 5; // 0-10, fallback when batch parse fails

export class AgenticRetriever implements FragmentRetriever {
  private selfConsistency: boolean;

  constructor(
    private indexService: IndexService,
    private llm: LlmClient,
    private fragmentService: FragmentService,
    options: { selfConsistency?: boolean } = {},
  ) {
    this.selfConsistency = options.selfConsistency ?? false;
  }

  async searchForSection(query: SectionQuery, limit = 5): Promise<RetrievedFragment[]> {
    const indexData = await this.indexService.getData(false, query.collectionSlug ?? undefined);

    // Phase 0 — TOC filtering (only when no domain filter AND index large enough to justify it)
    let activeData = indexData;
    if (!query.filters.domain?.length && indexData.total > PHASE0_THRESHOLD) {
      const toc = renderToc(indexData);
      const combinations = new Set<string>(
        Object.entries(indexData.subjects).flatMap(([domain, subj]) =>
          Object.keys(subj.types).map((type) => `${domain}:${type}`),
        ),
      );
      const selected = await this.selectDomainTypes(query, toc, combinations);
      if (selected) {
        console.debug(
          `[retrieval][agentic-only][phase0] section "${query.text.slice(0, 50)}" → selected ${selected.length}: ${selected.join(', ')}`,
        );
        activeData = filterIndexData(indexData, selected);
      } else {
        console.debug(
          `[retrieval][agentic-only][phase0] section "${query.text.slice(0, 50)}" → fallback to full index`,
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
    const candidateIds = await this.selectCandidates(query, indexMd, idMap, phase1Cap, limit);
    console.info(
      `[retrieval][agentic-only][phase1] section "${query.text.slice(0, 50)}" → ${candidateIds.length} candidates (cap=${phase1Cap})`,
    );
    if (candidateIds.length === 0) return [];

    // Phase 2 — batch scoring (one LLM call for all candidates)
    const scored = await this.batchScore(query, candidateIds);
    const kept = scored.filter((r) => r.score !== null && r.score >= PHASE2_SCORE_MIN);

    console.info(
      `[retrieval][agentic-only][phase2] section "${query.text.slice(0, 50)}" ` +
        `kept ${kept.length}/${candidateIds.length} ` +
        `(threshold=${PHASE2_SCORE_MIN}, self-consistency=${this.selfConsistency})`,
    );

    return kept.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, limit);
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

      return valid.map(({ id, frag }) => {
        const j1 = judgements1.get(id) ?? { score: LLM_NEUTRAL_SCORE_RAW };
        const j2 = judgements2.get(id) ?? { score: LLM_NEUTRAL_SCORE_RAW };

        // Normalize to 0-1 for STRONG_DISAGREEMENT comparison
        const norm1 = j1.score / 10;
        const norm2 = j2.score / 10;
        const finalNorm = Math.min(norm1, norm2);
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
              `agent1=${norm1.toFixed(2)} agent2=${norm2.toFixed(2)} → final=${finalNorm.toFixed(2)} (min)`,
          );
        }

        // Justification comes from the more pessimistic agent
        const pessimistic = norm1 <= norm2 ? j1 : j2;
        return buildResult(id, frag, Math.round(finalNorm * 10), pessimistic.reason);
      });
    }

    // Single batch call (no self-consistency)
    const judgements = await this.callBatchJudge(query, valid);
    return valid.map(({ id, frag }) => {
      const j = judgements.get(id) ?? { score: LLM_NEUTRAL_SCORE_RAW };
      return buildResult(id, frag, j.score, j.reason);
    });
  }

  /**
   * One LLM call that scores all candidates simultaneously.
   * Returns Map<fragment_id, { score: 0-10, reason? }>.
   */
  private async callBatchJudge(
    query: SectionQuery,
    candidates: Array<{
      id: string;
      frag: { title: string | null; body?: string | null; body_excerpt?: string | null };
    }>,
    temperature?: number,
  ): Promise<Map<string, { score: number; reason?: string }>> {
    const neutral = (): { score: number; reason?: string } => ({ score: LLM_NEUTRAL_SCORE_RAW });
    const defaultMap = new Map(candidates.map(({ id }) => [id, neutral()]));

    const list = candidates
      .map(
        ({ id, frag }, i) =>
          `${i + 1}. ID:${id}\nTitle: ${frag.title ?? ''}\nExcerpt: ${((frag.body ?? frag.body_excerpt) ?? '').slice(0, 200)}`,
      )
      .join('\n\n');

    const typeLine = query.inferred_type
      ? `Expected fragment type for this section: ${query.inferred_type}`
      : '';
    const contextLine = query.spec_context
      ? `\nDocument context (spec): "${query.spec_context.slice(0, 300)}"\n`
      : '';

    const prompt = `Evaluate the relevance of each fragment for the following document section.
${contextLine}
Section: "${query.text}"
${typeLine}

Fragments:
${list}

Score each fragment 0 to 10. Be strict and discriminating:
9-10 = perfect fit (type AND content directly relevant)
7-8 = good fit
5-6 = partial fit
3-4 = weak fit
0-2 = poor fit or type mismatch

Return a JSON array: [{"id": "...", "score": N, "reason": "one sentence"}, ...]
Include ALL ${candidates.length} fragments. Return ONLY the JSON array.`;

    try {
      const response = await this.llm.chatMessages(
        [{ role: 'user', content: prompt }],
        temperature !== undefined ? { temperature } : undefined,
      );
      const match = response.match(/\[[\s\S]*\]/);
      if (!match) return defaultMap;
      const parsed = JSON.parse(match[0]) as unknown[];
      if (!Array.isArray(parsed)) return defaultMap;

      const result = new Map(candidates.map(({ id }) => [id, neutral()]));
      for (const item of parsed) {
        const it = item as Record<string, unknown>;
        if (typeof it.id === 'string' && typeof it.score === 'number') {
          result.set(it.id, {
            score: Math.max(0, Math.min(10, it.score)),
            reason: typeof it.reason === 'string' ? it.reason : undefined,
          });
        }
      }
      return result;
    } catch (err) {
      console.warn(
        '[agentic][batch-judge] LLM response unparseable, falling back to neutral score',
        err,
      );
      return defaultMap;
    }
  }

  // ── Phase 1 helpers ──────────────────────────────────────────────────────────

  private async selectDomainTypes(
    query: SectionQuery,
    toc: string,
    availableCombinations: Set<string>,
  ): Promise<string[] | null> {
    const prompt = `You are a document composition assistant.

Section to populate: "${query.text}"
${query.filters.lang ? `Language: ${query.filters.lang}` : ''}

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
${query.inferred_type ? `Preferred fragment type: ${query.inferred_type}` : ''}
${filtersLine}
${collectionLine}

Fragment library index (organized by domain → type, with \`type:\` explicit on each fragment line):
${indexMd}

Rank the most relevant fragment IDs for this section, from most to least relevant.
The goal is to surface ${targetCount} high-quality fragments for this section.
Return between ${minCount} and ${maxCount} IDs — your choice based on how many are genuinely useful.
Do not pad with weak fragments. Do not truncate good ones.
Instructions:
- Each fragment has a \`type:\` field — use it to match the section's purpose:
  - "références clients" / "client references" → prefer type: reference or type: testimonial
  - "cas d'usage" / "use cases" → prefer type: use-case
  - "présentation" / "introduction" → prefer type: introduction or type: argument
  - "méthodologie" → prefer type: methodology
- Use entities and tags to further refine relevance within matching types.
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
  },
  rawScore: number,
  reason?: string,
): RetrievedFragment {
  return {
    fragment_id: id,
    score: rawScore / 10,
    title: frag.title ?? null,
    body_excerpt: ((frag.body ?? frag.body_excerpt) ?? '').slice(0, 200),
    quality: frag.quality,
    justification: reason,
    score_breakdown: {
      method: 'agentic' as const,
      llm_score: rawScore,
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
  if (filters.domain?.length) parts.push(`Domain(s): ${filters.domain.join(', ')}`);
  if (filters.type) parts.push(`Type: ${filters.type}`);
  if (filters.tags?.length) parts.push(`Tags: ${filters.tags.join(', ')}`);
  return parts.join('\n');
}
