import { eq, desc, like } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { FragmintDb } from '../db/connection.js';
import { fragmentCollections } from '../db/schema.js';

export type FragmentCollection = {
  id: string;
  title: string;
  description: string | null;
  payload_schema: string | null;
  member_ids: string[];
  source_document: string | null;
  collection_slug: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
};

function rowToCollection(row: typeof fragmentCollections.$inferSelect): FragmentCollection {
  let memberIds: string[] = [];
  try {
    memberIds = JSON.parse(row.member_ids ?? '[]');
  } catch {
    // malformed JSON — leave as empty array
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    payload_schema: row.payload_schema,
    member_ids: memberIds,
    source_document: row.source_document,
    collection_slug: row.collection_slug,
    created_at: row.created_at,
    created_by: row.created_by,
    updated_at: row.updated_at,
  };
}

export class FragmentCollectionService {
  constructor(private db: FragmintDb) {}

  async create(input: {
    title: string;
    description?: string;
    payloadSchema?: string;
    memberIds?: string[];
    sourceDocument?: string;
    collectionSlug?: string;
    createdBy: string;
  }): Promise<{ id: string }> {
    const id = `fc_${randomUUID()}`;
    const now = new Date().toISOString();

    await this.db.insert(fragmentCollections).values({
      id,
      title: input.title,
      description: input.description ?? null,
      payload_schema: input.payloadSchema ?? null,
      member_ids: JSON.stringify(input.memberIds ?? []),
      source_document: input.sourceDocument ?? null,
      collection_slug: input.collectionSlug ?? null,
      created_at: now,
      created_by: input.createdBy,
      updated_at: now,
    });

    return { id };
  }

  async list(options?: { collectionSlug?: string; limit?: number }): Promise<FragmentCollection[]> {
    const limit = options?.limit ?? 50;
    const whereClause = options?.collectionSlug
      ? eq(fragmentCollections.collection_slug, options.collectionSlug)
      : undefined;

    const rows = await this.db
      .select()
      .from(fragmentCollections)
      .where(whereClause)
      .orderBy(desc(fragmentCollections.created_at))
      .limit(limit);

    return rows.map(rowToCollection);
  }

  async getById(id: string): Promise<FragmentCollection | null> {
    const rows = await this.db
      .select()
      .from(fragmentCollections)
      .where(eq(fragmentCollections.id, id))
      .limit(1);

    if (rows.length === 0) return null;
    return rowToCollection(rows[0]);
  }

  async getByFragmentId(fragmentId: string): Promise<FragmentCollection[]> {
    const rows = await this.db
      .select()
      .from(fragmentCollections)
      .where(like(fragmentCollections.member_ids, `%"${fragmentId}"%`))
      .orderBy(desc(fragmentCollections.created_at))
      .limit(10);
    return rows.map(rowToCollection);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(fragmentCollections).where(eq(fragmentCollections.id, id));
  }
}
