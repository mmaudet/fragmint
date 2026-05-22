// packages/server/src/services/harvester-pipeline.ts
// Internal LLM pipeline for the harvester — extracted from harvester-service.ts
import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { eq, inArray } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import {
  harvestJobs,
  harvestCandidates,
  fragmentTypes,
  fragmentDomains,
  fragmentTags,
  fragmentFunctions,
  fragments,
  entities,
} from '../db/schema.js';
import { detectExactDuplicate, computeQualitySignals } from './quality-signals.js';
import { shouldRunJudge, runQualityJudge } from './quality-judge.js';
import type { JudgeResult } from './quality-judge.js';
import type { LlmClient, CombinedBlock } from './llm-client.js';
import type { SearchService } from '../search/index.js';
import { type UploadHints, computeTrustSources, overallTrustSource } from '../schema/trust-source.js';

const execFileAsync = promisify(execFile);

function getMetadataStatus(block: CombinedBlock): string {
  const pc = (block.new_proposals?.tags?.length ?? 0) + Object.values(block.new_proposals?.entities ?? {}).flat().length;
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
): Promise<void> {
  try {
    const existingTypes = (
      await db.select({ slug: fragmentTypes.slug }).from(fragmentTypes)
    ).map((r) => r.slug);
    const domainRows = await db
      .select({ slug: fragmentDomains.slug, description: fragmentDomains.description })
      .from(fragmentDomains);
    const existingDomains = domainRows.map((r) => r.slug);
    const domainHints: Record<string, string> = Object.fromEntries(
      domainRows.filter((r) => r.description).map((r) => [r.slug, r.description!]),
    );
    const knownTagRows = await db
      .select({ slug: fragmentTags.slug })
      .from(fragmentTags)
      .where(eq(fragmentTags.validated, 1));
    const knownTags = knownTagRows.map((r) => r.slug);

    // Load validated referentials for LLM prompt
    const validFunctionRows = await db
      .select({ slug: fragmentFunctions.slug })
      .from(fragmentFunctions)
      .where(eq(fragmentFunctions.validated, 1));
    const validFunctions = validFunctionRows.map((r) => r.slug);

    const validEntityRows = await db
      .select({ type: entities.type, canonicalName: entities.canonicalName })
      .from(entities)
      .where(eq(entities.validated, 1));

    // Load reviewed/approved fragments for exact duplicate detection (Milvus-independent)
    // body_excerpt stores first 200 chars — sufficient for normalizeForComparison (truncates to 200)
    const existingFragmentRows = (
      await db
        .select({ id: fragments.id, type: fragments.type, body_excerpt: fragments.body_excerpt })
        .from(fragments)
        .where(inArray(fragments.quality, ['reviewed', 'approved']))
    )
      .filter((r) => r.body_excerpt != null)
      .map((r) => ({ id: r.id, type: r.type, body: r.body_excerpt! }));

    let totalCandidates = 0;
    let duplicatesCount = 0;

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
        const { stdout } = await execFileAsync('pandoc', ['--from', 'docx', '--to', 'markdown', tempFile]);
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
      console.log(`[harvest:${jobId}] LLM total: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

      const blocks: CombinedBlock[] = deduplicateBlocks(chunkResults.flat());
      console.log(`[harvest:${jobId}] ${blocks.length} block(s) after dedup`);

      // Parallel duplicate detection — exact match always, Milvus near-match if available
      const t1 = Date.now();
      const dupeChecks = await Promise.all(
        blocks.map(async (block) => {
          // 1. Exact match — always runs, Milvus-independent
          const exactDup = detectExactDuplicate(block, existingFragmentRows);
          if (exactDup) return exactDup;

          // 2. Near match via Milvus cosine — only if Milvus available
          try {
            const results = await searchService.search(block.body, undefined, 1);
            if (results.length > 0 && results[0].score > 0.8) {
              return { id: results[0].id, score: results[0].score };
            }
          } catch {
            // Milvus not available — silently skip near-duplicate check
          }
          return null;
        }),
      );
      console.log(`[harvest:${jobId}] dupe detection: ${((Date.now() - t1) / 1000).toFixed(1)}s`);

      // Count stats
      blocks.forEach((_b, j) => {
        if (dupeChecks[j]) duplicatesCount++;
      });

      // Compute quality signals for all blocks
      const qualitySignalsPerBlock = blocks.map((block, j) => {
        const entities = (block.entities ?? {}) as Record<string, string[]>;
        return computeQualitySignals(
          { type: block.type, body: block.body, domain: block.domain, function_type: block.function_type, entities },
          dupeChecks[j],
        );
      });

      // Run LLM-as-judge on ambiguous fragments (warnings but not exact duplicates)
      const judgeResults: (JudgeResult | null)[] = await Promise.all(
        blocks.map(async (block, j) => {
          const signals = qualitySignalsPerBlock[j];
          if (!shouldRunJudge(signals, !!dupeChecks[j])) return null;
          return runQualityJudge(llmClient, {
            title: block.title || 'Untitled',
            body: block.body,
            domain: block.domain,
            function_type: block.function_type,
            type: block.type,
            audience: block.audience,
            entities: (block.entities ?? {}) as Record<string, string[]>,
          }, signals);
        }),
      );

      // Compute trust sources per block
      const trustSourcesPerBlock = blocks.map((block) =>
        computeTrustSources(
          uploadHints,
          {
            domain: block.domain,
            function_type: block.function_type ?? '',
            audience: block.audience ?? [],
            maturity: block.maturity ?? '',
            tags: block.tags ?? [],
          },
          {
            domain: existingDomains,
            function_type: validFunctions,
            tags: knownTags,
          },
        )
      );

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
            function_type: block.function_type ?? null,
            audience: JSON.stringify(block.audience ?? []),
            maturity: block.maturity ?? null,
            entities_json: JSON.stringify(block.entities ?? {}),
            new_proposals: JSON.stringify(block.new_proposals ?? {}),
            metadata_status: getMetadataStatus(block),
            trust_sources_json: JSON.stringify(trustSourcesPerBlock[j]),
            quality_signals: JSON.stringify(qualitySignalsPerBlock[j]),
            judge_result: judgeResults[j] ? JSON.stringify(judgeResults[j]) : null,
            origin_source: filename,
            origin_page: null,
            duplicate_of: dupeChecks[j]?.id ?? null,
            duplicate_score: dupeChecks[j]?.score ?? null,
            status: 'pending',
          })),
        );

        // Insert LLM NEW: proposals — tags, domains, and entities all go to admin queue
        // Auto-validate proposals when trust_source is human-direct or llm-confirmed
        const now = new Date().toISOString();
        for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
          const block = blocks[blockIndex];
          const blockTrustSources = trustSourcesPerBlock[blockIndex];
          const proposals = block.new_proposals ?? {};

          const tagTrust = blockTrustSources?.tags ?? 'llm-inferred';
          const tagAutoValidated = (tagTrust === 'human-direct' || tagTrust === 'llm-confirmed') ? 1 : 0;

          for (const rawTag of proposals.tags ?? []) {
            const slug = rawTag.replace(/^NEW:/i, '').toLowerCase().replace(/\s+/g, '-');
            await db
              .insert(fragmentTags)
              .values({
                slug,
                label: slug,
                category: 'proposed',
                validated: tagAutoValidated,
                proposedBy: 'llm-auto',
                trustSource: tagTrust,
                created_at: now,
              })
              .onConflictDoUpdate({
                target: fragmentTags.slug,
                set: { validated: tagAutoValidated, trustSource: tagTrust },
              });
          }

          const domainTrust = blockTrustSources?.domain ?? 'llm-inferred';
          const domainAutoValidated = (domainTrust === 'human-direct' || domainTrust === 'llm-confirmed') ? 1 : 0;

          for (const rawDomain of proposals.domains ?? []) {
            const slug = rawDomain.replace(/^NEW:/i, '').toLowerCase().replace(/\s+/g, '-');
            await db
              .insert(fragmentDomains)
              .values({
                slug,
                label: slug,
                description: 'LLM-proposed',
                validated: domainAutoValidated,
                proposedBy: 'llm-auto',
                trustSource: domainTrust,
                created_at: now,
              })
              .onConflictDoUpdate({
                target: fragmentDomains.slug,
                set: { validated: domainAutoValidated, trustSource: domainTrust },
              });
          }

          const entityOverallTrust = overallTrustSource(blockTrustSources ?? {});
          const entityAutoValidated = (entityOverallTrust === 'human-direct' || entityOverallTrust === 'llm-confirmed') ? 1 : 0;

          const VALID_ENTITY_TYPES = ['client', 'product', 'technology', 'partner', 'certification', 'regulation', 'metric'];
          for (const [entType, entNames] of Object.entries(proposals.entities ?? {})) {
            for (const rawName of (entNames as string[]) ?? []) {
              const canonical = rawName.replace(/^NEW:/i, '');
              const normalized = canonical.toLowerCase().replace(/[\s\-.]+/g, '-');
              const validEntityType = VALID_ENTITY_TYPES.includes(entType) ? entType : 'product';
              await db
                .insert(entities)
                .values({
                  type: validEntityType,
                  name: canonical,
                  canonicalName: canonical,
                  normalizedName: normalized,
                  aliases: '[]',
                  validated: entityAutoValidated,
                  proposedBy: 'llm-auto',
                  trustSource: entityOverallTrust,
                  createdAt: now,
                })
                .onConflictDoNothing();
            }
          }
        }
      }

      totalCandidates += blocks.length;
    }

    const stats = {
      total: totalCandidates,
      duplicates: duplicatesCount,
      valid: totalCandidates - duplicatesCount,
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
  const frStops = [
    'le', 'la', 'les', 'de', 'du', 'des', 'un', 'une', 'est', 'sont',
    'dans', 'pour', 'avec', 'qui', 'que', 'nous', 'cette', 'sur',
  ];
  const enStops = [
    'the', 'is', 'are', 'of', 'in', 'to', 'for', 'with', 'and', 'that',
    'this', 'from', 'have', 'has', 'been', 'will',
  ];

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
