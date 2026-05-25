import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { fragments, planFragmentUsages } from '../db/schema.js';
import { FRAGMENT_TYPES, type CreateFragmentInput } from '../schema/fragment.js';
import { buildSectionMessages } from './plan-prompts.js';
import { slugify } from './slugify.js';
import { renderMarkdownToDocx } from './pandoc-render.js';
import { PlanService, type PlanRecord } from './plan-service.js';

export class PlanAssembler extends PlanService {
  async validateFragments(id: string): Promise<PlanRecord | null> {
    const p = await this.get(id);
    if (!p) return null;
    const fragmentsSvc = this.requireFragments();

    const newSections = await Promise.all(
      p.state.sections.map(async (s) => {
        const newSelected = await Promise.all(
          s.selected.map(async (sel) => {
            if (!sel.propose_to_library || sel.proposed_fragment_id) return sel;
            const original = await fragmentsSvc.getById(sel.fragment_id);

            const type: CreateFragmentInput['type'] =
              original?.type && (FRAGMENT_TYPES as readonly string[]).includes(original.type)
                ? (original.type as CreateFragmentInput['type'])
                : 'argument';

            const domain: string =
              original?.domain && original.domain.length > 0 ? original.domain : 'general';

            const rawLang =
              (original?.lang && original.lang.length > 0 ? original.lang : null) ??
              p.state.filters.lang ??
              'fr';
            const lang: string = /^[a-z]{2}$/.test(rawLang) ? rawLang : 'fr';

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
              function_type: null,
              audience: [],
              maturity: null,
              harvest_confidence: null,
              origin: 'generated',
              access: {
                read: ['*'],
                write: ['contributor', 'admin'],
                approve: ['expert', 'admin'],
              },
            };

            const created = await fragmentsSvc.create(
              input,
              p.owner,
              'contributor',
              undefined,
              undefined,
              p.collection_slug ?? 'common',
            );
            return { ...sel, proposed_fragment_id: created.id };
          }),
        );
        return { ...s, selected: newSelected };
      }),
    );

    return this.update(id, { sections: newSections, status: 'fragments_validated' });
  }

  async generateSection(planId: string, sectionId: string): Promise<PlanRecord | null> {
    const p = await this.get(planId);
    if (!p) return null;
    const section = p.state.sections.find((s) => s.id === sectionId);
    if (!section) return null;

    // For non-edited selections, stored `body` is body_excerpt (~200 chars).
    // Fetch the full fragment body so the writer LLM has the complete context.
    const fragmentsSvc = this.config.fragments;
    const fragments_for_writer = await Promise.all(
      section.selected.map(async (sel) => {
        if (sel.edited || !fragmentsSvc) return { body: sel.body };
        const original = await fragmentsSvc.getById(sel.fragment_id);
        return { body: original?.body ?? sel.body };
      }),
    );

    const messages = buildSectionMessages({
      section: { title: section.title, description: section.description },
      fragments: fragments_for_writer,
      lang: p.state.filters.lang ?? 'fr',
      max_chars: this.config.fragmentMaxChars,
      writer_prompt_override: section.writer_instructions ?? p.state.writer_prompt_override,
      plan_title: p.title,
      spec_prompt: p.state.spec_prompt,
    });
    const out = await this.requireLlm().chatMessages(messages);

    const now = new Date().toISOString();
    await Promise.all(
      section.selected.map(async (sel) => {
        await this.db.insert(planFragmentUsages).values({
          id: randomUUID(),
          plan_id: planId,
          section_id: sectionId,
          fragment_id: sel.fragment_id,
          used_at: now,
        });
        await this.db
          .update(fragments)
          .set({ uses: sql`${fragments.uses} + 1` })
          .where(eq(fragments.id, sel.fragment_id));
      }),
    );

    const updatedSections = p.state.sections.map((s) =>
      s.id === sectionId ? { ...s, generated_markdown: out.trim() } : s,
    );
    return this.update(planId, { sections: updatedSections });
  }

  async assemble(id: string): Promise<PlanRecord | null> {
    const p = await this.get(id);
    if (!p) return null;
    const parts: string[] = [`---\ntitle: "${p.title.replace(/"/g, '\\"')}"\n---`, ''];
    for (const s of p.state.sections) {
      if (!s.generated_markdown) continue;
      parts.push(`# ${s.title}`);
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
    return { content: p.state.draft_markdown, filename: `${slugify(p.title)}.md` };
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
