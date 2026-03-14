// packages/server/src/services/harvester-service.ts
import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { fragments, harvestJobs, harvestCandidates } from '../db/schema.js';
import type { LlmClient } from './llm-client.js';
import type { SearchService } from '../search/index.js';
import type { FragmentService } from './fragment-service.js';

const execFileAsync = promisify(execFile);

export interface HarvestJobWithCandidates {
  id: string;
  status: string;
  files: string[];
  pipeline: string;
  min_confidence: number;
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
  ): Promise<string> {
    const jobId = `hrv-${randomUUID()}`;
    const now = new Date().toISOString();

    await this.db.insert(harvestJobs).values({
      id: jobId,
      status: 'processing',
      files: JSON.stringify(filenames),
      pipeline: 'docx-pandoc-llm',
      min_confidence: options.min_confidence,
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
      // Get existing types and domains for classification context
      const existingTypesRows = await this.db
        .selectDistinct({ type: fragments.type })
        .from(fragments);
      const existingDomainsRows = await this.db
        .selectDistinct({ domain: fragments.domain })
        .from(fragments);
      const existingTypes = existingTypesRows.map((r) => r.type);
      const existingDomains = existingDomainsRows.map((r) => r.domain);

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
            '--from', 'docx',
            '--to', 'markdown',
            tempFile,
          ]);
          markdown = stdout;
        } finally {
          try { unlinkSync(tempFile); } catch { /* ignore cleanup errors */ }
        }

        // Pre-process: normalize whitespace, detect language
        markdown = markdown.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
        const lang = HarvesterService.detectLanguage(markdown);

        // Segment via LLM
        const blocks = await this.llmClient.segment(markdown);

        for (const block of blocks) {
          // The LLM returns the full block text in body — use it directly
          const text = block.body;

          // Classify
          let classification;
          try {
            classification = await this.llmClient.classify(text, existingTypes, existingDomains);
          } catch (classErr: any) {
            classification = { type: block.type || 'unknown', domain: 'unknown', tags: [], confidence: 0.5 };
          }

          if (classification.confidence < minConfidence) {
            lowConfidenceCount++;
          }

          // Filter blocks below threshold — still insert but track
          let duplicateOf: string | null = null;
          let duplicateScore: number | null = null;

          // Check for duplicates via Milvus if available
          try {
            const searchResults = await this.searchService.search(text, undefined, 1);
            if (searchResults.length > 0) {
              const topScore = searchResults[0].score;
              if (topScore > 0.80) {
                duplicateOf = searchResults[0].id;
                duplicateScore = topScore;
                duplicatesCount++;
              }
            }
          } catch {
            // Milvus not available — skip duplicate detection
          }

          const candidateId = `hcn-${randomUUID()}`;
          await this.db.insert(harvestCandidates).values({
            id: candidateId,
            job_id: jobId,
            title: block.title || 'Untitled',
            body: text,
            type: classification.type,
            domain: classification.domain,
            lang: block.lang || lang,
            tags: JSON.stringify(classification.tags),
            confidence: classification.confidence,
            origin_source: filename,
            origin_page: null,
            duplicate_of: duplicateOf,
            duplicate_score: duplicateScore,
            status: 'pending',
          });

          totalCandidates++;
        }
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

      const result = await this.fragmentService.create(
        {
          type: candidate.type as any,
          domain: candidate.domain,
          tags: candidate.tags ? (JSON.parse(candidate.tags) as string[]) : [],
          lang: candidate.lang,
          body: candidate.body,
          translation_of: null,
          parent_id: null,
          generation: 0,
          origin: 'harvested',
          access: { read: ['*'], write: ['contributor', 'admin'], approve: ['expert', 'admin'] },
        },
        userId,
        'expert',
      );

      await this.db
        .update(harvestCandidates)
        .set({ status: 'accepted', fragment_id: result.id })
        .where(eq(harvestCandidates.id, candidateId));

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

      const result = await this.fragmentService.create(
        {
          type: (mod.type ?? candidate.type) as any,
          domain: mod.domain ?? candidate.domain,
          tags: candidate.tags ? (JSON.parse(candidate.tags) as string[]) : [],
          lang: candidate.lang,
          body: mod.body ?? candidate.body,
          translation_of: null,
          parent_id: null,
          generation: 0,
          origin: 'harvested',
          access: { read: ['*'], write: ['contributor', 'admin'], approve: ['expert', 'admin'] },
        },
        userId,
        'expert',
      );

      await this.db
        .update(harvestCandidates)
        .set({ status: 'accepted', fragment_id: result.id })
        .where(eq(harvestCandidates.id, mod.id));

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

  static extractBlockText(
    markdown: string,
    startMarker: string,
    endMarker: string,
  ): string {
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

  static detectLanguage(text: string): 'fr' | 'en' {
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
}
