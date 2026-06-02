// packages/server/src/services/harvester-pipeline.ts
// Internal LLM pipeline for the harvester — extracted from harvester-service.ts
import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { eq, inArray, sql, desc } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import {
  harvestJobs,
  harvestCandidates,
  fragmentTypes,
  fragmentDomains,
  fragmentTags,
  fragments,
} from '../db/schema.js';
import { generateShingles } from './dedupe/shingles.js';
import { deduplicateL1L2, deduplicateL3 } from './dedupe/dedup-pipeline.js';
import { detectDuplicate } from './dedupe/duplicate-detector.js';
import { shouldRunJudge, runQualityJudge } from './quality-judge.js';
import type { JudgeResult } from './quality-judge.js';
import type { LlmClient, CombinedBlock } from './llm-client.js';
import type { SearchService } from '../search/index.js';
import { type UploadHints, computeTrustSources } from '../schema/trust-source.js';
import {
  applyUploadHintsInPlace,
  insertNewProposals,
  flushHintReferentials,
} from './harvest-hint-processor.js';
import { semanticChunk } from './harvest-chunker.js';
import { isJunky } from './dedupe/junkiness-filter.js';
import { extractTablesFromMarkdown, flushTableCandidates } from './harvest-table-extractor.js';
import type { DetectedTableSpec } from './harvest-table-extractor.js';
import type { FragmentCollectionService } from './fragment-collection-service.js';

const execFileAsync = promisify(execFile);

function getMetadataStatus(block: CombinedBlock): string {
  const pc = block.new_proposals?.tags?.length ?? 0;
  if (block.confidence >= 0.85 && pc === 0) return 'auto-validated';
  if (block.confidence >= 0.6 && pc <= 2) return 'needs-review';
  return 'requires-review';
}

