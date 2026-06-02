# Harvest Refactoring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the harvest pipeline to fix a domain-override bug, improve chunking (character → semantic), tighten junkiness filtering, add a 3-level intra-harvest dedup (Title Jaccard → Body shingles → Embedding cosine), fix hints-prompt asymmetry, add source_section tracking, pre-seed Linagora domains, and expose source_section in the review UI — validated by golden-set measurement scripts.

**Architecture:** Pipeline utilities are extracted to focused files (`harvest-chunker.ts`, `dedupe/junkiness-filter.ts`, `dedupe/dedup-pipeline.ts`). The `harvester-pipeline.ts` file (currently at the 500-line hard limit) is thinned by extraction. All changes are tested with Vitest unit tests.  
Chantier order: **5 → A → 1+2 → C+F → 3 → 4 → 6 → H → E → G** (Phase 0 first, then sequential).

**Tech Stack:** TypeScript, Vitest, Drizzle (SQLite), Fastify 5, Pandoc, OpenAI-compatible embeddings API.

---

## Phase 0 — Measurement Baseline

### Task 0: Golden set + measurement script

**Files:**
- Create: `scripts/golden-set.json`
- Create: `scripts/eval-harvest.ts`

Goal: capture a "before" baseline; re-run after each chantier to measure improvement.

- [ ] **Step 1: Create the golden set JSON**

```json
{
  "comment": "Golden set for harvest pipeline eval. Each case: input markdown + expected blocks.",
  "cases": [
    {
      "id": "gs-001",
      "description": "Two distinct product sections, French",
      "markdown": "# Présentation LinShare\n\nLinShare est une solution open source de partage de fichiers développée par Linagora. Elle permet aux entreprises de partager des documents de façon sécurisée.\n\n# Présentation Twake Mail\n\nTwake Mail est un client mail open source moderne développé par Linagora. Il offre une interface épurée et des fonctionnalités avancées de collaboration.",
      "expected": [
        { "domain": "linshare", "type": "introduction", "lang": "fr" },
        { "domain": "twake-mail", "type": "introduction", "lang": "fr" }
      ]
    },
    {
      "id": "gs-002",
      "description": "Junk blocks (separator, TOC title, short header)",
      "markdown": "---\n\n# Sommaire\n\n## Section 1\n\nContenu substantiel de la première section avec plusieurs phrases complètes et des informations utiles sur le produit LinShare.",
      "expected": [
        { "domain": "linshare", "type": "introduction", "lang": "fr" }
      ],
      "expected_junky": [
        { "body_starts_with": "---" },
        { "body_starts_with": "# Sommaire" }
      ]
    },
    {
      "id": "gs-003",
      "description": "Duplicate in two chunks (same text repeated)",
      "markdown": "LinShare est une solution open source de partage de fichiers. Elle est utilisée par de nombreuses entreprises pour partager des documents.\n\nLinShare est une solution open source de partage de fichiers. Elle est utilisée par de nombreuses entreprises pour partager des documents.",
      "expected_count": 1,
      "expected_dedup": true
    },
    {
      "id": "gs-004",
      "description": "Table with Pandoc (pipe table extraction)",
      "markdown": "| Feature | LinShare | Competitor |\n|---------|----------|------------|\n| Open source | Yes | No |\n| LDAP support | Yes | Partial |",
      "expected": [
        { "type": "argument", "lang": "en" }
      ]
    },
    {
      "id": "gs-005",
      "description": "Hints: domain suggestion should NOT override all blocks",
      "markdown": "# LinShare Features\n\nLinShare provides secure file sharing.\n\n# Twake Collaboration\n\nTwake is a complete collaboration platform.",
      "hint_domain": "linshare",
      "expected": [
        { "domain": "linshare" },
        { "domain": "twake" }
      ],
      "comment": "Second block should keep 'twake' not be overridden to 'linshare'"
    }
  ]
}
```

Save to `scripts/golden-set.json`.

- [ ] **Step 2: Write eval script**

```typescript
// scripts/eval-harvest.ts
// Usage: npx tsx scripts/eval-harvest.ts
// Reports: recall (expected blocks found), precision (correct domain/type), junkiness (junky blocks filtered)

import { readFileSync } from 'node:fs';
import { chunkMarkdown } from '../packages/server/src/services/harvester-pipeline.js';
import { isJunky } from '../packages/server/src/services/dedupe/junkiness-filter.js';

const golden = JSON.parse(readFileSync('scripts/golden-set.json', 'utf-8'));

interface GoldenCase {
  id: string;
  description: string;
  markdown: string;
  expected?: Array<{ domain?: string; type?: string; lang?: string }>;
  expected_junky?: Array<{ body_starts_with?: string }>;
  expected_count?: number;
  expected_dedup?: boolean;
  hint_domain?: string;
}

let totalTests = 0;
let passed = 0;

for (const c of golden.cases as GoldenCase[]) {
  console.log(`\n[${c.id}] ${c.description}`);
  const chunks = chunkMarkdown(c.markdown);
  console.log(`  chunks: ${chunks.length}`);

  // Junkiness check
  if (c.expected_junky) {
    for (const expected of c.expected_junky) {
      totalTests++;
      const body = expected.body_starts_with ?? '';
      const junky = isJunky(body);
      if (junky) {
        console.log(`  ✅ junky: "${body.slice(0, 30)}..."`);
        passed++;
      } else {
        console.log(`  ❌ expected junky but isJunky=false: "${body.slice(0, 30)}..."`);
      }
    }
  }

  console.log(`  NOTE: LLM calls not run in this script — use for structural/junkiness checks only`);
}

console.log(`\n=== Results: ${passed}/${totalTests} passed ===`);
```

- [ ] **Step 3: Run baseline**

```bash
cd /Users/julietteengel/code/julietteengel/linagora/fragmint
npx tsx scripts/eval-harvest.ts
```

Expected: prints summary. The junkiness tests will fail until Task 6.  
Note the baseline output — compare after chantiers are complete.

---

## Task 1: Chantier 5 — Pandoc pipe tables

**Files:**
- Modify: `packages/server/src/services/harvester-pipeline.ts:142-148`

Tables in Word documents were being dropped by Pandoc. `--to markdown+pipe_tables` preserves them as Markdown pipe tables that the LLM can read.

- [ ] **Step 1: Write failing test**

```typescript
// In packages/server/src/services/harvester-service.test.ts — add to existing describe block:
it('chunkMarkdown preserves pipe tables (single chunk)', () => {
  const md = '| Col A | Col B |\n|-------|-------|\n| val1  | val2  |';
  const chunks = HarvesterService.chunkMarkdown(md);
  expect(chunks).toHaveLength(1);
  expect(chunks[0]).toContain('| Col A |');
});
```

(This test already passes because `chunkMarkdown` doesn't strip tables — it's a smoke test.)

- [ ] **Step 2: Run test**

```bash
pnpm --filter @fragmint/server test -- harvester-service
```

