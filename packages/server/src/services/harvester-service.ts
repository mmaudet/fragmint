// packages/server/src/services/harvester-service.ts
import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { fragments, harvestJobs, harvestCandidates, fragmentTypes, fragmentDomains, fragmentTags } from '../db/schema.js';
import type { LlmClient, CombinedBlock } from './llm-client.js';
import type { SearchService } from '../search/index.js';
import type { FragmentService } from './fragment-service.js';

const execFileAsync = promisify(execFile);


export interface HarvestJobWithCandidates {
  id: string;
  status: string;
  files: string[];
  pipeline: string;
  min_confidence: number;
  collection_slug: string | null;
  stats: Record<string, number> | null;
  error: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  candidates: HarvestCandidate[];
}

export interface HarvestCandidate {
  id: string;
  job_id: string;
  title: string;
  body: string;
  type: string;
  domain: string;
  lang: string;
  tags: string[];
  confidence: number;
  origin_source: string;
  origin_page: number | null;
  duplicate_of: string | null;
  duplicate_score: number | null;
  status: string;
  fragment_id: string | null;
}

export interface ValidationInput {
  accepted: string[];
  modified: Array<{
    id: string;
    title?: string;
    body?: string;
    domain?: string;
    type?: string;
    lang?: string;
    tags?: string[];
  }>;
  merged: Array<{ candidate: string; into: string }>;
  rejected: string[];
}

export class HarvesterService {
  constructor(
    private db: FragmintDb,
    private llmClient: LlmClient,
    private searchService: SearchService,
    private fragmentService: FragmentService,
    private storePath: string,
  ) {}

  async harvest(
    files: Buffer[],
    filenames: string[],
    options: { min_confidence: number },
    userId: string,
    collectionSlug: string | null = null,
  ): Promise<string> {
    const jobId = `hrv-${randomUUID()}`;
    const now = new Date().toISOString();

    await this.db.insert(harvestJobs).values({
      id: jobId,
      status: 'processing',
      files: JSON.stringify(filenames),
      pipeline: 'docx-pandoc-llm',
      min_confidence: options.min_confidence,
      collection_slug: collectionSlug,
      created_by: userId,
      created_at: now,
      updated_at: now,
    });

    // Launch pipeline async without awaiting
    setImmediate(() => {
      this._runPipeline(jobId, files, filenames, options.min_confidence).catch((err) => {
        console.error(`Pipeline error for job ${jobId}:`, err);
      });
    });

    return jobId;
  }

