// packages/server/src/services/harvest-hint-processor.ts
// Hint-processing helpers for the harvester pipeline — extracted to stay under 500-line limit.
import { sql } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { fragmentDomains, fragmentTags } from '../db/schema.js';
import type { CombinedBlock } from './llm-client.js';
import {
  type UploadHints,
  type TrustSourcesPerMetadata,
} from '../schema/trust-source.js';

// ---------------------------------------------------------------------------
// 2. applyUploadHintsInPlace
//    Per-block body-scan: force-apply hint tags when body mentions the keyword.
//    Mirrors domain override logic — hint tags are not just LLM suggestions.
//    Mutates blocks and hintTagsFound in place.
// ---------------------------------------------------------------------------

/**
 * Returns indices of blocks whose domain was overridden from "other" to the hint domain.
 * Override only fires when: hint domain is new (not in existingDomains), LLM returned "other",
 * and the block body contains the hint domain word — avoids broad-stroke labeling.
 */
export function applyUploadHintsInPlace(
  blocks: CombinedBlock[],
  uploadHints: UploadHints,
  hintTagsFound: Set<string>,
  existingDomains: string[] = [],
): Set<number> {
  const domainOverridden = new Set<number>();

  const hintDomain = uploadHints.domain;
  const isNewDomain = hintDomain && !existingDomains.includes(hintDomain);
  const domainWord = isNewDomain ? hintDomain.toLowerCase() : null;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    if (uploadHints.tags?.length) {
      for (const tag of uploadHints.tags) {
        // Keyword to search for in body: "client:canut" → "canut", "canut" → "canut"
        const keyword = tag.includes(':') ? tag.split(':')[1] : tag;
        const alreadyTagged = (block.tags ?? []).includes(tag);
        const bodyMentions = keyword && block.body?.toLowerCase().includes(keyword.toLowerCase());
        if (alreadyTagged || bodyMentions) {
          if (!alreadyTagged) {
            block.tags = [...(block.tags ?? []), tag];
          }
          hintTagsFound.add(tag);
        }
      }
    }

    if (domainWord && block.domain === 'other' && block.body?.toLowerCase().includes(domainWord)) {
      block.domain = hintDomain!;
      domainOverridden.add(i);
    }
  }

  return domainOverridden;
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
  userId?: string,
): Promise<void> {
  const now = new Date().toISOString();
  const proposedBy = userId ?? 'harvest-hint';

  // Create pending domain entry if hint domain is new (not yet in referential)
  if (uploadHints.domain && !existingDomains.includes(uploadHints.domain)) {
    await db
      .insert(fragmentDomains)
      .values({
        slug: uploadHints.domain,
        label: uploadHints.domain,
        description: 'Hint-proposed',
        proposedBy,
        trustSource: 'human-direct',
        created_at: now,
      })
      .onConflictDoNothing();
  }

  // Create pending tag entries for hint tags applied to ≥1 fragment.
  // If the tag was previously rejected, restore it to pending (human intent overrides rejection).
  // Also update category if it changed (e.g. slug was re-entered with a prefix).
  for (const tag of hintTagsFound) {
    const prefix = tag.includes(':') ? tag.split(':')[0] : null;
    await db
      .insert(fragmentTags)
      .values({
        slug: tag,
        label: tag,
        status: 'pending',
        proposedBy,
        trustSource: 'human-direct',
        category: prefix ?? undefined,
        created_at: now,
      })
      .onConflictDoUpdate({
        target: fragmentTags.slug,
        set: {
          // Restore rejected tags to pending — human hint is explicit intent
          status: sql`CASE WHEN ${fragmentTags.status} = 'rejected' THEN 'pending' ELSE ${fragmentTags.status} END`,
          // Update category if prefix changed
          category: prefix ?? null,
          trustSource: 'human-direct',
        },
      });
  }
}
