import { randomUUID } from 'node:crypto';
import { eq, and, desc, inArray, ne, isNotNull, sql, or, like } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { plans, fragmentTypes, fragmentDomains, fragments, fragmentCollections } from '../db/schema.js';
import {
  PlanStateSchema,
  type PlanState,
  type PlanStatus,
  type PlanFilters,
  type PlanSection,
} from '../schema/plan.js';
import { buildPlanMessages } from './plan-prompts.js';
import { parsePlanSections, sanitizeSections } from './plan-section-parser.js';
import { deriveTitle } from '../git/fragment-file.js';
import type { LlmClient } from './llm-client.js';
import type { SearchService, SearchResult } from '../search/search-service.js';
import type { FragmentService } from './fragment-service.js';
import { FRAGMENT_TYPES, type CreateFragmentInput } from '../schema/fragment.js';
import type { FragmentCandidate } from '../schema/plan.js';
import type {
  FragmentRetriever,
  RetrievedFragment,
  SectionQuery,
} from '../retrieval/fragment-retriever.js';
import { VectorRetriever } from '../retrieval/vector-retriever.js';
import { getCurrentRetriever, getCurrentMode, getSectionTopK } from '../retrieval/factory.js';
import type { FragmentCollectionService } from './fragment-collection-service.js';
import type { PlanTemplate } from '../schema/plan-template.js';

const SECTION_SCORE_THRESHOLD = 0.2;

export function makeSemaphore(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async function<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>((r) => queue.push(r));
    active++;
    try { return await fn(); }
    finally { active--; queue.shift()?.(); }
  };
}

// When two sections compete for the same fragment and their score gap is below this
// threshold, type affinity breaks the tie instead of raw score.
const DEDUP_CLEAR_GAP = 0.15;

// Compatible fragment types per section inferred_type (beyond exact match → 0.7 affinity).
const INFERRED_TYPE_FRAGMENT_MAP: Record<string, string[]> = {
  introduction: ['argument', 'use-case', 'engagement'],
  conclusion: ['engagement', 'use-case', 'argument'],
  argument: ['use-case', 'methodology', 'engagement'],
  reference: ['testimonial', 'bio', 'use-case'],
  engagement: ['argument', 'methodology', 'use-case'],
  'use-case': ['reference', 'testimonial', 'argument'],
  pricing: ['argument', 'clause'],
  methodology: ['argument', 'engagement'],
  faq: ['argument', 'use-case'],
  clause: ['methodology', 'faq'],
  testimonial: ['reference', 'bio'],
  bio: ['testimonial', 'reference'],
};

function typeAlignment(fragmentType: string | undefined, sectionInferredType: string | undefined): number {
  if (!fragmentType || !sectionInferredType) return 0.0;
  if (fragmentType === sectionInferredType) return 1.0;
  return INFERRED_TYPE_FRAGMENT_MAP[sectionInferredType]?.includes(fragmentType) ? 0.7 : 0.0;
}

function dedupCandidatesAcrossSections<T extends { candidates?: FragmentCandidate[]; inferred_type?: string }>(sections: T[]): T[] {
  // Build appearance map: fragId → [{idx, score}], and a type lookup
  const fragTypeMap = new Map<string, string | undefined>();
  const allApps = new Map<string, Array<{ idx: number; score: number }>>();
  for (let i = 0; i < sections.length; i++) {
    for (const c of sections[i].candidates ?? []) {
      if (!fragTypeMap.has(c.fragment_id)) fragTypeMap.set(c.fragment_id, c.type);
      const apps = allApps.get(c.fragment_id) ?? [];
      apps.push({ idx: i, score: c.score ?? 0 });
      allApps.set(c.fragment_id, apps);
    }
  }

  // Assign each fragment to exactly one section
  const assignedIdx = new Map<string, number>();
  for (const [fragId, apps] of allApps) {
    if (apps.length === 1) { assignedIdx.set(fragId, apps[0].idx); continue; }
    apps.sort((a, b) => b.score - a.score);
    if (apps[0].score - apps[1].score >= DEDUP_CLEAR_GAP) {
      assignedIdx.set(fragId, apps[0].idx);
    } else {
      // Scores are close — use type affinity as tiebreaker
      const fragType = fragTypeMap.get(fragId);
      let best = apps[0];
      let bestAlign = typeAlignment(fragType, sections[apps[0].idx].inferred_type);
      for (const app of apps.slice(1)) {
        const align = typeAlignment(fragType, sections[app.idx].inferred_type);
        if (align > bestAlign || (align === bestAlign && app.score > best.score)) {
          best = app; bestAlign = align;
        }
      }
      assignedIdx.set(fragId, best.idx);
    }
  }

  const result = sections.map((s, i) => ({
    ...s,
    candidates: (s.candidates ?? []).filter((c) => assignedIdx.get(c.fragment_id) === i),
  }));
  const removed = sections.reduce((acc, s) => acc + (s.candidates?.length ?? 0), 0) -
    result.reduce((acc, s) => acc + (s.candidates?.length ?? 0), 0);
  if (removed > 0) console.log(`[plan-service] cross-section dedup removed ${removed} duplicate candidate(s)`);
  return result;
}

