import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, like } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import {
  fragmentTags,
  fragmentDomains,
  fragmentFunctions,
  entities,
  fragmentEntities,
  fragments,
} from '../db/schema.js';
import { requireRole } from '../auth/middleware.js';
import {
  normalizeForComparison,
  getPreviewForTag,
  getPreviewForEntity,
  computeFlagsForTag,
  computeFlagsForEntity,
  computeCounts,
} from './admin-metadata-helpers.js';

export function adminMetadataRoutes(
  app: FastifyInstance,
  db: FragmintDb,
  authenticate: ReturnType<typeof import('../auth/middleware.js').buildAuthMiddleware>,
) {
  // GET /v1/admin/metadata/proposals
  app.get(
    '/v1/admin/metadata/proposals',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      const {
        kind,
        entity_type,
        search,
        trust_source,
        limit = 50,
        offset = 0,
      } = (request.query ?? {}) as {
        kind?: string;
        entity_type?: string;
        search?: string;
        trust_source?: string;
        limit?: number;
        offset?: number;
      };

      const proposals: any[] = [];

      if (!kind || kind === 'tag') {
        const conditions: any[] = [eq(fragmentTags.validated, 0)];
        if (search) conditions.push(like(fragmentTags.label, `%${search}%`));
        if (trust_source) conditions.push(eq(fragmentTags.trustSource, trust_source));
        const tags = await db
          .select()
          .from(fragmentTags)
          .where(and(...conditions))
          .limit(Number(limit))
          .offset(Number(offset));
        const cachedValidatedTags = await db
          .select({ slug: fragmentTags.slug, label: fragmentTags.label })
          .from(fragmentTags)
          .where(eq(fragmentTags.validated, 1));
        for (const tag of tags) {
          const preview = await getPreviewForTag(db, tag.slug);
          const flags = await computeFlagsForTag(db, tag, cachedValidatedTags);
          proposals.push({
            id: tag.slug,
            kind: 'tag',
            name: tag.slug,
            label: tag.label,
            usage_count: tag.usageCount,
            validated: !!tag.validated,
            proposed_by: tag.proposedBy,
            created_at: tag.created_at,
            trust_source: tag.trustSource ?? 'llm-inferred',
            preview,
            flags,
          });
        }
      }

      if (!kind || kind === 'domain') {
        const conditions: any[] = [eq(fragmentDomains.validated, 0)];
        if (search) conditions.push(like(fragmentDomains.label, `%${search}%`));
        if (trust_source) conditions.push(eq(fragmentDomains.trustSource, trust_source));
        const domains = await db
          .select()
          .from(fragmentDomains)
          .where(and(...conditions))
          .limit(Number(limit))
          .offset(Number(offset));
        for (const d of domains) {
          proposals.push({
            id: d.slug,
            kind: 'domain',
            name: d.slug,
            label: d.label,
            usage_count: d.usageCount ?? 0,
            validated: !!d.validated,
            proposed_by: d.proposedBy,
            created_at: d.created_at,
            trust_source: d.trustSource ?? 'llm-inferred',
            preview: null,
            flags: [],
          });
        }
      }

      if (!kind || kind === 'entity') {
        const conditions: any[] = [eq(entities.validated, 0)];
        if (entity_type) conditions.push(eq(entities.type, entity_type));
        if (search) conditions.push(like(entities.name, `%${search}%`));
        if (trust_source) conditions.push(eq(entities.trustSource, trust_source));
        const ents = await db
          .select()
          .from(entities)
          .where(and(...conditions))
          .limit(Number(limit))
          .offset(Number(offset));
        const cachedValidatedEntities = await db
          .select({
            type: entities.type,
            normalizedName: entities.normalizedName,
            canonicalName: entities.canonicalName,
          })
          .from(entities)
          .where(eq(entities.validated, 1));
        for (const ent of ents) {
          const preview = await getPreviewForEntity(db, ent.id);
          const flags = await computeFlagsForEntity(db, ent, cachedValidatedEntities);
          proposals.push({
            id: ent.id,
            kind: 'entity',
            name: ent.name,
            entity_type: ent.type,
            usage_count: ent.usageCount,
            validated: !!ent.validated,
            proposed_by: ent.proposedBy,
            created_at: ent.createdAt,
            trust_source: ent.trustSource ?? 'llm-inferred',
            preview,
            flags,
          });
        }
      }

      const counts = await computeCounts(db);
      return { data: { proposals, total: proposals.length, counts }, meta: null, error: null };
    },
  );

  // POST /v1/admin/metadata/proposals/:id/approve
  app.post(
    '/v1/admin/metadata/proposals/:id/approve',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z
        .object({ kind: z.enum(['tag', 'domain', 'entity']) })
        .safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
      const { kind } = parsed.data;
      if (kind === 'tag')
        await db.update(fragmentTags).set({ validated: 1 }).where(eq(fragmentTags.slug, id));
      else if (kind === 'domain')
        await db.update(fragmentDomains).set({ validated: 1 }).where(eq(fragmentDomains.slug, id));
      else
        await db
          .update(entities)
          .set({ validated: 1 })
          .where(eq(entities.id, Number(id)));
      return { success: true, id, kind };
    },
  );

  // POST /v1/admin/metadata/proposals/:id/reject
  app.post(
    '/v1/admin/metadata/proposals/:id/reject',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z
        .object({ kind: z.enum(['tag', 'domain', 'entity']) })
        .safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
      const { kind } = parsed.data;
      let affectedFragments = 0;

      if (kind === 'tag') {
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
        }
        affectedFragments = fragmentsUsing.length;
        await db.delete(fragmentTags).where(eq(fragmentTags.slug, id));
      } else if (kind === 'domain') {
        await db.delete(fragmentDomains).where(eq(fragmentDomains.slug, id));
      } else {
        await db.delete(entities).where(eq(entities.id, Number(id)));
      }
      return { success: true, rejected_id: id, affected_fragments: affectedFragments };
    },
  );

  // POST /v1/admin/metadata/proposals/:id/rename
  app.post(
    '/v1/admin/metadata/proposals/:id/rename',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z
        .object({
          kind: z.enum(['tag', 'domain', 'entity']),
          new_name: z.string(),
          new_label: z.string().optional(),
        })
        .safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
      const { kind, new_name, new_label } = parsed.data;

      if (kind === 'tag') {
        const fragmentsUsing = await db
          .select()
          .from(fragments)
          .where(like(fragments.tags, `%"${id}"%`));
        for (const f of fragmentsUsing) {
          const tagsArr = JSON.parse(f.tags ?? '[]').map((t: string) => (t === id ? new_name : t));
          await db
            .update(fragments)
            .set({ tags: JSON.stringify(tagsArr) })
            .where(eq(fragments.id, f.id));
        }
        await db
          .update(fragmentTags)
          .set({ slug: new_name, label: new_label ?? new_name, validated: 1 })
          .where(eq(fragmentTags.slug, id));
      } else if (kind === 'domain') {
        await db.update(fragments).set({ domain: new_name }).where(eq(fragments.domain, id));
        await db
          .update(fragmentDomains)
          .set({ slug: new_name, label: new_label ?? new_name, validated: 1 })
          .where(eq(fragmentDomains.slug, id));
      } else {
        await db
          .update(entities)
          .set({
            name: new_name,
            canonicalName: new_name,
            normalizedName: normalizeForComparison(new_name),
            validated: 1,
          })
          .where(eq(entities.id, Number(id)));
      }
      return { success: true, updated: { id: new_name, name: new_name } };
    },
  );

  // POST /v1/admin/metadata/proposals/:id/merge
  app.post(
    '/v1/admin/metadata/proposals/:id/merge',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z
        .object({ kind: z.enum(['tag', 'domain', 'entity']), target_id: z.string() })
        .safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
      const { kind, target_id } = parsed.data;
      let affectedFragments = 0;

      if (kind === 'tag') {
        const fragmentsUsing = await db
          .select()
          .from(fragments)
          .where(like(fragments.tags, `%"${id}"%`));
        for (const f of fragmentsUsing) {
          const newTags = [
            ...new Set(JSON.parse(f.tags ?? '[]').map((t: string) => (t === id ? target_id : t))),
          ];
          await db
            .update(fragments)
            .set({ tags: JSON.stringify(newTags) })
            .where(eq(fragments.id, f.id));
        }
        affectedFragments = fragmentsUsing.length;
        await db.delete(fragmentTags).where(eq(fragmentTags.slug, id));
      } else if (kind === 'entity') {
        await db
          .update(fragmentEntities)
          .set({ entity_id: Number(target_id) })
          .where(eq(fragmentEntities.entity_id, Number(id)));
        await db.delete(entities).where(eq(entities.id, Number(id)));
      }
      return { success: true, merged_into: target_id, affected_fragments: affectedFragments };
    },
  );

  // POST /v1/admin/metadata/proposals/:id/set-as-alias
  app.post(
    '/v1/admin/metadata/proposals/:id/set-as-alias',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ canonical_entity_id: z.number() }).safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
      const { canonical_entity_id } = parsed.data;

      const [proposal] = await db
        .select()
        .from(entities)
        .where(eq(entities.id, Number(id)));
      const [canonical] = await db
        .select()
        .from(entities)
        .where(eq(entities.id, canonical_entity_id));
      if (!proposal || !canonical) {
        return reply.status(404).send({ data: null, meta: null, error: 'Entity not found' });
      }
      const currentAliases = JSON.parse(canonical.aliases ?? '[]');
      await db
        .update(entities)
        .set({ aliases: JSON.stringify([...new Set([...currentAliases, proposal.name])]) })
        .where(eq(entities.id, canonical_entity_id));
      await db
        .update(fragmentEntities)
        .set({ entity_id: canonical_entity_id })
        .where(eq(fragmentEntities.entity_id, Number(id)));
      await db.delete(entities).where(eq(entities.id, Number(id)));
      return { success: true, canonical_entity: canonical };
    },
  );

  // POST /v1/admin/metadata/proposals/:id/reclassify-entity-type
  app.post(
    '/v1/admin/metadata/proposals/:id/reclassify-entity-type',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ new_type: z.string() }).safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
      const [old] = await db
        .select()
        .from(entities)
        .where(eq(entities.id, Number(id)));
      if (!old) {
        return reply.status(404).send({ data: null, meta: null, error: 'Entity not found' });
      }
      await db
        .update(entities)
        .set({ type: parsed.data.new_type })
        .where(eq(entities.id, Number(id)));
      return {
        success: true,
        updated: { id: Number(id), old_type: old.type, new_type: parsed.data.new_type },
      };
    },
  );

  // GET /v1/admin/metadata/validated — for merge/alias pickers in the UI
  app.get(
    '/v1/admin/metadata/validated',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      const { kind, entity_type } = (request.query ?? {}) as {
        kind?: string;
        entity_type?: string;
      };
      let rows: any[];
      if (kind === 'tag')
        rows = await db.select().from(fragmentTags).where(eq(fragmentTags.validated, 1));
      else if (kind === 'domain')
        rows = await db.select().from(fragmentDomains).where(eq(fragmentDomains.validated, 1));
      else {
        const conditions: any[] = [eq(entities.validated, 1)];
        if (entity_type) conditions.push(eq(entities.type, entity_type));
        rows = await db.select().from(entities).where(and(...conditions));
      }
      return { data: rows, meta: null, error: null };
    },
  );

  // GET /v1/admin/functions — publicly readable (used in contributor dropdowns)
  app.get('/v1/admin/functions', { preHandler: [authenticate] }, async () => {
    const rows = await db.select().from(fragmentFunctions).orderBy(fragmentFunctions.slug);
    return { data: rows, meta: { count: rows.length }, error: null };
  });

}
