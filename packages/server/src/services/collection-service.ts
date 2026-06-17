// packages/server/src/services/collection-service.ts
import { eq, and, like, sql } from 'drizzle-orm';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { FragmintDb } from '../db/connection.js';
import { collections, collectionMemberships, fragments, toMilvusPartition } from '../db/schema.js';

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]{2,}$/;

const ROLE_HIERARCHY: Record<string, number> = {
  reader: 0,
  contributor: 1,
  expert: 2,
  manager: 3,
  owner: 4,
};

export type Collection = typeof collections.$inferSelect;

export type CollectionWithRole = Collection & { role: string; fragment_count: number };

export class CollectionService {
  constructor(
    private db: FragmintDb,
    private config: { store_path: string },
  ) {}

  async create(
    params: {
      slug: string;
      name: string;
      type: string;
      description?: string;
      tags?: string;
      ownerId?: string;
    },
    createdBy: string,
  ): Promise<Collection> {
    // Validate slug
    if (params.slug.length < 2) {
      throw new Error('Slug must be at least 2 characters');
    }
    if (!SLUG_REGEX.test(params.slug)) {
      throw new Error('Slug must be lowercase alphanumeric with hyphens only');
    }

    // Check uniqueness
    const existing = await this.db
      .select()
      .from(collections)
      .where(eq(collections.slug, params.slug))
      .limit(1);
    if (existing.length > 0) {
      throw new Error(`Collection with slug '${params.slug}' already exists`);
    }

    const id = `col-${randomUUID()}`;
    const now = new Date().toISOString();
    // All collections share the root git repo; fragments live at fragments/<slug>/
    const gitPath = this.config.store_path;
    const fragmentsDir = join(this.config.store_path, 'fragments', params.slug);
    const milvusPartition = toMilvusPartition(params.slug);

    // Insert into DB
    await this.db.insert(collections).values({
      id,
      slug: params.slug,
      name: params.name,
      type: params.type,
      git_path: gitPath,
      milvus_partition: milvusPartition,
      owner_id: params.ownerId ?? null,
      description: params.description ?? null,
      tags: params.tags ?? null,
      created_at: now,
      created_by: createdBy,
    });

    // Create fragments/<slug>/ directory in the shared vault (no separate git init)
    mkdirSync(fragmentsDir, { recursive: true });

    // If personal, add owner as member
    if (params.type === 'personal' && params.ownerId) {
      await this.db.insert(collectionMemberships).values({
        id: `cm-${randomUUID()}`,
        collection_id: id,
        user_id: params.ownerId,
        role: 'owner',
        granted_by: createdBy,
        granted_at: now,
      });
    }

    const rows = await this.db.select().from(collections).where(eq(collections.id, id)).limit(1);
    return rows[0];
  }

  async listAll(): Promise<CollectionWithRole[]> {
    const rows = await this.db
      .select({
        id: collections.id,
        slug: collections.slug,
        name: collections.name,
        type: collections.type,
        read_only: collections.read_only,
        auto_assign: collections.auto_assign,
        git_path: collections.git_path,
        milvus_partition: collections.milvus_partition,
        owner_id: collections.owner_id,
        description: collections.description,
        tags: collections.tags,
        created_at: collections.created_at,
        created_by: collections.created_by,
        fragment_count: sql<number>`(SELECT COUNT(*) FROM fragments WHERE fragments.collection_slug = collections.slug)`,
      })
      .from(collections);
    return rows.map((r) => ({ ...r, role: 'owner' })) as CollectionWithRole[];
  }

  async listForUser(userId: string): Promise<CollectionWithRole[]> {
    const rows = await this.db
      .select({
        id: collections.id,
        slug: collections.slug,
        name: collections.name,
        type: collections.type,
        read_only: collections.read_only,
        auto_assign: collections.auto_assign,
        git_path: collections.git_path,
        milvus_partition: collections.milvus_partition,
        owner_id: collections.owner_id,
        description: collections.description,
        tags: collections.tags,
        created_at: collections.created_at,
        created_by: collections.created_by,
        role: collectionMemberships.role,
        fragment_count: sql<number>`(SELECT COUNT(*) FROM fragments WHERE fragments.collection_slug = collections.slug)`,
      })
      .from(collections)
      .innerJoin(collectionMemberships, eq(collections.id, collectionMemberships.collection_id))
      .where(eq(collectionMemberships.user_id, userId));

    return rows as CollectionWithRole[];
  }

