import type { ChatMessage } from './llm-client.js';
import type { PlanFilters } from '../schema/plan.js';

export interface BuildPlanArgs {
  spec_prompt: string;
  filters: PlanFilters;
  current_plan?: string;
  reference_docs?: Array<{ name: string; content: string }>;
  corpus_summary?: string;
}

const PLAN_SYSTEM = `You produce structured document plans in Markdown. Output ONLY the plan.

Format for each section:
## Section title
**Type:** <slug>
Short description (1–3 sentences) describing what the section covers.

The <slug> MUST be one of:
- introduction   : opening context, problem statement, or executive summary
- argument       : key point, benefit, or rationale for a claim
- use-case       : concrete scenario, customer story, or application example
- methodology    : process, approach, technical specification, or how-it-works
- engagement     : call to action, next steps, contact, or offer
- reference      : legal reference, standard, norm, or external citation
- testimonial    : customer quote, review, or success story
- pricing        : pricing table, licensing model, or cost breakdown
- faq            : frequently asked questions or objection handling
- conclusion     : summary, recap, or closing remarks
- bio            : author, speaker, or team member profile
- clause         : contractual clause, term, or condition

No body content. No commentary outside section descriptions.

When a corpus context is provided:
- Prefer types listed under "Types" — those have matching fragments in the library.
- You may use other valid types (faq, bio, clause, conclusion) if editorially appropriate, but note in the description that no library content exists for that section.
- Table titles in the corpus (e.g. "Choix du modèle de langage", "New additional features", "Proposition financière") are internal data labels from source documents. They MUST NOT appear as section names in your plan.
  Use them only inside section descriptions, with a phrasing like "may include data from the table titled '...'".
  Correct:   section name "Tarification annuelle des prestations", description "...may include data from the table titled 'New additional features'..."
  Incorrect: section name "New additional features" ← do not do this`;

export function buildPlanMessages(args: BuildPlanArgs): ChatMessage[] {
  const lang = args.filters.lang ?? 'fr';
  const domain = args.filters.domain ?? 'any';
  const tags =
    args.filters.tags && args.filters.tags.length > 0 ? args.filters.tags.join(', ') : 'none';

  const parts: string[] = [];

  if (args.corpus_summary) {
    parts.push(`Corpus context (shape sections to match available content):\n${args.corpus_summary}`);
    parts.push('');
  }

  parts.push(`Context / specification:\n${args.spec_prompt}`);
  parts.push('');
  parts.push('Constraints:');
  parts.push(`- Language: ${lang}`);
  parts.push(`- Domain: ${domain}`);
  parts.push(`- Tags: ${tags}`);

  if (args.reference_docs && args.reference_docs.length > 0) {
    parts.push('');
    parts.push('Reference documents (use as context, do not quote directly):');
    for (const doc of args.reference_docs) {
      const truncated =
        doc.content.length > 2000 ? doc.content.slice(0, 2000) + '\n…[truncated]' : doc.content;
      parts.push(`--- ${doc.name} ---`);
      parts.push(truncated);
      parts.push('---');
    }
  }

  if (args.current_plan && args.current_plan.trim() !== '') {
    parts.push('');
    parts.push('Current plan to revise (update it according to the specification above):');
    parts.push(args.current_plan);
  }

  return [
    { role: 'system', content: PLAN_SYSTEM },
    { role: 'user', content: parts.join('\n') },
  ];
}

export interface BuildSectionArgs {
  section: { title: string; description: string };
  fragments: Array<{ body: string }>;
  lang: string;
  max_chars: number;
  writer_prompt_override?: string;
  plan_title?: string;
  spec_prompt?: string;
  reference_docs?: Array<{ name: string; content: string }>;
  /** When true, a structured table will be inserted in the section alongside this prose. */
  has_table_block?: boolean;
  /** Role of this prose block relative to surrounding table blocks. */
  prose_block_role?: 'intro' | 'conclusion' | 'standalone';
}

const WRITER_SYSTEM_BASE = `You are an expert technical writer producing one section of a larger
document. Write in {LANG}. Be concise and factual.

The "Source fragments" provided are internal raw material — building
blocks of the document being authored. They are NOT external sources
to cite. Do NOT:
- attribute content to them ("according to fragment 1", "as stated in...")
- quote them verbatim or wrap their text in quotation marks
- mention that fragments, notes, or sources exist
- preserve their original phrasing if it doesn't fit the section's
  flow or voice

Instead, rewrite and weave the fragment content into a single coherent
section that reads as original prose. You may rephrase freely, reorder
ideas, and drop fragment content that does not fit the section's scope.
Stay faithful to the facts in the fragments — do not invent additional
facts.

Output ONLY the section body in Markdown. Do not repeat the section
title as a heading. No introduction, no closing remark.`;

function truncate(body: string, max: number): string {
  if (body.length <= max) return body;
  return body.slice(0, max) + '\n…[truncated]';
}

export function buildSectionMessages(args: BuildSectionArgs): ChatMessage[] {
  let system = WRITER_SYSTEM_BASE.replace('{LANG}', args.lang);
  if (args.writer_prompt_override && args.writer_prompt_override.trim() !== '') {
    system += `\n\nAdditional guidance: ${args.writer_prompt_override.trim()}`;
  }
  if (args.has_table_block) {
    if (args.prose_block_role === 'intro') {
      system += '\n\nNote: a structured data table will be inserted after this paragraph. Write only a brief introductory sentence or two — do not describe or repeat the tabular data.';
    } else if (args.prose_block_role === 'conclusion') {
      system += '\n\nNote: this paragraph follows a structured data table in the section. Write a brief conclusion that may reference the table above without repeating its data.';
    }
  }

  const lines: string[] = [];
  if (args.plan_title) lines.push(`Document title: ${args.plan_title}`);
  if (args.spec_prompt) {
    lines.push(`Document specification: ${args.spec_prompt.trim()}`);
    lines.push('');
  }
  lines.push(`Section title: ${args.section.title}`);
  lines.push(`Section description: ${args.section.description}`);
  lines.push('');
  if (args.reference_docs?.length) {
    lines.push('Reference documents (background context for this plan — do not quote directly):');
    args.reference_docs.forEach((doc) => {
      lines.push(`--- ${doc.name} ---`);
      lines.push(truncate(doc.content, 1500));
    });
    lines.push('');
  }
  if (args.fragments.length === 0) {
    lines.push('(no source fragments — write from the description and reference documents above)');
  } else {
    lines.push('Source fragments (use these as the basis for the content):');
    args.fragments.forEach((f, i) => {
      lines.push(`--- Fragment ${i + 1} ---`);
      lines.push(truncate(f.body, args.max_chars));
    });
  }

  return [
    { role: 'system', content: system },
    { role: 'user', content: lines.join('\n') },
  ];
}
