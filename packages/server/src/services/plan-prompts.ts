import type { ChatMessage } from './llm-client.js';
import type { PlanFilters, GroundednessFlag } from '../schema/plan.js';
export type { GroundednessFlag };

export interface BuildPlanArgs {
  spec_prompt: string;
  filters: PlanFilters;
  current_plan?: string;
  reference_docs?: Array<{ name: string; content: string }>;
  corpus_summary?: string;
}

const PLAN_SYSTEM = `You produce structured document plans in Markdown. Output ONLY the plan.

Rules:
- Aim for 8 to 12 sections. Never exceed 13.
- Group related sub-topics into one section rather than creating one section per keyword.
- If a conclusion section is included, it MUST be the very last section — nothing comes after it.

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
- ONLY use types listed under "Types" in the corpus. Do NOT use any other type even if editorially appropriate — a section with no matching fragments will be empty and must be omitted.
- For each type you plan to use, check its domain coverage. Do NOT include a section of that type if its coverage is limited to domains unrelated to the specification topic (e.g. if pricing only covers "twake" and "linto" but the spec is about "mirai" and "openrag", omit the pricing section).
- If you feel a testimonial, faq, bio, or clause section is needed but that type is not in the corpus, replace it with the closest available type (e.g. use-case instead of testimonial, methodology instead of faq).
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

const GROUNDEDNESS_SYSTEM = `You are a factual accuracy auditor for AI-generated documents.

Compare the generated draft against the provided source fragments.
Identify assertions in the draft that are NOT directly supported by those fragments.

Flag an assertion when:
- It states a fact, figure, percentage, date, or amount not present in any fragment
- It modifies a specific value from a fragment (e.g. "99.5%" becomes "nearly 100%", "216 minutes" becomes "~3.5h")
- It changes the scope of a commitment ("under certain conditions" → "guaranteed", "may" → "will")
- It creates a causal or logical link between two fragments that neither fragment establishes

Risk levels:
- high: invented fact, modified number/amount/percentage, changed condition or scope
- medium: causal link between fragments not present in any source, overgeneralization
- low: paraphrase that subtly shifts meaning without inventing new information

Return ONLY a valid JSON array. If the draft is fully grounded, return [].
Each item must have exactly: { "text": "exact phrase from the draft", "risk": "high|medium|low", "reason": "concise explanation" }
Do not wrap in markdown code blocks.`;

export function buildGroundednessMessages(
  draft: string,
  fragmentBodies: string[],
): ChatMessage[] {
  const lines: string[] = [];
  if (fragmentBodies.length === 0) {
    lines.push('(no source fragments — all assertions in the draft are potentially ungrounded)');
  } else {
    lines.push('Source fragments:');
    fragmentBodies.forEach((body, i) => {
      lines.push(`--- Fragment ${i + 1} ---`);
      lines.push(body.slice(0, 2000));
    });
  }
  lines.push('');
  lines.push('Generated draft:');
  lines.push(draft);

  return [
    { role: 'system', content: GROUNDEDNESS_SYSTEM },
    { role: 'user', content: lines.join('\n') },
  ];
}

export function parseGroundednessFlags(raw: string): GroundednessFlag[] {
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (f): f is GroundednessFlag =>
        typeof f?.text === 'string' &&
        (f?.risk === 'high' || f?.risk === 'medium' || f?.risk === 'low') &&
        typeof f?.reason === 'string',
    );
  } catch {
    return [];
  }
}
