// packages/server/src/services/harvester-validation.ts
// Validation and bulk-accept logic for the harvester — extracted from harvester-service.ts
import { eq, and, inArray, sql, count } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import {
  harvestCandidates,
  harvestJobs,
  fragmentTags,
  entities,
  fragmentEntities,
} from '../db/schema.js';
import type { FragmentService } from './fragment-service.js';
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
        function_type: candidate.function_type ?? null,
        audience: candidate.audience ? JSON.parse(candidate.audience) : [],
        maturity: candidate.maturity ?? null,
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
      linkFragmentEntities(db, result.id, candidate.entities_json),
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
        function_type: candidate.function_type ?? null,
        audience: candidate.audience ? JSON.parse(candidate.audience) : [],
        maturity: candidate.maturity ?? null,
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
      linkFragmentEntities(db, result.id, mod.entities_json ?? candidate.entities_json),
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
  fragmentService: FragmentService,
  candidates: (typeof harvestCandidates.$inferSelect)[],
  userId: string,
): Promise<number> {
  const jobIds = [...new Set(candidates.map((c) => c.job_id))];
  const jobRows = await db
    .select({ id: harvestJobs.id, collection_slug: harvestJobs.collection_slug })
    .from(harvestJobs)
    .where(jobIds.length === 1 ? eq(harvestJobs.id, jobIds[0]!) : inArray(harvestJobs.id, jobIds));
  const jobCollectionMap = new Map(jobRows.map((j) => [j.id, j.collection_slug ?? undefined]));

  const items = candidates.map((candidate) => ({
    type: candidate.type,
    domain: candidate.domain,
    lang: candidate.lang,
    body: candidate.body,
    tags: tagsFromCandidate(candidate),
    origin: 'harvested' as const,
    function_type: candidate.function_type ?? null,
    audience: candidate.audience ? (JSON.parse(candidate.audience) as string[]) : [],
    maturity: candidate.maturity ?? null,
    harvest_confidence: candidate.confidence,
    collectionSlug: jobCollectionMap.get(candidate.job_id),
  }));

  // Single batch: one git commit per collection vault instead of N commits
  const created = await fragmentService.bulkCreateDraftFragments(items, userId);

  // Update candidates and link entities
  const allTags = [...new Set(items.flatMap((i) => i.tags))];
  await upsertTags(db, allTags);

  for (const { idx, id } of created) {
    const candidate = candidates[idx];
    await db
      .update(harvestCandidates)
      .set({ status: 'accepted', fragment_id: id })
      .where(eq(harvestCandidates.id, candidate.id));
    await linkFragmentEntities(db, id, candidate.entities_json);
  }

  return created.length;
}

export function tagsFromCandidate(
  candidate: { tags: string | null; new_proposals: string | null },
  overrideTags?: string[],
): string[] {
  const known: string[] = overrideTags ?? (candidate.tags ? (JSON.parse(candidate.tags) as string[]) : []);
  const proposals = candidate.new_proposals ? (JSON.parse(candidate.new_proposals) as Record<string, unknown>) : {};
  const proposed: string[] = ((proposals.tags as string[] | undefined) ?? []).map((t) =>
    t.replace(/^NEW:/i, '').toLowerCase().replace(/\s+/g, '-'),
  );
  const merged = [...new Set([...known, ...proposed])].filter(Boolean);
  return merged;
}

export async function linkFragmentEntities(
  db: FragmintDb,
  fragmentId: string,
  entitiesJson: string | null,
): Promise<void> {
  if (!entitiesJson) return;
  let parsed: Record<string, string[]>;
  try {
    parsed = JSON.parse(entitiesJson) as Record<string, string[]>;
  } catch {
    return;
  }
  const allNames = Object.values(parsed).flat();
  for (const raw of allNames) {
    const normalized = raw.replace(/^NEW:/i, '').toLowerCase().replace(/[\s\-.]+/g, '-');
    const found = await db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.normalizedName, normalized), eq(entities.validated, 1)))
      .limit(1);
    if (found.length > 0) {
      await db
        .insert(fragmentEntities)
        .values({ fragment_id: fragmentId, entity_id: found[0].id })
        .onConflictDoNothing();
    }
  }
}

export async function upsertTags(db: FragmintDb, tags: string[]): Promise<void> {
  if (tags.length === 0) return;
  const now = new Date().toISOString();
  await db
    .insert(fragmentTags)
    .values(tags.map((slug) => ({
      slug,
      label: slug,
      usageCount: 1,
      validated: 0,
      status: 'pending' as const,
      proposedBy: 'llm-auto',
      trustSource: 'llm-inferred',
      created_at: now,
    })))
    .onConflictDoUpdate({
      target: fragmentTags.slug,
      set: { usageCount: sql`usage_count + 1` },
    });
}