export async function runPipeline(
  db: FragmintDb,
  llmClient: LlmClient,
  searchService: SearchService,
  jobId: string,
  files: Buffer[],
  filenames: string[],
  _minConfidence: number,
  uploadHints: UploadHints = {},
  dupeShinglesThreshold = 0.70,
  collectionService?: FragmentCollectionService,
  userId?: string,
): Promise<void> {
  try {
    const existingTypes = (await db.select({ slug: fragmentTypes.slug }).from(fragmentTypes)).map(
      (r) => r.slug,
    );
    const domainRows = await db
      .select({ slug: fragmentDomains.slug, description: fragmentDomains.description })
      .from(fragmentDomains);
    const existingDomains = domainRows.map((r) => r.slug);
    const domainHints: Record<string, string> = Object.fromEntries(
      domainRows.filter((r) => r.description).map((r) => [r.slug, r.description!]),
    );
    const knownTagRows = await db
      .select({ slug: fragmentTags.slug, usageCount: sql<number>`(SELECT COUNT(*) FROM fragment_tag_links WHERE tag_slug = fragment_tags.slug)` })
      .from(fragmentTags)
      .where(eq(fragmentTags.status, 'active'))
      .orderBy(desc(sql<number>`(SELECT COUNT(*) FROM fragment_tag_links WHERE tag_slug = fragment_tags.slug)`));
    const knownTagsAll = knownTagRows.map((r) => r.slug);

    const hintTagsFound = new Set<string>();

    // Load reviewed/approved fragments for exact duplicate detection (Milvus-independent)
    // body_excerpt stores first 200 chars — sufficient for normalizeForComparison (truncates to 200)
    const existingFragmentRows = (
      await db
        .select({
          id: fragments.id,
          type: fragments.type,
          domain: fragments.domain,
          lang: fragments.lang,
          body_excerpt: fragments.body_excerpt,
        })
        .from(fragments)
        .where(inArray(fragments.quality, ['reviewed', 'approved']))
    )
      .filter((r) => r.body_excerpt != null)
      .map((r) => ({
        id: r.id,
        type: r.type,
        domain: r.domain,
        lang: r.lang,
        body: r.body_excerpt!,
      }));

    // Threshold for shingles Jaccard similarity — wired from config via caller.
    const SHINGLES_THRESHOLD = dupeShinglesThreshold;
    // Pre-calculate shingles for ALL existing fragments once, before the file loop.
    // Avoids recomputing shingle sets for every candidate across multiple files.
    const existingShinglesMap = new Map<string, Set<string>>(
      existingFragmentRows.map((r) => [r.id, generateShingles(r.body, 3)]),
    );

    let totalCandidates = 0;
    let duplicatesCount = 0;
    let lowConfidenceCount = 0;
    let l3Skipped = false;
    const pendingTableSpecs: DetectedTableSpec[] = [];
    let lastLang = 'fr';

    for (let i = 0; i < files.length; i++) {
      const buffer = files[i];
      const filename = filenames[i];

      // Write buffer to temp file
      const tempDir = join(tmpdir(), 'fragmint-harvest');
      mkdirSync(tempDir, { recursive: true });
      const tempFile = join(tempDir, `${randomUUID()}.docx`);
      writeFileSync(tempFile, buffer);

      let markdown: string;
      try {
        const { stdout } = await execFileAsync('pandoc', [
          '--from',
          'docx',
          '--to',
          'gfm',
          tempFile,
        ]);
        markdown = stdout;
      } finally {
        try {
          unlinkSync(tempFile);
        } catch {
          /* ignore cleanup errors */
        }
      }

      // Pre-process: normalize whitespace, detect language
      markdown = markdown
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n');
      const lang = detectLanguage(markdown);
      lastLang = lang || lastLang;

      // Strip table of contents sections (Pandoc outputs ToC as link lists under a Contents-Heading)
      // These create many useless "title-only" fragments when passed to the LLM
      markdown = markdown.replace(
        /#{1,6}\s+[^\n]*?\.Contents-Heading\}[^\n]*\n((?:\[.*?\]\(#[^\)]+\)\n?)+)/g,
        ''
      );

      // Phase 1: detect tables, strip from markdown — do NOT insert yet (order matters)
      const { specs, cleanedMarkdown } = extractTablesFromMarkdown(markdown);
      if (specs.length > 0) {
        markdown = cleanedMarkdown;
      }

      // Only pass tags whose keyword appears in the document — others won't be assigned anyway
      const markdownLower = markdown.toLowerCase();
      const knownTags = knownTagsAll.filter((tag) => {
        const keyword = tag.includes(':') ? tag.split(':')[1] : tag;
        return keyword.length >= 3 && markdownLower.includes(keyword.toLowerCase());
      });

      // Parallel LLM calls — one segmentAndClassify per semantic chunk
      // Skip table-of-contents chunks (Word ToC → Pandoc heading with .Contents-Heading class)
      const semanticChunks = semanticChunk(markdown).filter(
        (chunk) => !/(Contents-Heading|table.*mati.res)/i.test(chunk.sourceSection ?? ''),
      );

      // Assign doc_position to table specs.
      // The chunker merges L2/L3 subsections into their L1 parent, so sourceSection is the
      // L1 title, not the L2 heading preceding the table. We match in two passes:
      //   1. exact sourceSection match (L1 tables like "# Facturation")
      //   2. heading appears as an ATX line inside the chunk text (L2/L3 tables)
      if (specs.length > 0) {
        const norm = (h: string) =>
          h.replace(/\{[^}]+\}/g, '').replace(/^\d+(?:\.\d+)*\.?\s+/, '').trim().toLowerCase();
        const chunkContainsHeading = (chunk: { text: string }, h: string): boolean =>
          chunk.text.split('\n').some((line) => {
            const m = line.match(/^#{1,6}\s+(.+)$/);
            return m != null && norm(m[1]) === norm(h);
          });
        for (const spec of specs) {
          const heading = spec.table.precedingHeading ?? null;
          if (!heading) { spec.docPosition = 999999; continue; }
          let matchIdx = semanticChunks.findIndex((c) => norm(c.sourceSection) === norm(heading));
          if (matchIdx < 0) matchIdx = semanticChunks.findIndex((c) => chunkContainsHeading(c, heading));
          spec.docPosition = matchIdx >= 0 ? (matchIdx + 1) * 10000 + 9999 : 999999;
        }
        pendingTableSpecs.push(...specs);
      }
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
            uploadHints,
          );
          console.log(
            `[harvest:${jobId}] chunk ${ci + 1}/${semanticChunks.length} [${chunk.sourceSection || 'root'}]: ${result.length} block(s) in ${((Date.now() - tc) / 1000).toFixed(1)}s`,
          );
          // Tag each result block with its source section and chunk index for doc ordering
          return result.map((b, bi) => ({ ...b, _sourceSection: chunk.sourceSection, _chunkIndex: ci, _blockIndexInChunk: bi }));
        }),
      );
      console.log(`[harvest:${jobId}] LLM total: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

      type TaggedBlock = CombinedBlock & { _sourceSection: string; _chunkIndex: number; _blockIndexInChunk: number };
      const allBlocks = chunkResults.flat() as TaggedBlock[];
      const dedupedTagged = deduplicateL1L2(allBlocks);
      const l1l2Blocks: TaggedBlock[] = dedupedTagged.filter((b) => !isJunky(b.body ?? ''));
      console.log(`[harvest:${jobId}] ${l1l2Blocks.length} block(s) after dedup+separator-filter`);

      // L3: embedding cosine dedup (skipped when embedding service unavailable)
      let blocks = l1l2Blocks;
      try {
        const texts = l1l2Blocks.map((b) => `${b.title}\n\n${b.body.slice(0, 300)}`);
        const embeddings = await searchService.embedBatch(texts);
        blocks = deduplicateL3(l1l2Blocks, embeddings) as TaggedBlock[];
        console.info(`[harvest:${jobId}] L3 dedup: ${l1l2Blocks.length} → ${blocks.length}`);
      } catch (err) {
        l3Skipped = true;
        console.warn(`[harvest:${jobId}] L3 embedding dedup skipped:`, (err as Error).message);
      }

      // Parallel duplicate detection — exact match always, Milvus near-match if available
      const t1 = Date.now();
      console.log(`[dup-detect] ── starting detection for ${blocks.length} candidate(s) ──`);
      const dupeChecks = await Promise.all(
        blocks.map(async (block) => {
          const title = (block.title || 'untitled').slice(0, 50);
          console.log(`[dup-detect] candidate "${title}" — checking duplicates`);
          console.log(
            `[dup-detect]   filters: domain=${block.domain}, type=${block.type}, lang=${block.lang}`,
          );
          console.log(`[dup-detect]   exact-match pool size: ${existingFragmentRows.length}`);
          return detectDuplicate(
            block,
            existingFragmentRows,
            existingShinglesMap,
            SHINGLES_THRESHOLD,
            searchService,
          );
        }),
      );
      // ── summary ──────────────────────────────────────────────────────────
      const dupesSummary = dupeChecks
        .map((d, i) => (d ? `#${i}→DUPE(${Math.round(d.score * 100)}%)` : `#${i}→OK`))
        .join(' | ');
      console.log(
        `[dup-detect] ── done in ${((Date.now() - t1) / 1000).toFixed(1)}s — ${dupesSummary} ──`,
      );

      // Count stats
      blocks.forEach((b, j) => {
        if (dupeChecks[j]) duplicatesCount++;
        else if (b.confidence < 0.7) lowConfidenceCount++;
      });

      // Track coherent hint tags + apply hint-domain override for unknown domains
      const domainOverridden = applyUploadHintsInPlace(blocks, uploadHints, hintTagsFound, existingDomains);

      // Body-scan: force-add known tags whose keyword appears in the block text — LLM sometimes misses obvious ones
      for (const block of blocks) {
        const blockText = `${block.title ?? ''} ${block.body ?? ''}`.toLowerCase();
        for (const tag of knownTags) {
          const normalizedTag = tag.toLowerCase();
          const keyword = normalizedTag.includes(':') ? normalizedTag.split(':')[1] : normalizedTag;
          if (keyword.length >= 3 && blockText.includes(keyword)) {
            if (!block.tags) block.tags = [];
            if (!block.tags.some((t) => t.toLowerCase() === normalizedTag)) {
              block.tags.push(normalizedTag);
            }
          }
        }
      }

      // Run LLM-as-judge on all non-duplicate fragments — provides quality verdict + metadata suggestions
      const judgeTaxonomy = { domains: existingDomains, types: existingTypes, tags: knownTags };
      const judgeResults: (JudgeResult | null)[] = await Promise.all(
        blocks.map(async (block, j) => {
          if (!shouldRunJudge(!!dupeChecks[j])) return null;
          return runQualityJudge(
            llmClient,
            {
              title: block.title || 'Untitled',
              body: block.body,
              domain: block.domain,
              type: block.type,
            },
            judgeTaxonomy,
          );
        }),
      );

      // Compute trust sources per block
      const trustSourcesPerBlock = blocks.map((block) =>
        computeTrustSources(
          uploadHints,
          {
            domain: block.domain,
            tags: block.tags ?? [],
          },
          {
            domain: existingDomains,
            tags: knownTags,
          },
        ),
      );

      // Patch trust source for hint-domain overrides — human provided this, not the LLM
      for (const idx of domainOverridden) {
        const ts = trustSourcesPerBlock[idx];
        if (ts) ts.domain = 'human-direct';
      }

      // Promote new_proposals.tags into block.tags BEFORE saving to DB so that
      // llm-inferred tags surface on the candidate (and later the fragment) immediately.
      for (const block of blocks) {
        for (const rawTag of block.new_proposals?.tags ?? []) {
          const slug = rawTag.replace(/^NEW:/i, '').toLowerCase().replace(/\s+/g, '-');
          if (!block.tags) block.tags = [];
          if (!block.tags.includes(slug)) block.tags.push(slug);
        }
      }

      // Batch insert all candidates
      if (blocks.length > 0) {
        await db.insert(harvestCandidates).values(
          blocks.map((block, j) => ({
            id: `hcn-${randomUUID()}`,
            job_id: jobId,
            title: block.title || 'Untitled',
            body: block.body,
            type: block.type,
            domain: block.domain,
            lang: block.lang || lang,
            tags: JSON.stringify(block.tags),
            confidence: block.confidence,
            new_proposals: JSON.stringify(block.new_proposals ?? {}),
            metadata_status: getMetadataStatus(block),
            trust_sources_json: JSON.stringify(trustSourcesPerBlock[j]),
            quality_signals: '[]',
            judge_result: judgeResults[j] ? JSON.stringify(judgeResults[j]) : null,
            origin_source: filename,
            origin_page: null,
            source_section: (block as TaggedBlock)._sourceSection ?? null,
            duplicate_of: dupeChecks[j]?.id ?? null,
            duplicate_score: dupeChecks[j]?.score ?? null,
            duplicate_method: dupeChecks[j]?.method ?? null,
            doc_position: ((block as TaggedBlock)._chunkIndex + 1) * 10000 + (block as TaggedBlock)._blockIndexInChunk,
            status: 'pending',
          })),
        );

        // Insert LLM NEW: proposals — tags and domains go to admin queue
        await insertNewProposals(db, blocks, trustSourcesPerBlock);
      }

      totalCandidates += blocks.length;
    }

    // Phase 2: insert table candidates AFTER all LLM blocks — preserves document order
    if (pendingTableSpecs.length > 0) {
      const tableCount = await flushTableCandidates(
        db, pendingTableSpecs, jobId, filenames[0] ?? '', lastLang, uploadHints, existingDomains, collectionService,
      );
      totalCandidates += tableCount;
    }

    // Post-pipeline: surface coherent hints to admin referential queues
    await flushHintReferentials(
      db,
      uploadHints,
      hintTagsFound,
      existingDomains,
      userId,
    );

    const stats = {
      total: totalCandidates,
      duplicates: duplicatesCount,
      low_confidence: lowConfidenceCount,
      valid: totalCandidates - duplicatesCount - lowConfidenceCount,
      ...(l3Skipped ? { l3_dedup_skipped: true } : {}),
    };

    await db
      .update(harvestJobs)
      .set({
        status: 'done',
        stats: JSON.stringify(stats),
        updated_at: new Date().toISOString(),
      })
      .where(eq(harvestJobs.id, jobId));
  } catch (err: any) {
    await db
      .update(harvestJobs)
      .set({
        status: 'error',
        error: err.message ?? String(err),
        updated_at: new Date().toISOString(),
      })
      .where(eq(harvestJobs.id, jobId));
  }
}

