// packages/server/src/services/harvester-service.ts
import { randomUUID } from 'node:crypto';
import { eq, asc } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { harvestJobs, harvestCandidates } from '../db/schema.js';
import type { LlmClient } from './llm-client.js';
import type { SearchService } from '../search/index.js';
import type { FragmentBulkService } from './fragment-bulk-service.js';
import type { UploadHints } from '../schema/trust-source.js';
import type { CoherenceFlag } from './quality-signals.js';
import type { FragmentCollectionService } from './fragment-collection-service.js';
import type { JudgeResult } from './quality-judge.js';
import {
  runPipeline,
  extractBlockText,
  chunkMarkdown,
  deduplicateBlocks,
  detectLanguage,
  MAX_CHUNK_CHARS,
  OVERLAP_CHARS,
} from './harvester-pipeline.js';
import { validate, bulkAccept as bulkAcceptCandidates } from './harvester-validation.js';

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
  source_section: string | null;
  duplicate_of: string | null;
  duplicate_score: number | null;
  duplicate_method: string | null;
  status: string;
  fragment_id: string | null;
  trust_sources_json: string | null;
  entities_json: string | null;
  quality_signals: CoherenceFlag[];
  judge_result: JudgeResult | null;
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
    entities_json?: string;
  }>;
  merged: Array<{ candidate: string; into: string }>;
  rejected: string[];
}

export class HarvesterService {
  constructor(
    private db: FragmintDb,
    private llmClient: LlmClient,
    private searchService: SearchService,
    private fragmentService: FragmentBulkService,
    private storePath: string,
    private options: { dupeShinglesThreshold?: number } = {},
    private collectionService?: FragmentCollectionService,
  ) {}

  async harvest(
    files: Buffer[],
    filenames: string[],
    options: { min_confidence: number },
    userId: string,
    collectionSlug: string | null = null,
    uploadHints?: UploadHints,
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
      upload_hints: uploadHints ? JSON.stringify(uploadHints) : null,
      created_by: userId,
      created_at: now,
      updated_at: now,
    });

    // Launch pipeline async without awaiting
    setImmediate(() => {
      this._runPipeline(jobId, files, filenames, options.min_confidence, uploadHints ?? {}, userId).catch(
        (err) => {
          console.error(`Pipeline error for job ${jobId}:`, err);
        },
      );
    });

    return jobId;
  }

  async _runPipeline(
    jobId: string,
    files: Buffer[],
    filenames: string[],
    minConfidence: number,
    uploadHints: UploadHints = {},
    userId?: string,
  ): Promise<void> {
    return runPipeline(
      this.db,
      this.llmClient,
      this.searchService,
      jobId,
      files,
      filenames,
      minConfidence,
      uploadHints,
      this.options.dupeShinglesThreshold,
      this.collectionService,
      userId,
    );
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
      .where(eq(harvestCandidates.job_id, jobId))
      .orderBy(asc(harvestCandidates.doc_position));

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
        source_section: c.source_section ?? null,
        duplicate_of: c.duplicate_of,
        duplicate_score: c.duplicate_score,
        duplicate_method: c.duplicate_method ?? null,
        status: c.status,
        fragment_id: c.fragment_id,
        trust_sources_json: c.trust_sources_json ?? null,
        entities_json: c.entities_json ?? null,
        quality_signals: c.quality_signals
          ? (JSON.parse(c.quality_signals) as CoherenceFlag[])
          : [],
        judge_result: c.judge_result ? (JSON.parse(c.judge_result) as JudgeResult) : null,
      })),
    };
  }

  async validate(
    jobId: string,
    validation: ValidationInput,
    userId: string,
  ): Promise<{ committed: number; merged: number; rejected: number }> {
    return validate(this.db, this.fragmentService, jobId, validation, userId);
  }

  async bulkAccept(
    candidates: (typeof harvestCandidates.$inferSelect)[],
    userId: string,
  ): Promise<number> {
    return bulkAcceptCandidates(this.db, this.fragmentService, candidates, userId);
  }

  // Static utility methods — delegates to harvester-pipeline module functions
  static extractBlockText = extractBlockText;
  static readonly MAX_CHUNK_CHARS = MAX_CHUNK_CHARS;
  static readonly OVERLAP_CHARS = OVERLAP_CHARS;
  static chunkMarkdown = chunkMarkdown;
  static deduplicateBlocks = deduplicateBlocks;
  static detectLanguage = detectLanguage;
}
