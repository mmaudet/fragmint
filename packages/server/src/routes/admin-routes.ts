// packages/server/src/routes/admin-routes.ts
import type { FastifyInstance } from 'fastify';
import { requireRole } from '../auth/middleware.js';
import { UserService } from '../services/user-service.js';
import { TokenService } from '../services/token-service.js';
import { AuditService } from '../services/audit-service.js';
import { FragmentService } from '../services/fragment-service.js';
import { createUserSchema, createTokenSchema } from '../schema/api.js';

export function adminRoutes(
  app: FastifyInstance,
  userService: UserService,
  tokenService: TokenService,
  auditService: AuditService,
  fragmentService: FragmentService,
  authenticate: ReturnType<typeof import('../auth/middleware.js').buildAuthMiddleware>,
) {
  // Users
  app.get('/v1/users', { preHandler: [authenticate, requireRole('admin')] }, async () => {
    const users = await userService.list();
    return { data: users, meta: { count: users.length }, error: null };
  });

  app.post('/v1/users', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    const user = await userService.create(parsed.data.login, parsed.data.password, parsed.data.display_name, parsed.data.role);
    return reply.status(201).send({ data: user, meta: null, error: null });
  });

  // Tokens
  app.get('/v1/tokens', { preHandler: [authenticate, requireRole('admin')] }, async () => {
    const tokens = await tokenService.list();
    return { data: tokens, meta: { count: tokens.length }, error: null };
  });

  app.post('/v1/tokens', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const parsed = createTokenSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    const token = await tokenService.create(parsed.data.name, parsed.data.role, request.user.login);
    return reply.status(201).send({ data: token, meta: null, error: null });
  });

  app.delete('/v1/tokens/:id', { preHandler: [authenticate, requireRole('admin')] }, async (request) => {
    const { id } = request.params as { id: string };
    await tokenService.revoke(id);
    return { data: { revoked: true }, meta: null, error: null };
  });

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
    return { data: { status: 'ok', last_run: new Date().toISOString() }, meta: null, error: null };
  });
}
