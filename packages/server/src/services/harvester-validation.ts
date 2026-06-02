// packages/server/src/services/harvester-validation.ts
// Validation and bulk-accept logic for the harvester — extracted from harvester-service.ts
import { eq, and, inArray, count } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import {
  harvestCandidates,
  harvestJobs,
  fragmentTags,
  fragmentTagLinks,
} from '../db/schema.js';
import type { FragmentService } from './fragment-service.js';
import type { FragmentBulkService } from './fragment-bulk-service.js';
import type { ValidationInput } from './harvester-service.js';

export async function validate(
  db: FragmintDb,
  fragmentService: FragmentService,
  jobId: string,
  validation: ValidationInput,
  userId: string,
): Promise<{ committed: number; merged: number; rejected: number }> {
  let committed = 0;
  let merged = 0;
  let rejected = 0;

  const jobRows = await db
    .select({ collection_slug: harvestJobs.collection_slug })
    .from(harvestJobs)
    .where(eq(harvestJobs.id, jobId))
    .limit(1);
  const collectionSlug = jobRows[0]?.collection_slug ?? undefined;

  // Accepted candidates — create fragments
  for (const candidateId of validation.accepted) {
    const rows = await db
      .select()
      .from(harvestCandidates)
      .where(eq(harvestCandidates.id, candidateId))
      .limit(1);

    if (rows.length === 0) continue;
    const candidate = rows[0];

    const tags = tagsFromCandidate(candidate);

    const result = await fragmentService.create(
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
        origin_source: candidate.origin_source,
        origin_page: candidate.origin_page ?? null,
        valid_from: null,
        valid_until: null,
        access: { read: ['*'], write: ['contributor', 'admin'], approve: ['expert', 'admin'] },
        harvest_confidence: candidate.confidence,
      } as any,
      userId,
      'expert',
      undefined,
      undefined,
      collectionSlug,
    );

    await Promise.all([
      db
        .update(harvestCandidates)
        .set({ status: 'accepted', fragment_id: result.id })
        .where(eq(harvestCandidates.id, candidateId)),
      upsertTags(db, tags),
    ]);

    committed++;
  }

  // Modified candidates — create fragments with modifications
  for (const mod of validation.modified) {
    const rows = await db
      .select()
      .from(harvestCandidates)
      .where(eq(harvestCandidates.id, mod.id))
      .limit(1);

    if (rows.length === 0) continue;
    const candidate = rows[0];

    const tags = tagsFromCandidate(candidate, mod.tags);

    const result = await fragmentService.create(
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
        origin_source: candidate.origin_source,
        origin_page: candidate.origin_page ?? null,
        valid_from: null,
        valid_until: null,
        access: { read: ['*'], write: ['contributor', 'admin'], approve: ['expert', 'admin'] },
        harvest_confidence: candidate.confidence,
      } as any,
      userId,
      'expert',
      undefined,
      undefined,
      collectionSlug,
    );

    await Promise.all([
      db
        .update(harvestCandidates)
        .set({ status: 'accepted', fragment_id: result.id })
        .where(eq(harvestCandidates.id, mod.id)),
      upsertTags(db, tags),
    ]);

    committed++;
  }

  // Merged candidates
  for (const merge of validation.merged) {
    await db
      .update(harvestCandidates)
      .set({ status: 'merged' })
      .where(eq(harvestCandidates.id, merge.candidate));

    merged++;
  }

  // Rejected candidates
  for (const candidateId of validation.rejected) {
    await db
      .update(harvestCandidates)
      .set({ status: 'rejected' })
      .where(eq(harvestCandidates.id, candidateId));

    rejected++;
  }

  // Mark job as fully validated if no pending candidates remain
  const [{ remaining }] = await db
    .select({ remaining: count() })
    .from(harvestCandidates)
    .where(and(eq(harvestCandidates.job_id, jobId), eq(harvestCandidates.status, 'pending')));

  if (remaining === 0) {
    await db
      .update(harvestJobs)
      .set({ validated_at: new Date().toISOString() })
      .where(eq(harvestJobs.id, jobId));
  }

  return { committed, merged, rejected };
}

