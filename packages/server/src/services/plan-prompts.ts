import type { ChatMessage } from './llm-client.js';
import type { PlanFilters } from '../schema/plan.js';

export interface BuildPlanArgs {
  spec_prompt: string;
  filters: PlanFilters;
  current_plan?: string;
  extra_instructions?: string;
  reference_docs?: Array<{ name: string; content: string }>;
}

const PLAN_SYSTEM = `You produce structured document plans in Markdown. Output ONLY the plan.
Format: one H2 (## ) per section. Under each H2, a single short paragraph
(1–3 sentences) describing what the section covers. No body content.
No introduction, no conclusion outside the plan, no commentary.`;

export function buildPlanMessages(args: BuildPlanArgs): ChatMessage[] {
  const lang = args.filters.lang ?? 'fr';
  const domain = args.filters.domain ?? 'any';
  const tags =
    args.filters.tags && args.filters.tags.length > 0 ? args.filters.tags.join(', ') : 'none';

  const parts: string[] = [];
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

  if (args.extra_instructions && !args.current_plan) {
    parts.push('');
    parts.push(`Additional instructions: ${args.extra_instructions}`);
  }

  if (args.current_plan && args.current_plan.trim() !== '') {
    parts.push('');
    parts.push('Current plan to revise:');
    parts.push(args.current_plan);
    parts.push('');
    parts.push(`Revision instructions: ${args.extra_instructions ?? ''}`.trim());
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
