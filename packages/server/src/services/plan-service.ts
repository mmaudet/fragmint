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
import type { SearchResult, SearchService } from '../search/search-service.js';
import type { FragmentService } from './fragment-service.js';
import { FRAGMENT_TYPES, type CreateFragmentInput } from '../schema/fragment.js';
import type { FragmentCandidate } from '../schema/plan.js';

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

  private async runSectionSearch(
    section: { title: string; description: string },
    filters: PlanFilters,
    collectionSlug: string | null,
  ): Promise<FragmentCandidate[]> {
    const results = await this.requireSearch().search(
      `${section.title}\n${section.description}`,
      {
        domain: filters.domain ? [filters.domain] : undefined,
        type: filters.type ? [filters.type] : undefined,
        lang: filters.lang,
        tags: filters.tags,
        collectionSlug: collectionSlug ?? undefined,
      },
      5,
    );
    return results.map(toCandidate);
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

    const newSections = await Promise.all(parsed.map(async (ps) => {
      const previous = oldById.get(ps.id);
      const filters = previous?.filters_override ?? p.state.filters;
      let candidates: FragmentCandidate[] = [];
      try {
        candidates = await this.runSectionSearch(ps, filters, p.collection_slug);
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
    const candidates = await this.runSectionSearch(section, filters, p.collection_slug);
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

        const originalType = original?.type;
        const type = originalType && (FRAGMENT_TYPES as readonly string[]).includes(originalType)
          ? (originalType as CreateFragmentInput['type'])
          : 'argument';

        const domain: string =
          original?.domain && original.domain.length > 0 ? original.domain : 'general';

        const candidateLang: string =
          (original?.lang && original.lang.length > 0 ? original.lang : null) ??
          p.state.filters.lang ??
          'fr';
        const lang: string = /^[a-z]{2}$/.test(candidateLang) ? candidateLang : 'fr';

        // Tags may come from the SQLite row (serialized JSON string) or the
        // parsed frontmatter (already an array). Handle both shapes.
        let tags: string[] = [];
        const frontmatterTags = original?.frontmatter?.tags as unknown;
        const rawTags: unknown = original?.tags ?? frontmatterTags;
        if (Array.isArray(rawTags)) {
          tags = rawTags.filter((t): t is string => typeof t === 'string');
        } else if (typeof rawTags === 'string' && rawTags.length > 0) {
          try {
            const parsed = JSON.parse(rawTags);
            if (Array.isArray(parsed)) {
              tags = parsed.filter((t): t is string => typeof t === 'string');
            }
          } catch {
            tags = [];
          }
        }

        const input: CreateFragmentInput = {
          type,
          domain,
          lang,
          body: sel.body,
          tags,
          translation_of: null,
          parent_id: null,
          generation: 0,
          valid_from: null,
          valid_until: null,
          origin: 'generated',
          access: {
            read: ['*'],
            write: ['contributor', 'admin'],
            approve: ['expert', 'admin'],
          },
        };

        const created = await fragments.create(
          input,
          p.owner,
          'contributor',
          undefined,
          undefined,
          p.collection_slug ?? 'common',
        );
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

    // For non-edited selections, the stored `body` is body_excerpt (~200 chars).
    // Fetch the full fragment body so the writer LLM has the complete context.
    // If no FragmentService is configured (some test setups), fall back to sel.body.
    const fragmentsService = this.config.fragments;
    const fragments_for_writer = await Promise.all(
      section.selected.map(async (sel) => {
        if (sel.edited || !fragmentsService) return { body: sel.body };
        const original = await fragmentsService.getById(sel.fragment_id);
        return { body: original?.body ?? sel.body };
      }),
    );

    const messages = buildSectionMessages({
      section: { title: section.title, description: section.description },
      fragments: fragments_for_writer,
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
    if (!p.state.draft_markdown || p.state.draft_markdown.trim() === '') {
      throw new Error('No assembled draft to export — call /assemble first');
    }
    await this.update(id, { status: 'completed' });
    return {
      content: p.state.draft_markdown,
      filename: `${slugify(p.title)}.md`,
    };
  }

  async exportDocx(
    id: string,
    args: { styleTemplatePath?: string },
  ): Promise<{ content: Buffer; filename: string }> {
    const p = await this.get(id);
    if (!p) throw new Error('Plan not found');
    if (!p.state.draft_markdown || p.state.draft_markdown.trim() === '') {
      throw new Error('No assembled draft to export — call /assemble first');
    }
    const reference = args.styleTemplatePath ?? this.config.docxReferencePath;
    const buf = await renderMarkdownToDocx(p.state.draft_markdown, reference);
    await this.update(id, { status: 'completed' });
    return { content: buf, filename: `${slugify(p.title)}.docx` };
  }
}
