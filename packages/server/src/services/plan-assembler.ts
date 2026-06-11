import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { fragments, planFragmentUsages } from '../db/schema.js';
import { FRAGMENT_TYPES, type CreateFragmentInput } from '../schema/fragment.js';
import { type PlanSection } from '../schema/plan.js';
import { buildSectionMessages, buildGroundednessMessages, parseGroundednessFlags, type GroundednessContext } from './plan-prompts.js';
import { makeSemaphore, PlanService, type PlanRecord } from './plan-service.js';
import { slugify } from './slugify.js';
import { renderMarkdownToDocx, renderMarkdownToPptx } from './pandoc-render.js';
import { renderMarpFromString } from './render-marp.js';

// Schemas whose values are project-specific parameters (substitution from brief is allowed).
// Do NOT add sla-row-v1: SLA values are Linagora commitments, not project parameters.
// Do NOT add reference-v1: client references are historical facts.
// Only add a schema here if its values are intrinsically project-specific
// and do not require human validation before being included in a proposal.
export const PARAMETERIZABLE_SCHEMAS = ['pricing-line-v1'];

const PRICING_OVERRIDE_INSTRUCTION = `When a source fragment contains structured tabular data (pricing table), the Document specification takes precedence over fragment values for all monetary amounts, quantities, and totals. Use the fragment for table structure (column names, row labels, format) only.

If the Document specification does not provide a specific value for a cell, mark it as "[à préciser]" rather than copying from the fragment.`;

const TABLE_ROW_INSTRUCTION = `The source fragments are rows of a structured table. You MUST output a Markdown table — one row per fragment, in the order given. Infer column headers from the fragment structure. Do not convert the rows to prose paragraphs.`;

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

// Tags may come from the SQLite row (serialized JSON string) or parsed frontmatter (already an array).
function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === 'string');
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((t): t is string => typeof t === 'string');
    } catch { /* fall through */ }
  }
  return [];
}

export class PlanAssembler extends PlanService {
  private _groundSemaphore: ReturnType<typeof makeSemaphore> | null = null;
  private get groundSemaphore() {
    if (!this._groundSemaphore) {
      this._groundSemaphore = makeSemaphore(this.config.llmConcurrency ?? 3);
    }
    return this._groundSemaphore;
  }

  private scheduleGroundednessCheck(
    planId: string,
    sectionId: string,
    draft: string,
    fragmentBodies: string[],
    context?: GroundednessContext,
  ): void {
    void this.groundSemaphore(async () => {
      try {
        const msgs = buildGroundednessMessages(draft, fragmentBodies, context);
        const raw = await this.requireLlm().chatMessages(msgs, { temperature: 0 });
        const flags = parseGroundednessFlags(raw);
        const latest = await this.get(planId);
        if (!latest) return;
        const updated = latest.state.sections.map((s) =>
          s.id === sectionId ? { ...s, groundedness_flags: flags } : s,
        );
        await this.update(planId, { sections: updated });
      } catch (err) {
        console.warn(`[groundedness] section ${sectionId}:`, err instanceof Error ? err.message : err);
      }
    });
  }

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

            const tags = parseTags(original?.tags ?? original?.frontmatter?.tags);

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

