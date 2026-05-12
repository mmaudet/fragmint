import { randomUUID } from 'node:crypto';
import { eq, and, desc } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { plans } from '../db/schema.js';
import {
  PlanStateSchema,
  type PlanState,
  type PlanStatus,
  type PlanFilters,
} from '../schema/plan.js';
import { buildPlanMessages, buildSectionMessages } from './plan-prompts.js';
import { parsePlanSections } from './plan-section-parser.js';
import { slugify } from './slugify.js';
import { renderMarkdownToDocx } from './pandoc-render.js';
import type { LlmClient } from './llm-client.js';
import type { SearchService } from '../search/search-service.js';
import type { FragmentService } from './fragment-service.js';

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
  constructor(private db: FragmintDb, private config: PlanServiceConfig) {}

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
      title: input.title?.trim() && input.title.trim() !== '' ? input.title.trim() : 'Untitled plan',
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
        title: input.title?.trim() && input.title.trim() !== '' ? input.title.trim() : existing.title,
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

  private requireLlm(): LlmClient {
    if (!this.config.llm) throw new Error('PlanService: LlmClient not configured');
    return this.config.llm;
  }
  private requireSearch(): SearchService {
    if (!this.config.search) throw new Error('PlanService: SearchService not configured');
    return this.config.search;
  }
  private requireFragments(): FragmentService {
    if (!this.config.fragments) throw new Error('PlanService: FragmentService not configured');
    return this.config.fragments;
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

    const search = this.requireSearch();
    const newSections = await Promise.all(parsed.map(async (ps) => {
      const previous = oldById.get(ps.id);
      const filters = previous?.filters_override ?? p.state.filters;
      const results = await search.search(
        `${ps.title}\n${ps.description}`,
        {
          domain: filters.domain ? [filters.domain] : undefined,
          type: filters.type ? [filters.type] : undefined,
          lang: filters.lang,
          tags: filters.tags,
          collectionSlug: p.collection_slug ?? undefined,
        },
        5,
      );
      const candidates = results.map((r: any) => ({
        fragment_id: r.id,
        score: r.score,
        title: r.title,
        body_excerpt: r.body_excerpt,
        quality: r.quality,
      }));
      return {
        id: ps.id,
        title: ps.title,
        description: ps.description,
        candidates,
        selected: previous?.selected ?? [],
        generated_markdown: previous?.generated_markdown,
        filters_override: previous?.filters_override,
      };
    }));

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
    const results = await this.requireSearch().search(
      `${section.title}\n${section.description}`,
      {
        domain: filters.domain ? [filters.domain] : undefined,
        type: filters.type ? [filters.type] : undefined,
        lang: filters.lang,
        tags: filters.tags,
        collectionSlug: p.collection_slug ?? undefined,
      },
      5,
    );
    const candidates = results.map((r: any) => ({
      fragment_id: r.id,
      score: r.score,
      title: r.title,
      body_excerpt: r.body_excerpt,
      quality: r.quality,
    }));
    const updatedSections = p.state.sections.map((s) =>
      s.id === sectionId ? { ...s, candidates, filters_override: args.filters_override ?? s.filters_override } : s,
    );
    return this.update(planId, { sections: updatedSections });
  }

  async validateFragments(id: string): Promise<PlanRecord | null> {
    const p = await this.get(id);
    if (!p) return null;
    const fragments = this.requireFragments();

    const newSections = await Promise.all(p.state.sections.map(async (s) => {
      const newSelected = await Promise.all(s.selected.map(async (sel) => {
        if (!sel.propose_to_library || sel.proposed_fragment_id) return sel;
        const original = await fragments.getById(sel.fragment_id);
        const created = await (fragments as any).create({
          type: (original as any)?.type ?? 'other',
          domain: (original as any)?.domain ?? 'other',
          lang: (original as any)?.lang ?? 'fr',
          body: sel.body,
          quality: 'draft',
          origin: 'plan',
          origin_source: id,
          author: p.owner,
          tags: (original as any)?.tags,
          collection_slug: p.collection_slug,
        });
        return { ...sel, proposed_fragment_id: created.id };
      }));
      return { ...s, selected: newSelected };
    }));

    return this.update(id, { sections: newSections, status: 'fragments_validated' });
  }

  async generateSection(planId: string, sectionId: string): Promise<PlanRecord | null> {
    const p = await this.get(planId);
    if (!p) return null;
    const section = p.state.sections.find((s) => s.id === sectionId);
    if (!section) return null;
    const messages = buildSectionMessages({
      section: { title: section.title, description: section.description },
      fragments: section.selected.map((s) => ({ body: s.body })),
      lang: p.state.filters.lang ?? 'fr',
      max_chars: this.config.fragmentMaxChars,
      writer_prompt_override: p.state.writer_prompt_override,
    });
    const out = await this.requireLlm().chatMessages(messages);
    const updatedSections = p.state.sections.map((s) =>
      s.id === sectionId ? { ...s, generated_markdown: out.trim() } : s,
    );
    return this.update(planId, { sections: updatedSections });
  }

  async assemble(id: string): Promise<PlanRecord | null> {
    const p = await this.get(id);
    if (!p) return null;
    const parts: string[] = [`# ${p.title}`, ''];
    for (const s of p.state.sections) {
      if (!s.generated_markdown) continue;
      parts.push(`## ${s.title}`);
      parts.push('');
      parts.push(s.generated_markdown.trim());
      parts.push('');
    }
    return this.update(id, { draft_markdown: parts.join('\n'), draft_dirty: false });
  }

  async exportMarkdown(id: string): Promise<{ content: string; filename: string }> {
    const p = await this.get(id);
    if (!p) throw new Error('Plan not found');
    await this.update(id, { status: 'completed' });
    return {
      content: p.state.draft_markdown ?? '',
      filename: `${slugify(p.title)}.md`,
    };
  }

  async exportDocx(
    id: string,
    args: { styleTemplatePath?: string },
  ): Promise<{ content: Buffer; filename: string }> {
    const p = await this.get(id);
    if (!p) throw new Error('Plan not found');
    const reference = args.styleTemplatePath ?? this.config.docxReferencePath;
    const buf = await renderMarkdownToDocx(p.state.draft_markdown ?? '', reference);
    await this.update(id, { status: 'completed' });
    return { content: buf, filename: `${slugify(p.title)}.docx` };
  }
}
