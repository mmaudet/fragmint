import type { LlmClient } from '../services/llm-client.js';
import type { IndexService, IndexData } from '../services/index-service.js';
import { buildReadableIdMap, renderMarkdown, renderToc } from '../services/index-service.js';
import type { FragmentService } from '../services/fragment-service.js';
import type { PlanFilters } from '../schema/plan.js';
import type { FragmentRetriever, RetrievedFragment, SectionQuery } from './fragment-retriever.js';

const PHASE2_SCORE_MIN = 0.3;
const PHASE1_MULTIPLIER = 3;
const PHASE0_THRESHOLD = 200; // fragments — below this, full index fits in context window
const SELF_CONSISTENCY_AGENT1_TEMP = 0.2;
const SELF_CONSISTENCY_AGENT2_TEMP = 0.4;
const STRONG_DISAGREEMENT_THRESHOLD = 0.3;

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
    const phase1Count = limit * PHASE1_MULTIPLIER;

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

    const candidateIds = await this.selectCandidates(query, indexMd, idMap, phase1Count);
    console.debug(
      `[retrieval][agentic-only][phase1] section "${query.text.slice(0, 50)}" → ${candidateIds.length} candidates`,
    );
    if (candidateIds.length === 0) return [];

    const judgeOnce = (id: string) => this.judgeFragmentWithTemp(query, id);
    const judgeWithConsistency = (id: string) => this.judgeFragmentPair(query, id);
    const judge = this.selfConsistency ? judgeWithConsistency : judgeOnce;

    const allResults = await Promise.all(candidateIds.map(judge));
    const scored = allResults.filter(
      (r): r is RetrievedFragment => r !== null && r.score !== null && r.score >= PHASE2_SCORE_MIN,
    );

    console.info(
      `[retrieval][agentic-only][phase2] section "${query.text.slice(0, 50)}" ` +
        `kept ${scored.length}/${candidateIds.length} ` +
        `(threshold=${PHASE2_SCORE_MIN}, self-consistency=${this.selfConsistency})`,
    );

    return scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, limit);
  }

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
      const response = await this.llm.chatMessages([{ role: 'user', content: prompt }]);
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
    count: number,
  ): Promise<string[]> {
    const filtersLine = buildFiltersDesc(query.filters);
    const collectionLine = query.collectionSlug ? `Collection: ${query.collectionSlug}` : '';
    const prompt = `You are a document composition assistant with access to a fragment library.

Section to populate: "${query.text}"
${query.inferred_type ? `Preferred fragment type: ${query.inferred_type}` : ''}
${filtersLine}
${collectionLine}

Fragment library index (organized by domain → type, with \`type:\` explicit on each fragment line):
${indexMd}

Select the ${count} most relevant fragment IDs for this section.
Instructions:
- Each fragment has a \`type:\` field — use it to match the section's purpose:
  - "références clients" / "client references" → prefer type: reference or type: testimonial
  - "cas d'usage" / "use cases" → prefer type: use-case
  - "présentation" / "introduction" → prefer type: introduction or type: argument
  - "méthodologie" → prefer type: methodology
- Use entities and tags to further refine relevance within matching types.
Return ONLY a JSON array of ID strings: ["TM-arg-001", "LC-intro-003", ...]`;

    try {
      const response = await this.llm.chatMessages([{ role: 'user', content: prompt }]);
      const match = response.match(/\[[\s\S]*?\]/);
      if (!match) return [];
      const parsed = JSON.parse(match[0]);
      if (!Array.isArray(parsed)) return [];
      return (parsed as unknown[])
        .filter((id): id is string => typeof id === 'string')
        .map((id) => idMap.get(id) ?? id) // readable_id → uuid, passthrough si déjà UUID
        .filter((id) => id.length > 0)
        .slice(0, count);
    } catch {
      return [];
    }
  }

  /**
   * Judges a single fragment against a section query.
   * The optional `temperature` parameter allows the self-consistency caller
   * (`judgeFragmentPair`) to invoke this method twice with different temperatures
   * (0.2 and 0.4) and take the minimum score as consensus.
   * When omitted, falls back to `this.llm` config temperature.
   */
  private async judgeFragmentWithTemp(
    query: SectionQuery,
    fragmentId: string,
    temperature?: number,
  ): Promise<RetrievedFragment | null> {
    const fragment = await this.fragmentService.getById(fragmentId);
    if (!fragment) return null;

    const prompt = `Evaluate whether this content fragment is relevant for a document section.

Section: "${query.text}"
Fragment title: "${fragment.title ?? ''}"
Fragment body (excerpt):
${(fragment.body ?? '').slice(0, 800)}

Score relevance from 0 to 10 (integer). Be strict and discriminating:
9-10 = perfect fit, directly and specifically addresses the section goal
7-8 = good fit, clearly relevant content
5-6 = partial fit, tangentially related
3-4 = weak fit, loosely related topic
0-2 = poor fit, wrong topic or section mismatch

Most fragments should score 5-7. Only exceptional matches score 8+.
Return ONLY JSON: {"score": N, "reason": "one sentence explanation"}`;

    try {
      const response = await this.llm.chatMessages(
        [{ role: 'user', content: prompt }],
        temperature !== undefined ? { temperature } : undefined,
      );
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
        score_breakdown: {
          method: 'agentic' as const,
          llm_score: rawScore,
        },
      };
    } catch {
      return null;
    }
  }

  private async judgeFragmentPair(
    query: SectionQuery,
    fragmentId: string,
  ): Promise<RetrievedFragment | null> {
    const [result1, result2] = await Promise.all([
      this.judgeFragmentWithTemp(query, fragmentId, SELF_CONSISTENCY_AGENT1_TEMP),
      this.judgeFragmentWithTemp(query, fragmentId, SELF_CONSISTENCY_AGENT2_TEMP),
    ]);

    if (!result1 && !result2) return null;
    if (!result1) {
      console.warn(
        `[retrieval][agentic-only][phase2][${fragmentId.slice(0, 8)}] Agent 1 failed, using agent 2 only`,
      );
      return result2;
    }
    if (!result2) {
      console.warn(
        `[retrieval][agentic-only][phase2][${fragmentId.slice(0, 8)}] Agent 2 failed, using agent 1 only`,
      );
      return result1;
    }

    const score1 = result1.score ?? 0;
    const score2 = result2.score ?? 0;
    const finalScore = Math.min(score1, score2);
    const disagreement = Math.abs(score1 - score2);

    console.debug(
      `[retrieval][agentic-only][phase2][${fragmentId.slice(0, 8)}] ` +
        `agent1=${score1.toFixed(2)} agent2=${score2.toFixed(2)} ` +
        `→ final=${finalScore.toFixed(2)} (min)`,
    );

    if (disagreement > STRONG_DISAGREEMENT_THRESHOLD) {
      console.warn(
        `[retrieval][agentic-only][phase2][${fragmentId.slice(0, 8)}] ` +
          `STRONG_DISAGREEMENT: scores=${score1.toFixed(2)}/${score2.toFixed(2)} ` +
          `(diff=${disagreement.toFixed(2)}, threshold=${STRONG_DISAGREEMENT_THRESHOLD})`,
      );
    }

    // Justification from the more pessimistic agent (consistent with min strategy)
    const finalAgent = score1 <= score2 ? result1 : result2;
    return {
      ...finalAgent,
      score: finalScore,
    };
  }
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