  async generateSection(planId: string, sectionId: string, constraint?: string): Promise<PlanRecord | null> {
    const p = await this.get(planId);
    if (!p) return null;
    const section = p.state.sections.find((s) => s.id === sectionId);
    if (!section) return null;

    // For non-edited selections, stored `body` is body_excerpt (~200 chars).
    // Fetch the full fragment body so the writer LLM has the complete context.
    const fragmentsSvc = this.config.fragments;
    const fragments_for_writer = await Promise.all(
      section.selected.map(async (sel) => {
        if (sel.edited || !fragmentsSvc) return { body: sel.body, payload_schema: null, type: null, payload: null };
        const original = await fragmentsSvc.getById(sel.fragment_id);
        return {
          body: original?.body ?? sel.body,
          payload_schema: original?.payload_schema ?? null,
          type: original?.type ?? null,
          payload: original?.payload ?? null,
        };
      }),
    );

    // Restore original row order for table fragments using _row_index stored in payload.
    fragments_for_writer.sort((a, b) => {
      if (a.payload_schema && a.payload_schema === b.payload_schema) {
        try {
          const pa = JSON.parse(a.payload ?? '{}') as Record<string, unknown>;
          const pb = JSON.parse(b.payload ?? '{}') as Record<string, unknown>;
          if (pa._row_index !== undefined && pb._row_index !== undefined) {
            return (pa._row_index as number) - (pb._row_index as number);
          }
        } catch { /* non-JSON payload, skip */ }
      }
      return 0;
    });

    const referenceDocs = [
      ...(p.state.reference_docs ?? []),
      ...(section.reference_docs ?? []),
    ];
    const fragmentBodyList = fragments_for_writer.map((f) => f.body);

    const hasParameterizableSchema = fragments_for_writer.some(
      (f) => f.payload_schema != null && PARAMETERIZABLE_SCHEMAS.includes(f.payload_schema),
    );
    const rowFragmentCount = fragments_for_writer.filter((f) => f.payload_schema?.endsWith('-row-v1')).length;
    const hasTableRows = rowFragmentCount >= 2;
    const baseOverride = section.writer_instructions ?? p.state.writer_prompt_override;
    const writer_prompt_override = [
      baseOverride,
      hasTableRows ? TABLE_ROW_INSTRUCTION : undefined,
      hasParameterizableSchema ? PRICING_OVERRIDE_INSTRUCTION : undefined,
      constraint,
    ].filter(Boolean).join('\n\n') || undefined;

    const messages = buildSectionMessages({
      section: { title: section.title, description: section.description },
      fragments: fragments_for_writer,
      lang: p.state.filters.lang ?? 'fr',
      max_chars: this.config.fragmentMaxChars,
      writer_prompt_override,
      plan_title: p.title,
      spec_prompt: p.state.spec_prompt,
      reference_docs: referenceDocs.length ? referenceDocs : undefined,
    });
    const out = await this.requireLlm().chatMessages(messages);
    this.scheduleGroundednessCheck(planId, sectionId, out.trim(), fragmentBodyList, {
      spec_prompt: p.state.spec_prompt,
      section_description: section.description,
      reference_docs: referenceDocs.length ? referenceDocs : undefined,
    });

    const now = new Date().toISOString();
    await Promise.all(
      section.selected.map(async (sel) => {
        if (sel.fragment_id.startsWith('inline_')) return;
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

    // Re-read before write to avoid stale-state race when called concurrently
    // from generateAllSections — each call only patches its own section slot.
    const latest = await this.get(planId);
    if (!latest) return null;
    const updatedSections = latest.state.sections.map((s) =>
      s.id === sectionId ? { ...s, generated_markdown: out.trim() } : s,
    );
    return this.update(planId, { sections: updatedSections });
  }

  async generateAllSections(planId: string): Promise<PlanRecord | null> {
    const p = await this.get(planId);
    if (!p) return null;
    const throttle = makeSemaphore(this.config.llmConcurrency ?? 3);
    await Promise.all(p.state.sections.map((s) => throttle(async () => {
      try {
        await this.generateSection(planId, s.id);
      } catch (err) {
        console.error(`[generateAllSections] section "${s.title}" failed:`, err);
      }
    })));
    return this.assemble(planId);
  }

  async assemble(id: string): Promise<PlanRecord | null> {
    const p = await this.get(id);
    if (!p) return null;
    const parts: string[] = [`---\ntitle: "${p.title.replace(/"/g, '\\"')}"\n---`, ''];

    for (const s of p.state.sections) {
      parts.push(`# ${s.title}`);
      parts.push('');

      if (s.generated_markdown) {
        const md = s.generated_markdown.trim();
        const firstNewline = md.indexOf('\n');
        const firstLine = firstNewline >= 0 ? md.slice(0, firstNewline) : md;
        const headingText = firstLine.match(/^#{1,6}\s+(.+)$/)?.[1]?.trim();
        const isTitleDupe = headingText?.toLowerCase() === s.title.trim().toLowerCase();
        const body = !isTitleDupe
          ? md
          : firstNewline >= 0
          ? md.slice(firstNewline + 1).replace(/^\n+/, '')
          : '';
        if (body) parts.push(body);
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
    const slideBlocks = p.state.draft_markdown
      .split(/(?=^#{1,2} )/m)
      .map((block) => block.trim())
      .filter(Boolean);
    const sectionsHtml = slideBlocks
      .map((block) => {
        const html = block
          .replace(/^#{1,2} (.+)$/m, '<h2>$1</h2>')
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/`(.+?)`/g, '<code>$1</code>')
          .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
          .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
        return `<section>${html}</section>`;
      })
      .join('\n');
    const fullHtml = buildRevealHtml(p.title, sectionsHtml, opts.revealTheme ?? 'white');
    await this.update(id, { status: 'completed' });
    return { content: Buffer.from(fullHtml), filename: `${slugify(p.title)}.html` };
  }
}

function buildRevealHtml(title: string, sectionsHtml: string, revealTheme: string): string {
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
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
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
}