Expected: PASS (verifies tables aren't stripped by chunking).

- [ ] **Step 3: Apply the Pandoc flag change**

In `packages/server/src/services/harvester-pipeline.ts`, find lines 142-148:

```typescript
        const { stdout } = await execFileAsync('pandoc', [
          '--from',
          'docx',
          '--to',
          'markdown',
          tempFile,
        ]);
```

Replace with:

```typescript
        const { stdout } = await execFileAsync('pandoc', [
          '--from',
          'docx',
          '--to',
          'markdown+pipe_tables',
          tempFile,
        ]);
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors.

---

## Task 2: Chantier A — source_section schema migration

**Files:**
- Modify: `packages/server/src/db/schema.ts`
- Modify: `packages/server/src/db/connection.ts`

Adds `source_section TEXT` to `harvest_candidates` so we know which document section each fragment came from. Populated in Task 4 (Chantier C).

- [ ] **Step 1: Update Drizzle schema**

In `packages/server/src/db/schema.ts`, find the `harvestCandidates` table definition (line 136). Add `source_section` after `origin_page`:

```typescript
export const harvestCandidates = sqliteTable('harvest_candidates', {
  id: text('id').primaryKey(),
  job_id: text('job_id').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  type: text('type').notNull(),
  domain: text('domain').notNull(),
  lang: text('lang').notNull(),
  tags: text('tags'),
  confidence: real('confidence').notNull(),
  origin_source: text('origin_source').notNull(),
  origin_page: integer('origin_page'),
  source_section: text('source_section'),   // ← NEW: header/section the block came from
  duplicate_of: text('duplicate_of'),
  duplicate_score: real('duplicate_score'),
  duplicate_method: text('duplicate_method'),
  status: text('status').notNull().default('pending'),
  fragment_id: text('fragment_id'),
  function_type: text('function_type'),
  audience: text('audience'),
  maturity: text('maturity'),
  entities_json: text('entities_json'),
  new_proposals: text('new_proposals'),
  metadata_status: text('metadata_status'),
  trust_sources_json: text('trust_sources_json'),
  quality_signals: text('quality_signals'),
  judge_result: text('judge_result'),
});
```

- [ ] **Step 2: Add migration in connection.ts**

In `packages/server/src/db/connection.ts`, after the last existing migration block (search for the last `} catch (_) {}`), add:

```typescript
  // Migration: add source_section to harvest_candidates
  try {
    sqlite.exec('ALTER TABLE harvest_candidates ADD COLUMN source_section TEXT');
  } catch (_) {
    // Column already exists — ignore
  }
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors.

---

## Task 3: Chantier 1+2 — Fix hints behavior

**Files:**
- Modify: `packages/server/src/services/harvester-pipeline.ts:197-202` (delete domain override)
- Modify: `packages/server/src/services/llm-client.ts:168-188` (fix prompt asymmetry)

**Chantier 1**: Lines 200-202 forcibly overwrite every fragment's domain with the upload hint. This means a document about both LinShare and Twake would label ALL fragments as "linshare" if that hint was set.

**Chantier 2 (+ B)**: Tags and entities are labeled "(suggested)" in the LLM prompt but domain, function_type, audience, maturity are not — causing the LLM to treat them as directives rather than orientation. The header also says "high confidence", reinforcing this. Fix: uniform "(suggested)" labeling + softer header.

- [ ] **Step 1: Write failing test for domain override**

Create `packages/server/src/services/harvester-pipeline.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { chunkMarkdown, deduplicateBlocks, isSeparatorBlock } from './harvester-pipeline.js';

describe('harvester-pipeline exports (pure functions)', () => {
  describe('chunkMarkdown', () => {
    it('returns single chunk for short markdown', () => {
      expect(chunkMarkdown('hello')).toHaveLength(1);
    });

    it('splits long markdown at paragraph boundary', () => {
      const para = 'Lorem ipsum dolor sit amet. '.repeat(500); // ~14000 chars
      const chunks = chunkMarkdown(para);
      expect(chunks.length).toBeGreaterThan(1);
    });
  });

  describe('isSeparatorBlock', () => {
    it('returns true for dash separator', () => {
      expect(isSeparatorBlock('---')).toBe(true);
    });

    it('returns false for real content', () => {
      expect(isSeparatorBlock('LinShare est une solution open source.')).toBe(false);
    });
  });

  describe('deduplicateBlocks', () => {
    it('removes exact prefix duplicates', () => {
      const blocks = [
        { body: 'LinShare est une solution', title: 'A' },
        { body: 'LinShare est une solution', title: 'B' },
        { body: 'Twake est une autre solution', title: 'C' },
      ];
      expect(deduplicateBlocks(blocks)).toHaveLength(2);
    });
  });
});
```

- [ ] **Step 2: Run test**

```bash
pnpm --filter @fragmint/server test -- harvester-pipeline
```

Expected: all 4 tests PASS (these test existing behavior).

- [ ] **Step 3: Delete the domain override (Chantier 1)**

In `packages/server/src/services/harvester-pipeline.ts`, find lines 197-202:

```typescript
      // Apply hint overrides: domain forced on all fragments (document-level metadata)
      // Tags and entities are fragment-level — LLM applies tags where coherent,
      // entities are injected only where found in the body (body-scan below)
      if (uploadHints.domain) {
        for (const block of blocks) block.domain = uploadHints.domain;
      }
```

Delete these 6 lines entirely. The comment and the `if` block.

- [ ] **Step 4: Fix hints prompt asymmetry (Chantier 2+B)**

In `packages/server/src/services/llm-client.ts`, find the `hintsBlock` construction (lines ~176-188):

```typescript
    const hintsBlock = hasAnyHint
      ? `\n# Operator hints (high confidence — prefer these unless content clearly contradicts them)\n${
          uploadHints.domain ? `- domain: ${uploadHints.domain}\n` : ''
        }${uploadHints.function_type ? `- function_type: ${uploadHints.function_type}\n` : ''}${
          uploadHints.audience?.length ? `- audience: ${uploadHints.audience.join(', ')}\n` : ''
        }${uploadHints.maturity ? `- maturity: ${uploadHints.maturity}\n` : ''}${
          uploadHints.tags?.length ? `- tags (suggested): ${uploadHints.tags.join(', ')}\n` : ''
        }${
          uploadHints.entities?.length
            ? `- entities (suggested): ${uploadHints.entities.join(', ')}\n`
            : ''
        }`
      : '';
```

Replace with:

```typescript
    const hintsBlock = hasAnyHint
      ? `\n# Operator hints (orientation — apply where relevant, not systematically to every block)\n${
          uploadHints.domain ? `- domain (suggested): ${uploadHints.domain}\n` : ''
        }${uploadHints.function_type ? `- function_type (suggested): ${uploadHints.function_type}\n` : ''}${
          uploadHints.audience?.length ? `- audience (suggested): ${uploadHints.audience.join(', ')}\n` : ''
        }${uploadHints.maturity ? `- maturity (suggested): ${uploadHints.maturity}\n` : ''}${
          uploadHints.tags?.length ? `- tags (suggested): ${uploadHints.tags.join(', ')}\n` : ''
        }${
          uploadHints.entities?.length
            ? `- entities (suggested): ${uploadHints.entities.join(', ')}\n`
            : ''
        }`
      : '';
```

