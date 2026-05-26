// packages/server/src/routes/admin-routes.ts
import type { FastifyInstance } from 'fastify';
import { requireRole } from '../auth/middleware.js';
import { UserService } from '../services/user-service.js';
import { TokenService } from '../services/token-service.js';
import { AuditService } from '../services/audit-service.js';
import { FragmentService } from '../services/fragment-service.js';
import { SearchService } from '../search/search-service.js';
import { z } from 'zod';
import { createUserSchema, createTokenSchema } from '../schema/api.js';
import { setRetrievalMode, getCurrentMode, type RetrievalMode } from '../retrieval/factory.js';

const patchUserSchema = z.object({
  role: z.enum(['reader', 'contributor', 'expert', 'admin']).optional(),
  display_name: z.string().min(1).optional(),
  active: z.number().int().min(0).max(1).optional(),
});

export function adminRoutes(
  app: FastifyInstance,
  userService: UserService,
  tokenService: TokenService,
  auditService: AuditService,
  fragmentService: FragmentService,
  authenticate: ReturnType<typeof import('../auth/middleware.js').buildAuthMiddleware>,
  searchService?: SearchService,
) {
  // Users
  app.get('/v1/users', { preHandler: [authenticate, requireRole('admin')] }, async () => {
    const users = await userService.list();
    return { data: users, meta: { count: users.length }, error: null };
  });

  app.post(
    '/v1/users',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const parsed = createUserSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
      const user = await userService.create(
        parsed.data.login,
        parsed.data.password,
        parsed.data.display_name,
        parsed.data.role,
        parsed.data.active,
      );
      return reply.status(201).send({ data: user, meta: null, error: null });
    },
  );

  app.patch(
    '/v1/users/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = patchUserSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
      const patch = parsed.data;
      const user = await userService.update(id, patch);
      if (!user) return reply.status(404).send({ data: null, meta: null, error: 'Not found' });
      return { data: user, meta: null, error: null };
    },
  );

  app.delete(
    '/v1/users/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      const { id } = request.params as { id: string };
      const result = await userService.delete(id);
      return { data: result, meta: null, error: null };
    },
  );

  // Tokens
  app.get('/v1/tokens', { preHandler: [authenticate, requireRole('admin')] }, async () => {
    const tokens = await tokenService.list();
    return { data: tokens, meta: { count: tokens.length }, error: null };
  });

  app.post(
    '/v1/tokens',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const parsed = createTokenSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
      const token = await tokenService.create(
        parsed.data.name,
        parsed.data.role,
        request.user.login,
      );
      return reply.status(201).send({ data: token, meta: null, error: null });
    },
  );

  app.delete(
    '/v1/tokens/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      const { id } = request.params as { id: string };
      await tokenService.revoke(id);
      return { data: { revoked: true }, meta: null, error: null };
    },
  );

  // Audit
  app.get('/v1/audit', { preHandler: [authenticate, requireRole('admin')] }, async (request) => {
    const query = request.query as Record<string, string>;
    const logs = await auditService.query({ from: query.from, to: query.to });
    return { data: logs, meta: { count: logs.length }, error: null };
  });

  // Index
  app.post('/v1/index/trigger', { preHandler: [authenticate, requireRole('admin')] }, async () => {
    const result = await fragmentService.reindex();
    return { data: result, meta: null, error: null };
  });

  app.get('/v1/index/status', { preHandler: [authenticate, requireRole('admin')] }, async () => {
    let mode: 'milvus' | 'sqlite' = 'sqlite';
    let milvus = false;
    let embedding = false;
    if (searchService) {
      try {
        const status = await searchService.status();
        mode = status.mode;
        milvus = status.milvus;
        embedding = status.embedding;
      } catch {
        /* fallback to defaults */
      }
    }
    return {
      data: { status: 'ok', mode, milvus, embedding, retrieval_mode: getCurrentMode(), last_run: new Date().toISOString() },
      meta: null,
      error: null,
    };
  });

  app.get(
    '/v1/admin/retrieval/mode',
    { preHandler: [authenticate, requireRole('admin')] },
    async (_req, reply) => {
      return reply.send({ data: { mode: getCurrentMode() }, meta: null, error: null });
    },
  );

  app.post(
    '/v1/admin/retrieval/mode',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const retrievalModeSchema = z.object({
        mode: z.enum(['vector-only', 'agentic-only', 'hybrid']),
      });
      const parsed = retrievalModeSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
      const retriever = setRetrievalMode(parsed.data.mode as RetrievalMode);
      return reply.send({
        data: { mode: parsed.data.mode, retriever_type: retriever.constructor.name },
        meta: null,
        error: null,
      });
    },
  );
}
