import { randomUUID } from 'node:crypto';
import { eq, and, desc } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import {
  plans,
  fragmentTypes,
  fragmentDomains,
} from '../db/schema.js';
import {
  PlanStateSchema,
  type PlanState,
  type PlanStatus,
  type PlanFilters,
} from '../schema/plan.js';
import { buildPlanMessages } from './plan-prompts.js';
import { parsePlanSections } from './plan-section-parser.js';
import { deriveTitle } from '../git/fragment-file.js';
import type { LlmClient } from './llm-client.js';
import type { SearchResult, SearchService } from '../search/search-service.js';
import type { FragmentService } from './fragment-service.js';
import { FRAGMENT_TYPES, type CreateFragmentInput } from '../schema/fragment.js';
import type { FragmentCandidate } from '../schema/plan.js';

const SECTION_SCORE_THRESHOLD = 0.2;

function toCandidate(r: SearchResult): FragmentCandidate {
  return {
    fragment_id: r.id,
    score: r.score,
    title: r.title,
    body_excerpt: r.body_excerpt,
    quality: r.quality,
  };
}

function normalizeTitle(raw: string | undefined, fallback: string): string {
  const t = raw?.trim();
  return t ? t : fallback;
}

export interface PlanServiceConfig {
  fragmentMaxChars: number;
  docxReferencePath?: string;
  llm?: LlmClient;
  search?: SearchService;
  fragments?: FragmentService;
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
  owner: string;
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

  async list(input: ListPlansInput): Promise<PlanRecord[]> {
    const conds = [eq(plans.owner, input.owner)];
    if (input.collection_slug !== undefined && input.collection_slug !== null) {
      conds.push(eq(plans.collection_slug, input.collection_slug));
    }
    const rows = await this.db
      .select()
      .from(plans)
      .where(and(...conds))
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
  protected requireSearch(): SearchService {
    if (!this.config.search) throw new Error('PlanService: SearchService not configured');
    return this.config.search;
  }
  protected requireFragments(): FragmentService {
    if (!this.config.fragments) throw new Error('PlanService: FragmentService not configured');
    return this.config.fragments;
  }

  private async runSectionSearch(
    section: { title: string; description: string; inferred_type?: string },
    filters: PlanFilters,
    collectionSlug: string | null,
  ): Promise<FragmentCandidate[]> {
    const results = await this.requireSearch().search(
      `${section.title}\n${section.description}`,
      {
        domain: filters.domain?.length ? filters.domain : undefined,
        type: filters.type ? [filters.type] : undefined,
        lang: filters.lang,
        tags: filters.tags,
        collectionSlug: collectionSlug ?? undefined,
        quality_min: 'reviewed',
      },
      5,
    );
    return results.filter((r) => r.score >= SECTION_SCORE_THRESHOLD).map(toCandidate);
  }

  private async inferSectionTypes(
    sections: { id: string; title: string; description: string }[],
  ): Promise<Map<string, string | undefined>> {
    const knownTypes = (await this.db.select({ slug: fragmentTypes.slug }).from(fragmentTypes))
      .map((r) => r.slug)
      .filter((t) => t !== 'unknown' && t !== 'other');
    const knownDomains = (
      await this.db.select({ slug: fragmentDomains.slug }).from(fragmentDomains)
    ).map((r) => r.slug);

    const llm = this.requireLlm();
    const entries = await Promise.all(
      sections.map(async (s) => {
        try {
          const c = await llm.classify(`${s.title}\n${s.description}`, knownTypes, knownDomains);
          const t = knownTypes.includes(c.type) ? c.type : undefined;
          return [s.id, t] as const;
        } catch (err) {
          console.error(`Section "${s.title}" type inference failed:`, err);
          return [s.id, undefined] as const;
        }
      }),
    );
    return new Map(entries);
  }

  async generatePlan(
    id: string,
    args: { extra_instructions?: string },
  ): Promise<PlanRecord | null> {
    const p = await this.get(id);
    if (!p) return null;
    const messages = buildPlanMessages({
      spec_prompt: p.state.spec_prompt,
      filters: p.state.filters,
      current_plan: p.state.plan_markdown,
      extra_instructions: args.extra_instructions,
    });
    const out = await this.requireLlm().chatMessages(messages);
    return this.update(id, { plan_markdown: out.trim() });
  }

  async validatePlan(id: string): Promise<PlanRecord | null> {
    const p = await this.get(id);
    if (!p) return null;
    const parsed = parsePlanSections(p.state.plan_markdown);
    const oldById = new Map(p.state.sections.map((s) => [s.id, s]));

    const inferredById = await this.inferSectionTypes(parsed);

    const newSections = await Promise.all(
      parsed.map(async (ps) => {
        const previous = oldById.get(ps.id);
        const filters = previous?.filters_override ?? p.state.filters;
        const inferred_type = inferredById.get(ps.id) ?? previous?.inferred_type;
        let candidates: FragmentCandidate[] = [];
        try {
          candidates = await this.runSectionSearch(
            { ...ps, inferred_type },
            filters,
            p.collection_slug,
          );
        } catch (err) {
          console.error(`Section "${ps.title}" search failed:`, err);
          candidates = [];
        }
        return {
          id: ps.id,
          title: ps.title,
          description: ps.description,
          candidates,
          selected: previous?.selected ?? [],
          generated_markdown: previous?.generated_markdown,
          filters_override: previous?.filters_override,
          inferred_type,
        };
      }),
    );

    return this.update(id, { sections: newSections, status: 'plan_validated' });
  }

  async searchSection(
    planId: string,
    sectionId: string,
    args: { filters_override?: PlanFilters },
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

    const candidates = await this.runSectionSearch(
      { ...section, inferred_type },
      filters,
      p.collection_slug,
    );
    const updatedSections = p.state.sections.map((s) =>
      s.id === sectionId
        ? {
            ...s,
            candidates,
            filters_override: args.filters_override ?? s.filters_override,
            inferred_type,
          }
        : s,
    );
    return this.update(planId, { sections: updatedSections });
  }

  async addFragmentToSection(
    planId: string,
    sectionId: string,
    args: {
      fragment_id?: string;
      manual?: { body: string; type?: string; lang: string; domain: string };
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
        function_type: null,
        audience: [],
        maturity: null,
        harvest_confidence: null,
        origin: 'manual',
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
      title = deriveTitle(args.manual.body);
      bodyExcerpt = args.manual.body.slice(0, 200);
      quality = 'draft';
      preSelectBody = args.manual.body;
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
          propose_to_library: false,
        },
      ];
    }

    const updatedSections = p.state.sections.map((s) =>
      s.id === sectionId ? { ...s, candidates: newCandidates, selected: newSelected } : s,
    );
    return this.update(planId, { sections: updatedSections });
  }

}