export function computeConfidenceLevel(llmScore: number | undefined): 'high' | 'medium' | 'low' | 'unknown' {
  if (llmScore === undefined) return 'unknown';
  if (llmScore >= 9) return 'high';
  if (llmScore >= 7) return 'medium';
  return 'low';
}

export function computeSectionConfidence(candidates: FragmentCandidate[]): 'good' | 'partial' | 'poor' | 'empty' {
  if (candidates.length === 0) return 'empty';
  const topLlm = candidates
    .map((c) => c.score_breakdown?.llm_score)
    .filter((s): s is number => s !== undefined)
    .reduce((max, s) => Math.max(max, s), -Infinity);
  if (topLlm !== -Infinity) {
    if (topLlm >= 9) return 'good';
    if (topLlm >= 7) return 'partial';
    return 'poor';
  }
  // No LLM score (vector-only mode) — fall back to top vector similarity score
  const topVector = candidates
    .map((c) => c.score)
    .filter((s): s is number => s !== undefined && s !== null)
    .reduce((max, s) => Math.max(max, s), -Infinity);
  if (topVector === -Infinity) return 'poor';
  if (topVector >= 0.80) return 'good';
  if (topVector >= 0.65) return 'partial';
  return 'poor';
}

function extractRelevantSpecContext(spec: string, maxChars: number, sectionTitle: string): string {
  const paragraphs = spec.split(/\n\n+/);
  const keywords = sectionTitle.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
  const scored = paragraphs.map((text) => ({
    text,
    score: keywords.filter((kw) => text.toLowerCase().includes(kw)).length,
  }));
  scored.sort((a, b) => b.score - a.score);
  let result = '';
  for (const p of scored) {
    if (result.length + p.text.length > maxChars) break;
    result += p.text + '\n\n';
  }
  return (result.trim() || spec.slice(0, maxChars)).trim();
}

function normalizeTitle(raw: string | undefined, fallback: string): string {
  const t = raw?.trim();
  return t ? t : fallback;
}

export interface PlanServiceConfig {
  fragmentMaxChars: number;
  docxReferencePath?: string;
  docxTableTemplatePath?: string;
  llm?: LlmClient;
  search?: SearchService;
  retriever?: FragmentRetriever;
  fragments?: FragmentService;
  collectionService?: FragmentCollectionService;
  sectionTopK?: number;
  llmConcurrency?: number;
}

export interface PlanRecord {
  id: string;
  title: string;
  owner: string;
  collection_slug: string | null;
  status: PlanStatus;
  state: PlanState;
  created_at: string;
  updated_at: string;
}

export interface CreatePlanInput {
  title?: string;
  owner: string;
  collection_slug: string | null;
  spec_prompt: string;
  filters?: PlanFilters;
}

export interface ListPlansInput {
  owner?: string;
  collection_slug?: string | null;
}

export interface UpdatePlanInput {
  title?: string;
  spec_prompt?: string;
  filters?: PlanFilters;
  plan_markdown?: string;
  draft_markdown?: string;
  draft_dirty?: boolean;
  writer_prompt_override?: string;
  sections?: PlanState['sections'];
  export_style_template_id?: string | null;
  status?: PlanStatus;
  reference_docs?: Array<{ name: string; content: string }>;
}