  async _runPipeline(
    jobId: string,
    files: Buffer[],
    filenames: string[],
    minConfidence: number,
  ): Promise<void> {
    try {
      const existingTypes = (await this.db.select({ slug: fragmentTypes.slug }).from(fragmentTypes)).map((r) => r.slug);
      const domainRows = await this.db.select({ slug: fragmentDomains.slug, description: fragmentDomains.description }).from(fragmentDomains);
      const existingDomains = domainRows.map((r) => r.slug);
      const domainHints: Record<string, string> = Object.fromEntries(
        domainRows.filter((r) => r.description).map((r) => [r.slug, r.description!]),
      );
      const knownTags = (await this.db.select({ slug: fragmentTags.slug }).from(fragmentTags)).map((r) => r.slug);

      let totalCandidates = 0;
      let duplicatesCount = 0;
      let lowConfidenceCount = 0;

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
            'markdown',
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
        const lang = HarvesterService.detectLanguage(markdown);

        // Parallel LLM calls — one segmentAndClassify per chunk
        const chunks = HarvesterService.chunkMarkdown(markdown);
        console.log(`[harvest:${jobId}] ${filename}: ${markdown.length} chars → ${chunks.length} chunk(s)`);

        const t0 = Date.now();
        const chunkResults = await Promise.all(
          chunks.map(async (chunk, ci) => {
            const tc = Date.now();
            const result = await this.llmClient.segmentAndClassify(chunk, existingTypes, existingDomains, knownTags, domainHints);
            console.log(`[harvest:${jobId}] chunk ${ci + 1}/${chunks.length}: ${result.length} block(s) in ${((Date.now() - tc) / 1000).toFixed(1)}s`);
            return result;
          }),
        );
        console.log(`[harvest:${jobId}] LLM total: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

        const blocks: CombinedBlock[] = HarvesterService.deduplicateBlocks(chunkResults.flat());
        console.log(`[harvest:${jobId}] ${blocks.length} block(s) after dedup`);

        // Parallel duplicate detection
        const t1 = Date.now();
        const dupeChecks = await Promise.all(
          blocks.map(async (block) => {
            try {
              const results = await this.searchService.search(block.body, undefined, 1);
              if (results.length > 0 && results[0].score > 0.8) {
                return { id: results[0].id, score: results[0].score };
              }
            } catch {
              // Milvus not available
            }
            return null;
          }),
        );

        console.log(`[harvest:${jobId}] dupe detection: ${((Date.now() - t1) / 1000).toFixed(1)}s`);

        // Count stats
        for (let j = 0; j < blocks.length; j++) {
          if (blocks[j].confidence < minConfidence) lowConfidenceCount++;
          if (dupeChecks[j]) duplicatesCount++;
        }

        // Batch insert all candidates
        if (blocks.length > 0) {
          await this.db.insert(harvestCandidates).values(
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
              origin_source: filename,
              origin_page: null,
              duplicate_of: dupeChecks[j]?.id ?? null,
              duplicate_score: dupeChecks[j]?.score ?? null,
              status: 'pending',
            })),
          );
        }

        totalCandidates += blocks.length;
      }

      const validCount = totalCandidates - duplicatesCount - lowConfidenceCount;
      const stats = {
        total: totalCandidates,
        duplicates: duplicatesCount,
        low_confidence: lowConfidenceCount,
        valid: Math.max(0, validCount),
      };

      await this.db
        .update(harvestJobs)
        .set({
          status: 'done',
          stats: JSON.stringify(stats),
          updated_at: new Date().toISOString(),
        })
        .where(eq(harvestJobs.id, jobId));
    } catch (err: any) {
      await this.db
        .update(harvestJobs)
        .set({
          status: 'error',
          error: err.message ?? String(err),
          updated_at: new Date().toISOString(),
        })
        .where(eq(harvestJobs.id, jobId));
    }
  }

  async getJob(jobId: string): Promise<HarvestJobWithCandidates | null> {
    const jobRows = await this.db
      .select()
      .from(harvestJobs)
      .where(eq(harvestJobs.id, jobId))
      .limit(1);

    if (jobRows.length === 0) return null;

    const job = jobRows[0];
    const candidateRows = await this.db
      .select()
      .from(harvestCandidates)
      .where(eq(harvestCandidates.job_id, jobId));

    return {
      id: job.id,
      status: job.status,
      files: JSON.parse(job.files) as string[],
      pipeline: job.pipeline,
      min_confidence: job.min_confidence,
      collection_slug: job.collection_slug ?? null,
      stats: job.stats ? (JSON.parse(job.stats) as Record<string, number>) : null,
      error: job.error,
      created_by: job.created_by,
      created_at: job.created_at,
      updated_at: job.updated_at,
      candidates: candidateRows.map((c) => ({
        id: c.id,
        job_id: c.job_id,
        title: c.title,
        body: c.body,
        type: c.type,
        domain: c.domain,
        lang: c.lang,
        tags: c.tags ? (JSON.parse(c.tags) as string[]) : [],
        confidence: c.confidence,
        origin_source: c.origin_source,
        origin_page: c.origin_page,
        duplicate_of: c.duplicate_of,
        duplicate_score: c.duplicate_score,
        status: c.status,
        fragment_id: c.fragment_id,
      })),
    };
  }

  async validate(
    jobId: string,
    validation: ValidationInput,
    userId: string,
  ): Promise<{ committed: number; merged: number; rejected: number }> {
    let committed = 0;
    let merged = 0;
    let rejected = 0;

    // Accepted candidates — create fragments
    for (const candidateId of validation.accepted) {
      const rows = await this.db
        .select()
        .from(harvestCandidates)
        .where(eq(harvestCandidates.id, candidateId))
        .limit(1);

      if (rows.length === 0) continue;
      const candidate = rows[0];

      const tags = candidate.tags ? (JSON.parse(candidate.tags) as string[]) : [];

      const result = await this.fragmentService.create(
        {
          type: candidate.type as any,
          domain: candidate.domain,
          tags,
          lang: candidate.lang,
          body: candidate.body,
          translation_of: null,
          parent_id: null,
          generation: 0,
          origin: 'harvested',
          valid_from: null,
          valid_until: null,
          access: { read: ['*'], write: ['contributor', 'admin'], approve: ['expert', 'admin'] },
        },
        userId,
        'expert',
      );

      await Promise.all([
        this.db.update(harvestCandidates).set({ status: 'accepted', fragment_id: result.id }).where(eq(harvestCandidates.id, candidateId)),
        this._upsertTags(tags),
      ]);

      committed++;
    }

    // Modified candidates — create fragments with modifications
    for (const mod of validation.modified) {
      const rows = await this.db
        .select()
        .from(harvestCandidates)
        .where(eq(harvestCandidates.id, mod.id))
        .limit(1);

      if (rows.length === 0) continue;
      const candidate = rows[0];

      const tags = mod.tags ?? (candidate.tags ? (JSON.parse(candidate.tags) as string[]) : []);

      const result = await this.fragmentService.create(
        {
          type: (mod.type ?? candidate.type) as any,
          domain: mod.domain ?? candidate.domain,
          tags,
          lang: mod.lang ?? candidate.lang,
          body: mod.body ?? candidate.body,
          translation_of: null,
          parent_id: null,
          generation: 0,
          origin: 'harvested',
          valid_from: null,
          valid_until: null,
          access: { read: ['*'], write: ['contributor', 'admin'], approve: ['expert', 'admin'] },
        },
        userId,
        'expert',
      );

      await Promise.all([
        this.db.update(harvestCandidates).set({ status: 'accepted', fragment_id: result.id }).where(eq(harvestCandidates.id, mod.id)),
        this._upsertTags(tags),
      ]);

      committed++;
    }

    // Merged candidates
    for (const merge of validation.merged) {
      await this.db
        .update(harvestCandidates)
        .set({ status: 'merged' })
        .where(eq(harvestCandidates.id, merge.candidate));

      merged++;
    }

    // Rejected candidates
    for (const candidateId of validation.rejected) {
      await this.db
        .update(harvestCandidates)
        .set({ status: 'rejected' })
        .where(eq(harvestCandidates.id, candidateId));

      rejected++;
    }

    return { committed, merged, rejected };
  }

  private async _upsertTags(tags: string[]): Promise<void> {
    if (tags.length === 0) return;
    const now = new Date().toISOString();
    await this.db
      .insert(fragmentTags)
      .values(tags.map((slug) => ({ slug, label: slug, created_at: now })))
      .onConflictDoNothing();
  }

  static extractBlockText(markdown: string, startMarker: string, endMarker: string): string {
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

  static readonly MAX_CHUNK_CHARS = 12000; // ~3000 tokens — larger chunks = fewer LLM calls
  static readonly OVERLAP_CHARS = 400;

  static chunkMarkdown(markdown: string): string[] {
    if (markdown.length <= HarvesterService.MAX_CHUNK_CHARS) return [markdown];

    const chunks: string[] = [];
    let start = 0;
    while (start < markdown.length) {
      let end = Math.min(start + HarvesterService.MAX_CHUNK_CHARS, markdown.length);
      // Try to break at a paragraph boundary
      if (end < markdown.length) {
        const lastParagraph = markdown.lastIndexOf('\n\n', end);
        if (lastParagraph > start + HarvesterService.MAX_CHUNK_CHARS * 0.5) {
          end = lastParagraph + 2;
        }
      }
      chunks.push(markdown.slice(start, end));
      start = end - HarvesterService.OVERLAP_CHARS;
      if (start < 0) start = 0;
      if (end >= markdown.length) break;
    }
    return chunks;
  }

  static deduplicateBlocks<T extends { body: string }>(blocks: T[]): T[] {
    const seen = new Set<string>();
    return blocks.filter((b) => {
      // Use first 50 chars of body as dedup key
      const key = (b.body || '').substring(0, 50).trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  static detectLanguage(text: string): 'fr' | 'en' {
    const frStops = [
      'le',
      'la',
      'les',
      'de',
      'du',
      'des',
      'un',
      'une',
      'est',
      'sont',
      'dans',
      'pour',
      'avec',
      'qui',
      'que',
      'nous',
      'cette',
      'sur',
    ];
    const enStops = [
      'the',
      'is',
      'are',
      'of',
      'in',
      'to',
      'for',
      'with',
      'and',
      'that',
      'this',
      'from',
      'have',
      'has',
      'been',
      'will',
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
}
