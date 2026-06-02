// packages/server/src/routes/fragment-routes.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/middleware.js';
import { FragmentBulkService } from '../services/fragment-bulk-service.js';
import { JobService } from '../services/job-service.js';
import { createFragmentSchema, updateFragmentSchema } from '../schema/fragment.js';
import { searchQuerySchema, inventoryQuerySchema } from '../schema/api.js';
import { inArray } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { fragmentTypes, fragments } from '../db/schema.js';
import { getCurrentRetriever } from '../retrieval/factory.js';
import type { PlanFilters } from '../schema/plan.js';

export function fragmentRoutes(
  app: FastifyInstance,
  fragmentService: FragmentBulkService,
  authenticate: ReturnType<typeof import('../auth/middleware.js').buildAuthMiddleware>,
  options?: {
    prefix?: string;
    collectionMiddleware?: any;
    jobService?: JobService;
    db?: FragmintDb;
  },
) {
  const prefix = options?.prefix ?? '/v1';
  const jobService = options?.jobService;
  const db = options?.db;

  async function validateType(type: string): Promise<boolean> {
    if (!db) return true;
    const rows = await db.select({ slug: fragmentTypes.slug }).from(fragmentTypes);
    return rows.some((r) => r.slug === type);
  }
  const readHandlers = options?.collectionMiddleware
    ? [authenticate, options.collectionMiddleware]
    : [authenticate, requireRole('reader')];
  const writeHandlers = options?.collectionMiddleware
    ? [authenticate, options.collectionMiddleware]
    : [authenticate, requireRole('contributor')];
  const expertHandlers = options?.collectionMiddleware
    ? [authenticate, options.collectionMiddleware]
    : [authenticate, requireRole('expert')];
  const adminHandlers = options?.collectionMiddleware
    ? [authenticate, options.collectionMiddleware]
    : [authenticate, requireRole('admin')];

  // List fragments
  app.get(
    `${prefix}/fragments`,
    {
      preHandler: readHandlers,
      schema: {
        querystring: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            domain: { type: 'string' },
            lang: { type: 'string' },
            quality: { type: 'string' },
            limit: { type: 'string' },
            offset: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const query = request.query as Record<string, string>;
      const collection = request.collection;
      const { rows, total } = await fragmentService.list({
        type: query.type,
        domain: query.domain,
        lang: query.lang,
        quality: query.quality,
        limit: query.limit ? parseInt(query.limit) : undefined,
        offset: query.offset ? parseInt(query.offset) : undefined,
        collectionSlug: collection?.slug,
      });
      return { data: rows, meta: { count: rows.length, total }, error: null };
    },
  );

  // Export fragments as XLSX
  app.get(
    `${prefix}/fragments/export`,
    {
      preHandler: readHandlers,
      schema: {
        querystring: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            domain: { type: 'string' },
            lang: { type: 'string' },
            quality: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const query = request.query as Record<string, string>;
      const collection = request.collection;
      const { rows } = await fragmentService.list({
        type: query.type,
        domain: query.domain,
        lang: query.lang,
        quality: query.quality,
        collectionSlug: collection?.slug,
      });

      const { exportFragmentsToXlsx } = await import('../services/render-xlsx-export.js');
      const buffer = await exportFragmentsToXlsx(rows);

      return reply
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', 'attachment; filename="fragments-export.xlsx"')
        .send(buffer);
    },
  );

  // Get fragment by UUID or readable_id (e.g. LS-ref-003)
  app.get(`${prefix}/fragments/:id`, { preHandler: readHandlers }, async (request, reply) => {
    const { id } = request.params as { id: string };
    // Try UUID first, then fall back to readable_id lookup
    let frag = await fragmentService.getById(id);
    if (!frag && !id.startsWith('frag-')) {
      frag = await fragmentService.getByReadableId(id);
    }
    if (!frag)
      return reply.status(404).send({ data: null, meta: null, error: 'Fragment not found' });
    const data = {
      ...frag,
      tags: frag.tags
        ? typeof frag.tags === 'string'
          ? (JSON.parse(frag.tags) as string[])
          : frag.tags
        : [],
    };
    return { data, meta: null, error: null };
  });

  // Git history
  app.get(`${prefix}/fragments/:id/history`, { preHandler: readHandlers }, async (request) => {
    const { id } = request.params as { id: string };
    const history = await fragmentService.history(id);
    return { data: history, meta: null, error: null };
  });

  // Diff
  app.get(`${prefix}/fragments/:id/diff/:c1/:c2`, { preHandler: readHandlers }, async (request) => {
    const { id, c1, c2 } = request.params as { id: string; c1: string; c2: string };
    const frag = await fragmentService.getById(id);
    if (!frag) throw new Error('Fragment not found');
    const diff = await fragmentService.getGit().diff(c1, c2, frag.file_path);
    return { data: { diff }, meta: null, error: null };
  });

  // Version at commit
  app.get(
    `${prefix}/fragments/:id/version/:commit`,
    { preHandler: readHandlers },
    async (request) => {
      const { id, commit } = request.params as { id: string; commit: string };
      const frag = await fragmentService.getById(id);
      if (!frag) throw new Error('Fragment not found');
      const content = await fragmentService.getGit().show(commit, frag.file_path);
      return { data: { content, commit }, meta: null, error: null };
    },
  );

  // Search
  app.post(`${prefix}/fragments/search`, { preHandler: readHandlers }, async (request) => {
    const parsed = searchQuerySchema.safeParse(request.body);
    if (!parsed.success) return { data: null, meta: null, error: parsed.error.message };
    // Auto-apply valid_at=today to exclude expired/future fragments from search
    const filters = {
      ...parsed.data.filters,
      valid_at: new Date().toISOString().slice(0, 10),
    };

    // Use the active retrieval mode (vector-only / agentic-only / hybrid) when available.
    // PlanFilters supports domain[], lang, type (single), tags — advanced search filters
    // (quality_min, function_type, audience, maturity) are not forwarded to agentic/hybrid.
    const retriever = getCurrentRetriever();
    if (retriever && db) {
      const sectionFilters: PlanFilters = {
        domain: parsed.data.filters?.domain?.length ? parsed.data.filters.domain : undefined,
        lang: parsed.data.filters?.lang,
        type: parsed.data.filters?.type?.[0],
        tags: parsed.data.filters?.tags,
      };
      const retrieved = await retriever.searchForSection(
        { text: parsed.data.query, filters: sectionFilters, collectionSlug: null },
        parsed.data.limit,
      );
      if (retrieved.length > 0) {
        const ids = retrieved.map((r) => r.fragment_id);
        const rows = await db
          .select({
            id: fragments.id,
            type: fragments.type,
            domain: fragments.domain,
            lang: fragments.lang,
            author: fragments.author,
            uses: fragments.uses,
            updated_at: fragments.updated_at,
          })
          .from(fragments)
          .where(inArray(fragments.id, ids));
        const rowMap = new Map(rows.map((r) => [r.id, r]));
        const enriched = retrieved
          .map((r) => {
            const row = rowMap.get(r.fragment_id);
            if (!row) return null;
            return {
              id: r.fragment_id,
              score: r.score,
              title: r.title,
              body_excerpt: r.body_excerpt,
              quality: r.quality,
              type: row.type,
              domain: row.domain,
              lang: row.lang,
              author: row.author,
              uses: row.uses,
              updated_at: row.updated_at,
              score_breakdown: r.score_breakdown,
              justification: r.justification,
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);
        return { data: enriched, meta: { count: enriched.length }, error: null };
      }
    }

    // Fallback: vector-only path via FragmentService (also used when db not injected)
    const results = await fragmentService.search(parsed.data.query, filters, parsed.data.limit);
    return { data: results, meta: { count: results.length }, error: null };
  });

  // Facets (distinct domains + tags for autocomplete)
  app.get(`${prefix}/fragments/facets`, { preHandler: readHandlers }, async (request) => {
    const collection = request.collection;
    const facets = await fragmentService.facets(collection?.slug);
    return { data: facets, meta: null, error: null };
  });

  // Inventory
  app.post(`${prefix}/fragments/inventory`, { preHandler: readHandlers }, async (request) => {
    const parsed = inventoryQuerySchema.safeParse(request.body);
    if (!parsed.success) return { data: null, meta: null, error: parsed.error.message };
    const inventory = await fragmentService.inventory(parsed.data?.topic, parsed.data?.lang);
    return { data: inventory, meta: null, error: null };
  });

  // Create
  app.post(`${prefix}/fragments`, { preHandler: writeHandlers }, async (request, reply) => {
    const parsed = createFragmentSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    if (!(await validateType(parsed.data.type)))
      return reply
        .status(400)
        .send({ data: null, meta: null, error: `Invalid type '${parsed.data.type}'` });
    const collection = (request as any).collection;
    const result = await fragmentService.create(
      parsed.data,
      request.user.login,
      request.user.role,
      request.ip,
      collection?.git_path,
      collection?.slug,
    );
    return reply.status(201).send({ data: result, meta: null, error: null });
  });

  // Update
  app.put(`${prefix}/fragments/:id`, { preHandler: writeHandlers }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateFragmentSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    const result = await fragmentService.update(
      id,
      parsed.data,
      request.user.login,
      request.user.role,
      request.ip,
    );
    return { data: result, meta: null, error: null };
  });

  // Review
  app.post(`${prefix}/fragments/:id/review`, { preHandler: writeHandlers }, async (request) => {
    const { id } = request.params as { id: string };
    const result = await fragmentService.update(
      id,
      { quality: 'reviewed' },
      request.user.login,
      request.user.role,
      request.ip,
    );
    return { data: result, meta: null, error: null };
  });

  // Approve
  app.post(`${prefix}/fragments/:id/approve`, { preHandler: expertHandlers }, async (request) => {
    const { id } = request.params as { id: string };
    const result = await fragmentService.approve(id, request.user.login, request.ip);
    return { data: result, meta: null, error: null };
  });

  // Deprecate
  app.post(`${prefix}/fragments/:id/deprecate`, { preHandler: adminHandlers }, async (request) => {
    const { id } = request.params as { id: string };
    const result = await fragmentService.deprecate(id, request.user.login, request.ip);
    return { data: result, meta: null, error: null };
  });

  // Delete
  app.route({
    method: 'DELETE',
    url: `${prefix}/fragments/:id`,
    preHandler: adminHandlers,
    handler: async (request, reply) => {
      const params = request.params as Record<string, string>;
      const id = params.id;
      const result = await fragmentService.delete(id, request.user.login, request.ip);
      return reply.send({ data: result, meta: null, error: null });
    },
  });

  // Lineage
  app.get(`${prefix}/fragments/:id/lineage`, { preHandler: readHandlers }, async (request) => {
    const { id } = request.params as { id: string };
    const lineage = await fragmentService.lineage(id);
    return { data: lineage, meta: null, error: null };
  });

  // Restore
  app.post(
    `${prefix}/fragments/:id/restore/:commit`,
    { preHandler: adminHandlers },
    async (request) => {
      const { id, commit } = request.params as { id: string; commit: string };
      const frag = await fragmentService.getById(id);
      if (!frag) throw new Error('Fragment not found');
      await fragmentService.getGit().restore(commit, frag.file_path);
      return { data: { restored: true, commit }, meta: null, error: null };
    },
  );

  // Bulk review
  app.post(
    `${prefix}/fragments/bulk-review`,
    { preHandler: writeHandlers },
    async (request, reply) => {
      if (!jobService)
        return reply
          .status(501)
          .send({ data: null, meta: null, error: 'Job service not available' });
      const { ids } = request.body as { ids: string[] };
      if (!Array.isArray(ids) || ids.length === 0)
        return reply.status(400).send({ data: null, meta: null, error: 'ids required' });
      const job = await jobService.create('bulk_review', ids.length, request.user.login);
      reply.code(202).send({ data: { job_id: job.id }, meta: null, error: null });
      fragmentService
        .bulkReview(ids, request.user.login, request.ip, (done) =>
          jobService.progress(job.id, done),
        )
        .then(({ done, errors }) => jobService.complete(job.id, done, errors))
        .catch(() => jobService.fail(job.id));
    },
  );

  // Bulk delete
  app.post(
    `${prefix}/fragments/bulk-delete`,
    { preHandler: adminHandlers },
    async (request, reply) => {
      if (!jobService)
        return reply
          .status(501)
          .send({ data: null, meta: null, error: 'Job service not available' });
      const { ids } = request.body as { ids: string[] };
      if (!Array.isArray(ids) || ids.length === 0)
        return reply.status(400).send({ data: null, meta: null, error: 'ids required' });
      const job = await jobService.create('bulk_delete', ids.length, request.user.login);
      reply.code(202).send({ data: { job_id: job.id }, meta: null, error: null });
      fragmentService
        .bulkDelete(ids, request.user.login, request.ip, (done) =>
          jobService.progress(job.id, done),
        )
        .then(({ done, errors }) => jobService.complete(job.id, done, errors))
        .catch(() => jobService.fail(job.id));
    },
  );

  // Bulk delete own (contributor/expert — only deletes fragments authored by the requester, non-approved)
  app.post(
    `${prefix}/fragments/bulk-delete-own`,
    { preHandler: writeHandlers },
    async (request, reply) => {
      if (!jobService)
        return reply
          .status(501)
          .send({ data: null, meta: null, error: 'Job service not available' });
      const parseResult = z
        .object({ ids: z.array(z.string().min(1)).min(1) })
        .safeParse(request.body);
      if (!parseResult.success)
        return reply.status(400).send({ data: null, meta: null, error: 'ids required' });
      const { ids } = parseResult.data;
      const ownedIds = await fragmentService.filterOwnedIds(ids, request.user.login);
      if (ownedIds.length === 0)
        return reply.code(200).send({ data: { done: 0 }, meta: null, error: null });
      const job = await jobService.create('bulk_delete', ownedIds.length, request.user.login);
      reply.code(202).send({ data: { job_id: job.id }, meta: null, error: null });
      fragmentService
        .bulkDelete(
          ownedIds,
          request.user.login,
          request.ip,
          (done) => jobService.progress(job.id, done),
          (request.user as any).role ?? 'contributor',
        )
        .then(({ done, errors }) => jobService.complete(job.id, done, errors))
        .catch(() => jobService.fail(job.id));
    },
  );

  // Bulk approve
  app.post(
    `${prefix}/fragments/bulk-approve`,
    { preHandler: expertHandlers },
    async (request, reply) => {
      if (!jobService)
        return reply
          .status(501)
          .send({ data: null, meta: null, error: 'Job service not available' });
      const { ids } = request.body as { ids: string[] };
      if (!Array.isArray(ids) || ids.length === 0)
        return reply.status(400).send({ data: null, meta: null, error: 'ids required' });
      const job = await jobService.create('bulk_approve', ids.length, request.user.login);
      reply.code(202).send({ data: { job_id: job.id }, meta: null, error: null });
      fragmentService
        .bulkApprove(ids, request.user.login, request.ip, (done) =>
          jobService.progress(job.id, done),
        )
        .then(({ done, errors }) => jobService.complete(job.id, done, errors))
        .catch(() => jobService.fail(job.id));
    },
  );
}
