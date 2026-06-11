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
- definition     : glossary entry, term definition, or concept explanation

No body content. No commentary outside section descriptions.

When a corpus context is provided:
- Use the corpus to inform which types have rich content available, and prioritise those sections. But DO NOT omit a section solely because its type is absent or scarce in the corpus — if the document specification requires that section, include it. A section with no matching fragments will be generated from the specification alone.
- For each type you plan to use, check its domain coverage. Prefer types whose coverage matches the specification topic, but do not drop a required section because of domain mismatch.
- If you feel a testimonial, faq, bio, or clause section is needed but that type is not in the corpus, keep the section with the correct type — the composer will generate it from the specification.
- Table titles in the corpus (e.g. "Choix du modèle de langage", "Proposition financière") are internal data labels from source documents. They MUST NOT appear as section names in your plan.
  Use them only inside section descriptions, with a phrasing like "may include data from the table titled '...'".
  Correct:   section name "Tarification annuelle des prestations", description "...may include data from the table titled 'Proposition financière'..."
  Incorrect: section name "Proposition financière" ← do not do this`;

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
  fragments: Array<{ body: string; payload_schema?: string | null }>;
  lang: string;
  max_chars: number;
  writer_prompt_override?: string;
  plan_title?: string;
  spec_prompt?: string;
  reference_docs?: Array<{ name: string; content: string }>;
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

Source hierarchy — you have two sources of truth:
1. The Document specification (brief): defines what THIS project is about
   — client, product in scope, user count, dates, budget, specific
   technical context. This is the ground truth for current-project facts.
2. Source fragments: provide writing style, professional formulations,
   structural patterns, and reusable commitments from past proposals.

When the brief and a fragment conflict on a project-specific fact
(client name, product name, user count, scope, dates, budget,
technical components in scope), the BRIEF WINS. Fragments are
templates from past projects — authoritative for style and structure,
not for facts that belong to the current project.

Do not invent facts absent from both sources. NEVER invent: phone
numbers, email addresses, URLs, postal addresses, monetary amounts,
discount percentages, promotional offers with specific dates or
conditions, or named individuals not present in either source.
If a section expects such content but neither source provides it,
write in general terms without fabricating specific values.

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
    const rowCount = args.fragments.filter((f) => f.payload_schema?.endsWith('-row-v1')).length;
    if (rowCount >= 2) {
      lines.push(
        'IMPORTANT: The source fragments below are rows of a structured table. ' +
          'Output a Markdown table — one row per fragment, in the order given. ' +
          'Infer column headers from the fragment content. Do not convert them to prose.',
      );
      lines.push('');
    }
    lines.push('Source fragments (use these as the basis for the content):');
    args.fragments.forEach((f, i) => {
      lines.push(`--- Fragment ${i + 1}${f.payload_schema ? ` [${f.payload_schema}]` : ''} ---`);
      lines.push(truncate(f.body, args.max_chars));
    });
  }

  return [
    { role: 'system', content: system },
    { role: 'user', content: lines.join('\n') },
  ];
}

const GROUNDEDNESS_SYSTEM = `You are a factual accuracy auditor for AI-generated documents.

Compare the generated draft against ALL provided source material: source fragments, the document specification (brief), the section description, and any reference documents.
An assertion is grounded if it is supported by ANY of these sources — not just the fragments.
Identify assertions in the draft that are NOT supported by any of the provided source material.

Flag an assertion when:
- It states a fact, figure, percentage, date, or amount not present in any source material
- It modifies a specific value from a source (e.g. "99.5%" becomes "nearly 100%", "216 minutes" becomes "~3.5h")
- It changes the scope of a commitment ("under certain conditions" → "guaranteed", "may" → "will")
- It creates a causal or logical link that none of the source material establishes

Risk levels:
- high: invented fact, modified number/amount/percentage, changed condition or scope
- medium: causal link not present in any source, overgeneralization
- low: paraphrase that subtly shifts meaning without inventing new information

Return ONLY a valid JSON array. If the draft is fully grounded, return [].
Each item must have exactly: { "text": "exact phrase from the draft", "risk": "high|medium|low", "reason": "concise explanation" }
Do not wrap in markdown code blocks.`;

export interface GroundednessContext {
  spec_prompt?: string;
  section_description?: string;
  reference_docs?: Array<{ name: string; content: string }>;
}

export function buildGroundednessMessages(
  draft: string,
  fragmentBodies: string[],
  context?: GroundednessContext,
): ChatMessage[] {
  const lines: string[] = [];

  if (context?.spec_prompt) {
    lines.push('Document specification (brief):');
    lines.push(context.spec_prompt.slice(0, 2000));
    lines.push('');
  }

  if (context?.section_description) {
    lines.push(`Section description: ${context.section_description}`);
    lines.push('');
  }

  if (context?.reference_docs?.length) {
    lines.push('Reference documents:');
    context.reference_docs.forEach((doc) => {
      lines.push(`--- ${doc.name} ---`);
      lines.push(doc.content.slice(0, 1500));
    });
    lines.push('');
  }

  if (fragmentBodies.length === 0) {
    lines.push('(no source fragments)');
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
