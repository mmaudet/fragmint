// packages/server/src/services/harvest-hint-processor.ts
// Hint-processing helpers for the harvester pipeline — extracted to stay under 500-line limit.
import { eq } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { entities, fragmentDomains, fragmentTags } from '../db/schema.js';
import type { CombinedBlock } from './llm-client.js';
import {
  type UploadHints,
  type TrustSourcesPerMetadata,
  overallTrustSource,
} from '../schema/trust-source.js';

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

export const normalizeEntityName = (name: string) => name.toLowerCase().replace(/[\s\-.]+/g, '-');

// ---------------------------------------------------------------------------
// Types shared with harvester-pipeline
// ---------------------------------------------------------------------------

export interface HintEntitySetup {
  hintEntityNames: string[];
  hintEntityMeta: Map<string, string>; // lowercase name → entity type
  hintEntitiesFound: Set<string>;
  hintTagsFound: Set<string>;
}

// ---------------------------------------------------------------------------
// 1. setupHintEntities
//    Build hintEntityMeta from uploadHints.entities, inserting pending DB rows
//    for unknown entity names (validated=0). Returns tracking sets ready for use.
// ---------------------------------------------------------------------------

export async function setupHintEntities(
  db: FragmintDb,
  uploadHints: UploadHints,
  validEntityRows: { type: string; canonicalName: string; normalizedName: string }[],
): Promise<HintEntitySetup> {
  const hintEntityNames: string[] = uploadHints.entities ?? [];
  const hintEntityMeta = new Map<string, string>();
  const hintEntitiesFound = new Set<string>();
  const hintTagsFound = new Set<string>();

  if (hintEntityNames.length > 0) {
    const now = new Date().toISOString();
    for (const name of hintEntityNames) {
      const normalized = normalizeEntityName(name);
      const existing = validEntityRows.find((e) => e.normalizedName === normalized);
      if (existing) {
        hintEntityMeta.set(name.toLowerCase(), existing.type);
      } else {
        // Create as pending (validated=0) — promoted to validated=1 if found in ≥1 fragment
        await db
          .insert(entities)
          .values({
            type: 'client',
            name,
            canonicalName: name,
            normalizedName: normalized,
            aliases: '[]',
            validated: 0,
            usageCount: 0,
            proposedBy: 'harvest-hint',
            createdAt: now,
            trustSource: 'human-direct',
            status: 'active',
          })
          .onConflictDoNothing();
        hintEntityMeta.set(name.toLowerCase(), 'client');
      }
    }
    // Note: validEntityRows is NOT reloaded — pending entities don't go in the LLM prompt
  }

  return { hintEntityNames, hintEntityMeta, hintEntitiesFound, hintTagsFound };
}

// ---------------------------------------------------------------------------
// 2. applyUploadHintsInPlace
//    Per-block body-scan: inject hint entities where found; track coherent hints.
//    Mutates blocks in place and updates the two tracking sets.
// ---------------------------------------------------------------------------

