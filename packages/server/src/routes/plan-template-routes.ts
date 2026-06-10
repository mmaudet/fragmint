import type { FastifyInstance } from 'fastify';
import { requireRole } from '../auth/middleware.js';
import type { PlanTemplateService } from '../services/plan-template-service.js';
import { CreatePlanTemplateSchema } from '../schema/plan-template.js';

export function planTemplateRoutes(
  app: FastifyInstance,
  service: PlanTemplateService,
  authenticate: ReturnType<typeof import('../auth/middleware.js').buildAuthMiddleware>,
  options?: { prefix?: string },
) {
  const prefix = options?.prefix ?? '/v1';
  const readerHandlers = [authenticate, requireRole('reader')];
  const adminHandlers = [authenticate, requireRole('admin')];

  app.get(`${prefix}/plan-templates`, { preHandler: readerHandlers }, async (request) => {
    const { status } = request.query as { status?: string };
    const items = await service.list(status);
    return { data: items, meta: { count: items.length }, error: null };
  });

  app.get(`${prefix}/plan-templates/:id`, { preHandler: readerHandlers }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const item = await service.getById(id);
    if (!item) return reply.status(404).send({ data: null, meta: null, error: 'Plan template not found' });
    return { data: item, meta: null, error: null };
  });

  app.post(`${prefix}/plan-templates`, { preHandler: adminHandlers }, async (request, reply) => {
    const parsed = CreatePlanTemplateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    }
    const item = await service.create(parsed.data);
    return reply.status(201).send({ data: item, meta: null, error: null });
  });
}
