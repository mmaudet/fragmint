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