export async function bulkAccept(
  db: FragmintDb,
  fragmentService: FragmentBulkService,
  candidates: (typeof harvestCandidates.$inferSelect)[],
  userId: string,
): Promise<number> {
  const jobIds = [...new Set(candidates.map((c) => c.job_id))];
  const jobRows = await db
    .select({ id: harvestJobs.id, collection_slug: harvestJobs.collection_slug })
    .from(harvestJobs)
    .where(jobIds.length === 1 ? eq(harvestJobs.id, jobIds[0]!) : inArray(harvestJobs.id, jobIds));
  const jobCollectionMap = new Map(jobRows.map((j) => [j.id, j.collection_slug ?? undefined]));

  // Compute source_position: 1-based rank of each candidate within its job by doc_position.
  // Fetch all candidates per job (ordered by doc_position) to build a stable rank map.
  const allJobCandidates = await db
    .select({ id: harvestCandidates.id, job_id: harvestCandidates.job_id, doc_position: harvestCandidates.doc_position })
    .from(harvestCandidates)
    .where(inArray(harvestCandidates.job_id, jobIds));

  const sourcePositionMap = new Map<string, number>();
  for (const jid of jobIds) {
    const jobCands = allJobCandidates
      .filter((c) => c.job_id === jid)
      .sort((a, b) => (a.doc_position ?? 999999) - (b.doc_position ?? 999999));
    jobCands.forEach((c, i) => sourcePositionMap.set(c.id, i + 1));
  }

  const items = candidates.map((candidate) => ({
    type: candidate.type,
    domain: candidate.domain,
    lang: candidate.lang,
    body: candidate.body,
    tags: tagsFromCandidate(candidate),
    origin: 'harvested' as const,
    harvest_confidence: candidate.confidence,
    source_position: sourcePositionMap.get(candidate.id) ?? null,
    collectionSlug: jobCollectionMap.get(candidate.job_id),
  }));

  // Single batch: one git commit per collection vault instead of N commits
  const created = await fragmentService.bulkCreateDraftFragments(items, userId);

  // Update candidates and upsert tags
  const allTags = [...new Set(items.flatMap((i) => i.tags))];
  await upsertTags(db, allTags);

  for (const { idx, id } of created) {
    const candidate = candidates[idx];
    await db
      .update(harvestCandidates)
      .set({ status: 'accepted', fragment_id: id })
      .where(eq(harvestCandidates.id, candidate.id));
    const candidateTags = items[idx]?.tags ?? [];
    if (candidateTags.length > 0) {
      await db
        .insert(fragmentTagLinks)
        .values(candidateTags.map((slug) => ({ fragment_id: id, tag_slug: slug })))
        .onConflictDoNothing();
    }
  }

  return created.length;
}

function normalizeTagSlug(raw: string): string {
  return raw.replace(/^NEW:/i, '').toLowerCase().replace(/\s+/g, '-').trim();
}

export function tagsFromCandidate(
  candidate: { tags: string | null; new_proposals: string | null },
  overrideTags?: string[],
): string[] {
  const rawKnown: string[] =
    overrideTags ?? (candidate.tags ? (JSON.parse(candidate.tags) as string[]) : []);
  const proposals = candidate.new_proposals
    ? (JSON.parse(candidate.new_proposals) as Record<string, unknown>)
    : {};
  const rawProposed: string[] = (proposals.tags as string[] | undefined) ?? [];
  const merged = [...new Set([...rawKnown, ...rawProposed].map(normalizeTagSlug))].filter(Boolean);
  return merged;
}

export async function upsertTags(db: FragmintDb, tags: string[]): Promise<void> {
  if (tags.length === 0) return;
  // Safety net: normalize slugs before inserting (strip NEW: prefix, lowercase, spaces→dashes)
  const normalized = [
    ...new Set(
      tags
        .map((t) => t.replace(/^NEW:/i, '').toLowerCase().replace(/\s+/g, '-').trim())
        .filter(Boolean),
    ),
  ];
  if (normalized.length === 0) return;
  const now = new Date().toISOString();
  await db
    .insert(fragmentTags)
    .values(
      normalized.map((slug) => ({
        slug,
        label: slug,
        validated: 0,
        status: 'pending' as const,
        proposedBy: 'llm-auto',
        trustSource: 'llm-inferred',
        created_at: now,
      })),
    )
    .onConflictDoNothing();
}
