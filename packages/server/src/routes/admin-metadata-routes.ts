import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, like, count } from 'drizzle-orm';
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
        limit = 50,
        offset = 0,
      } = (request.query ?? {}) as {
        kind?: string;
        entity_type?: string;
        search?: string;
        limit?: number;
        offset?: number;
      };

      const proposals: any[] = [];

      if (!kind || kind === 'tag') {
        const conditions: any[] = [eq(fragmentTags.validated, 0)];
        if (search) conditions.push(like(fragmentTags.label, `%${search}%`));
        const tags = await db
          .select()
          .from(fragmentTags)
          .where(and(...conditions))
          .limit(Number(limit))
          .offset(Number(offset));
        for (const tag of tags) {
          const preview = await getPreviewForTag(db, tag.slug);
          const flags = await computeFlagsForTag(db, tag);
          proposals.push({
            id: tag.slug,
            kind: 'tag',
            name: tag.slug,
            label: tag.label,
            usage_count: tag.usageCount,
            validated: !!tag.validated,
            proposed_by: tag.proposedBy,
            created_at: tag.created_at,
            preview,
            flags,
          });
        }
      }

      if (!kind || kind === 'domain') {
        const conditions: any[] = [eq(fragmentDomains.validated, 0)];
        if (search) conditions.push(like(fragmentDomains.label, `%${search}%`));
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
            preview: null,
            flags: [],
          });
        }
      }

      if (!kind || kind === 'entity') {
        const conditions: any[] = [eq(entities.validated, 0)];
        if (entity_type) conditions.push(eq(entities.type, entity_type));
        if (search) conditions.push(like(entities.name, `%${search}%`));
        const ents = await db
          .select()
          .from(entities)
          .where(and(...conditions))
          .limit(Number(limit))
          .offset(Number(offset));
        for (const ent of ents) {
          const preview = await getPreviewForEntity(db, ent.id);
          const flags = await computeFlagsForEntity(db, ent);
          proposals.push({
            id: ent.id,
            kind: 'entity',
            name: ent.name,
            entity_type: ent.type,
            usage_count: ent.usageCount,
            validated: !!ent.validated,
            proposed_by: ent.proposedBy,
            created_at: ent.createdAt,
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
        });
      const [newEntity] = await db
        .select()
        .from(entities)
        .where(and(eq(entities.canonicalName, canonical_name), eq(entities.type, entity_type)));

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

// --- Helpers ---

export function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function similarityRatio(a: string, b: string): number {
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1.0;
  const mat = Array.from({ length: shorter.length + 1 }, (_, j) =>
    Array.from({ length: longer.length + 1 }, (_, i) => (j === 0 ? i : i === 0 ? j : 0)),
  );
  for (let j = 1; j <= shorter.length; j++)
    for (let i = 1; i <= longer.length; i++)
      mat[j][i] =
        longer[i - 1] === shorter[j - 1]
          ? mat[j - 1][i - 1]
          : Math.min(mat[j][i - 1] + 1, mat[j - 1][i] + 1, mat[j - 1][i - 1] + 1);
  return (longer.length - mat[shorter.length][longer.length]) / longer.length;
}

async function getPreviewForTag(db: FragmintDb, slug: string): Promise<string> {
  const [row] = await db
    .select({ bodyExcerpt: fragments.body_excerpt })
    .from(fragments)
    .where(like(fragments.tags, `%"${slug}"%`))
    .limit(1);
  return (row?.bodyExcerpt ?? '').slice(0, 150);
}

async function getPreviewForEntity(db: FragmintDb, entityId: number): Promise<string> {
  const [row] = await db
    .select({ bodyExcerpt: fragments.body_excerpt })
    .from(fragments)
    .innerJoin(fragmentEntities, eq(fragmentEntities.fragment_id, fragments.id))
    .where(eq(fragmentEntities.entity_id, entityId))
    .limit(1);
  return (row?.bodyExcerpt ?? '').slice(0, 150);
}

async function computeFlagsForTag(
  db: FragmintDb,
  tag: { slug: string; usageCount: number; label: string },
): Promise<any[]> {
  const flags = [];
  if ((tag.usageCount ?? 0) < 3) flags.push({ type: 'info', label: 'Low usage' });
  const entityKeywords = ['cert', 'iso', 'rgpd', 'cnb', 'james', 'jmap', 'secnum'];
  if (entityKeywords.some((kw) => tag.slug.toLowerCase().includes(kw)))
    flags.push({ type: 'warning', label: 'Possibly entity', suggestion: 'Convert to entity' });
  const validatedTags = await db.select().from(fragmentTags).where(eq(fragmentTags.validated, 1));
  for (const vt of validatedTags) {
    if (similarityRatio(tag.slug, vt.slug) > 0.7 && tag.slug !== vt.slug) {
      flags.push({ type: 'info', label: `Similar to ${vt.slug}`, merge_target: vt.slug });
      break;
    }
  }
  return flags;
}

async function computeFlagsForEntity(
  db: FragmintDb,
  ent: { id: number; type: string; name: string; normalizedName: string },
): Promise<any[]> {
  const flags = [];
  const validatedEntities = await db
    .select()
    .from(entities)
    .where(and(eq(entities.type, ent.type), eq(entities.validated, 1)));
  for (const ve of validatedEntities) {
    if (similarityRatio(ent.normalizedName, ve.normalizedName) > 0.6) {
      flags.push({
        type: 'warning',
        label: `Canonical: ${ve.canonicalName}`,
        suggestion: `Set as alias of ${ve.canonicalName}`,
      });
      break;
    }
  }
  const typeKeywords: Record<string, string[]> = {
    technology: ['protocol', 'api', 'sdk', 'framework', 'james', 'jmap'],
    certification: ['cert', 'iso', 'rgpd', 'secnumcloud', 'hds'],
  };
  for (const [correctType, kws] of Object.entries(typeKeywords)) {
    if (ent.type !== correctType && kws.some((kw) => ent.name.toLowerCase().includes(kw))) {
      flags.push({
        type: 'warning',
        label: 'Wrong type?',
        suggestion: `Reclassify as ${correctType}`,
        reclassify_to: correctType,
      });
      break;
    }
  }
  return flags;
}

async function computeCounts(db: FragmintDb) {
  const tagCount = await db
    .select({ value: count() })
    .from(fragmentTags)
    .where(eq(fragmentTags.validated, 0));
  const entityCount = await db
    .select({ value: count() })
    .from(entities)
    .where(eq(entities.validated, 0));
  const domainCount = await db
    .select({ value: count() })
    .from(fragmentDomains)
    .where(eq(fragmentDomains.validated, 0));
  const entitiesByType = await db
    .select({ type: entities.type, value: count() })
    .from(entities)
    .where(eq(entities.validated, 0))
    .groupBy(entities.type);
  return {
    tags: tagCount[0]?.value ?? 0,
    entities: entityCount[0]?.value ?? 0,
    domains: domainCount[0]?.value ?? 0,
    entities_by_type: entitiesByType.reduce((acc: any, r) => ({ ...acc, [r.type]: r.value }), {}),
  };
}
