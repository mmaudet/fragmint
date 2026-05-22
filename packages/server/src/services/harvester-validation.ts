// packages/server/src/services/harvester-validation.ts
// Validation and bulk-accept logic for the harvester — extracted from harvester-service.ts
import { eq } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import {
  harvestCandidates,
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
    );

    await Promise.all([
      db
        .update(harvestCandidates)
        .set({ status: 'accepted', fragment_id: result.id })
        .where(eq(harvestCandidates.id, mod.id)),
      upsertTags(db, tags),
      linkFragmentEntities(db, result.id, candidate.entities_json),
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

  return { committed, merged, rejected };
}

export async function bulkAccept(
  db: FragmintDb,
  fragmentService: FragmentService,
  candidates: (typeof harvestCandidates.$inferSelect)[],
  userId: string,
): Promise<number> {
  let count = 0;
  for (const candidate of candidates) {
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
    );
    await Promise.all([
      db
        .update(harvestCandidates)
        .set({ status: 'accepted', fragment_id: result.id })
        .where(eq(harvestCandidates.id, candidate.id)),
      upsertTags(db, tags),
      linkFragmentEntities(db, result.id, candidate.entities_json),
    ]);
    count++;
  }
  return count;
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
      .where(eq(entities.normalizedName, normalized))
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
    .values(tags.map((slug) => ({ slug, label: slug, created_at: now })))
    .onConflictDoNothing();
}