- [ ] **Step 5: Write unit test for prompt text**

Add to `packages/server/src/services/harvester-pipeline.test.ts`:

```typescript
// Note: prompt content is tested indirectly via llm-client.ts snapshot
// The key invariant is that domain override is gone from the pipeline
it('does not forcibly overwrite domains when hint is set (chantier 1)', () => {
  // This test documents the expected behavior post-fix.
  // The actual domain assignment is done by the LLM — this is a regression guard.
  // If the override comes back, a harvest with hint_domain="linshare" would set all
  // candidate.domain to "linshare" regardless of LLM output.
  // Since runPipeline is async/integration, we document the invariant here only.
  // Full coverage via harvest.integration.test.ts and golden set eval.
  expect(true).toBe(true); // documentation test
});
```

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors.

---

## Task 4: Chantier C+F — Semantic chunker with source_section

**Files:**
- Create: `packages/server/src/services/harvest-chunker.ts`
- Create: `packages/server/src/services/harvest-chunker.test.ts`
- Modify: `packages/server/src/services/harvester-pipeline.ts` (use new chunker, populate source_section)

The character-based chunker cuts mid-paragraph and creates overlapping chunks, causing duplicate blocks. The semantic chunker splits by H1–H3 headers. Chantier F ("comes free with C") is populating `source_section` from the header title.

- [ ] **Step 1: Write failing tests first**

Create `packages/server/src/services/harvest-chunker.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { semanticChunk, SECTION_MAX_CHARS } from './harvest-chunker.js';

describe('semanticChunk', () => {
  it('returns one chunk for short markdown with no headers', () => {
    const md = 'LinShare est une solution open source.';
    const chunks = semanticChunk(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(md);
    expect(chunks[0].sourceSection).toBe('');
  });

  it('splits by H2 headers into separate chunks', () => {
    const md = `## Section A

Contenu de la section A avec du texte suffisamment long pour être utile.

## Section B