  async update(slug: string, fields: { name?: string; description?: string; read_only?: number }): Promise<void> {
    const updates: Record<string, unknown> = {};
    if (fields.name !== undefined) updates.name = fields.name;
    if (fields.description !== undefined) updates.description = fields.description;
    if (fields.read_only !== undefined) updates.read_only = fields.read_only;
    if (Object.keys(updates).length === 0) return;
    await this.db.update(collections).set(updates).where(eq(collections.slug, slug));
  }

  async getBySlug(slug: string): Promise<Collection | null> {
    const rows = await this.db
      .select()
      .from(collections)
      .where(eq(collections.slug, slug))
      .limit(1);
    return rows.length > 0 ? rows[0] : null;
  }

  async addMember(
    collectionSlug: string,
    userId: string,
    role: string,
    grantedBy: string,
  ): Promise<void> {
    const collection = await this.getBySlug(collectionSlug);
    if (!collection) throw new Error(`Collection '${collectionSlug}' not found`);

    const now = new Date().toISOString();
    await this.db.insert(collectionMemberships).values({
      id: `cm-${randomUUID()}`,
      collection_id: collection.id,
      user_id: userId,
      role,
      granted_by: grantedBy,
      granted_at: now,
    });
  }

  async removeMember(collectionSlug: string, userId: string): Promise<void> {
    const collection = await this.getBySlug(collectionSlug);
    if (!collection) throw new Error(`Collection '${collectionSlug}' not found`);

    // Prevent removing the owner of a personal collection
    if (collection.type === 'personal' && collection.owner_id === userId) {
      throw new Error('Cannot remove the owner of a personal collection');
    }

    await this.db
      .delete(collectionMemberships)
      .where(
        and(
          eq(collectionMemberships.collection_id, collection.id),
          eq(collectionMemberships.user_id, userId),
        ),
      );
  }

  async checkAccess(
    userId: string,
    _tokenId: string | null,
    collectionSlug: string,
    minRole: string,
  ): Promise<boolean> {
    const collection = await this.getBySlug(collectionSlug);
    if (!collection) return false;

    const rows = await this.db
      .select({ role: collectionMemberships.role })
      .from(collectionMemberships)
      .where(
        and(
          eq(collectionMemberships.collection_id, collection.id),
          eq(collectionMemberships.user_id, userId),
        ),
      )
      .limit(1);

    if (rows.length === 0) return false;

    const userLevel = ROLE_HIERARCHY[rows[0].role] ?? -1;
    const requiredLevel = ROLE_HIERARCHY[minRole] ?? 999;
    return userLevel >= requiredLevel;
  }

  async ensurePersonalCollection(userId: string, login: string): Promise<Collection> {
    const slug = `personal-${login}`;
    const existing = await this.getBySlug(slug);
    if (existing) return existing;

    return this.create(
      {
        slug,
        name: `${login}'s collection`,
        type: 'personal',
        ownerId: userId,
      },
      userId,
    );
  }

  async assignSystemCollections(userId: string): Promise<void> {
    const systemCollections = await this.db
      .select()
      .from(collections)
      .where(eq(collections.auto_assign, 1));

    const now = new Date().toISOString();
    for (const col of systemCollections) {
      // Check if membership already exists
      const existing = await this.db
        .select()
        .from(collectionMemberships)
        .where(
          and(
            eq(collectionMemberships.collection_id, col.id),
            eq(collectionMemberships.user_id, userId),
          ),
        )
        .limit(1);

      if (existing.length === 0) {
        await this.db.insert(collectionMemberships).values({
          id: `cm-${randomUUID()}`,
          collection_id: col.id,
          user_id: userId,
          role: 'reader',
          granted_by: 'system',
          granted_at: now,
        });
      }
    }
  }

  async getAccessibleSlugs(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ slug: collections.slug })
      .from(collections)
      .innerJoin(collectionMemberships, eq(collections.id, collectionMemberships.collection_id))
      .where(eq(collectionMemberships.user_id, userId));

    return rows.map((r) => r.slug);
  }

  async delete(slug: string, force: boolean): Promise<void> {
    const collection = await this.getBySlug(slug);
    if (!collection) throw new Error(`Collection '${slug}' not found`);

    // Check if collection has fragments
    const frags = await this.db
      .select({ id: fragments.id })
      .from(fragments)
      .where(like(fragments.file_path, `${collection.git_path}%`))
      .limit(1);

    if (frags.length > 0 && !force) {
      throw new Error('Collection is not empty. Use force=true to delete anyway.');
    }

    // Delete memberships
    await this.db
      .delete(collectionMemberships)
      .where(eq(collectionMemberships.collection_id, collection.id));

    // Delete collection
    await this.db.delete(collections).where(eq(collections.id, collection.id));

    // Note: git directory removal is intentionally skipped for safety.
    // Callers can handle filesystem cleanup separately if needed.
  }
}