export function applyUploadHintsInPlace(
  blocks: CombinedBlock[],
  uploadHints: UploadHints,
  hintEntityNames: string[],
  hintEntityMeta: Map<string, string>,
  hintEntitiesFound: Set<string>,
  hintTagsFound: Set<string>,
): void {
  // Pre-compile hint entity regexes once for all blocks
  const hintEntityRegexes = new Map(
    hintEntityNames.map((name) => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return [name, new RegExp(`\\b${escaped}\\b`, 'i')] as const;
    }),
  );

  for (const block of blocks) {
    // Hint entities — inject into block.entities where name appears in body
    if (hintEntityNames.length > 0) {
      if (!block.entities)
        block.entities = {
          clients: [],
          products: [],
          technologies: [],
          partners: [],
          certifications: [],
          regulations: [],
        } as typeof block.entities;
      const blockEntities = block.entities as Record<string, string[]>;
      for (const hintName of hintEntityNames) {
        if (!hintEntityRegexes.get(hintName)?.test(block.body)) continue;
        hintEntitiesFound.add(hintName.toLowerCase());
        const entityType = hintEntityMeta.get(hintName.toLowerCase()) ?? 'client';
        const bucket = `${entityType}s`;
        if (!blockEntities[bucket]) blockEntities[bucket] = [];
        if (!blockEntities[bucket].includes(hintName)) blockEntities[bucket].push(hintName);
      }
    }

    // Hint tags — track which ones the LLM applied to this block
    if (uploadHints.tags?.length) {
      for (const tag of uploadHints.tags) {
        if ((block.tags ?? []).includes(tag)) hintTagsFound.add(tag);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. insertNewProposals
//    Insert LLM NEW: proposals (tags, domains, entities) into admin queues.
//    Auto-validates when trust_source is human-direct or llm-confirmed.
// ---------------------------------------------------------------------------

const VALID_ENTITY_TYPES = [
  'client',
  'product',
  'technology',
  'partner',
  'certification',
  'regulation',
  'metric',
];

export async function insertNewProposals(
  db: FragmintDb,
  blocks: CombinedBlock[],
  trustSourcesPerBlock: (TrustSourcesPerMetadata | undefined)[],
): Promise<void> {
  const now = new Date().toISOString();

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
    const block = blocks[blockIndex];
    const blockTrustSources = trustSourcesPerBlock[blockIndex];
    const proposals = block.new_proposals ?? {};

    const tagTrust = blockTrustSources?.tags ?? 'llm-inferred';
    const tagAutoValidated = tagTrust === 'human-direct' || tagTrust === 'llm-confirmed' ? 1 : 0;

    for (const rawTag of proposals.tags ?? []) {
      const slug = rawTag.replace(/^NEW:/i, '').toLowerCase().replace(/\s+/g, '-');
      // onConflictDoNothing: if the tag already exists in any state (pending, active, rejected…)
      // we never overwrite it — the LLM re-discovering a known tag is not a reason to change it.
      await db
        .insert(fragmentTags)
        .values({
          slug,
          label: slug,
          category: 'proposed',
          status: tagAutoValidated ? 'active' : 'pending',
          validated: tagAutoValidated,
          proposedBy: 'llm-auto',
          trustSource: tagTrust,
          created_at: now,
        })
        .onConflictDoNothing();
    }

    const domainTrust = blockTrustSources?.domain ?? 'llm-inferred';
    const domainAutoValidated =
      domainTrust === 'human-direct' || domainTrust === 'llm-confirmed' ? 1 : 0;

    for (const rawDomain of proposals.domains ?? []) {
      const slug = rawDomain.replace(/^NEW:/i, '').toLowerCase().replace(/\s+/g, '-');
      await db
        .insert(fragmentDomains)
        .values({
          slug,
          label: slug,
          description: 'LLM-proposed',
          status: domainAutoValidated ? 'active' : 'pending',
          validated: domainAutoValidated,
          proposedBy: 'llm-auto',
          trustSource: domainTrust,
          created_at: now,
        })
        .onConflictDoNothing();
    }

    const entityOverallTrust = overallTrustSource(blockTrustSources ?? {});
    const entityAutoValidated =
      entityOverallTrust === 'human-direct' || entityOverallTrust === 'llm-confirmed' ? 1 : 0;

    for (const [entType, entNames] of Object.entries(proposals.entities ?? {})) {
      // Guard: LLM occasionally returns a string instead of an array — skip silently
      if (!Array.isArray(entNames)) continue;
      for (const rawName of entNames) {
        if (typeof rawName !== 'string' || rawName.trim().length < 2) continue;
        const canonical = rawName.replace(/^NEW:/i, '').trim();
        const normalized = normalizeEntityName(canonical);
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

// ---------------------------------------------------------------------------
// 4. flushHintReferentials
//    Post-pipeline: promote coherent hint entities to validated=1 and surface
//    hint domain/tags to the admin referential queues.
// ---------------------------------------------------------------------------

export async function flushHintReferentials(
  db: FragmintDb,
  uploadHints: UploadHints,
  hintEntityNames: string[],
  hintEntitiesFound: Set<string>,
  hintTagsFound: Set<string>,
  existingDomains: string[],
): Promise<void> {
  const now = new Date().toISOString();

  // Promote hint entities found in ≥1 fragment to validated=1
  for (const name of hintEntityNames) {
    if (hintEntitiesFound.has(name.toLowerCase())) {
      const normalized = normalizeEntityName(name);
      await db
        .update(entities)
        .set({ validated: 1 })
        .where(eq(entities.normalizedName, normalized));
    }
  }

  // Create pending domain entry if hint domain is new (not yet in referential)
  if (uploadHints.domain && !existingDomains.includes(uploadHints.domain)) {
    await db
      .insert(fragmentDomains)
      .values({
        slug: uploadHints.domain,
        label: uploadHints.domain,
        description: 'Hint-proposed',
        validated: 0,
        proposedBy: 'harvest-hint',
        trustSource: 'human-direct',
        created_at: now,
      })
      .onConflictDoNothing();
  }

  // Create pending tag entries for hint tags applied to ≥1 fragment by the LLM
  for (const tag of hintTagsFound) {
    await db
      .insert(fragmentTags)
      .values({
        slug: tag,
        label: tag,
        validated: 0,
        status: 'pending',
        proposedBy: 'harvest-hint',
        trustSource: 'human-direct',
        created_at: now,
      })
      .onConflictDoNothing();
  }
}
