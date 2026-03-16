// packages/server/src/routes/fragment-routes.ts
import type { FastifyInstance } from 'fastify';
import { requireRole } from '../auth/middleware.js';
import { FragmentService } from '../services/fragment-service.js';
import { createFragmentSchema, updateFragmentSchema } from '../schema/fragment.js';
import { searchQuerySchema, inventoryQuerySchema } from '../schema/api.js';

export function fragmentRoutes(
  app: FastifyInstance,
  fragmentService: FragmentService,
  authenticate: ReturnType<typeof import('../auth/middleware.js').buildAuthMiddleware>,
  options?: {
    prefix?: string;
    collectionMiddleware?: any;
  },
) {
  const prefix = options?.prefix ?? '/v1';
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
  app.get(`${prefix}/fragments`, { preHandler: readHandlers }, async (request) => {
    const query = request.query as Record<string, string>;
    const collection = request.collection;
    const rows = await fragmentService.list({
      type: query.type, domain: query.domain, lang: query.lang, quality: query.quality,
      limit: query.limit ? parseInt(query.limit) : undefined,
      filePathPrefix: collection?.git_path,
    });
    return { data: rows, meta: { count: rows.length }, error: null };
  });

  // Get fragment by ID
  app.get(`${prefix}/fragments/:id`, { preHandler: readHandlers }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const frag = await fragmentService.getById(id);
    if (!frag) return reply.status(404).send({ data: null, meta: null, error: 'Fragment not found' });
    return { data: frag, meta: null, error: null };
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
  app.get(`${prefix}/fragments/:id/version/:commit`, { preHandler: readHandlers }, async (request) => {
    const { id, commit } = request.params as { id: string; commit: string };
    const frag = await fragmentService.getById(id);
    if (!frag) throw new Error('Fragment not found');
    const content = await fragmentService.getGit().show(commit, frag.file_path);
    return { data: { content, commit }, meta: null, error: null };
  });

  // Search
  app.post(`${prefix}/fragments/search`, { preHandler: readHandlers }, async (request) => {
    const parsed = searchQuerySchema.safeParse(request.body);
    if (!parsed.success) return { data: null, meta: null, error: parsed.error.message };
    const results = await fragmentService.search(parsed.data.query, parsed.data.filters, parsed.data.limit);
    return { data: results, meta: { count: results.length }, error: null };
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
    if (!parsed.success) return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    const result = await fragmentService.create(parsed.data, request.user.login, request.user.role, request.ip);
    return reply.status(201).send({ data: result, meta: null, error: null });
  });

  // Update
  app.put(`${prefix}/fragments/:id`, { preHandler: writeHandlers }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateFragmentSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    const result = await fragmentService.update(id, parsed.data, request.user.login, request.user.role, request.ip);
    return { data: result, meta: null, error: null };
  });

  // Review
  app.post(`${prefix}/fragments/:id/review`, { preHandler: writeHandlers }, async (request) => {
    const { id } = request.params as { id: string };
    const result = await fragmentService.update(id, { quality: 'reviewed' }, request.user.login, request.user.role, request.ip);
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

  // Lineage
  app.get(`${prefix}/fragments/:id/lineage`, { preHandler: readHandlers }, async (request) => {
    const { id } = request.params as { id: string };
    const lineage = await fragmentService.lineage(id);
    return { data: lineage, meta: null, error: null };
  });

  // Restore
  app.post(`${prefix}/fragments/:id/restore/:commit`, { preHandler: adminHandlers }, async (request) => {
    const { id, commit } = request.params as { id: string; commit: string };
    const frag = await fragmentService.getById(id);
    if (!frag) throw new Error('Fragment not found');
    await fragmentService.getGit().restore(commit, frag.file_path);
    return { data: { restored: true, commit }, meta: null, error: null };
  });
}
