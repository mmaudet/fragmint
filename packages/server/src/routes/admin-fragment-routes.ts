// packages/server/src/routes/admin-fragment-routes.ts
import type { FastifyInstance } from 'fastify';
import { eq, and, or, desc, asc, like, count } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { fragments } from '../db/schema.js';
import { requireRole } from '../auth/middleware.js';
import type { buildAuthMiddleware } from '../auth/middleware.js';
import type { FragmentBulkService } from '../services/fragment-bulk-service.js';
import type { JobService } from '../services/job-service.js';

export function adminFragmentRoutes(
  app: FastifyInstance,
  db: FragmintDb,
  authenticate: ReturnType<typeof buildAuthMiddleware>,
  fragmentService: FragmentBulkService,
  jobService: JobService,
): void {
  const adminHandlers = [authenticate, requireRole('admin')];

  // ── GET /v1/admin/fragments ─────────────────────────────────────────
  app.get('/v1/admin/fragments', { preHandler: adminHandlers }, async (request, reply) => {
    const q = request.query as {
      quality?: string;
      domain?: string;
      type?: string;
      lang?: string;
      origin?: string;
      search?: string;
      sort?: string;
      limit?: string;
      offset?: string;
    };

    const limit = Math.max(1, Math.min(Number(q.limit) || 50, 200));
    const offset = Number(q.offset) || 0;

    const conditions = [];
    if (q.quality) conditions.push(eq(fragments.quality, q.quality));
    if (q.domain) conditions.push(eq(fragments.domain, q.domain));
    if (q.type) conditions.push(eq(fragments.type, q.type));
    if (q.lang) conditions.push(eq(fragments.lang, q.lang));
    if (q.origin) conditions.push(eq(fragments.origin, q.origin));
    if (q.search) {
      const pattern = `%${q.search}%`;
      conditions.push(or(like(fragments.title, pattern), like(fragments.body_excerpt, pattern), like(fragments.id, pattern)));
    }

    const where = conditions.length ? and(...conditions) : undefined;

    let orderBy;
    if (q.sort === 'date_asc') orderBy = asc(fragments.updated_at);
    else if (q.sort === 'title_asc') orderBy = asc(fragments.title);
    else if (q.sort === 'title_desc') orderBy = desc(fragments.title);
    else if (q.sort === 'usage_desc') orderBy = desc(fragments.uses);
    else orderBy = desc(fragments.updated_at);

    const [rows, [{ total }], statusCounts] = await Promise.all([
      db
        .select({
          id: fragments.id,
          title: fragments.title,
          body_excerpt: fragments.body_excerpt,
          domain: fragments.domain,
          type: fragments.type,
          lang: fragments.lang,
          quality: fragments.quality,
          origin: fragments.origin,
          tags: fragments.tags,
          uses: fragments.uses,
          author: fragments.author,
          created_at: fragments.created_at,
          updated_at: fragments.updated_at,
          payload_schema: fragments.payload_schema,
        })
        .from(fragments)
        .where(where)
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(fragments).where(where),
      // Stats always reflect global counts across all fragments (not filtered by current query)
      // — intentional: the stats bar gives a full-database overview, not a filtered view.
      db
        .select({ quality: fragments.quality, cnt: count() })
        .from(fragments)
        .groupBy(fragments.quality),
    ]);

    const byStatus = { draft: 0, reviewed: 0, approved: 0, deprecated: 0 };
    for (const row of statusCounts) {
      if (row.quality in byStatus) byStatus[row.quality as keyof typeof byStatus] = row.cnt;
    }

    const items = rows.map((r) => {
      let tags: string[] = [];
      if (r.tags) {
        try {
          tags = JSON.parse(r.tags) as string[];
        } catch {
          console.error(`[admin/fragments] malformed tags for fragment ${r.id}:`, r.tags);
        }
      }
      return { ...r, tags };
    });

    return reply.send({
      data: {
        items,
        pagination: {
          total,
          limit,
          offset,
          has_more: offset + limit < total,
        },
        stats: {
          total,
          by_status: byStatus,
        },
      },
      meta: null,
      error: null,
    });
  });

  // ── POST /v1/admin/fragments/bulk-archive ───────────────────────────
  app.post(
    '/v1/admin/fragments/bulk-archive',
    { preHandler: adminHandlers },
    async (request, reply) => {
      const { ids } = request.body as { ids: string[] };
      if (!Array.isArray(ids) || ids.length === 0) {
        return reply
          .status(400)
          .send({ data: null, meta: null, error: 'ids must be a non-empty array' });
      }
      const userLogin = (request.user as { login: string }).login;
      const job = await jobService.create('bulk_archive', ids.length, userLogin);
      reply.code(202).send({ data: { job_id: job.id }, meta: null, error: null });
      fragmentService
        .bulkDeprecate(ids, userLogin, request.ip, (done) => jobService.progress(job.id, done))
        .then(({ done, errors }) => jobService.complete(job.id, done, errors))
        .catch(() => jobService.fail(job.id));
    },
  );

  // ── POST /v1/admin/fragments/bulk-approve-all ────────────────────────
  // Approves ALL fragments with quality='reviewed' matching the given filters.
  // No IDs needed — the server resolves the full set server-side.
  app.post(
    '/v1/admin/fragments/bulk-approve-all',
    { preHandler: adminHandlers },
    async (request, reply) => {
      const q = request.query as {
        domain?: string;
        type?: string;
        lang?: string;
        origin?: string;
      };
      const userLogin = (request.user as { login: string }).login;

      const conditions: ReturnType<typeof eq>[] = [eq(fragments.quality, 'reviewed')];
      if (q.domain) conditions.push(eq(fragments.domain, q.domain));
      if (q.type) conditions.push(eq(fragments.type, q.type));
      if (q.lang) conditions.push(eq(fragments.lang, q.lang));
      if (q.origin) conditions.push(eq(fragments.origin, q.origin));

      const rows = await db
        .select({ id: fragments.id })
        .from(fragments)
        .where(and(...conditions));

      const ids = rows.map((r) => r.id);
      if (ids.length === 0) {
        return reply.send({ data: { job_id: null, count: 0 }, meta: null, error: null });
      }

      const job = await jobService.create('bulk_approve', ids.length, userLogin);
      reply.code(202).send({ data: { job_id: job.id, count: ids.length }, meta: null, error: null });
      fragmentService
        .bulkApprove(ids, userLogin, request.ip, (done) => jobService.progress(job.id, done))
        .then(({ done, errors }) => jobService.complete(job.id, done, errors))
        .catch(() => jobService.fail(job.id));
    },
  );
}
