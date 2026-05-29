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
 *   1. Split by H1–H3 headers (ATX-style: "## Title") AND numbered sections
 *      produced by Pandoc from manually-numbered Word paragraphs ("1\. Title",
 *      "1.1 Title", "1.1.1 Title").
 *   2. Flush at every level-1 section boundary so each major section becomes its
 *      own chunk (preserves source_section even in small documents < SECTION_MAX_CHARS).
 *   3. Merge level-2/3 sub-sections into their parent level-1 chunk until SECTION_MAX_CHARS.
 *   4. Split oversized chunks by paragraph (\n\n) with 300-char overlap.
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

    // Level-1 section with tiny/empty body (e.g. "6\. Conformité et sécurité" with no
    // content before the first sub-section): flush previous chunk and start a new one
    // labeled with this top-level title. Sub-sections will fill in the body text.
    const isTopLevel = section.level === 1 && section.title !== '';
    if (isTopLevel && (!text || text.length < MIN_MERGE_CHARS)) {
      if (pending && pending.text.trim()) {
        chunks.push(...splitLargeChunk(pending));
      }
      // Start new pending with top-level label; body may be just the header line or empty.
      pending = { text: text || '', sourceSection: section.title };
      continue;
    }

    // Skip other micro-sections (< MIN_MERGE_CHARS) — e.g. bare sub-headers with no body.
    // They are merged into the next section so context is carried forward.
    if (!text || text.length < MIN_MERGE_CHARS) {
      if (text && pending) {
        pending.text += '\n\n' + text;
      } else if (text) {
        pending = { text, sourceSection: section.title };
      }
      continue;
    }

    if (!pending) {
      pending = { text, sourceSection: section.title };
    } else if (isTopLevel) {
      // Flush at every top-level section boundary so each major section gets its own
      // source_section label, even when the document fits within SECTION_MAX_CHARS.
      if (!pending.sourceSection) {
        // Nameless intro (cover page, preamble): absorb into this first named section
        // rather than emitting a chunk with source_section="".
        pending.text += '\n\n' + text;
        pending.sourceSection = section.title;
      } else {
        chunks.push(...splitLargeChunk(pending));
        pending = { text, sourceSection: section.title };
      }
    } else if (pending.text.length + text.length + 2 <= SECTION_MAX_CHARS) {
      // Sub-section (level 2 or 3): merge into the current parent chunk.
      pending.text += '\n\n' + text;
    } else {
      // Size limit reached: flush and start a new chunk.
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
  /** Header depth: 1 = top-level (# or "1\. Title"), 2 = subsection, 3 = sub-subsection. */
  level: 1 | 2 | 3;
}

function splitByHeaders(markdown: string): Section[] {
  const lines = markdown.split('\n');
  const sections: Section[] = [];
  let currentTitle = '';
  let currentLevel: 1 | 2 | 3 = 1;
  const currentBody: string[] = [];
  // Track whether the previous line was blank so we only treat numbered lines
  // as section headers when they appear after a blank line (Pandoc convention).
  // This guards against body sentences like "2.5 Go de RAM" being mis-detected.
  let prevLineBlank = true; // treat document start as preceded by blank

  for (const line of lines) {
    const isBlank = line.trim() === '';

    // ATX-style headers produced by Pandoc from Word Heading 1/2/3 styles: "# Title"
    const atxMatch = line.match(/^(#{1,3})\s+(.+)$/);

    // Numbered sections produced by Pandoc from manually-numbered Word paragraphs:
    //   "1\. Title"     — level 1 top-level (Pandoc backslash-escapes the period)
    //   "1.1 Title"     — level 2 subsection
    //   "1.1.1 Title"   — level 3 sub-subsection
    // Only fire after a blank line to avoid matching mid-paragraph numbers like "2.5 Go".
    const numberedMatch =
      !atxMatch &&
      prevLineBlank &&
      line.match(
        /^(\d+\\\.\s+[A-ZÀÉÈÊËÏÎÔÙÛÜŒÇÆ]|\d+(?:\.\d+){1,2}\s+[A-ZÀÉÈÊËÏÎÔÙÛÜŒÇÆ])/,
      );

    const isHeader = atxMatch || numberedMatch;

    if (isHeader) {
      if (currentBody.join('\n').trim() || currentTitle) {
        sections.push({ title: currentTitle, body: currentBody.join('\n'), level: currentLevel });
      }
      if (atxMatch) {
        currentLevel = atxMatch[1].length as 1 | 2 | 3;
        currentTitle = atxMatch[2].trim();
      } else {
        // Determine level by counting numeric segments after unescaping:
        //   "1\. Title" → unescaped "1. Title" → prefix "1"  → 1 segment → level 1
        //   "1.1 Title" → prefix "1.1"  → 2 segments → level 2
        //   "1.1.1 Title" → prefix "1.1.1" → 3 segments → level 3
        const unescaped = line.replace(/\\\./g, '.');
        const numericPrefix = unescaped.match(/^(\d+(?:\.\d+)*)/)?.[1] ?? '';
        const segmentCount = numericPrefix.split('.').filter(Boolean).length;
        currentLevel = Math.min(3, Math.max(1, segmentCount)) as 1 | 2 | 3;
        // Strip numeric prefix: "1\. Title" → "Title", "1.1 Title" → "Title"
        currentTitle = line
          .replace(/\\\./g, '.') // unescape backslash-period: "1\. " → "1. "
          .replace(/^\d+(?:\.\d+)*\.?\s+/, '') // strip "1. " / "1.1 " / "1.1.1 "
          .trim() || line.trim();
      }
      currentBody.length = 0;
      currentBody.push(line); // include the header line in the body text
    } else {
      currentBody.push(line);
    }

    prevLineBlank = isBlank;
  }
  if (currentBody.join('\n').trim() || currentTitle) {
    sections.push({ title: currentTitle, body: currentBody.join('\n'), level: currentLevel });
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
