import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { fragments, planFragmentUsages } from '../db/schema.js';
import { FRAGMENT_TYPES, type CreateFragmentInput } from '../schema/fragment.js';
import { type PlanSection } from '../schema/plan.js';
import { buildSectionMessages } from './plan-prompts.js';
import { slugify } from './slugify.js';
import { renderMarkdownToDocx, renderMarkdownToPptx } from './pandoc-render.js';
import { renderMarpFromString } from './render-marp.js';
import { renderDocxWithTables, type DocxSection } from './render-docx-table.js';
import { renderPptxWithTables, type PptxSection } from './render-pptx-table.js';
import { buildGfmTable, buildMarkdownList } from './table-assembler.js';
import { PlanService, type PlanRecord } from './plan-service.js';

// Marp CSS for the "linagora" pseudo-theme (uses built-in 'default' + custom style overrides).
const LINAGORA_MARP_STYLE = `
  section { font-family: "Calibri", sans-serif; font-size: 24px; }
  h1 { color: #2B579A; }
  h2 { color: #2B579A; }
  a { color: #2B579A; }
`.trim();

function buildMarpContent(
  draftMarkdown: string,
  theme: 'default' | 'gaia' | 'uncover' | 'linagora' = 'default',
): string {
  if (draftMarkdown.trimStart().startsWith('---')) return draftMarkdown;
  // 'linagora' is not a Marp built-in theme — use 'default' + inject custom style
  const marpTheme = theme === 'linagora' ? 'default' : theme;
  const styleBlock = theme === 'linagora' ? `style: |\n  ${LINAGORA_MARP_STYLE.replace(/\n/g, '\n  ')}\n` : '';
  const frontmatter = `---\nmarp: true\ntheme: ${marpTheme}\npaginate: true\n${styleBlock}---\n\n`;
  return frontmatter + draftMarkdown;
}

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
              harvest_confidence: null,
              source_position: null,
              payload: null,
              payload_schema: null,
              origin: 'generated',
              origin_source: null,
              origin_page: null,
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
      reference_docs: [
        ...(p.state.reference_docs ?? []),
        ...(section.reference_docs ?? []),
      ].length ? [
        ...(p.state.reference_docs ?? []),
        ...(section.reference_docs ?? []),
      ] : undefined,
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

  async generateAllSections(planId: string): Promise<PlanRecord | null> {
    const p = await this.get(planId);
    if (!p) return null;
    // Generate prose sections sequentially to avoid LLM rate limits
    for (const section of p.state.sections) {
      if (section.render_mode && section.render_mode !== 'prose') continue;
      try {
        await this.generateSection(planId, section.id);
      } catch (err) {
        console.error(`[generateAllSections] section "${section.title}" failed:`, err);
      }
    }
    return this.assemble(planId);
  }

  private async resolveTableRows(section: PlanSection): Promise<Record<string, unknown>[]> {
    const source = section.table_source;
    const rows: Record<string, unknown>[] = [];

    if (source?.collection_id && this.config.collectionService) {
      const col = await this.config.collectionService.getById(source.collection_id);
      if (col) {
        // Use member fragment payloads
        const fragmentsSvc = this.config.fragments;
        if (fragmentsSvc && col.member_ids.length > 0) {
          for (const fid of col.member_ids) {
            const frag = await fragmentsSvc.getById(fid);
            if (!frag) continue;
            let payload: Record<string, unknown> = {};
            if (frag.payload) {
              try {
                payload = JSON.parse(frag.payload) as Record<string, unknown>;
              } catch {
                payload = {};
              }
            }
            rows.push(payload);
          }
        }
      }
    } else if (source?.fragment_ids && this.config.fragments) {
      const fragmentsSvc = this.config.fragments;
      for (const fid of source.fragment_ids) {
        const frag = await fragmentsSvc.getById(fid);
        if (!frag) continue;
        let payload: Record<string, unknown> = {};
        if (frag.payload) {
          try {
            payload = JSON.parse(frag.payload) as Record<string, unknown>;
          } catch {
            payload = {};
          }
        }
        rows.push(payload);
      }
    } else {
      // Fall back to selected fragment payloads
      const fragmentsSvc = this.config.fragments;
      if (fragmentsSvc) {
        for (const sel of section.selected) {
          const frag = await fragmentsSvc.getById(sel.fragment_id);
          if (!frag) continue;
          let payload: Record<string, unknown> = {};
          if (frag.payload) {
            try {
              payload = JSON.parse(frag.payload) as Record<string, unknown>;
            } catch {
              payload = {};
            }
          }
          rows.push(payload);
        }
      }
    }
    return rows;
  }

  async assemble(id: string): Promise<PlanRecord | null> {
    const p = await this.get(id);
    if (!p) return null;
    const parts: string[] = [`---\ntitle: "${p.title.replace(/"/g, '\\"')}"\n---`, ''];
    for (const s of p.state.sections) {
      parts.push(`# ${s.title}`);
      parts.push('');

      if (s.render_mode === 'table') {
        const rows = await this.resolveTableRows(s);
        const columns = s.columns ?? [];
        const table = buildGfmTable(rows, columns);
        if (table) parts.push(table);
      } else if (s.render_mode === 'list') {
        const bodies = s.selected.map((sel) => sel.body).filter(Boolean);
        const list = buildMarkdownList(bodies);
        if (list) parts.push(list);
      } else {
        // prose (default) — use generated_markdown if available
        if (s.generated_markdown) parts.push(s.generated_markdown.trim());
      }

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

    const hasTableSection = p.state.sections.some((s) => s.render_mode === 'table');
    const tableTemplatePath = this.config.docxTableTemplatePath;

    if (hasTableSection && tableTemplatePath) {
      const docxSections: DocxSection[] = await Promise.all(
        p.state.sections.map(async (s) => {
          if (s.render_mode === 'table') {
            const rows = await this.resolveTableRows(s);
            return {
              title: s.title,
              is_table: true,
              prose: '',
              rows,
              columns: s.columns ?? [],
            };
          }
          return {
            title: s.title,
            is_table: false,
            prose: s.generated_markdown ?? '',
            rows: [],
            columns: [],
          };
        }),
      );
      const buf = await renderDocxWithTables(tableTemplatePath, p.title, docxSections);
      await this.update(id, { status: 'completed' });
      return { content: buf, filename: `${slugify(p.title)}.docx` };
    }

    const reference = args.styleTemplatePath ?? this.config.docxReferencePath;
    const buf = await renderMarkdownToDocx(p.state.draft_markdown, reference);
    await this.update(id, { status: 'completed' });
    return { content: buf, filename: `${slugify(p.title)}.docx` };
  }

  async exportPptx(
    id: string,
    args: { styleTemplatePath?: string } = {},
  ): Promise<{ content: Buffer; filename: string }> {
    const p = await this.get(id);
    if (!p) throw new Error('Plan not found');
    if (!p.state.draft_markdown?.trim()) {
      throw new Error('No assembled draft to export — call /assemble first');
    }

    const hasTableSection = p.state.sections.some((s) => s.render_mode === 'table');

    if (hasTableSection) {
      const pptxSections: PptxSection[] = await Promise.all(
        p.state.sections.map(async (s) => {
          if (s.render_mode === 'table') {
            const rows = await this.resolveTableRows(s);
            return {
              title: s.title,
              render_mode: 'table' as const,
              rows,
              columns: s.columns ?? [],
            };
          }
          return {
            title: s.title,
            render_mode: 'prose' as const,
            prose: s.generated_markdown ?? '',
          };
        }),
      );
      const buf = await renderPptxWithTables(p.title, pptxSections);
      await this.update(id, { status: 'completed' });
      return { content: buf, filename: `${slugify(p.title)}.pptx` };
    }

    const buf = await renderMarkdownToPptx(p.state.draft_markdown, args.styleTemplatePath);
    await this.update(id, { status: 'completed' });
    return { content: buf, filename: `${slugify(p.title)}.pptx` };
  }

  async exportSlides(
    id: string,
    opts: { marpTheme?: 'default' | 'gaia' | 'uncover' | 'linagora' } = {},
  ): Promise<{ content: Buffer; filename: string }> {
    const p = await this.get(id);
    if (!p) throw new Error('Plan not found');
    if (!p.state.draft_markdown?.trim()) {
      throw new Error('No assembled draft to export — call /assemble first');
    }
    const mdContent = buildMarpContent(p.state.draft_markdown, opts.marpTheme);
    const { buffer } = await renderMarpFromString(mdContent, 'html');
    await this.update(id, { status: 'completed' });
    return { content: buffer, filename: `${slugify(p.title)}.html` };
  }

  async exportReveal(
    id: string,
    opts: { revealTheme?: string } = {},
  ): Promise<{ content: Buffer; filename: string }> {
    const p = await this.get(id);
    if (!p) throw new Error('Plan not found');
    if (!p.state.draft_markdown?.trim()) {
      throw new Error('No assembled draft to export — call /assemble first');
    }
    // Convert markdown headings into reveal.js <section> slides.
    // Each `## ` or `# ` heading starts a new slide.
    const raw = p.state.draft_markdown;
    const slideBlocks = raw
      .split(/(?=^#{1,2} )/m)
      .map((block) => block.trim())
      .filter(Boolean);

    const sectionsHtml = slideBlocks
      .map((block) => {
        // Convert basic markdown: bold, inline code, lists (enough for slide bullets)
        const html = block
          .replace(/^#{1,2} (.+)$/m, '<h2>$1</h2>')
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/`(.+?)`/g, '<code>$1</code>')
          .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
          .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
        return `<section>${html}</section>`;
      })
      .join('\n');

    const revealTheme = opts.revealTheme ?? 'white';
    const isLinagora = revealTheme === 'linagora';
    const themeLink = isLinagora
      ? `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/theme/white.css">`
      : `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/theme/${revealTheme}.css">`;
    const customStyle = isLinagora
      ? `
    .reveal h1, .reveal h2, .reveal h3 { text-transform: none; color: #2B579A; }
    .reveal { font-family: "Calibri", sans-serif; font-size: 28px; }
    .reveal ul { text-align: left; }
    .reveal .slides section { border-top: 3px solid #2B579A; padding-top: 10px; }`
      : `
    .reveal h1, .reveal h2, .reveal h3 { text-transform: none; }
    .reveal { font-size: 28px; }
    .reveal ul { text-align: left; }`;
    const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${p.title}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.css">
  ${themeLink}
  <style>${customStyle}
  </style>
</head>
<body>
  <div class="reveal"><div class="slides">
${sectionsHtml}
  </div></div>
  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.js"></script>
  <script>Reveal.initialize({ hash: true, transition: 'slide' });</script>
</body>
</html>`;
    await this.update(id, { status: 'completed' });
    return { content: Buffer.from(fullHtml), filename: `${slugify(p.title)}.html` };
  }
}
