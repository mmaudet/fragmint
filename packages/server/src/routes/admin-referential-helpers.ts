import { eq, inArray, like, and } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import {
  fragmentDomains,
  fragmentTags,
  fragmentTagLinks,
  fragmentTypes,
  fragmentFunctions,
  entities,
  fragments,
  harvestCandidates,
  fragmentEntities,
  users,
} from '../db/schema.js';

export type ReferentialType = 'domain' | 'tag' | 'entity' | 'type' | 'function';

export const TABLE_MAP = {
  domain: fragmentDomains,
  tag: fragmentTags,
  type: fragmentTypes,
  function: fragmentFunctions,
  entity: entities,
} as const;

export const TABLE_NAME_MAP: Record<ReferentialType, string> = {
  domain: 'fragment_domains',
  tag: 'fragment_tags',
  type: 'fragment_types',
  function: 'fragment_functions',
  entity: 'entities',
};

export const VALID_TYPES: ReferentialType[] = ['domain', 'tag', 'entity', 'type', 'function'];

export const FRAGMENT_FIELDS = {
  id: fragments.id,
  title: fragments.title,
  quality: fragments.quality,
  updated_at: fragments.updated_at,
  body_excerpt: fragments.body_excerpt,
} as const;

export async function batchUserInfo(
  db: FragmintDb,
  proposedBys: string[],
): Promise<Record<string, { role: string; displayName: string }>> {
  const names = [...new Set(proposedBys.filter((p) => p && p !== 'llm-auto'))];
  if (names.length === 0) return {};
  const rows = await db
    .select({ login: users.login, role: users.role, displayName: users.display_name })
    .from(users)
    .where(inArray(users.login, names));
  return Object.fromEntries(
    rows.map((r) => [r.login, { role: r.role, displayName: r.displayName }]),
  );
}

export function formatItem(row: any, type: ReferentialType) {
  const base = {
    status: row.status,
    trustSource: row.trustSource ?? row.trust_source,
    usageCount: row.usageCount ?? row.usage_count ?? 0,
    createdAt: row.created_at ?? row.createdAt,
    proposedBy: row.proposedBy ?? row.proposed_by,
  };
  if (type === 'entity') {
    return {
      ...base,
      id: row.id,
      label: row.canonicalName,
      canonicalName: row.canonicalName,
      category: row.type,
      aliases: JSON.parse(row.aliases ?? '[]'),
    };
  }
  return {
    ...base,
    id: row.slug,
    label: row.label,
    description: row.description,
    category: (row as any).category,
  };
}

export async function getFragmentsForItem(
  db: FragmintDb,
  type: ReferentialType,
  id: string | number,
) {
  switch (type) {
    case 'domain':
      return db
        .select(FRAGMENT_FIELDS)
        .from(fragments)
        .where(eq(fragments.domain, id as string))
        .limit(100);
    case 'type':
      return db
        .select(FRAGMENT_FIELDS)
        .from(fragments)
        .where(eq(fragments.type, id as string))
        .limit(100);
    case 'tag':
      return db
        .select(FRAGMENT_FIELDS)
        .from(fragmentTagLinks)
        .innerJoin(fragments, eq(fragmentTagLinks.fragment_id, fragments.id))
        .where(eq(fragmentTagLinks.tag_slug, id as string))
        .limit(100);
    case 'entity':
      return db
        .select(FRAGMENT_FIELDS)
        .from(fragmentEntities)
        .innerJoin(fragments, eq(fragmentEntities.fragment_id, fragments.id))
        .where(eq(fragmentEntities.entity_id, id as number))
        .limit(100);
    default:
      return [];
  }
}

export async function getCandidatesForItem(
  db: FragmintDb,
  type: ReferentialType,
  id: string | number,
) {
  switch (type) {
    case 'domain':
      return db
        .select({ id: harvestCandidates.id })
        .from(harvestCandidates)
        .where(
          and(eq(harvestCandidates.domain, id as string), eq(harvestCandidates.status, 'pending')),
        );
    case 'type':
      return db
        .select({ id: harvestCandidates.id })
        .from(harvestCandidates)
        .where(
          and(eq(harvestCandidates.type, id as string), eq(harvestCandidates.status, 'pending')),
        );
    case 'tag':
      return db
        .select({ id: harvestCandidates.id })
        .from(harvestCandidates)
        .where(
          and(like(harvestCandidates.tags, `%"${id}"%`), eq(harvestCandidates.status, 'pending')),
        );
    default:
      return [];
  }
}

export function resolveId(
  refType: ReferentialType,
  table: any,
  id: string,
): { idField: any; lookupValue: string | number } {
  return {
    idField: refType === 'entity' ? entities.id : table.slug,
    lookupValue: refType === 'entity' ? parseInt(id, 10) : id,
  };
}

export async function renameTagInJson(db: FragmintDb, oldTag: string, newTag: string) {
  const fragsWithTag = await db
    .select({ id: fragments.id, tags: fragments.tags })
    .from(fragments)
    .where(like(fragments.tags, `%"${oldTag}"%`));
  for (const frag of fragsWithTag) {
    if (!frag.tags) continue;
    const tags = JSON.parse(frag.tags) as string[];
    const updated = tags.map((t) => (t === oldTag ? newTag : t));
    await db
      .update(fragments)
      .set({ tags: JSON.stringify(updated) })
      .where(eq(fragments.id, frag.id));
  }
  const candsWithTag = await db
    .select({ id: harvestCandidates.id, tags: harvestCandidates.tags })
    .from(harvestCandidates)
    .where(like(harvestCandidates.tags, `%"${oldTag}"%`));
  for (const cand of candsWithTag) {
    if (!cand.tags) continue;
    const tags = JSON.parse(cand.tags) as string[];
    const updated = tags.map((t) => (t === oldTag ? newTag : t));
    await db
      .update(harvestCandidates)
      .set({ tags: JSON.stringify(updated) })
      .where(eq(harvestCandidates.id, cand.id));
  }
}