function rowToRecord(row: typeof plans.$inferSelect): PlanRecord {
  return {
    id: row.id,
    title: row.title,
    owner: row.owner,
    collection_slug: row.collection_slug,
    status: row.status as PlanStatus,
    state: PlanStateSchema.parse(JSON.parse(row.state_json)),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class PlanService {
  constructor(
    protected db: FragmintDb,
    protected config: PlanServiceConfig,
  ) {}

  async create(input: CreatePlanInput): Promise<PlanRecord> {
    const id = `plan_${randomUUID()}`;
    const now = new Date().toISOString();
    const state: PlanState = PlanStateSchema.parse({
      spec_prompt: input.spec_prompt,
      filters: input.filters ?? {},
      plan_markdown: '',
      sections: [],
    });
    await this.db.insert(plans).values({
      id,
      title: normalizeTitle(input.title, 'Untitled plan'),
      owner: input.owner,
      collection_slug: input.collection_slug,
      status: 'draft',
      state_json: JSON.stringify(state),
      created_at: now,
      updated_at: now,
    });
    return (await this.get(id))!;
  }

  async createFromTemplate(template: PlanTemplate, input: CreatePlanInput): Promise<PlanRecord> {
    const id = `plan_${randomUUID()}`;
    const now = new Date().toISOString();
    const sections: PlanSection[] = template.sections.map((s) => ({
      id: `sec_${randomUUID()}`,
      title: s.title,
      description: s.description,
      inferred_type: s.inferred_type,
      candidates: [],
      selected: [],
    }));
    const state: PlanState = PlanStateSchema.parse({
      spec_prompt: input.spec_prompt ?? '',
      filters: input.filters ?? {},
      plan_markdown: '',
      sections,
      from_template_id: template.id,
      from_template_version: template.version,
      from_template_name: template.name,
    });
    await this.db.insert(plans).values({
      id,
      title: normalizeTitle(input.title, template.name),
      owner: input.owner,
      collection_slug: input.collection_slug,
      status: 'plan_validated',
      state_json: JSON.stringify(state),
      created_at: now,
      updated_at: now,
    });
    return (await this.get(id))!;
  }

  async list(input: ListPlansInput): Promise<PlanRecord[]> {
    const conds = [];
    if (input.owner) conds.push(eq(plans.owner, input.owner));
    if (input.collection_slug !== undefined && input.collection_slug !== null) {
      conds.push(eq(plans.collection_slug, input.collection_slug));
    }
    const rows = await this.db
      .select()
      .from(plans)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(plans.updated_at));
    return rows.map(rowToRecord);
  }

  async get(id: string): Promise<PlanRecord | null> {
    const rows = await this.db.select().from(plans).where(eq(plans.id, id)).limit(1);
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async update(id: string, input: UpdatePlanInput): Promise<PlanRecord | null> {
    const existing = await this.get(id);
    if (!existing) return null;

    const newState: PlanState = { ...existing.state };
    if (input.spec_prompt !== undefined) newState.spec_prompt = input.spec_prompt;
    if (input.filters !== undefined) newState.filters = input.filters;
    if (input.plan_markdown !== undefined) newState.plan_markdown = input.plan_markdown;
    if (input.draft_markdown !== undefined) newState.draft_markdown = input.draft_markdown;
    if (input.draft_dirty !== undefined) newState.draft_dirty = input.draft_dirty;
    if (input.writer_prompt_override !== undefined)
      newState.writer_prompt_override = input.writer_prompt_override;
    if (input.sections !== undefined) newState.sections = input.sections;
    if (input.export_style_template_id === null) {
      delete newState.export_style_template_id;
    } else if (input.export_style_template_id !== undefined) {
      newState.export_style_template_id = input.export_style_template_id;
    }
    if (input.reference_docs !== undefined) newState.reference_docs = input.reference_docs;

    const now = new Date().toISOString();
    await this.db
      .update(plans)
      .set({
        title: normalizeTitle(input.title, existing.title),
        status: input.status ?? existing.status,
        state_json: JSON.stringify(newState),
        updated_at: now,
      })
      .where(eq(plans.id, id));
    return await this.get(id);
  }

  async remove(id: string): Promise<boolean> {
    await this.db.delete(plans).where(eq(plans.id, id));
    return true;
  }

  protected requireLlm(): LlmClient {
    if (!this.config.llm) throw new Error('PlanService: LlmClient not configured');
    return this.config.llm;
  }
  protected requireRetriever(): FragmentRetriever {
    const live = getCurrentRetriever();
    if (live) return live;
    if (this.config.retriever) return this.config.retriever;
    if (this.config.search) return new VectorRetriever(this.config.search);
    throw new Error('PlanService: neither retriever nor search is configured');
  }
  protected requireFragments(): FragmentService {
    if (!this.config.fragments) throw new Error('PlanService: FragmentService not configured');
    return this.config.fragments;
  }

  private async computePoolA(
    section: { title: string; description: string },
    filters: PlanFilters,
    collectionSlug: string | null,
    knownTags: string[],
    knownDomains: string[],
    poolLimit: number,
  ): Promise<{ forcedCandidates: SearchResult[]; detectedTags: string[]; detectedDomains: string[] }> {
    const sectionText = `${section.title} ${section.description}`.toLowerCase();
    const detectedTags = knownTags.filter((tag: string) => {
      const kw = (tag.includes(':') ? tag.split(':')[1] : tag).toLowerCase();
      return kw.length >= 3 && (sectionText.includes(kw) || sectionText.includes(kw.replace(/-/g, ' ')));
    });
    // Title-only domain detection to avoid false positives from description text
    const titleText = section.title.toLowerCase();
    const detectedDomains = knownDomains.filter((domain) => {
      const kw = domain.toLowerCase().replace(/-/g, ' ');
      return kw.length >= 3 && (titleText.includes(kw) || titleText.includes(domain.toLowerCase()));
    });

    if (!this.config.search || (detectedTags.length === 0 && detectedDomains.length === 0)) {
      return { forcedCandidates: [], detectedTags, detectedDomains };
    }

    const searchFilters = {
      quality_min: 'approved' as const,
      collectionSlug: collectionSlug ?? undefined,
      lang: filters.lang,
    };
    // Namespaced tags (e.g. "produit:twake-workplace") are high-precision — search them first
    // so their fragments fill the priority slots. Bare tags ("migration", "sla") backfill only
    // if slots remain. Without this, generic bare tags ("alternative", "solution") crowd out
    // the specific matches.
    const namespacedTags = detectedTags.filter((t) => t.includes(':'));
    const bareTags = detectedTags.filter((t) => !t.includes(':'));

    const [namespacedForced, ...domainForcedArrays] = await Promise.all([
      namespacedTags.length > 0
        ? this.config.search.searchByTags(namespacedTags, searchFilters, poolLimit)
        : Promise.resolve([]),
      ...detectedDomains.map((domain) =>
        this.config.search!.searchByDomain(domain, searchFilters, poolLimit),
      ),
    ]);

    const seenIds = new Set<string>();
    const priorityResults = [...namespacedForced, ...domainForcedArrays.flat()].filter((r) => {
      if (seenIds.has(r.id)) return false;
      seenIds.add(r.id);
      return true;
    });

    // Fill remaining slots with bare-tag matches
    const remainingSlots = poolLimit - priorityResults.length;
    const bareForced = bareTags.length > 0 && remainingSlots > 0
      ? await this.config.search.searchByTags(bareTags, searchFilters, remainingSlots)
      : [];
    const forcedCandidates = [
      ...priorityResults,
      ...bareForced.filter((r) => !seenIds.has(r.id)),
    ];
    return { forcedCandidates, detectedTags, detectedDomains };
  }

  private async runSectionSearch(
    section: { title: string; description: string; inferred_type?: string },
    filters: PlanFilters,
    collectionSlug: string | null,
    retriever: FragmentRetriever,
    specContext?: string,
    topK?: number,
    planTitle?: string,
    knownTagsHint?: string[],
    knownDomainsHint?: string[],
  ): Promise<FragmentCandidate[]> {
    const specExtract = specContext
      ? extractRelevantSpecContext(specContext, 1500, section.title)
      : undefined;
    const enrichedText = [section.title, section.description, specExtract]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 2000);
    console.debug(`[plan-service] query "${section.title.slice(0, 40)}" enriched=${enrichedText.slice(0, 200).replace(/\n/g, ' ')}`);

    const limit = topK ?? getSectionTopK();

    // Pool A — detect referential tags + domains in section text, fetch forced candidates
    const [knownTags, knownDomains] = await Promise.all([
      knownTagsHint ? Promise.resolve(knownTagsHint) : this.getKnownTags(),
      knownDomainsHint ? Promise.resolve(knownDomainsHint) : this.getKnownDomains(),
    ]);
    const poolLimit = Math.max(50, limit * 4);
    const { forcedCandidates, detectedTags, detectedDomains } = await this.computePoolA(
      section, filters, collectionSlug, knownTags, knownDomains, poolLimit,
    );

    const query: SectionQuery = {
      text: enrichedText,
      filters,
      collectionSlug,
      inferred_type: section.inferred_type,
      spec_context: specContext,
      forced_candidates: forcedCandidates,
    };
    console.debug(
      `[plan-service] "${section.title.slice(0, 30)}" detected_tags=${JSON.stringify(detectedTags)} detected_domains=${JSON.stringify(detectedDomains)} forced=${forcedCandidates.length}`,
    );

    const results: RetrievedFragment[] = await retriever.searchForSection(query, limit);
    const seenIds = new Set<string>();
    return results
      .filter((r) => r.retrieval_source === 'tag' || r.score == null || r.score >= SECTION_SCORE_THRESHOLD)
      .filter((r) => {
        if (seenIds.has(r.fragment_id)) return false;
        seenIds.add(r.fragment_id);
        return true;
      })
      .map((r) => ({
        fragment_id: r.fragment_id,
        score: r.score,
        title: r.title,
        body_excerpt: r.body_excerpt,
        quality: r.quality,
        type: r.type,
        payload_schema: r.payload_schema ?? null,
        score_breakdown: r.score_breakdown,
        justification: r.justification,
        retrieval_source: r.retrieval_source,
        confidence_level: computeConfidenceLevel(r.score_breakdown?.llm_score),
      }));
  }

  private async getKnownTags(): Promise<string[]> {
    const rows = await this.db.selectDistinct({ tags: fragments.tags }).from(fragments);
    return [...new Set(rows.flatMap((r) => { try { return r.tags ? JSON.parse(r.tags) as string[] : []; } catch { return []; } }))];
  }

  private async getKnownDomains(): Promise<string[]> {
    const rows = await this.db.selectDistinct({ domain: fragments.domain }).from(fragments).where(
      and(ne(fragments.domain, ''), ne(fragments.domain, 'other'))
    );
    return rows.map((r) => r.domain).filter((d): d is string => !!d);
  }

  private async inferSectionTypes(
    sections: { id: string; title: string; description: string }[],
    concurrency = 3,
  ): Promise<Map<string, string | undefined>> {
    const knownTypes = (await this.db.select({ slug: fragmentTypes.slug }).from(fragmentTypes))
      .map((r) => r.slug)
      .filter((t) => t !== 'unknown' && t !== 'other');
    const knownDomains = (
      await this.db.select({ slug: fragmentDomains.slug }).from(fragmentDomains)
    ).map((r) => r.slug);

    const llm = this.requireLlm();
    const throttle = makeSemaphore(concurrency);
    const entries = await Promise.all(
      sections.map((s) => throttle(async () => {
        try {
          const c = await llm.classify(`${s.title}\n${s.description}`, knownTypes, knownDomains);
          const t = knownTypes.includes(c.type) ? c.type : undefined;
          return [s.id, t] as const;
        } catch (err) {
          console.error(`Section "${s.title}" type inference failed:`, err);
          return [s.id, undefined] as const;
        }
      })),
    );
    return new Map(entries);
  }

  async generatePlan(id: string): Promise<PlanRecord | null> {
    const p = await this.get(id);
    if (!p) return null;
    const corpusSummary = await this.buildCorpusSummary(p.state.filters);
    const messages = buildPlanMessages({
      spec_prompt: p.state.spec_prompt,
      filters: p.state.filters,
      current_plan: p.state.plan_markdown,
      reference_docs: p.state.reference_docs,
      corpus_summary: corpusSummary,
    });
    const out = await this.requireLlm().chatMessages(messages);
    const sections = sanitizeSections(parsePlanSections(out.trim()));
    const sanitizedMarkdown = sections
      .map((s) => `## ${s.title}\n**Type:** ${s.inferred_type ?? 'argument'}\n${s.description}`)
      .join('\n\n');
    return this.update(id, { plan_markdown: sanitizedMarkdown, status: 'plan_generated' });
  }

  private async buildCorpusSummary(filters?: PlanFilters): Promise<string | undefined> {
    const tagFilters = filters?.tags?.filter((t) => t.length > 0) ?? [];
    const domainFilters = filters?.domain?.filter((d) => d.length > 0) ?? [];

    let scopeCondition;
    if (tagFilters.length > 0 || domainFilters.length > 0) {
      const parts = [
        ...(tagFilters.length > 0
          ? [or(...tagFilters.map((t) => like(fragments.tags, `%"${t}"%`)))]
          : []),
        ...(domainFilters.length > 0 ? [inArray(fragments.domain, domainFilters)] : []),
      ];
      scopeCondition = parts.length === 1 ? parts[0] : or(...parts);
    }
    const qualityFilter = scopeCondition
      ? and(eq(fragments.quality, 'approved'), scopeCondition)
      : eq(fragments.quality, 'approved');

    const domainRows = await this.db
      .select({ domain: fragments.domain, n: sql<number>`count(*)` })
      .from(fragments)
      .where(qualityFilter)
      .groupBy(fragments.domain)
      .orderBy(desc(sql`count(*)`))
      .limit(12);

    const total = domainRows.reduce((s, r) => s + r.n, 0);
    if (total < 20) return undefined;

    const typeDomainRows = await this.db
      .select({ type: fragments.type, domain: fragments.domain, n: sql<number>`count(*)` })
      .from(fragments)
      .where(qualityFilter)
      .groupBy(fragments.type, fragments.domain)
      .orderBy(fragments.type, desc(sql`count(*)`));

    const collRows = await this.db
      .select({
        title: fragmentCollections.title,
        schema: fragmentCollections.payload_schema,
        source: fragmentCollections.source_document,
        member_ids: fragmentCollections.member_ids,
      })
      .from(fragmentCollections)
      .where(isNotNull(fragmentCollections.payload_schema));

    const domainStr = domainRows.map((r) => `${r.domain} (${r.n})`).join(', ');

    const typeMap = new Map<string, { total: number; domains: string[] }>();
    for (const r of typeDomainRows) {
      const entry = typeMap.get(r.type) ?? { total: 0, domains: [] };
      entry.total += r.n;
      entry.domains.push(`${r.domain} (${r.n})`);
      typeMap.set(r.type, entry);
    }
    const typeStr = [...typeMap.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([type, { total, domains }]) => `${type} (${total}): ${domains.join(', ')}`)
      .join('\n  ');

    const structuredColls = collRows
      .map((r) => {
        try {
          const count = (JSON.parse(r.member_ids ?? '[]') as unknown[]).length;
          return count > 0 ? { title: r.title, schema: r.schema ?? '', source: r.source ?? '', count } : null;
        } catch {
          return null;
        }
      })
      .filter((r): r is { title: string; schema: string; source: string; count: number } => r !== null)
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    const lines: string[] = [
      `Available corpus (${total} approved fragments):`,
      `Domains: ${domainStr}`,
      `Types (with domain coverage):`,
      `  ${typeStr}`,
    ];

    if (structuredColls.length > 0) {
      lines.push('Structured data sources (internal labels, NOT section names):');
      for (const c of structuredColls) {
        const tableId = c.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
        const src = c.source.replace(/\.docx?$/i, '').slice(0, 55);
        lines.push(`- table_id="${tableId}" (${c.count} rows, schema=${c.schema}, source=${src})`);
      }
    }

    return lines.join('\n');
  }

  async addReferenceDoc(
    id: string,
    doc: { name: string; content: string },
  ): Promise<PlanRecord | null> {
    const p = await this.get(id);
    if (!p) return null;
    const existing = p.state.reference_docs ?? [];
    return this.update(id, { reference_docs: [...existing, doc] });
  }

  async addSectionReferenceDoc(
    id: string,
    sectionId: string,
    doc: { name: string; content: string },
  ): Promise<PlanRecord | null> {
    const p = await this.get(id);
    if (!p) return null;
    const sections = p.state.sections.map((s) => {
      if (s.id !== sectionId) return s;
      return { ...s, reference_docs: [...(s.reference_docs ?? []), doc] };
    });
    return this.update(id, { sections });
  }

  async validatePlan(id: string): Promise<PlanRecord | null> {
    const p = await this.get(id);
    if (!p) return null;
    if (p.status === 'draft') throw Object.assign(new Error('Generate the plan before validating'), { statusCode: 409 });
    const parsed = parsePlanSections(p.state.plan_markdown);
    const oldById = new Map(p.state.sections.map((s) => [s.id, s]));

    const concurrency = this.config.llmConcurrency ?? 3;
    const sectionsNeedingInference = parsed.filter((ps) => !ps.inferred_type);
    const inferredById = sectionsNeedingInference.length > 0
      ? await this.inferSectionTypes(sectionsNeedingInference, concurrency)
      : new Map<string, string | undefined>();

    const newSections = parsed.map((ps) => {
      const previous = oldById.get(ps.id);
      const inferred_type = ps.inferred_type ?? inferredById.get(ps.id) ?? previous?.inferred_type;
      return {
        id: ps.id,
        title: ps.title,
        description: ps.description,
        candidates: previous?.candidates ?? [],
        selected: previous?.selected ?? [],
        generated_markdown: previous?.generated_markdown,
        filters_override: previous?.filters_override,
        inferred_type,
        section_confidence: previous?.section_confidence,
      };
    });

    return this.update(id, { sections: newSections, status: 'plan_validated' });
  }

  async searchSection(
    planId: string,
    sectionId: string,
    args: { filters_override?: PlanFilters; top_k?: number },
  ): Promise<PlanRecord | null> {
    const p = await this.get(planId);
    if (!p) return null;
    const section = p.state.sections.find((s) => s.id === sectionId);
    if (!section) return null;
    const filters = args.filters_override ?? section.filters_override ?? p.state.filters;

    let inferred_type = section.inferred_type;
    if (!inferred_type) {
      const inferred = await this.inferSectionTypes([section]);
      inferred_type = inferred.get(section.id);
    }

    const retrieverSnapshot = this.requireRetriever();
    const freshCandidates = await this.runSectionSearch(
      { ...section, inferred_type },
      filters,
      p.collection_slug,
      retrieverSnapshot,
      p.state.spec_prompt,
      args.top_k,
      p.title,
    );

    // Re-compute Pool A for all other sections (tag/domain search only, no LLM) to get
    // the same dedup competition as searchAllSections.
    const [knownTags, knownDomains] = await Promise.all([
      this.getKnownTags(),
      this.getKnownDomains(),
    ]);
    const poolLimit = (args.top_k ?? getSectionTopK()) * 4;
    const otherPoolAs = await Promise.all(
      p.state.sections
        .filter((s) => s.id !== sectionId)
        .map((s) =>
          this.computePoolA(
            s,
            s.filters_override ?? p.state.filters,
            p.collection_slug,
            knownTags,
            knownDomains,
            poolLimit,
          ).then(({ forcedCandidates: poolA }) => ({ id: s.id, poolA })),
        ),
    );
    const poolAById = new Map(otherPoolAs.map((o) => [o.id, o.poolA]));
    const virtualSections = p.state.sections.map((s) => {
      if (s.id === sectionId) return { ...s, inferred_type, candidates: freshCandidates };
      const poolA = poolAById.get(s.id);
      const candidates: FragmentCandidate[] = poolA?.length
        ? poolA.map((r) => ({
            fragment_id: r.id,
            score: r.score,
            title: r.title,
            body_excerpt: r.body_excerpt,
            quality: r.quality,
            type: r.type,
            payload_schema: r.payload_schema,
          }))
        : (s.candidates ?? []);
      return { ...s, candidates };
    });
    const deduped = dedupCandidatesAcrossSections(virtualSections);
    const dedupedCandidates = deduped.find((s) => s.id === sectionId)?.candidates ?? [];

    const updatedSections = p.state.sections.map((s) =>
      s.id === sectionId
        ? {
            ...s,
            candidates: dedupedCandidates,
            filters_override: args.filters_override ?? s.filters_override,
            inferred_type,
            section_confidence: computeSectionConfidence(dedupedCandidates),
          }
        : s,
    );
    return this.update(planId, { sections: updatedSections });
  }

  async searchAllSections(
    planId: string,
    args: { top_k?: number } = {},
  ): Promise<PlanRecord | null> {
    const p = await this.get(planId);
    if (!p) return null;
    const validatedStatuses: PlanStatus[] = ['plan_validated', 'fragments_validated', 'completed'];
    if (!validatedStatuses.includes(p.status)) {
      throw Object.assign(new Error('Outline must be validated first. Call plan_validate_outline after the user approves the outline.'), { statusCode: 409 });
    }
    const sections = p.state.sections;
    const retrieverSnapshot = this.requireRetriever();
    const concurrency = this.config.llmConcurrency ?? 3;
    const throttle = makeSemaphore(concurrency);
    console.log(`[plan-service] searchAllSections starting (mode=${getCurrentMode()}, sections=${sections.length}, concurrency=${concurrency})`);

    const toInfer = sections.filter((s) => !s.inferred_type);
    const [inferredById, knownTags, knownDomains] = await Promise.all([
      toInfer.length > 0
        ? this.inferSectionTypes(toInfer, concurrency)
        : Promise.resolve(new Map<string, string | undefined>()),
      this.getKnownTags(),
      this.getKnownDomains(),
    ]);

    // Progressive saves — serialize DB writes via mutex so concurrent section completions
    // don't race on the plan state JSON.
    const saveMutex = makeSemaphore(1);
    const doneById = new Map<string, PlanSection>();

    // Batch path: build all queries in parallel (DB-only Pool A), then run phased LLM
    // across all sections. Critical path: 3 LLM rounds instead of ceil(N/concurrency)×3.
    let rawSections: PlanSection[];
    if (retrieverSnapshot.searchForSectionsBatch) {
      const limit = args.top_k ?? getSectionTopK();
      const sectionMeta = await Promise.all(sections.map(async (s) => {
        const inferred_type = inferredById.get(s.id) ?? s.inferred_type;
        const filters = s.filters_override ?? p.state.filters;
        const specExtract = p.state.spec_prompt ? extractRelevantSpecContext(p.state.spec_prompt, 1500, s.title) : undefined;
        const enrichedText = [s.title, s.description, specExtract].filter(Boolean).join('\n\n').slice(0, 2000);
        const { forcedCandidates } = await this.computePoolA({ title: s.title, description: s.description }, filters, p.collection_slug, knownTags, knownDomains, Math.max(50, limit * 4));
        const query: SectionQuery = { text: enrichedText, filters, collectionSlug: p.collection_slug, inferred_type, spec_context: p.state.spec_prompt, forced_candidates: forcedCandidates };
        return { s, inferred_type, query };
      }));
      const allResults = await retrieverSnapshot.searchForSectionsBatch(sectionMeta.map((m) => m.query), limit, concurrency);
      rawSections = await Promise.all(sectionMeta.map(async ({ s, inferred_type }, i) => {
        const seenIds = new Set<string>();
        const candidates: FragmentCandidate[] = (allResults[i] ?? [])
          .filter((r) => r.retrieval_source === 'tag' || r.score == null || r.score >= SECTION_SCORE_THRESHOLD)
          .filter((r) => { if (seenIds.has(r.fragment_id)) return false; seenIds.add(r.fragment_id); return true; })
          .map((r) => ({ fragment_id: r.fragment_id, score: r.score, title: r.title, body_excerpt: r.body_excerpt, quality: r.quality, type: r.type, payload_schema: r.payload_schema ?? null, score_breakdown: r.score_breakdown, justification: r.justification, retrieval_source: r.retrieval_source, confidence_level: computeConfidenceLevel(r.score_breakdown?.llm_score) }));
        const section_confidence = computeSectionConfidence(candidates);
        const result: PlanSection = { ...s, candidates, inferred_type, section_confidence };
        await saveMutex(async () => { doneById.set(s.id, result); await this.update(planId, { sections: sections.map((sec) => doneById.get(sec.id) ?? sec) }); });
        return result;
      }));
    } else {
    rawSections = await Promise.all(sections.map((s) => throttle(async () => {
      const inferred_type = inferredById.get(s.id) ?? s.inferred_type;
      const filters = s.filters_override ?? p.state.filters;
      let candidates: FragmentCandidate[] = s.candidates ?? [];
      try {
        candidates = await this.runSectionSearch(
          { ...s, inferred_type },
          filters,
          p.collection_slug,
          retrieverSnapshot,
          p.state.spec_prompt,
          args.top_k,
          p.title,
          knownTags,
          knownDomains,
        );
      } catch (err) {
        console.error(`[searchAllSections] section "${s.title}" failed:`, err);
      }
      const section_confidence = computeSectionConfidence(candidates);
      const topLlm = candidates
        .map((c) => c.score_breakdown?.llm_score)
        .filter((sc): sc is number => sc !== undefined)
        .reduce((max, sc) => Math.max(max, sc), -Infinity);
      console.log(
        `[plan] section "${s.title.slice(0, 40)}": top_llm=${topLlm === -Infinity ? 'none' : topLlm} → ${section_confidence}`,
      );
      const result: PlanSection = { ...s, candidates, inferred_type, section_confidence };

      // Immediately persist this section so the frontend can poll and show progress.
      await saveMutex(async () => {
        doneById.set(s.id, result);
        const progressSections = sections.map((sec) => doneById.get(sec.id) ?? sec);
        await this.update(planId, { sections: progressSections });
      });

      return result;
    })));
    } // end else (serial path)

    const updatedSections = dedupCandidatesAcrossSections(rawSections).map((s) => ({
      ...s,
      section_confidence: computeSectionConfidence(s.candidates ?? []),
    }));

    // Batch fetch full bodies for all candidates in one query
    const allIds = updatedSections.flatMap((s) => (s.candidates ?? []).map((c) => c.fragment_id));
    const bodyRows = allIds.length > 0
      ? await this.db.select({ id: fragments.id, body: fragments.body_excerpt }).from(fragments).where(inArray(fragments.id, allIds))
      : [];
    const bodyById = new Map(bodyRows.map((r) => [r.id, r.body]));

    const sectionsWithBodies = updatedSections.map((s) => ({
      ...s,
      candidates: (s.candidates ?? []).map((c) => ({
        ...c,
        body_full: bodyById.get(c.fragment_id) ?? null,
      })),
    }));

    return this.update(planId, { sections: sectionsWithBodies });
  }

  async approveFragments(
    planId: string,
    exclusions: { section_id: string; exclude_ids: string[] }[] = [],
  ): Promise<PlanRecord | null> {
    const p = await this.get(planId);
    if (!p) return null;
    const exclusionMap = new Map(exclusions.map((e) => [e.section_id, new Set(e.exclude_ids)]));
    const sections = p.state.sections.map((s) => {
      const excluded = exclusionMap.get(s.id) ?? new Set<string>();
      const selected = (s.candidates ?? [])
        .filter((c) => !excluded.has(c.fragment_id))
        .map((c) => ({
          fragment_id: c.fragment_id,
          body: c.body_excerpt ?? '',
          edited: false as const,
          propose_to_library: false as const,
        }));
      return { ...s, selected };
    });
    return this.update(planId, { sections });
  }

  async addFragmentToSection(
    planId: string,
    sectionId: string,
    args: {
      fragment_id?: string;
      manual?: { body: string; type?: string; lang: string; domain: string; propose_to_library?: boolean };
    },
    author: string,
    authorRole: string,
    ip?: string,
    collectionGitPath?: string,
  ): Promise<PlanRecord | null> {
    const p = await this.get(planId);
    if (!p) return null;
    const section = p.state.sections.find((s) => s.id === sectionId);
    if (!section) return null;

    let fragmentId: string;
    let title: string | null;
    let bodyExcerpt: string | null;
    let quality: string;
    let preSelectBody: string | null = null;

    if (args.fragment_id) {
      const fragments = this.requireFragments();
      const fragment = await fragments.getById(args.fragment_id);
      if (!fragment) return null;
      fragmentId = fragment.id;
      title = fragment.title;
      bodyExcerpt = fragment.body_excerpt;
      quality = fragment.quality;
    } else if (args.manual) {
      title = deriveTitle(args.manual.body);
      bodyExcerpt = args.manual.body.slice(0, 200);
      quality = 'draft';
      preSelectBody = args.manual.body;

      if (args.manual.propose_to_library) {
        const fragments = this.requireFragments();
        const inferredType = section.inferred_type;
        const type =
          args.manual.type &&
          FRAGMENT_TYPES.includes(args.manual.type as (typeof FRAGMENT_TYPES)[number])
            ? (args.manual.type as (typeof FRAGMENT_TYPES)[number])
            : inferredType && FRAGMENT_TYPES.includes(inferredType as (typeof FRAGMENT_TYPES)[number])
              ? (inferredType as (typeof FRAGMENT_TYPES)[number])
              : 'introduction';
        const input: CreateFragmentInput = {
          type,
          domain: args.manual.domain,
          tags: [],
          lang: args.manual.lang,
          body: args.manual.body,
          translation_of: null,
          parent_id: null,
          generation: 0,
          valid_from: null,
          valid_until: null,
          harvest_confidence: null,
          source_position: null,
          payload: null,
          payload_schema: null,
          origin: 'manual',
          origin_source: null,
          origin_page: null,
          access: { read: ['*'], write: ['contributor', 'admin'], approve: ['expert', 'admin'] },
        };
        const created = await fragments.create(
          input,
          author,
          authorRole,
          ip,
          collectionGitPath,
          p.collection_slug ?? undefined,
        );
        fragmentId = created.id;
      } else {
        // Inline fragment — stored only in plan state, not in the library
        fragmentId = `inline_${randomUUID()}`;
      }
    } else {
      return null;
    }

    const alreadyInCandidates = section.candidates.some((c) => c.fragment_id === fragmentId);
    const newCandidates = alreadyInCandidates
      ? section.candidates
      : [
          ...section.candidates,
          { fragment_id: fragmentId, score: 1, title, body_excerpt: bodyExcerpt, quality },
        ];

    let newSelected = section.selected;
    if (preSelectBody !== null && !section.selected.some((s) => s.fragment_id === fragmentId)) {
      newSelected = [
        ...section.selected,
        {
          fragment_id: fragmentId,
          body: preSelectBody,
          edited: false,
          propose_to_library: args.manual?.propose_to_library ?? false,
        },
      ];
    }

    const updatedSections = p.state.sections.map((s) =>
      s.id === sectionId ? { ...s, candidates: newCandidates, selected: newSelected } : s,
    );
    return this.update(planId, { sections: updatedSections });
  }

  async editSectionFragment(
    planId: string,
    sectionId: string,
    fragmentId: string,
    body: string,
  ): Promise<PlanRecord | null> {
    const p = await this.get(planId);
    if (!p) return null;
    const sectionIdx = p.state.sections.findIndex((s) => s.id === sectionId);
    if (sectionIdx === -1) return null;
    const section = p.state.sections[sectionIdx];
    const selIdx = section.selected.findIndex((sel) => sel.fragment_id === fragmentId);
    if (selIdx === -1) return null;

    const updatedSections = p.state.sections.map((s, i) => {
      if (i !== sectionIdx) return s;
      const newSelected = s.selected.map((sel, j) => {
        if (j !== selIdx) return sel;
        return { ...sel, body, edited: true };
      });
      return { ...s, selected: newSelected };
    });

    return this.update(planId, { sections: updatedSections });
  }
}

