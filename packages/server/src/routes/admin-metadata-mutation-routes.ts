import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, like } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import {
  fragmentTags,
  fragmentDomains,
  entities,
  fragmentEntities,
  fragments,
} from '../db/schema.js';
import { requireRole } from '../auth/middleware.js';
import { normalizeForComparison } from './admin-metadata-helpers.js';

export function adminMetadataMutationRoutes(
  app: FastifyInstance,
  db: FragmintDb,
  authenticate: ReturnType<typeof import('../auth/middleware.js').buildAuthMiddleware>,
) {
  // POST /v1/admin/metadata/proposals/:id/convert-to-entity
  // GOTCHA: better-sqlite3 doesn't support .returning() — insert then select back by unique key.
  app.post(
    '/v1/admin/metadata/proposals/:id/convert-to-entity',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z
        .object({
          entity_type: z.string(),
          canonical_name: z.string(),
          aliases: z.array(z.string()).default([]),
        })
        .safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
      const { entity_type, canonical_name, aliases } = parsed.data;
      const now = new Date().toISOString();

      await db
        .insert(entities)
        .values({
          type: entity_type,
          name: canonical_name,
          canonicalName: canonical_name,
          normalizedName: normalizeForComparison(canonical_name),
          aliases: JSON.stringify(aliases),
          validated: 1,
          proposedBy: 'admin',
          usageCount: 0,
          createdAt: now,
        })
        .onConflictDoNothing();
      const [newEntity] = await db
        .select()
        .from(entities)
        .where(and(eq(entities.canonicalName, canonical_name), eq(entities.type, entity_type)));

      if (!newEntity) {
        return reply.status(500).send({ data: null, meta: null, error: 'Entity creation failed' });
      }

      const fragmentsUsing = await db
        .select()
        .from(fragments)
        .where(like(fragments.tags, `%"${id}"%`));
      for (const f of fragmentsUsing) {
        const tagsArr = JSON.parse(f.tags ?? '[]').filter((t: string) => t !== id);
        await db
          .update(fragments)
          .set({ tags: JSON.stringify(tagsArr) })
          .where(eq(fragments.id, f.id));
        await db
          .insert(fragmentEntities)
          .values({ fragment_id: f.id, entity_id: newEntity.id })
          .onConflictDoNothing();
      }
      await db.delete(fragmentTags).where(eq(fragmentTags.slug, id));
      return {
        success: true,
        created_entity: newEntity,
        affected_fragments: fragmentsUsing.length,
      };
    },
  );

  // POST /v1/admin/metadata/bulk-action
  app.post(
    '/v1/admin/metadata/bulk-action',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      const { action, items } = request.body as {
        action: 'approve' | 'reject';
        items: Array<{ id: string | number; kind: 'tag' | 'domain' | 'entity' }>;
      };
      const results = [];
      for (const item of items) {
        try {
          if (item.kind === 'tag') {
            action === 'approve'
              ? await db
                  .update(fragmentTags)
                  .set({ validated: 1 })
                  .where(eq(fragmentTags.slug, String(item.id)))
              : await db.delete(fragmentTags).where(eq(fragmentTags.slug, String(item.id)));
          } else if (item.kind === 'domain') {
            action === 'approve'
              ? await db
                  .update(fragmentDomains)
                  .set({ validated: 1 })
                  .where(eq(fragmentDomains.slug, String(item.id)))
              : await db.delete(fragmentDomains).where(eq(fragmentDomains.slug, String(item.id)));
          } else {
            action === 'approve'
              ? await db
                  .update(entities)
                  .set({ validated: 1 })
                  .where(eq(entities.id, Number(item.id)))
              : await db.delete(entities).where(eq(entities.id, Number(item.id)));
          }
          results.push({ id: item.id, success: true });
        } catch (e: any) {
          results.push({ id: item.id, success: false, error: e.message });
        }
      }
      return { success: true, results };
    },
  );
}
