import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireRole } from '../auth/middleware.js';
import {
  createSearchJob,
  resolveSearchJob,
  failSearchJob,
  getSearchJob,
  deleteSearchJob,
} from './plan-search-jobs.js';
import type { PlanAssembler } from '../services/plan-assembler.js';
import type { TemplateService } from '../services/template-service.js';
import type { HarvesterService } from '../services/harvester-service.js';
import type { PlanTemplateService } from '../services/plan-template-service.js';
import {
  CreatePlanSchema,
  UpdatePlanSchema,
  GeneratePlanSchema,
  SectionSearchSchema,
  ExportPlanSchema,
  AddFragmentToSectionSchema,
} from '../schema/plan.js';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

export function planRoutes(
  app: FastifyInstance,
  planService: PlanAssembler,
  templateService: TemplateService,
  storePath: string,
  authenticate: ReturnType<typeof import('../auth/middleware.js').buildAuthMiddleware>,
  options?: { prefix?: string; collectionMiddleware?: any; harvesterService?: HarvesterService; planTemplateService?: PlanTemplateService },
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
  async function requireOwnership(request: FastifyRequest, reply: FastifyReply, id: string) {
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
    if (parsed.data.template_id) {
      const planTemplateService = options?.planTemplateService;
      if (!planTemplateService) {
        return reply.status(503).send({ data: null, meta: null, error: 'Plan template service unavailable' });
      }
      const template = await planTemplateService.getById(parsed.data.template_id);
      if (!template) {
        return reply.status(404).send({ data: null, meta: null, error: 'Plan template not found' });
      }
      const plan = await planService.createFromTemplate(template, {
        title: parsed.data.title,
        owner: request.user.login,
        collection_slug: request.collection?.slug ?? null,
        spec_prompt: parsed.data.spec_prompt,
        filters: parsed.data.filters,
      });
      return reply.status(201).send({ data: plan, meta: null, error: null });
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
      owner: request.user.role === 'admin' ? undefined : request.user.login,
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

  // ADD REFERENCE DOC
  app.post(
    `${prefix}/plans/:id/add-reference`,
    { preHandler: writeHandlers },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const plan = await requireOwnership(request, reply, id);
      if (!plan) return;

      const contentType = request.headers['content-type'] ?? '';

      if (contentType.includes('multipart/form-data')) {
        const execFileAsync = promisify(execFile);

        let filename = 'document';
        let fileBuffer: Buffer | null = null;

        const parts = request.parts();
        for await (const part of parts) {
          if (part.type === 'file') {
            const buffers: Buffer[] = [];
            for await (const chunk of part.file) buffers.push(chunk);
            fileBuffer = Buffer.concat(buffers);
            filename = part.filename ?? 'document';
          }
        }

        if (!fileBuffer) {
          return reply.status(400).send({ data: null, meta: null, error: 'No file provided' });
        }

        const ext = filename.split('.').pop()?.toLowerCase();
        let content: string;

        if (ext === 'md' || ext === 'txt') {
          content = fileBuffer.toString('utf-8');
        } else {
          const tempDir = join(tmpdir(), 'fragmint-ref');
          mkdirSync(tempDir, { recursive: true });
          const tempFile = join(tempDir, `${randomUUID()}.${ext ?? 'docx'}`);
          writeFileSync(tempFile, fileBuffer);
          try {
            const { stdout } = await execFileAsync('pandoc', [
              '--from', ext === 'docx' ? 'docx' : 'markdown',
              '--to', 'plain',
              tempFile,
            ]);
            content = stdout;
          } catch (err) {
            try { unlinkSync(tempFile); } catch { /* ignore */ }
            return reply.status(400).send({ data: null, meta: null, error: 'Text extraction failed: ' + (err instanceof Error ? err.message : String(err)) });
          } finally {
            try { unlinkSync(tempFile); } catch { /* ignore */ }
          }
        }

        const updated = await planService.addReferenceDoc(id, { name: filename, content });
        return reply.send({ data: updated, meta: null, error: null, harvest_prompt: 'Ce document est-il réutilisable pour d\'autres plans ? Si oui, appelez plan_harvest_reference pour en extraire des fragments réutilisables (domaine, langue et tags du plan appliqués automatiquement).' });
      } else {
        const body = request.body as { name?: string; content?: string };
        if (!body?.content) {
          return reply.status(400).send({ data: null, meta: null, error: 'content is required' });
        }
        const name = body.name ?? 'document';
        const updated = await planService.addReferenceDoc(id, { name, content: body.content });
        return reply.send({ data: updated, meta: null, error: null, harvest_prompt: 'Ce document est-il réutilisable pour d\'autres plans ? Si oui, appelez plan_harvest_reference pour en extraire des fragments réutilisables (domaine, langue et tags du plan appliqués automatiquement).' });
      }
    },
  );

  // ADD REFERENCE DOC TO SECTION
  app.post(
    `${prefix}/plans/:id/sections/:sectionId/add-reference`,
    { preHandler: writeHandlers },
    async (request, reply) => {
      const { id, sectionId } = request.params as { id: string; sectionId: string };
      const plan = await requireOwnership(request, reply, id);
      if (!plan) return;

      const section = plan.state.sections.find((s) => s.id === sectionId);
      if (!section) {
        return reply.status(404).send({ data: null, meta: null, error: 'Section not found' });
      }

      const contentType = request.headers['content-type'] ?? '';

      if (contentType.includes('multipart/form-data')) {
        const execFileAsync = promisify(execFile);
        let filename = 'document';
        let fileBuffer: Buffer | null = null;

        const parts = request.parts();
        for await (const part of parts) {
          if (part.type === 'file') {
            const buffers: Buffer[] = [];
            for await (const chunk of part.file) buffers.push(chunk);
            fileBuffer = Buffer.concat(buffers);
            filename = part.filename ?? 'document';
          }
        }

        if (!fileBuffer) {
          return reply.status(400).send({ data: null, meta: null, error: 'No file provided' });
        }

        const ext = filename.split('.').pop()?.toLowerCase();
        let content: string;

        if (ext === 'md' || ext === 'txt') {
          content = fileBuffer.toString('utf-8');
        } else {
          const tempDir = join(tmpdir(), 'fragmint-ref');
          mkdirSync(tempDir, { recursive: true });
          const tempFile = join(tempDir, `${randomUUID()}.${ext ?? 'docx'}`);
          writeFileSync(tempFile, fileBuffer);
          try {
            const { stdout } = await execFileAsync('pandoc', [
              '--from', ext === 'docx' ? 'docx' : 'markdown',
              '--to', 'plain',
              tempFile,
            ]);
            content = stdout;
          } catch (err) {
            try { unlinkSync(tempFile); } catch { /* ignore */ }
            return reply.status(400).send({ data: null, meta: null, error: 'Text extraction failed: ' + (err instanceof Error ? err.message : String(err)) });
          } finally {
            try { unlinkSync(tempFile); } catch { /* ignore */ }
          }
        }

        const updated = await planService.addSectionReferenceDoc(id, sectionId, { name: filename, content });
        return reply.send({ data: updated, meta: null, error: null, harvest_prompt: 'Ce document est-il réutilisable pour d\'autres plans ? Si oui, appelez plan_harvest_reference pour en extraire des fragments réutilisables (domaine, langue et tags du plan appliqués automatiquement).' });
      } else {
        const body = request.body as { name?: string; content?: string };
        if (!body?.content) {
          return reply.status(400).send({ data: null, meta: null, error: 'content is required' });
        }
        const name = body.name ?? 'document';
        const updated = await planService.addSectionReferenceDoc(id, sectionId, { name, content: body.content });
        return reply.send({ data: updated, meta: null, error: null, harvest_prompt: 'Ce document est-il réutilisable pour d\'autres plans ? Si oui, appelez plan_harvest_reference pour en extraire des fragments réutilisables (domaine, langue et tags du plan appliqués automatiquement).' });
      }
    },
  );

  // ACTIONS
  app.post(
    `${prefix}/plans/:id/generate-plan`,
    { preHandler: writeHandlers },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = GeneratePlanSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
      }
      if (!(await requireOwnership(request, reply, id))) return;
      const out = await planService.generatePlan(id);
      if (!out) return reply.status(404).send({ data: null, meta: null, error: 'Plan not found' });
      return { data: out, meta: null, error: null };
    },
  );

  app.post(
    `${prefix}/plans/:id/validate-plan`,
    { preHandler: writeHandlers },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!(await requireOwnership(request, reply, id))) return;
      const out = await planService.validatePlan(id);
      if (!out) return reply.status(404).send({ data: null, meta: null, error: 'Plan not found' });
      return { data: out, meta: null, error: null };
    },
  );

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
      if (!out)
        return reply
          .status(404)
          .send({ data: null, meta: null, error: 'Plan or section not found' });
      return { data: out, meta: null, error: null };
    },
  );

  // SEARCH ALL SECTIONS (batch)
  app.post(
    `${prefix}/plans/:id/search-all-sections`,
    { preHandler: writeHandlers },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!(await requireOwnership(request, reply, id))) return;
      const body = (request.body ?? {}) as { top_k?: number };
      const out = await planService.searchAllSections(id, { top_k: body.top_k });
      if (!out) return reply.status(404).send({ data: null, meta: null, error: 'Plan not found' });
      return { data: out, meta: null, error: null };
    },
  );

  // SEARCH ALL SECTIONS (async — MCP-friendly, avoids 60s tool call timeout)
  app.post(
    `${prefix}/plans/:id/search-all-sections-async`,
    { preHandler: writeHandlers },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!(await requireOwnership(request, reply, id))) return;
      const body = (request.body ?? {}) as { top_k?: number };
      const plan = await planService.get(id);
      if (!plan) return reply.status(404).send({ data: null, meta: null, error: 'Plan not found' });
      const validatedStatuses = ['plan_validated', 'fragments_validated', 'completed'];
      if (!validatedStatuses.includes(plan.status)) {
        return reply.status(409).send({ data: null, meta: null, error: 'Outline must be validated first. Call plan_validate_outline.' });
      }
      const jobId = createSearchJob(id);
      planService.searchAllSections(id, { top_k: body.top_k })
        .then(() => resolveSearchJob(jobId))
        .catch((err: unknown) => failSearchJob(jobId, String(err)));
      return reply.status(202).send({
        data: { job_id: jobId, total_sections: plan.state.sections.length },
        meta: null,
        error: null,
      });
    },
  );

  // SEARCH STATUS (poll for async search job)
  app.get(
    `${prefix}/plans/:id/search-status`,
    { preHandler: writeHandlers },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { job_id } = request.query as { job_id?: string };
      if (!job_id) return reply.status(400).send({ data: null, meta: null, error: 'job_id required' });
      const job = getSearchJob(job_id);
      if (!job || job.planId !== id) return reply.status(404).send({ data: null, meta: null, error: 'Job not found' });
      if (job.status === 'done') {
        const updated = await planService.get(id);
        return { data: { status: 'done', plan: updated }, meta: null, error: null };
      }
      if (job.status === 'error') {
        return reply.status(500).send({ data: { status: 'error' }, meta: null, error: job.error ?? 'Search failed' });
      }
      return { data: { status: 'running' }, meta: null, error: null };
    },
  );

  // APPROVE FRAGMENTS (move candidates to selected, with optional exclusions)
  app.post(
    `${prefix}/plans/:id/approve-fragments`,
    { preHandler: writeHandlers },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!(await requireOwnership(request, reply, id))) return;
      const body = (request.body ?? {}) as { exclusions?: { section_id: string; exclude_ids: string[] }[] };
      const out = await planService.approveFragments(id, body.exclusions ?? []);
      if (!out) return reply.status(404).send({ data: null, meta: null, error: 'Plan not found' });
      return { data: out, meta: null, error: null };
    },
  );

  // GENERATE ALL SECTIONS (batch — sequential LLM calls + assemble)
  app.post(
    `${prefix}/plans/:id/generate-all-sections`,
    { preHandler: writeHandlers },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!(await requireOwnership(request, reply, id))) return;
      const out = await planService.generateAllSections(id);
      if (!out) return reply.status(404).send({ data: null, meta: null, error: 'Plan not found' });
      return { data: out, meta: null, error: null };
    },
  );

  app.post(
    `${prefix}/plans/:id/sections/:sectionId/add-fragment`,
    { preHandler: writeHandlers },
    async (request, reply) => {
      const { id, sectionId } = request.params as { id: string; sectionId: string };
      const parsed = AddFragmentToSectionSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
      }
      if (!(await requireOwnership(request, reply, id))) return;
      const collection = (request as any).collection;
      const out = await planService.addFragmentToSection(
        id,
        sectionId,
        parsed.data,
        request.user.login,
        request.user.role,
        request.ip,
        collection?.git_path,
      );
      if (!out) {
        return reply
          .status(404)
          .send({ data: null, meta: null, error: 'Plan, section or fragment not found' });
      }
      return { data: out, meta: null, error: null };
    },
  );

  app.patch(
    `${prefix}/plans/:id/sections/:sectionId/fragment-edit`,
    { preHandler: writeHandlers },
    async (request, reply) => {
      const { id, sectionId } = request.params as { id: string; sectionId: string };
      const plan = await requireOwnership(request, reply, id);
      if (!plan) return;
      const body = request.body as { fragment_id?: string; body?: string };
      if (!body?.fragment_id || typeof body.body !== 'string') {
        return reply
          .status(400)
          .send({ data: null, meta: null, error: 'fragment_id and body are required' });
      }
      const updated = await planService.editSectionFragment(id, sectionId, body.fragment_id, body.body);
      if (!updated) return reply.status(404).send({ data: null, meta: null, error: 'Not found' });
      return reply.send({ data: updated, meta: null, error: null });
    },
  );

  app.post(
    `${prefix}/plans/:id/validate-fragments`,
    { preHandler: writeHandlers },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!(await requireOwnership(request, reply, id))) return;
      const out = await planService.validateFragments(id);
      if (!out) return reply.status(404).send({ data: null, meta: null, error: 'Plan not found' });
      return { data: out, meta: null, error: null };
    },
  );

  app.post(
    `${prefix}/plans/:id/sections/:sectionId/generate`,
    { preHandler: writeHandlers },
    async (request, reply) => {
      const { id, sectionId } = request.params as { id: string; sectionId: string };
      if (!(await requireOwnership(request, reply, id))) return;
      const body = (request.body ?? {}) as { constraint?: string };
      const constraint = typeof body.constraint === 'string' && body.constraint.trim() ? body.constraint.trim() : undefined;
      const out = await planService.generateSection(id, sectionId, constraint);
      if (!out)
        return reply
          .status(404)
          .send({ data: null, meta: null, error: 'Plan or section not found' });
      return { data: out, meta: null, error: null };
    },
  );

  app.post(
    `${prefix}/plans/:id/assemble`,
    { preHandler: writeHandlers },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!(await requireOwnership(request, reply, id))) return;
      const out = await planService.assemble(id);
      if (!out) return reply.status(404).send({ data: null, meta: null, error: 'Plan not found' });
      return { data: out, meta: null, error: null };
    },
  );

  // HARVEST REFERENCE DOCS
  app.post(
    `${prefix}/plans/:id/harvest-reference`,
    { preHandler: writeHandlers },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const plan = await requireOwnership(request, reply, id);
      if (!plan) return;

      const harvester = options?.harvesterService;
      if (!harvester) {
        return reply.status(501).send({ data: null, meta: null, error: 'Harvester not available' });
      }

      const referenceDocs = plan.state.reference_docs ?? [];
      if (referenceDocs.length === 0) {
        return reply
          .status(400)
          .send({ data: null, meta: null, error: 'No reference documents attached to this plan' });
      }

      const body = (request.body ?? {}) as { min_confidence?: number; domain?: string; lang?: string; tags?: string[]; collection_slug?: string };
      const minConfidence = typeof body.min_confidence === 'number' ? body.min_confidence : 0.65;
      const targetCollection = body.collection_slug ?? plan.collection_slug ?? 'common';

      // Build upload hints — body overrides take precedence over plan filters
      const filters = plan.state.filters;
      const uploadHints = {
        domain: body.domain ?? (Array.isArray(filters.domain) ? filters.domain[0] : filters.domain),
        tags: body.tags ?? filters.tags,
        lang: body.lang ?? filters.lang,
      };

      // Submit each reference doc as a markdown buffer to the harvester
      const jobIds: string[] = [];
      for (const doc of referenceDocs) {
        const buffer = Buffer.from(doc.content, 'utf-8');
        const filename = doc.name.endsWith('.md') ? doc.name : `${doc.name}.md`;
        const jobId = await harvester.harvest(
          [buffer],
          [filename],
          { min_confidence: minConfidence },
          request.user.login,
          targetCollection,
          uploadHints,
        );
        jobIds.push(jobId);
      }

      return reply.status(202).send({
        data: { job_ids: jobIds, count: jobIds.length, collection_slug: targetCollection },
        meta: null,
        error: null,
      });
    },
  );

  // EXPORT
  app.post(`${prefix}/plans/:id/export`, { preHandler: writeHandlers }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ExportPlanSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    }

    const plan = await requireOwnership(request, reply, id);
    if (!plan) return;

    try {
      if (parsed.data.format === 'md') {
        const { content, filename } = await planService.exportMarkdown(id);
        return reply
          .type('text/markdown; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="${filename}"`)
          .send(content);
      }

      if (parsed.data.format === 'pptx') {
        const pptxStyleId = parsed.data.style_template_id ?? plan.state.export_style_template_id;
        let pptxStylePath: string | undefined;
        if (pptxStyleId) {
          const tpl = await templateService.getById(pptxStyleId);
          if (tpl?.kind === 'style_reference') {
            pptxStylePath = join(storePath, tpl.template_path);
          }
        }
        const { content, filename } = await planService.exportPptx(id, {
          styleTemplatePath: pptxStylePath,
        });
        return reply
          .type('application/vnd.openxmlformats-officedocument.presentationml.presentation')
          .header('Content-Disposition', `attachment; filename="${filename}"`)
          .send(content);
      }

      if (parsed.data.format === 'slides') {
        const { content, filename } = await planService.exportSlides(id, {
          marpTheme: parsed.data.marp_theme,
        });
        return reply
          .type('text/html; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="${filename}"`)
          .send(content);
      }

      if (parsed.data.format === 'reveal') {
        const { content, filename } = await planService.exportReveal(id, {
          revealTheme: parsed.data.reveal_theme,
        });
        return reply
          .type('text/html; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="${filename}"`)
          .send(content);
      }

      // docx — resolve optional style template
      const styleId = parsed.data.style_template_id ?? plan.state.export_style_template_id;
      let stylePath: string | undefined;
      if (styleId) {
        const tpl = await templateService.getById(styleId);
        if (!tpl) {
          return reply
            .status(400)
            .send({ data: null, meta: null, error: 'Style template not found' });
        }
        if (tpl.kind !== 'style_reference') {
          return reply
            .status(400)
            .send({ data: null, meta: null, error: 'Template is not a style reference' });
        }
        stylePath = join(storePath, tpl.template_path);
      }
      const { content, filename } = await planService.exportDocx(id, {
        styleTemplatePath: stylePath,
      });
      return reply
        .type('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(content);
    } catch (err: any) {
      const msg = err?.message ?? 'Export failed';
      app.log.error({ err }, `Plan export error: ${msg}`);
      return reply.status(400).send({ data: null, meta: null, error: msg });
    }
  });
}
