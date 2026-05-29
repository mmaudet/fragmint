// packages/server/src/services/harvest-hint-processor.ts
// Hint-processing helpers for the harvester pipeline — extracted to stay under 500-line limit.
import type { FragmintDb } from '../db/connection.js';
import { fragmentDomains, fragmentTags } from '../db/schema.js';
import type { CombinedBlock } from './llm-client.js';
import {
  type UploadHints,
  type TrustSourcesPerMetadata,
} from '../schema/trust-source.js';

// ---------------------------------------------------------------------------
// 2. applyUploadHintsInPlace
//    Per-block body-scan: track coherent hint tags.
//    Mutates hintTagsFound in place.
// ---------------------------------------------------------------------------

export function applyUploadHintsInPlace(
  blocks: CombinedBlock[],
  uploadHints: UploadHints,
  hintTagsFound: Set<string>,
): void {
  for (const block of blocks) {
    if (uploadHints.tags?.length) {
      for (const tag of uploadHints.tags) {
        if ((block.tags ?? []).includes(tag)) hintTagsFound.add(tag);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. insertNewProposals
//    Insert LLM NEW: proposals (tags, domains) into admin queues.
//    Auto-validates when trust_source is human-direct or llm-confirmed.
// ---------------------------------------------------------------------------

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
  }
}

// ---------------------------------------------------------------------------
// 4. flushHintReferentials
//    Post-pipeline: surface hint domain/tags to the admin referential queues.
// ---------------------------------------------------------------------------

export async function flushHintReferentials(
  db: FragmintDb,
  uploadHints: UploadHints,
  hintTagsFound: Set<string>,
  existingDomains: string[],
): Promise<void> {
  const now = new Date().toISOString();

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
