// packages/server/src/services/harvest-chunker.ts
// Semantic chunker: splits markdown by H1–H3 headers, merges small sections,
// falls back to paragraph splitting for oversized sections.

export const SECTION_MAX_CHARS = 12000; // ~3000 tokens
const MIN_MERGE_CHARS = 200; // sections smaller than this are merged with the next

export interface SemanticChunk {
  text: string;
  sourceSection: string; // the header text of the enclosing section, or '' if none
}

/**
 * Split markdown into semantic chunks, each annotated with its source section header.
 * Algorithm:
 *   1. Split by H1–H3 headers.
 *   2. Merge consecutive small sections into one chunk (up to SECTION_MAX_CHARS).
 *   3. Split oversized single sections by paragraph (\n\n) with no overlap.
 */
export function semanticChunk(markdown: string): SemanticChunk[] {
  const sections = splitByHeaders(markdown);
  // splitByHeaders always returns ≥1 section for non-empty input; the guard below
  // is a safety net for truly empty markdown only.
  if (sections.length === 0) return [{ text: markdown.trim(), sourceSection: '' }];

  const chunks: SemanticChunk[] = [];
  let pending: SemanticChunk | null = null;

  for (const section of sections) {
    const text = section.body.trim();
    // Skip micro-sections (< MIN_MERGE_CHARS) that have no useful content —
    // e.g. bare H2 sub-headers with no body. They are merged into the next section.
    if (!text || text.length < MIN_MERGE_CHARS) {
      // Prepend to pending so the header context is carried forward
      if (text && pending) {
        pending.text += '\n\n' + text;
      } else if (text) {
        pending = { text, sourceSection: section.title };
      }
      continue;
    }

    if (!pending) {
      pending = { text, sourceSection: section.title };
    } else if (pending.text.length + text.length + 2 <= SECTION_MAX_CHARS) {
      // Merge: append this section to pending
      pending.text += '\n\n' + text;
      // Keep the first section's title as the label
    } else {
      // Flush pending
      chunks.push(...splitLargeChunk(pending));
      pending = { text, sourceSection: section.title };
    }
  }
  if (pending) chunks.push(...splitLargeChunk(pending));

  return chunks.length > 0 ? chunks : [{ text: markdown.trim(), sourceSection: '' }];
}

// ── Internals ─────────────────────────────────────────────────────────────────

interface Section {
  title: string;
  body: string;
}

function splitByHeaders(markdown: string): Section[] {
  const lines = markdown.split('\n');
  const sections: Section[] = [];
  let currentTitle = '';
  const currentBody: string[] = [];

  for (const line of lines) {
    const headerMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headerMatch) {
      if (currentBody.join('\n').trim() || currentTitle) {
        sections.push({ title: currentTitle, body: currentBody.join('\n') });
      }
      currentTitle = headerMatch[1].trim();
      currentBody.length = 0;
      currentBody.push(line); // include the header line in the body text
    } else {
      currentBody.push(line);
    }
  }
  if (currentBody.join('\n').trim() || currentTitle) {
    sections.push({ title: currentTitle, body: currentBody.join('\n') });
  }
  return sections;
}

const LARGE_CHUNK_OVERLAP = 300; // char overlap between sub-chunks of oversized sections

/**
 * If chunk fits within SECTION_MAX_CHARS, return as-is.
 * Otherwise split by paragraph boundaries (\n\n) with a small overlap so that
 * fragments straddling a paragraph boundary are seen by both adjacent LLM calls.
 */
function splitLargeChunk(chunk: SemanticChunk): SemanticChunk[] {
  if (chunk.text.length <= SECTION_MAX_CHARS) return [chunk];

  const result: SemanticChunk[] = [];
  let start = 0;
  const text = chunk.text;

  while (start < text.length) {
    let end = Math.min(start + SECTION_MAX_CHARS, text.length);
    if (end < text.length) {
      // Snap back to last \n\n within the window (must be at least halfway in)
      const lastPara = text.lastIndexOf('\n\n', end);
      if (lastPara > start + SECTION_MAX_CHARS * 0.5) {
        end = lastPara + 2;
      }
    }
    const slice = text.slice(start, end).trim();
    if (slice) result.push({ text: slice, sourceSection: chunk.sourceSection });
    // Advance with overlap so context bleeds into the next sub-chunk
    start = Math.max(start + 1, end - LARGE_CHUNK_OVERLAP);
    if (end >= text.length) break;
  }
  return result.length > 0 ? result : [chunk];
}
