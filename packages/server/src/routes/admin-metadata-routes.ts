import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, like, inArray, sql } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import {
  fragmentTags,
  fragmentTagLinks,
  fragmentDomains,
  fragmentFunctions,
  fragmentTypes,
  fragments,
  users,
} from '../db/schema.js';
import { requireRole } from '../auth/middleware.js';
import {
  getPreviewForTag,
  computeFlagsForTag,
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
        search,
        trust_source,
        sort = 'date',
        limit = 50,
        offset = 0,
      } = (request.query ?? {}) as {
        kind?: string;
        search?: string;
        trust_source?: string;
        sort?: string;
        limit?: number;
        offset?: number;
      };

      const proposals: any[] = [];

      if (!kind || kind === 'tag') {
        const conditions: any[] = [eq(fragmentTags.validated, 0)];
        if (search) conditions.push(like(fragmentTags.label, `%${search}%`));
        if (trust_source) conditions.push(eq(fragmentTags.trustSource, trust_source));
        const tags = await db
          .select({
            slug: fragmentTags.slug,
            label: fragmentTags.label,
            category: fragmentTags.category,
            created_at: fragmentTags.created_at,
            validated: fragmentTags.validated,
            proposedBy: fragmentTags.proposedBy,
            trustSource: fragmentTags.trustSource,
            status: fragmentTags.status,
            usageCount: sql<number>`(SELECT COUNT(*) FROM fragment_tag_links WHERE tag_slug = fragment_tags.slug)`,
          })
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

      if (sort === 'usage') {
        proposals.sort((a, b) => (b.usage_count ?? 0) - (a.usage_count ?? 0));
      } else if (sort === 'name') {
        proposals.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
      } else {
        proposals.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
      }

      const proposerNames = [
        ...new Set(proposals.map((p) => p.proposed_by).filter((n) => n && n !== 'llm-auto')),
      ];
      let roleMap: Record<string, string> = {};
      let displayMap: Record<string, string> = {};
      if (proposerNames.length > 0) {
        const userRows = await db
          .select({ login: users.login, role: users.role, display_name: users.display_name })
          .from(users)
          .where(inArray(users.login, proposerNames));
        roleMap = Object.fromEntries(userRows.map((r) => [r.login, r.role]));
        displayMap = Object.fromEntries(userRows.map((r) => [r.login, r.display_name ?? r.login]));
      }
      const proposalsWithRole = proposals.map((p) => ({
        ...p,
        proposed_by_role: p.proposed_by ? (roleMap[p.proposed_by] ?? null) : null,
        proposed_by_display: p.proposed_by ? (displayMap[p.proposed_by] ?? p.proposed_by) : null,
      }));

      const counts = await computeCounts(db);
      return {
        data: { proposals: proposalsWithRole, total: proposalsWithRole.length, counts },
        meta: null,
        error: null,
      };
    },
  );

  // POST /v1/admin/metadata/proposals/:id/approve
  app.post(
    '/v1/admin/metadata/proposals/:id/approve',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ kind: z.enum(['tag', 'domain']) }).safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
      const { kind } = parsed.data;
      const stripNew = (s: string) => s.replace(/^NEW:\s*/i, '').trim();
      if (kind === 'tag') {
        const cleanLabel = stripNew(id);
        await db
          .update(fragmentTags)
          .set({ validated: 1, status: 'active', label: cleanLabel })
          .where(eq(fragmentTags.slug, id));
      } else if (kind === 'domain') {
        const cleanLabel = stripNew(id);
        await db
          .update(fragmentDomains)
          .set({ validated: 1, status: 'active', label: cleanLabel })
          .where(eq(fragmentDomains.slug, id));
      }
      return { success: true, id, kind };
    },
  );

  // POST /v1/admin/metadata/proposals/:id/reject
  app.post(
    '/v1/admin/metadata/proposals/:id/reject',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ kind: z.enum(['tag', 'domain']) }).safeParse(request.body);
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
        await db.delete(fragmentTagLinks).where(eq(fragmentTagLinks.tag_slug, id));
        await db.delete(fragmentTags).where(eq(fragmentTags.slug, id));
      } else if (kind === 'domain') {
        await db.delete(fragmentDomains).where(eq(fragmentDomains.slug, id));
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
          kind: z.enum(['tag', 'domain']),
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
        .object({ kind: z.enum(['tag', 'domain']), target_id: z.string() })
        .safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
      const { kind, target_id } = parsed.data;
      let affectedFragments = 0;

      if (kind === 'tag') {
        // Read first (outside transaction — reads don't need atomicity)
        const fragmentsUsing = await db
          .select()
          .from(fragments)
          .where(like(fragments.tags, `%"${id}"%`));

        // Atomically update JSON, repoint links, delete source tag
        db.transaction((tx) => {
          for (const f of fragmentsUsing) {
            const newTags = [
              ...new Set(
                (JSON.parse(f.tags ?? '[]') as string[]).map((t: string) =>
                  t === id ? target_id : t,
                ),
              ),
            ];
            tx.update(fragments)
              .set({ tags: JSON.stringify(newTags) })
              .where(eq(fragments.id, f.id))
              .run();
          }
          tx.run(
            sql`INSERT OR IGNORE INTO fragment_tag_links (fragment_id, tag_slug) SELECT fragment_id, ${target_id} FROM fragment_tag_links WHERE tag_slug = ${id}`,
          );
          tx.delete(fragmentTagLinks).where(eq(fragmentTagLinks.tag_slug, id)).run();
          tx.delete(fragmentTags).where(eq(fragmentTags.slug, id)).run();
        });

        affectedFragments = fragmentsUsing.length;
      }
      return { success: true, merged_into: target_id, affected_fragments: affectedFragments };
    },
  );

  // GET /v1/admin/metadata/validated — for merge/alias pickers in the UI
  app.get(
    '/v1/admin/metadata/validated',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      const { kind } = (request.query ?? {}) as {
        kind?: string;
      };
      let rows: any[];
      if (kind === 'tag') {
        const raw = await db
          .select({
            slug: fragmentTags.slug,
            label: fragmentTags.label,
            category: fragmentTags.category,
            status: fragmentTags.status,
            validated: fragmentTags.validated,
            usageCount: sql<number>`(SELECT COUNT(*) FROM fragment_tag_links WHERE tag_slug = fragment_tags.slug)`,
          })
          .from(fragmentTags)
          .where(eq(fragmentTags.validated, 1));
        // Normalize: tags use `slug` as PK — expose it as `id` so the merge picker can use v.id
        rows = raw.map((r) => ({ ...r, id: r.slug, usage_count: r.usageCount }));
      } else if (kind === 'domain') {
        const raw = await db.select().from(fragmentDomains).where(eq(fragmentDomains.validated, 1));
        rows = raw.map((r) => ({ ...r, id: r.slug, usage_count: r.usageCount }));
      } else {
        rows = [];
      }
      return { data: rows, meta: null, error: null };
    },
  );

  // GET /v1/admin/functions — publicly readable (used in contributor dropdowns)
  app.get('/v1/admin/functions', { preHandler: [authenticate] }, async () => {
    const rows = await db.select().from(fragmentFunctions).orderBy(fragmentFunctions.slug);
    return { data: rows, meta: { count: rows.length }, error: null };
  });

  // GET /v1/admin/metadata/pending-count — lightweight badge counter
  app.get(
    '/v1/admin/metadata/pending-count',
    { preHandler: [authenticate, requireRole('admin')] },
    async () => {
      const [tagRows, domainRows, typeRows] = await Promise.all([
        db
          .select({ count: sql<number>`count(*)` })
          .from(fragmentTags)
          .where(eq(fragmentTags.status, 'pending')),
        db
          .select({ count: sql<number>`count(*)` })
          .from(fragmentDomains)
          .where(eq(fragmentDomains.status, 'pending')),
        db
          .select({ count: sql<number>`count(*)` })
          .from(fragmentTypes)
          .where(eq(fragmentTypes.status, 'pending')),
      ]);
      const tags = tagRows[0]?.count ?? 0;
      const domains = domainRows[0]?.count ?? 0;
      const types = typeRows[0]?.count ?? 0;
      return {
        data: {
          tags,
          domains,
          types,
          total: tags + domains + types,
        },
        meta: null,
        error: null,
      };
    },
  );
}