export function extractBlockText(markdown: string, startMarker: string, endMarker: string): string {
  if (!startMarker || !endMarker) return '';

  // Match first ~8 words of startMarker, case-insensitive
  const startWords = startMarker.trim().split(/\s+/).slice(0, 8).join('\\s+');
  const startRegex = new RegExp(startWords, 'i');
  const startMatch = startRegex.exec(markdown);
  if (!startMatch) return '';

  const startPos = startMatch.index;

  // Match first ~8 words of endMarker after start position
  const endWords = endMarker.trim().split(/\s+/).slice(0, 8).join('\\s+');
  const endRegex = new RegExp(endWords, 'i');
  const afterStart = markdown.slice(startPos + startMatch[0].length);
  const endMatch = endRegex.exec(afterStart);
  if (!endMatch) return '';

  const endPos = startPos + startMatch[0].length + endMatch.index + endMatch[0].length;
  return markdown.slice(startPos, endPos).trim();
}

export const MAX_CHUNK_CHARS = 12000; // ~3000 tokens — larger chunks = fewer LLM calls
export const OVERLAP_CHARS = 400;

/** @deprecated Use semanticChunk() from harvest-chunker.ts for new code. */
export function chunkMarkdown(markdown: string): string[] {
  if (markdown.length <= MAX_CHUNK_CHARS) return [markdown];

  const chunks: string[] = [];
  let start = 0;
  while (start < markdown.length) {
    let end = Math.min(start + MAX_CHUNK_CHARS, markdown.length);
    // Try to break at a paragraph boundary
    if (end < markdown.length) {
      const lastParagraph = markdown.lastIndexOf('\n\n', end);
      if (lastParagraph > start + MAX_CHUNK_CHARS * 0.5) {
        end = lastParagraph + 2;
      }
    }
    chunks.push(markdown.slice(start, end));
    start = end - OVERLAP_CHARS;
    if (start < 0) start = 0;
    if (end >= markdown.length) break;
  }
  return chunks;
}

/**
 * @deprecated Use deduplicateL1L2 from './dedupe/dedup-pipeline.js' for new code.
 *   This body-prefix approach is kept for backward compatibility with HarvesterService static API.
 */
export function deduplicateBlocks<T extends { body: string }>(blocks: T[]): T[] {
  const seen = new Set<string>();
  return blocks.filter((b) => {
    // Use first 50 chars of body as dedup key
    const key = (b.body || '').substring(0, 50).trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function detectLanguage(text: string): 'fr' | 'en' {
  // prettier-ignore
  const frStops = ['le','la','les','de','du','des','un','une','est','sont','dans','pour','avec','qui','que','nous','cette','sur'];
  // prettier-ignore
  const enStops = ['the','is','are','of','in','to','for','with','and','that','this','from','have','has','been','will'];

  const words = text.toLowerCase().split(/\s+/);
  const frSet = new Set(frStops);
  const enSet = new Set(enStops);

  let frCount = 0;
  let enCount = 0;

  for (const word of words) {
    if (frSet.has(word)) frCount++;
    if (enSet.has(word)) enCount++;
  }

  return frCount >= enCount ? 'fr' : 'en';
}