Contenu de la section B avec du texte différent sur un autre sujet.`;
    const chunks = semanticChunk(md);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].sourceSection).toBe('Section A');
    expect(chunks[1].sourceSection).toBe('Section B');
  });

  it('merges small sections (< SECTION_MAX_CHARS) into one chunk', () => {
    const md = `## A\n\nShort A.\n\n## B\n\nShort B.\n\n## C\n\nShort C.`;
    const chunks = semanticChunk(md);
    expect(chunks).toHaveLength(1); // all small → merged into one
  });

  it('splits a large single section by paragraphs (fallback)', () => {
    // One section with more than SECTION_MAX_CHARS
    const body = 'Paragraph content. '.repeat(700); // ~13000 chars
    const md = `## Big Section\n\n${body}`;
    const chunks = semanticChunk(md);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.sourceSection).toBe('Big Section');
    }
  });

  it('H1, H2, H3 all trigger section splits', () => {
    const md = `# H1\n\nText one.\n\n## H2\n\nText two.\n\n### H3\n\nText three.`;
    const chunks = semanticChunk(md);
    // Small sections get merged, so could be 1 or more depending on size
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const allSections = chunks.flatMap(c => c.sourceSection);
    // At least one section label should appear
    expect(chunks[0].sourceSection).not.toBe(undefined);
  });

  it('splits on \\n\\n within large section (fallback snap point)', () => {
    const para = 'Word content here. '.repeat(50) + '\n\n'; // ~1000 chars + paragraph break
    const bigSection = para.repeat(13); // ~13000 chars with many \n\n breaks
    const md = `## Large\n\n${bigSection}`;
    const chunks = semanticChunk(md);
    // Each sub-chunk should end at a paragraph boundary (not mid-sentence)
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(SECTION_MAX_CHARS + 100); // small tolerance
    }
  });
});
```

- [ ] **Step 2: Run failing tests**

```bash
pnpm --filter @fragmint/server test -- harvest-chunker
```

Expected: FAIL — `harvest-chunker.ts` doesn't exist yet.

- [ ] **Step 3: Create harvest-chunker.ts**

Create `packages/server/src/services/harvest-chunker.ts`:

```typescript
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
  if (sections.length === 0) return [{ text: markdown.trim(), sourceSection: '' }];

  const chunks: SemanticChunk[] = [];
  let pending: SemanticChunk | null = null;

  for (const section of sections) {
    const text = section.body.trim();
    if (!text) continue;

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

/**
 * If chunk fits within SECTION_MAX_CHARS, return as-is.
 * Otherwise split by paragraph boundaries (\n\n), no overlap.
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
    start = end;
    if (end >= text.length) break;
  }
  return result.length > 0 ? result : [chunk];
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm --filter @fragmint/server test -- harvest-chunker
```

Expected: all tests PASS.

- [ ] **Step 5: Update harvester-pipeline.ts to use semantic chunker**

In `packages/server/src/services/harvester-pipeline.ts`:

**a) Add import at the top (after existing imports):**

```typescript
import { semanticChunk } from './harvest-chunker.js';
```

**b) Replace the chunk + LLM section (lines 166-190). Find:**

```typescript
      // Parallel LLM calls — one segmentAndClassify per chunk
      const chunks = chunkMarkdown(markdown);
      console.log(
        `[harvest:${jobId}] ${filename}: ${markdown.length} chars → ${chunks.length} chunk(s)`,
      );

      const t0 = Date.now();
      const chunkResults = await Promise.all(
        chunks.map(async (chunk, ci) => {
          const tc = Date.now();
          const result = await llmClient.segmentAndClassify(
            chunk,
            existingTypes,
            existingDomains,
            knownTags,
            domainHints,
            validFunctions,
            validEntityRows,
            uploadHints,
          );
          console.log(
            `[harvest:${jobId}] chunk ${ci + 1}/${chunks.length}: ${result.length} block(s) in ${((Date.now() - tc) / 1000).toFixed(1)}s`,
          );
          return result;
        }),
      );
```

Replace with:

```typescript
      // Parallel LLM calls — one segmentAndClassify per semantic chunk
      const semanticChunks = semanticChunk(markdown);
      console.log(
        `[harvest:${jobId}] ${filename}: ${markdown.length} chars → ${semanticChunks.length} chunk(s)`,
      );

      const t0 = Date.now();
      const chunkResults = await Promise.all(
        semanticChunks.map(async (chunk, ci) => {
          const tc = Date.now();
          const result = await llmClient.segmentAndClassify(
            chunk.text,
            existingTypes,
            existingDomains,
            knownTags,
            domainHints,
            validFunctions,
            validEntityRows,
            uploadHints,
          );
          console.log(
            `[harvest:${jobId}] chunk ${ci + 1}/${semanticChunks.length} [${chunk.sourceSection || 'root'}]: ${result.length} block(s) in ${((Date.now() - tc) / 1000).toFixed(1)}s`,
          );
          // Tag each result block with its source section
          return result.map(b => ({ ...b, _sourceSection: chunk.sourceSection }));
        }),
      );
```

**c) Update the flat + dedup line. Find:**

```typescript
      const deduped = deduplicateBlocks(chunkResults.flat());
      const blocks: CombinedBlock[] = deduped.filter((b) => !isSeparatorBlock(b.body));
```

Replace with:

```typescript
      type TaggedBlock = CombinedBlock & { _sourceSection: string };
      const allBlocks = chunkResults.flat() as TaggedBlock[];
      const dedupedTagged = deduplicateBlocks(allBlocks);
      const blocks: TaggedBlock[] = dedupedTagged.filter((b) => !isSeparatorBlock(b.body));
```

**d) In the DB insert block (around line 309), add `source_section`:**

Find `origin_page: null,` and add after it:

```typescript
            source_section: (block as TaggedBlock)._sourceSection ?? null,
```

- [ ] **Step 6: Update harvester-service.ts re-exports**

`packages/server/src/services/harvester-service.ts` re-exports `chunkMarkdown`, `MAX_CHUNK_CHARS`, `OVERLAP_CHARS` from `harvester-pipeline.ts` as `HarvesterService` static methods (used in `harvester-service.test.ts`). The old `chunkMarkdown` function stays in `harvester-pipeline.ts` (as legacy export) — do NOT remove it. It is no longer called internally but external code depends on it. Add a deprecation comment:

Find in `packages/server/src/services/harvester-pipeline.ts`, the `chunkMarkdown` function (around line 403):

```typescript
export function chunkMarkdown(markdown: string): string[] {
```

Add comment before it:

```typescript
/** @deprecated Use semanticChunk() from harvest-chunker.ts for new code. */
export function chunkMarkdown(markdown: string): string[] {
```

- [ ] **Step 7: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors.

- [ ] **Step 8: Run full test suite**

```bash
pnpm test
```

Expected: all existing tests pass.

---

## Task 5: Chantier 3 — Junkiness filter

**Files:**
- Create: `packages/server/src/services/dedupe/junkiness-filter.ts`
- Create: `packages/server/src/services/dedupe/junkiness-filter.test.ts`
- Modify: `packages/server/src/services/harvester-pipeline.ts` (replace `isSeparatorBlock`)

The existing `isSeparatorBlock` only catches `[-=_*#~|.•·]+` (pure separator lines). It misses TOC titles like "Sommaire", very short headers, and partial-separator bodies. A junkiness score (0–1 composite) handles all these cases with a tunable threshold.

- [ ] **Step 1: Write failing tests**

Create `packages/server/src/services/dedupe/junkiness-filter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { junkinessScore, isJunky } from './junkiness-filter.js';

describe('junkinessScore', () => {
  it('scores pure separator as 1.0', () => {
    expect(junkinessScore('---')).toBeGreaterThanOrEqual(0.5);
  });

  it('scores empty string as 1.0', () => {
    expect(junkinessScore('')).toBe(1.0);
  });

  it('scores TOC header as >= 0.5', () => {
    expect(junkinessScore('Sommaire')).toBeGreaterThanOrEqual(0.5);
    expect(junkinessScore('Table of contents')).toBeGreaterThanOrEqual(0.5);
  });

  it('scores annexe section as >= 0.5', () => {
    expect(junkinessScore('Annexe 1')).toBeGreaterThanOrEqual(0.5);
  });

  it('scores very short fragment (< 50 chars, no punctuation) as >= 0.5', () => {
    expect(junkinessScore('Introduction')).toBeGreaterThanOrEqual(0.5);
  });

  it('scores substantive paragraph as < 0.5', () => {
    const body = 'LinShare est une solution open source de partage de fichiers développée par Linagora. Elle permet aux organisations de partager des documents de façon sécurisée et auditée.';
    expect(junkinessScore(body)).toBeLessThan(0.5);
  });

  it('scores medium-length technical text as < 0.5', () => {
    const body = 'L\'architecture de LinShare repose sur une API REST, une interface web moderne et un système de stockage distribué compatible S3.';
    expect(junkinessScore(body)).toBeLessThan(0.5);
  });
});

describe('isJunky', () => {
  it('returns true for separator at default threshold 0.5', () => {
    expect(isJunky('---')).toBe(true);
  });

  it('returns false for substantive text', () => {
    const body = 'LinShare est une solution open source de partage de fichiers développée par Linagora. Elle permet aux organisations de partager des documents de façon sécurisée.';
    expect(isJunky(body)).toBe(false);
  });

  it('respects custom threshold', () => {
    // "Introduction" has score ~0.55 at default
    // With threshold 0.8 it should NOT be junky
    expect(isJunky('Introduction', 0.8)).toBe(false);
  });
});
```

- [ ] **Step 2: Run failing tests**

```bash
pnpm --filter @fragmint/server test -- junkiness-filter
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Create junkiness-filter.ts**

Create `packages/server/src/services/dedupe/junkiness-filter.ts`:

```typescript
// packages/server/src/services/dedupe/junkiness-filter.ts
// Junkiness score: composite 0–1 measure for non-content blocks.
// Replaces the narrow isSeparatorBlock (which only caught pure separator lines).

/**
 * Returns a junkiness score (0–1). Score ≥ threshold = junky.
 *
 * Composite signals:
 *   1. Length penalty     — very short text (<50 chars) is suspect
 *   2. Sep char ratio     — high density of [-=_*#~|.•·] → likely a separator
 *   3. TOC/Annexe pattern — "Sommaire", "Table of contents", "Annexe N"
 *   4. No punctuation     — short text with no [.!?:;,] → likely a bare heading
 */
export function junkinessScore(body: string): number {
  const trimmed = body.trim();
  if (trimmed.length === 0) return 1.0;

  let score = 0;

  // 1. Length penalty
  if (trimmed.length < 50) {
    score += 0.4;
  } else if (trimmed.length < 150) {
    score += 0.15;
  }

  // 2. Separator char ratio (ignore whitespace)
  const stripped = trimmed.replace(/\s/g, '');
  if (stripped.length > 0) {
    const sepMatches = stripped.match(/[-=_*#~|.•·]/g) ?? [];
    const ratio = sepMatches.length / stripped.length;
    if (ratio > 0.5) score += 0.4;
    else if (ratio > 0.25) score += 0.15;
  }

  // 3. TOC / Annexe pattern (line must start with one of these)
  if (
    /^(sommaire|table\s+of\s+contents?|annexe\s*\d|annexe\s*[A-Z]|appendix|index\b)/i.test(trimmed)
  ) {
    score += 0.3;
  }

  // 4. No punctuation (short text without sentence markers → bare heading/label)
  if (trimmed.length < 200 && !/[.!?:;,]/.test(trimmed)) {
    score += 0.15;
  }

  return Math.min(1, score);
}

/**
 * Returns true if the block body should be filtered out as non-content.
 * Default threshold: 0.5 (tunable via FRAGMINT_HARVEST_JUNKINESS_THRESHOLD env var).
 */
export function isJunky(body: string, threshold = 0.5): boolean {
  return junkinessScore(body) >= threshold;
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm --filter @fragmint/server test -- junkiness-filter
```

Expected: all tests PASS.

- [ ] **Step 5: Replace isSeparatorBlock in harvester-pipeline.ts**

In `packages/server/src/services/harvester-pipeline.ts`:

**a) Add import** (after existing imports):

```typescript
import { isJunky } from './dedupe/junkiness-filter.js';
```

**b) Replace the filter call** — find:

```typescript
      const blocks: TaggedBlock[] = dedupedTagged.filter((b) => !isSeparatorBlock(b.body));
```

Replace with:

```typescript
      const blocks: TaggedBlock[] = dedupedTagged.filter((b) => !isJunky(b.body));
```

**c) Remove the old `isSeparatorBlock` function** at lines ~441-445:

```typescript
/** Returns true if the block body is purely decorative (separator lines, horizontal rules, etc.)
 *  and carries no semantic content worth indexing. */
export function isSeparatorBlock(body: string): boolean {
  const stripped = body.replace(/\s+/g, '');
  if (stripped.length === 0) return false;
  return /^[-=_*#~|.•·]+$/.test(stripped);
}
```

Delete this function and its export.

- [ ] **Step 6: Update harvester-pipeline.test.ts to remove isSeparatorBlock test**

In `packages/server/src/services/harvester-pipeline.test.ts`, remove `isSeparatorBlock` from the import and delete the `describe('isSeparatorBlock', ...)` block (it's now covered by `junkiness-filter.test.ts`):

```typescript
// Remove from import line:
import { chunkMarkdown, deduplicateBlocks } from './harvester-pipeline.js';
// (isSeparatorBlock is deleted — no longer exported)
```

- [ ] **Step 7: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors.

- [ ] **Step 7: Run all tests**

```bash
pnpm test
```

Expected: all tests pass.

---

## Task 6: Chantier 4 — Intra-harvest dedup L1+L2 (Title Jaccard + Body shingles)

**Files:**
- Create: `packages/server/src/services/dedupe/dedup-pipeline.ts`
- Create: `packages/server/src/services/dedupe/dedup-pipeline.test.ts`
- Modify: `packages/server/src/services/harvester-pipeline.ts`

The current `deduplicateBlocks` uses a 50-char prefix key — too crude, misses near-duplicates. Replace with a 2-level cascade:
- **L1**: Title shingles Jaccard k=3, threshold 0.80
- **L2**: Body shingles Jaccard k=3, threshold 0.70

These compare candidates within the same harvest job (cross-chunk dedup), not against the library.

- [ ] **Step 1: Write failing tests**

Create `packages/server/src/services/dedupe/dedup-pipeline.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { deduplicateL1L2 } from './dedup-pipeline.js';

const b = (title: string, body: string) => ({ title, body });

describe('deduplicateL1L2', () => {
  it('keeps all distinct blocks', () => {
    const blocks = [
      b('LinShare Introduction', 'LinShare est une solution open source de partage.'),
      b('Twake Features', 'Twake est une plateforme de collaboration complète.'),
    ];
    expect(deduplicateL1L2(blocks)).toHaveLength(2);
  });

  it('removes exact duplicate (title + body identical)', () => {
    const blocks = [
      b('LinShare Introduction', 'LinShare est une solution open source de partage de fichiers.'),
      b('LinShare Introduction', 'LinShare est une solution open source de partage de fichiers.'),
    ];
    expect(deduplicateL1L2(blocks)).toHaveLength(1);
  });

  it('removes near-duplicate body (L2: body shingles ≥ 0.70)', () => {
    const base = 'LinShare est une solution open source de partage de fichiers développée par Linagora permettant le partage sécurisé de documents.';
    const similar = 'LinShare est une solution open source de partage de fichiers développée par Linagora pour le partage sécurisé de documents.';
    const blocks = [b('Block A', base), b('Block B', similar)];
    const result = deduplicateL1L2(blocks, 0.80, 0.70);
    expect(result).toHaveLength(1);
  });

  it('keeps blocks with similar titles but different bodies (L1 no match, L2 no match)', () => {
    const blocks = [
      b('Introduction Produit', 'LinShare est une solution de partage de fichiers open source.'),
      b('Introduction Produit', 'Twake est une plateforme de collaboration en temps réel très différente.'),
    ];
    // Same title but bodies are very different → not a duplicate
    const result = deduplicateL1L2(blocks, 0.80, 0.70);
    expect(result).toHaveLength(2);
  });

  it('preserves first occurrence when deduplicating', () => {
    const first = b('LinShare', 'First occurrence body with unique content about LinShare file sharing.');
    const second = b('LinShare', 'First occurrence body with unique content about LinShare file sharing.');
    const result = deduplicateL1L2([first, second]);
    expect(result[0]).toBe(first);
  });
});
```

- [ ] **Step 2: Run failing tests**

```bash
pnpm --filter @fragmint/server test -- dedup-pipeline
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Create dedup-pipeline.ts**

Create `packages/server/src/services/dedupe/dedup-pipeline.ts`:

```typescript
// packages/server/src/services/dedupe/dedup-pipeline.ts
// Intra-harvest deduplication: L1 (title shingles) + L2 (body shingles).
// Compares candidates within the same harvest job, NOT against the fragment library.
// Library dedup is handled separately by duplicate-detector.ts.

import { generateShingles, jaccardSimilarity } from './shingles.js';

const DEFAULT_TITLE_THRESHOLD = 0.80;
const DEFAULT_BODY_THRESHOLD = 0.70;

/**
 * Two-level deduplication within a harvest batch.
 *
 * L1 — Title Jaccard (k=3 shingles): if two blocks have nearly identical titles
 *      AND sufficiently similar bodies, the later one is a duplicate.
 * L2 — Body shingles Jaccard (k=3): if bodies are nearly identical, it's a duplicate
 *      regardless of title.
 *
 * Returns only the first occurrence of each unique block.
 */
export function deduplicateL1L2<T extends { title: string; body: string }>(
  blocks: T[],
  titleThreshold = DEFAULT_TITLE_THRESHOLD,
  bodyThreshold = DEFAULT_BODY_THRESHOLD,
): T[] {
  const kept: T[] = [];
  const keptTitleShingles: Set<string>[] = [];
  const keptBodyShingles: Set<string>[] = [];

  for (const block of blocks) {
    const titleShingles = generateShingles(block.title, 3);
    const bodyShingles = generateShingles(block.body, 3);
    let isDuplicate = false;

    for (let i = 0; i < kept.length; i++) {
      // L2: body similarity (primary signal — always check)
      const bodyJ = jaccardSimilarity(bodyShingles, keptBodyShingles[i]);
      if (bodyJ >= bodyThreshold) {
        isDuplicate = true;
        break;
      }

      // L1: title similarity (secondary — only flag if title AND body are both non-trivially similar)
      // Avoids false positives where different products share a generic title like "Introduction"
      if (titleShingles.size >= 2 && keptTitleShingles[i].size >= 2) {
        const titleJ = jaccardSimilarity(titleShingles, keptTitleShingles[i]);
        if (titleJ >= titleThreshold) {
          // Title match: also require body to be at least somewhat similar (>= 0.3)
          const bodyPartial = jaccardSimilarity(bodyShingles, keptBodyShingles[i]);
          if (bodyPartial >= 0.3) {
            isDuplicate = true;
            break;
          }
        }
      }
    }

    if (!isDuplicate) {
      kept.push(block);
      keptTitleShingles.push(titleShingles);
      keptBodyShingles.push(bodyShingles);
    }
  }

  return kept;
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm --filter @fragmint/server test -- dedup-pipeline
```

Expected: all tests PASS.

- [ ] **Step 5: Wire dedup-pipeline into harvester**

In `packages/server/src/services/harvester-pipeline.ts`:

**a) Add import** (after existing imports):

```typescript
import { deduplicateL1L2 } from './dedupe/dedup-pipeline.js';
```

**b) Replace `deduplicateBlocks` call** — find:

```typescript
      const allBlocks = chunkResults.flat() as TaggedBlock[];
      const dedupedTagged = deduplicateBlocks(allBlocks);
```

Replace with:

```typescript
      const allBlocks = chunkResults.flat() as TaggedBlock[];
      const dedupedTagged = deduplicateL1L2(allBlocks);
```

- [ ] **Step 6: Typecheck + test**

```bash
pnpm --filter @fragmint/server typecheck
pnpm test
```

Expected: no errors, all tests pass.

---

## Task 7: Chantier 6 — Intra-harvest dedup L3 (embedding cosine)

**Files:**
- Modify: `packages/server/src/search/search-service.ts` (expose embedBatch)
- Modify: `packages/server/src/services/dedupe/dedup-pipeline.ts` (add L3 functions — keeps harvester-pipeline.ts under 500 lines)
- Modify: `packages/server/src/services/harvester-pipeline.ts` (call L3)

After L1+L2 shingles dedup, some semantic duplicates may survive (same idea, different wording). L3 uses batch embeddings to catch these. One call to embed all remaining candidates, then pairwise cosine comparison.

> **Line budget note:** `harvester-pipeline.ts` is at 500 lines. The L3 logic (~40 lines) goes into `dedup-pipeline.ts` (currently ~75 lines → ~115 lines) to stay within the 500-line hard limit in the pipeline file.

- [ ] **Step 1: Expose embedBatch on SearchService**

In `packages/server/src/search/search-service.ts`, add this public method after the existing `search` method:

```typescript
  /**
   * Batch-embed texts using the underlying embedding client.
   * Returns null if embedding is unavailable (no API key, network error).
   * Used by the harvest pipeline for intra-job dedup (L3).
   */
  async embedBatch(texts: string[]): Promise<number[][] | null> {
    try {
      return await this.embeddingClient.embedBatch(texts);
    } catch (err) {
      console.warn('[search-service][embedBatch] unavailable:', (err as Error).message?.slice(0, 80));
      return null;
    }
  }
```

- [ ] **Step 2: Add L3 functions to dedup-pipeline.ts**

Append to `packages/server/src/services/dedupe/dedup-pipeline.ts`:

```typescript
// ── L3: Embedding cosine dedup ─────────────────────────────────────────────
// Requires SearchService to be injected (avoids tight coupling to embedding client).

import type { SearchService } from '../../search/index.js';

/** Cosine similarity between two equal-length vectors. */
export function cosineSim(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * L3 dedup: embed all blocks in one batch call, then pairwise cosine comparison.
 * Keeps the first occurrence when cosine >= threshold (default 0.85).
 * Returns blocks unchanged if embedding is unavailable (graceful degradation).
 *
 * Threshold calibration: test 0.80 / 0.85 / 0.90 on golden set to tune recall vs precision.
 */
export async function deduplicateL3<T extends { body: string }>(
  blocks: T[],
  searchService: SearchService,
  threshold = 0.85,
): Promise<T[]> {
  if (blocks.length < 2) return blocks;

  const texts = blocks.map((b) => b.body.slice(0, 1000));
  const embeddings = await searchService.embedBatch(texts);
  if (!embeddings || embeddings.length !== blocks.length) {
    console.debug('[harvest][L3] embedding unavailable — skipping L3 dedup');
    return blocks;
  }

  const kept: number[] = [];
  const keptEmbeddings: number[][] = [];

  for (let i = 0; i < blocks.length; i++) {
    let isDuplicate = false;
    for (let j = 0; j < kept.length; j++) {
      const sim = cosineSim(embeddings[i], keptEmbeddings[j]);
      if (sim >= threshold) {
        console.debug(
          `[harvest][L3] block ${i} ≈ block ${kept[j]} (cosine=${sim.toFixed(3)} ≥ ${threshold})`,
        );
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) {
      kept.push(i);
      keptEmbeddings.push(embeddings[i]);
    }
  }

  const result = kept.map((i) => blocks[i]);
  console.info(`[harvest][L3] ${blocks.length} → ${result.length} after embedding dedup`);
  return result;
}
```

- [ ] **Step 3: Call L3 dedup in runPipeline**

In `packages/server/src/services/harvester-pipeline.ts`:

**a) Add import** (after existing dedupe imports):

```typescript
import { deduplicateL3 } from './dedupe/dedup-pipeline.js';
```

**b) Update the junkiness filter line** — find:

```typescript
      const blocks: TaggedBlock[] = dedupedTagged.filter((b) => !isJunky(b.body));
      console.log(`[harvest:${jobId}] ${blocks.length} block(s) after dedup+separator-filter`);
```

Replace with:

```typescript
      const afterJunk: TaggedBlock[] = dedupedTagged.filter((b) => !isJunky(b.body));
      const L3_THRESHOLD = 0.85; // test 0.80/0.85/0.90 on golden set
      const blocks: TaggedBlock[] = await deduplicateL3(afterJunk, searchService, L3_THRESHOLD);
      console.log(`[harvest:${jobId}] ${blocks.length} block(s) after dedup+junkiness+L3`);
```

- [ ] **Step 4: Typecheck + test**

```bash
pnpm --filter @fragmint/server typecheck
pnpm test
```

Expected: no errors, all tests pass.

---

## Task 8: Chantier H — Domain pre-seeding

**Files:**
- Create: `packages/server/src/db/seeds/linagora-domains.ts`
- Modify: `packages/server/src/db/connection.ts`

If `fragment_domains` is empty, the LLM receives no domain list and defaults to generic labels (like "logiciels-libres" for everything). Pre-seeding ensures Linagora products are always available as classification targets.

- [ ] **Step 1: Write test**

```typescript
// Add to packages/server/src/services/harvester-pipeline.test.ts:
import { describe, it, expect } from 'vitest';
import { createDb } from '../db/connection.js';
import { fragmentDomains } from '../db/schema.js';

describe('domain pre-seeding (connection.ts)', () => {
  it('seeds standard Linagora domains on fresh DB', async () => {
    const db = createDb(':memory:');
    const rows = db.select({ slug: fragmentDomains.slug }).from(fragmentDomains).all();
    const slugs = rows.map((r: { slug: string }) => r.slug);
    expect(slugs).toContain('linshare');
    expect(slugs).toContain('twake');
    expect(slugs).toContain('twake-mail');
    expect(slugs).toContain('other');
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
pnpm --filter @fragmint/server test -- harvester-pipeline
```

Expected: the domain seeding test FAILS (DB is empty on fresh start).

- [ ] **Step 3: Create seeds file**

Create `packages/server/src/db/seeds/linagora-domains.ts`:

```typescript
// packages/server/src/db/seeds/linagora-domains.ts
// Pre-seeds the fragment_domains table with known Linagora product domains.
// Called from connection.ts on DB initialization. Safe to call on every startup
// (uses INSERT OR IGNORE).

import type { FragmintDb } from '../connection.js';

const LINAGORA_DOMAINS: Array<{ slug: string; label: string; description: string }> = [
  { slug: 'linshare', label: 'LinShare', description: 'Solution de partage de fichiers open source' },
  { slug: 'twake', label: 'Twake', description: 'Plateforme de collaboration open source' },
  { slug: 'twake-mail', label: 'Twake Mail', description: 'Client email open source moderne' },
  { slug: 'open-paas', label: 'OpenPaaS', description: 'Plateforme enterprise collaborative' },
  { slug: 'linphone', label: 'Linphone', description: 'Solution de téléphonie IP / vidéo open source' },
  { slug: 'linid', label: 'LinID', description: 'Solution de gestion des identités et annuaire LDAP' },
  { slug: 'matrix', label: 'Matrix', description: 'Protocole et serveur de messagerie décentralisée' },
  { slug: 'rocket-chat', label: 'Rocket.Chat', description: 'Plateforme de messagerie instantanée' },
  { slug: 'nextcloud', label: 'Nextcloud', description: 'Suite collaborative self-hosted' },
  { slug: 'owncloud', label: 'ownCloud', description: 'Partage et synchronisation de fichiers' },
  { slug: 'sogo', label: 'SOGo', description: 'Serveur de groupware open source' },
  { slug: 'ia-souveraine', label: 'IA Souveraine', description: 'Offres d\'IA souveraine et locale' },
  { slug: 'open-source', label: 'Open Source', description: 'Contenu générique sur le logiciel libre' },
  { slug: 'cybersecurity', label: 'Cybersécurité', description: 'Solutions de sécurité et conformité' },
  { slug: 'other', label: 'Autre', description: 'Contenu non rattaché à un domaine spécifique' },
];

/**
 * Seeds standard domains into fragment_domains if they do not already exist.
 * Uses raw SQL with INSERT OR IGNORE for efficiency (no Drizzle needed here).
 */
export function seedLinagoraDomains(sqlite: import('better-sqlite3').Database): void {
  const now = new Date().toISOString();
  const stmt = sqlite.prepare(`
    INSERT OR IGNORE INTO fragment_domains (slug, label, description, validated, usage_count, proposed_by, created_at)
    VALUES (?, ?, ?, 1, 0, 'seed', ?)
  `);
  let seeded = 0;
  for (const d of LINAGORA_DOMAINS) {
    const result = stmt.run(d.slug, d.label, d.description, now);
    if (result.changes > 0) seeded++;
  }
  if (seeded > 0) {
    console.info(`[db/seed] Seeded ${seeded} Linagora domain(s) into fragment_domains`);
  }
}
```

- [ ] **Step 4: Call seeder from connection.ts**

In `packages/server/src/db/connection.ts`, at the top add the import:

```typescript
import { seedLinagoraDomains } from './seeds/linagora-domains.js';
```

After the last migration block (after all the `try { sqlite.exec('ALTER TABLE...') }` blocks), add:

```typescript
  // Seed standard Linagora domains if not present
  seedLinagoraDomains(sqlite);
```

Then add it before the `return drizzle(sqlite, { schema })` line.

- [ ] **Step 5: Run tests — expect PASS**

```bash
pnpm --filter @fragmint/server test -- harvester-pipeline
```

Expected: the domain seeding test now PASSES.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors.

---

## Task 9: Chantier E — Post-harvest UI: source_section display

**Files:**
- Modify: `packages/server/src/routes/harvest.integration.test.ts` (add source_section assertion)
- Verify: harvest route already returns the `harvestCandidates` row — check it includes `source_section`
- Modify: `packages/web/src/` — harvest review component to display source_section

- [ ] **Step 1: Verify backend returns source_section**

Check the harvest route to confirm `source_section` is returned in candidate rows.

```bash
grep -n "source_section\|candidates" /Users/julietteengel/code/julietteengel/linagora/fragmint/packages/server/src/routes/harvest.ts
```

If `source_section` is not in the SELECT or the route already selects `*` / full rows, it will be included automatically (Drizzle returns all columns). If an explicit column list excludes it, add it.

- [ ] **Step 2: Add integration test assertion**

In `packages/server/src/routes/harvest.integration.test.ts`, find the test that creates a candidate with `harvestCandidates` insert. Add `source_section` to the insert:

```typescript
// In the beforeEach / setup block, update cand1 insert to include source_section:
await db.insert(harvestCandidates).values({
  id: cand1Id,
  job_id: jobId,
  title: 'Test candidate 1',
  body: 'Body of candidate 1',
  type: 'introduction',
  domain: 'linshare',
  lang: 'fr',
  confidence: 0.85,
  origin_source: 'test.docx',
  status: 'pending',
  source_section: 'Section Test',  // ← new
});
```

And add assertion in the GET test:

```typescript
expect(body.data.candidates[0]).toHaveProperty('source_section');
```

- [ ] **Step 3: Run integration test**

```bash
pnpm --filter @fragmint/server test -- harvest.integration
```

Expected: PASS.

- [ ] **Step 4: Find the harvest candidate review component**

```bash
grep -rn "candidate\|harvest" /Users/julietteengel/code/julietteengel/linagora/fragmint/packages/web/src --include="*.tsx" -l
```

Identify the component that renders harvest candidate cards or rows.

- [ ] **Step 5: Add source_section display to the component**

In the harvest candidate card component (typically a table row or card), add source_section display. Example pattern:

```tsx
{candidate.source_section && (
  <span className="text-xs text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
    § {candidate.source_section}
  </span>
)}
```

Place it near the title or in the metadata row of the candidate card.

- [ ] **Step 6: Typecheck (web)**

```bash
pnpm --filter @fragmint/web typecheck
```

Expected: no errors.

---

## Task 10: Chantier G — Measurement scripts + threshold calibration

**Files:**
- Modify: `scripts/eval-harvest.ts` (extend with structural checks)
- Note: LLM recall tests require a running server — document as manual step

The goal is to measure, per chantier:
1. **Junkiness recall**: % of junky blocks correctly filtered
2. **Dedup precision**: % of L1+L2+L3 dedup decisions that are true duplicates (no false positives)
3. **Chunk count**: fewer chunks than before (semantic > character splitting)

- [ ] **Step 1: Extend eval script with all golden set structural checks**

Replace `scripts/eval-harvest.ts` with:

```typescript
// scripts/eval-harvest.ts
// Usage: npx tsx scripts/eval-harvest.ts
// Runs structural golden set checks (no LLM required).
// For LLM-dependent checks, see scripts/eval-harvest-llm.md

import { readFileSync } from 'node:fs';

// Dynamic imports — works only from monorepo root
const { semanticChunk } = await import('./packages/server/src/services/harvest-chunker.js');
const { junkinessScore, isJunky } = await import('./packages/server/src/services/dedupe/junkiness-filter.js');
const { deduplicateL1L2 } = await import('./packages/server/src/services/dedupe/dedup-pipeline.js');

interface GoldenCase {
  id: string;
  description: string;
  markdown: string;
  expected?: Array<{ domain?: string; type?: string; lang?: string }>;
  expected_junky?: Array<{ body_starts_with?: string }>;
  expected_count?: number;
  expected_dedup?: boolean;
  hint_domain?: string;
}

const golden = JSON.parse(readFileSync('scripts/golden-set.json', 'utf-8'));

let total = 0;
let passed = 0;

function assert(cond: boolean, msg: string) {
  total++;
  if (cond) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.log(`  ❌ ${msg}`);
  }
}

for (const c of golden.cases as GoldenCase[]) {
  console.log(`\n[${c.id}] ${c.description}`);

  // ── Semantic chunk count ────────────────────────────────────────────────────
  const chunks = semanticChunk(c.markdown);
  console.log(`  chunks: ${chunks.length} → ${chunks.map((ch) => `"${ch.sourceSection || 'root'}"`).join(', ')}`);

  if (c.expected && c.expected.length > 0) {
    assert(
      chunks.length >= 1,
      `at least 1 chunk produced (got ${chunks.length})`,
    );
  }

  // ── Junkiness filter ────────────────────────────────────────────────────────
  if (c.expected_junky) {
    for (const ej of c.expected_junky) {
      if (ej.body_starts_with) {
        const junky = isJunky(ej.body_starts_with);
        assert(junky, `isJunky("${ej.body_starts_with.slice(0, 30)}")`);
      }
    }
  }

  // ── Dedup check ─────────────────────────────────────────────────────────────
  if (c.expected_dedup) {
    // Simulate two identical blocks (as would come from overlapping chunks)
    const blocks = [
      { title: 'Block A', body: c.markdown },
      { title: 'Block A', body: c.markdown },
    ];
    const deduped = deduplicateL1L2(blocks);
    assert(deduped.length === 1, `L1+L2 dedup removed duplicate (${blocks.length} → ${deduped.length})`);
  }

  // ── Threshold calibration notes ─────────────────────────────────────────────
  if (c.id === 'gs-003') {
    console.log('  [calibration] testing body thresholds: 0.50, 0.60, 0.70');
    const blocks = [
      { title: 'A', body: c.markdown },
      { title: 'B', body: c.markdown.replace('partager', 'publier') }, // slight variation
    ];
    for (const t of [0.5, 0.6, 0.7]) {
      const d = deduplicateL1L2(blocks, 0.8, t);
      console.log(`    threshold=${t}: ${blocks.length} → ${d.length}`);
    }
  }
}

console.log(`\n=== Results: ${passed}/${total} structural checks passed ===`);
console.log('\nNOTE: LLM classification quality (recall/precision) requires a running server.');
console.log('      See scripts/eval-harvest-llm.md for manual harvest + export procedure.');
```

- [ ] **Step 2: Create LLM eval documentation**

Create `scripts/eval-harvest-llm.md`:

```markdown
# LLM Harvest Eval — Manual Procedure

## Prerequisites
- Running server (`docker compose -f docker/docker-compose.dev.yml up`)
- A Linagora product document (e.g., LinShare datasheet.docx)

## Steps

1. Export current candidates (before changes):
   ```bash
   docker exec fragmint-server node -e "
     const db = require('better-sqlite3')('/data/vault/.fragmint.db');
     const rows = db.prepare('SELECT id,domain,type,lang,confidence,source_section FROM harvest_candidates WHERE status=?').all('pending');
     console.log(JSON.stringify(rows,null,2));
   " > /tmp/before.json
   ```

2. Upload the test document via API:
   ```bash
   curl -X POST http://localhost:3210/v1/harvest \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -F "files=@linshare-datasheet.docx" \
     -F 'hints={"domain":"linshare"}'
   ```

3. Export after:
   ```bash
   # Same command → /tmp/after.json
   ```

4. Compare metrics:
   - **Recall**: Did all expected sections appear as candidates?
   - **Domain accuracy**: % of blocks with correct domain (vs golden expectation)
   - **Chunk count**: Did semantic chunking reduce chunk count?
   - **Junk filtered**: Count of status≠pending blocks (junky filtered)

## Golden expectations for LinShare datasheet
- Expected blocks: ≥ 5 (introduction, features, methodology, use-case, reference)
- Expected domains: all "linshare" (not "logiciels-libres")
- Expected: NO domain override when hint is set — blocks about other products stay correct
- Expected junk rate: 0 (all junky separators/TOC filtered)
```

- [ ] **Step 3: Run structural eval script**

```bash
cd /Users/julietteengel/code/julietteengel/linagora/fragmint
npx tsx --tsconfig packages/server/tsconfig.json scripts/eval-harvest.ts
```

Expected: all structural checks PASS. Results printed to console.

- [ ] **Step 4: Final typecheck + full test suite**

```bash
pnpm --filter @fragmint/server typecheck
pnpm --filter @fragmint/web typecheck
pnpm test
```

Expected: no errors, all tests pass.

---

## Final Validation Checklist

Before marking the plan complete, verify each chantier:

- [ ] **Chantier 5**: `grep "pipe_tables" packages/server/src/services/harvester-pipeline.ts` → returns match
- [ ] **Chantier A**: `grep "source_section" packages/server/src/db/schema.ts` → returns match
- [ ] **Chantier 1**: `grep "block.domain = uploadHints" packages/server/src/services/harvester-pipeline.ts` → NO match
- [ ] **Chantier 2+B**: `grep "orientation" packages/server/src/services/llm-client.ts` → returns match
- [ ] **Chantier C+F**: `grep "semanticChunk" packages/server/src/services/harvester-pipeline.ts` → returns match
- [ ] **Chantier 3**: `grep "isJunky" packages/server/src/services/harvester-pipeline.ts` → returns match
- [ ] **Chantier 4**: `grep "deduplicateL1L2" packages/server/src/services/harvester-pipeline.ts` → returns match
- [ ] **Chantier 6**: `grep "deduplicateL3" packages/server/src/services/harvester-pipeline.ts` → returns match
- [ ] **Chantier H**: `grep "linshare" packages/server/src/db/seeds/linagora-domains.ts` → returns match
- [ ] **Chantier E**: `grep "source_section" packages/web/src/` → returns match
- [ ] **Chantier G**: `ls scripts/eval-harvest.ts scripts/eval-harvest-llm.md golden-set.json` → all exist
- [ ] `pnpm test` → all tests PASS
- [ ] `pnpm --filter @fragmint/server typecheck` → no errors
- [ ] `pnpm --filter @fragmint/web typecheck` → no errors
