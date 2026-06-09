import { createHash } from 'node:crypto';

export interface ParsedSection {
  id: string;
  title: string;
  description: string;
  inferred_type?: string;
}

export function sectionStableId(title: string, index: number): string {
  const normalized = title.trim().toLowerCase().replace(/\s+/g, ' ');
  const hash = createHash('sha256').update(`${index}:${normalized}`).digest('hex');
  return `sec_${hash.slice(0, 12)}`;
}

const H2_RE = /^##\s+(.+?)\s*$/;
const TYPE_RE = /^\*\*Type:\*\*\s+([a-z-]+)\s*$/i;

function extractType(lines: string[]): { filtered: string[]; inferred_type: string | undefined } {
  let inferred_type: string | undefined;
  const filtered = lines.filter((l) => {
    const m = l.match(TYPE_RE);
    if (m) { inferred_type = m[1].toLowerCase(); return false; }
    return true;
  });
  return { filtered, inferred_type };
}

const MAX_SECTIONS = 13;

/**
 * Enforces structural invariants after LLM generation:
 * - Drops any sections that appear after the conclusion (LLMs often add extras).
 * - Caps at MAX_SECTIONS, keeping conclusion last when present.
 */
export function sanitizeSections(sections: ParsedSection[]): ParsedSection[] {
  const conclusionIdx = sections.findLastIndex((s) => s.inferred_type === 'conclusion');
  const truncated = conclusionIdx >= 0 ? sections.slice(0, conclusionIdx + 1) : sections;

  if (truncated.length <= MAX_SECTIONS) return truncated;

  const conclusion = conclusionIdx >= 0 ? truncated[truncated.length - 1] : null;
  const body = conclusion ? truncated.slice(0, -1) : truncated;
  const kept = body.slice(0, conclusion ? MAX_SECTIONS - 1 : MAX_SECTIONS);
  return conclusion ? [...kept, conclusion] : kept;
}

export function parsePlanSections(markdown: string): ParsedSection[] {
  const trimmed = markdown.trim();
  if (trimmed === '') return [];

  const lines = markdown.split('\n');
  const headingIndices: { line: number; title: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(H2_RE);
    if (m) headingIndices.push({ line: i, title: m[1].trim() });
  }

  if (headingIndices.length === 0) {
    const [firstLine, ...rest] = trimmed.split('\n');
    const { filtered, inferred_type } = extractType(rest);
    return [
      {
        id: sectionStableId(firstLine.trim(), 0),
        title: firstLine.trim(),
        description: filtered.join('\n').trim(),
        inferred_type,
      },
    ];
  }

  const sections: ParsedSection[] = [];
  for (let i = 0; i < headingIndices.length; i++) {
    const start = headingIndices[i].line + 1;
    const end = i + 1 < headingIndices.length ? headingIndices[i + 1].line : lines.length;
    const { filtered, inferred_type } = extractType(lines.slice(start, end));
    const description = filtered.join('\n').trim();
    const title = headingIndices[i].title;
    sections.push({ id: sectionStableId(title, i), title, description, inferred_type });
  }
  return sections;
}
