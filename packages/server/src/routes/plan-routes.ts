import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireRole } from '../auth/middleware.js';
import type { PlanService } from '../services/plan-service.js';
import type { TemplateService } from '../services/template-service.js';
import {
  CreatePlanSchema,
  UpdatePlanSchema,
  GeneratePlanSchema,
  SectionSearchSchema,
  ExportPlanSchema,
} from '../schema/plan.js';
import { join } from 'node:path';

export function planRoutes(
  app: FastifyInstance,
  planService: PlanService,
  templateService: TemplateService,
  storePath: string,
  authenticate: ReturnType<typeof import('../auth/middleware.js').buildAuthMiddleware>,
  options?: { prefix?: string; collectionMiddleware?: any },
) {
  const prefix = options?.prefix ?? '/v1';
  const readHandlers = options?.collectionMiddleware
    ? [authenticate, options.collectionMiddleware]
    : [authenticate, requireRole('reader')];
  const writeHandlers = options?.collectionMiddleware
    ? [authenticate, options.collectionMiddleware]
    : [authenticate, requireRole('contributor')];

  // Helper: enforce that the caller is the plan owner or an admin.
  // Returns the plan if access is allowed, or null after sending an error response.
  async function requireOwnership(
    request: FastifyRequest,
    reply: FastifyReply,
    id: string,
  ) {
    const plan = await planService.get(id);
    if (!plan) {
      reply.status(404).send({ data: null, meta: null, error: 'Plan not found' });
      return null;
    }
    if (plan.owner !== request.user.login && request.user.role !== 'admin') {
      reply.status(403).send({ data: null, meta: null, error: 'Forbidden' });
      return null;
    }
    return plan;
  }

  // CREATE
  app.post(`${prefix}/plans`, { preHandler: writeHandlers }, async (request, reply) => {
    const parsed = CreatePlanSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    }
    const plan = await planService.create({
      title: parsed.data.title,
      owner: request.user.login,
      collection_slug: request.collection?.slug ?? null,
      spec_prompt: parsed.data.spec_prompt,
      filters: parsed.data.filters,
    });
    return reply.status(201).send({ data: plan, meta: null, error: null });
  });

  // LIST
  app.get(`${prefix}/plans`, { preHandler: readHandlers }, async (request) => {
    const plans = await planService.list({
      owner: request.user.login,
      collection_slug: request.collection?.slug,
    });
    return { data: plans, meta: { count: plans.length }, error: null };
  });

  // GET
  app.get(`${prefix}/plans/:id`, { preHandler: readHandlers }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const plan = await requireOwnership(request, reply, id);
    if (!plan) return;
    return { data: plan, meta: null, error: null };
  });

  // PATCH
  app.patch(`${prefix}/plans/:id`, { preHandler: writeHandlers }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpdatePlanSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    }
    if (!(await requireOwnership(request, reply, id))) return;
    const updated = await planService.update(id, parsed.data);
    return { data: updated, meta: null, error: null };
  });

  // DELETE
  app.delete(`${prefix}/plans/:id`, { preHandler: writeHandlers }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireOwnership(request, reply, id))) return;
    await planService.remove(id);
    return reply.status(204).send();
  });

  // ACTIONS
  app.post(`${prefix}/plans/:id/generate-plan`, { preHandler: writeHandlers }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = GeneratePlanSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    }
    if (!(await requireOwnership(request, reply, id))) return;
    const out = await planService.generatePlan(id, parsed.data);
    if (!out) return reply.status(404).send({ data: null, meta: null, error: 'Plan not found' });
    return { data: out, meta: null, error: null };
  });

  app.post(`${prefix}/plans/:id/validate-plan`, { preHandler: writeHandlers }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireOwnership(request, reply, id))) return;
    const out = await planService.validatePlan(id);
    if (!out) return reply.status(404).send({ data: null, meta: null, error: 'Plan not found' });
    return { data: out, meta: null, error: null };
  });

  app.post(
    `${prefix}/plans/:id/sections/:sectionId/search`,
    { preHandler: writeHandlers },
    async (request, reply) => {
      const { id, sectionId } = request.params as { id: string; sectionId: string };
      const parsed = SectionSearchSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
      }
      if (!(await requireOwnership(request, reply, id))) return;
      const out = await planService.searchSection(id, sectionId, parsed.data);
      if (!out) return reply.status(404).send({ data: null, meta: null, error: 'Plan or section not found' });
      return { data: out, meta: null, error: null };
    },
  );

  app.post(`${prefix}/plans/:id/validate-fragments`, { preHandler: writeHandlers }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireOwnership(request, reply, id))) return;
    const out = await planService.validateFragments(id);
    if (!out) return reply.status(404).send({ data: null, meta: null, error: 'Plan not found' });
    return { data: out, meta: null, error: null };
  });

  app.post(
    `${prefix}/plans/:id/sections/:sectionId/generate`,
    { preHandler: writeHandlers },
    async (request, reply) => {
      const { id, sectionId } = request.params as { id: string; sectionId: string };
      if (!(await requireOwnership(request, reply, id))) return;
      const out = await planService.generateSection(id, sectionId);
      if (!out) return reply.status(404).send({ data: null, meta: null, error: 'Plan or section not found' });
      return { data: out, meta: null, error: null };
    },
  );

  app.post(`${prefix}/plans/:id/assemble`, { preHandler: writeHandlers }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireOwnership(request, reply, id))) return;
    const out = await planService.assemble(id);
    if (!out) return reply.status(404).send({ data: null, meta: null, error: 'Plan not found' });
    return { data: out, meta: null, error: null };
  });

  // EXPORT
  app.post(`${prefix}/plans/:id/export`, { preHandler: writeHandlers }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ExportPlanSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    }

    const plan = await requireOwnership(request, reply, id);
    if (!plan) return;

    if (parsed.data.format === 'md') {
      const { content, filename } = await planService.exportMarkdown(id);
      return reply
        .type('text/markdown; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(content);
    }

    const styleId = parsed.data.style_template_id ?? plan.state.export_style_template_id;
    let stylePath: string | undefined;
    if (styleId) {
      const tpl = await templateService.getById(styleId);
      if (!tpl) {
        return reply.status(400).send({ data: null, meta: null, error: 'Style template not found' });
      }
      if (tpl.kind !== 'style_reference') {
        return reply.status(400).send({ data: null, meta: null, error: 'Template is not a style reference' });
      }
      stylePath = join(storePath, tpl.template_path);
    }
    const { content, filename } = await planService.exportDocx(id, { styleTemplatePath: stylePath });
    return reply
      .type('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(content);
  });
}
