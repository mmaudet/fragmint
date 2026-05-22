// packages/server/src/routes/harvest-routes.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { requireRole } from '../auth/middleware.js';
import type { HarvesterService, ValidationInput } from '../services/harvester-service.js';
import type { FragmintDb } from '../db/connection.js';
import { harvestCandidates, harvestJobs, fragmentDomains, fragmentTags } from '../db/schema.js';

export function harvestRoutes(
  app: FastifyInstance,
  harvesterService: HarvesterService,
  authenticate: ReturnType<typeof import('../auth/middleware.js').buildAuthMiddleware>,
  options?: {
    prefix?: string;
    collectionMiddleware?: any;
    db?: FragmintDb;
  },
) {
  const prefix = options?.prefix ?? '/v1';
  const db = options?.db;
  const readHandlers = options?.collectionMiddleware
    ? [authenticate, options.collectionMiddleware]
    : [authenticate, requireRole('reader')];
  const expertHandlers = options?.collectionMiddleware
    ? [authenticate, options.collectionMiddleware]
    : [authenticate, requireRole('expert')];
  const contributorHandlers = options?.collectionMiddleware
    ? [authenticate, options.collectionMiddleware]
    : [authenticate, requireRole('contributor')];
  const adminHandlers = options?.collectionMiddleware
    ? [authenticate, options.collectionMiddleware]
    : [authenticate, requireRole('admin')];

  // POST /v1/harvest — upload documents for harvesting (docx only)
  app.post(`${prefix}/harvest`, { preHandler: expertHandlers }, async (request, reply) => {
    const files: Buffer[] = [];
    const filenames: string[] = [];
    let options: { min_confidence: number } = { min_confidence: 0.5 };

    const parts = request.parts();
    for await (const part of parts) {
      if (part.type === 'file') {
        if (part.filename.endsWith('.docx')) {
          const buffers: Buffer[] = [];
          for await (const chunk of part.file) {
            buffers.push(chunk);
          }
          files.push(Buffer.concat(buffers));
          filenames.push(part.filename);
        }
      } else if (part.type === 'field' && part.fieldname === 'options') {
        try {
          options = JSON.parse(part.value as string);
        } catch {
          return reply.status(400).send({ data: null, meta: null, error: 'Invalid options JSON' });
        }
      }
    }

    if (files.length === 0) {
      return reply.status(400).send({
        data: null,
        meta: null,
        error: 'No .docx files provided',
      });
    }

    const collectionSlug = request.collection?.slug ?? null;
    const jobId = await harvesterService.harvest(
      files,
      filenames,
      options,
      request.user.login,
      collectionSlug,
    );

    return reply.status(202).send({
      data: { job_id: jobId, status: 'processing', files: filenames },
      meta: null,
      error: null,
    });
  });

  // GET /v1/harvest/:jobId — get harvest job status and candidates
  app.get(`${prefix}/harvest/:jobId`, { preHandler: readHandlers }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = await harvesterService.getJob(jobId);

    if (!job) {
      return reply.status(404).send({ data: null, meta: null, error: 'Harvest job not found' });
    }

    return { data: job, meta: null, error: null };
  });

  // POST /v1/harvest/:jobId/validate — validate harvest candidates
  app.post(
    `${prefix}/harvest/:jobId/validate`,
    { preHandler: expertHandlers },
    async (request, reply) => {
      const { jobId } = request.params as { jobId: string };
      const body = request.body as ValidationInput;

      if (!body || (!body.accepted && !body.modified && !body.merged && !body.rejected)) {
        return reply.status(400).send({ data: null, meta: null, error: 'Missing validation data' });
      }

      const validation: ValidationInput = {
        accepted: body.accepted ?? [],
        modified: body.modified ?? [],
        merged: body.merged ?? [],
        rejected: body.rejected ?? [],
      };

      const result = await harvesterService.validate(jobId, validation, request.user.login);

      return { data: result, meta: null, error: null };
    },
  );

  // PATCH /v1/harvest/:jobId/candidates/:candidateId — contributor edits metadata inline
  if (db) {
    app.patch(
      `${prefix}/harvest/:jobId/candidates/:candidateId`,
      { preHandler: contributorHandlers },
      async (request, reply) => {
        const { jobId, candidateId } = request.params as { jobId: string; candidateId: string };
        const parsed = z
          .object({
            domain: z.string().optional(),
            function_type: z.string().optional(),
            audience: z.array(z.string()).optional(),
            maturity: z.string().optional(),
            tags: z.array(z.string()).optional(),
            entities_json: z.string().optional(),
          })
          .safeParse(request.body);
        if (!parsed.success)
          return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });

        const now = new Date().toISOString();
        const userLogin = (request.user as any).login as string;

        if (parsed.data.domain) {
          await db
            .insert(fragmentDomains)
            .values({
              slug: parsed.data.domain,
              label: parsed.data.domain,
              validated: 1,
              proposedBy: `user:${userLogin}`,
              created_at: now,
            })
            .onConflictDoNothing();
        }
        for (const tag of parsed.data.tags ?? []) {
          await db
            .insert(fragmentTags)
            .values({
              slug: tag,
              label: tag,
              validated: 1,
              proposedBy: `user:${userLogin}`,
              created_at: now,
            })
            .onConflictDoNothing();
        }

        await db
          .update(harvestCandidates)
          .set({
            ...(parsed.data.domain && { domain: parsed.data.domain }),
            ...(parsed.data.function_type && { function_type: parsed.data.function_type }),
            ...(parsed.data.audience && { audience: JSON.stringify(parsed.data.audience) }),
            ...(parsed.data.maturity && { maturity: parsed.data.maturity }),
            ...(parsed.data.tags && { tags: JSON.stringify(parsed.data.tags) }),
            ...(parsed.data.entities_json && { entities_json: parsed.data.entities_json }),
            metadata_status: 'human-validated',
          })
          .where(and(eq(harvestCandidates.id, candidateId), eq(harvestCandidates.job_id, jobId)));

        return {
          data: { id: candidateId, metadata_status: 'human-validated' },
          meta: null,
          error: null,
        };
      },
    );
  }

  // DELETE /v1/harvest/jobs/:id — admin only, deletes job + all its candidates
  if (db) {
    app.delete(`${prefix}/harvest/jobs/:id`, { preHandler: adminHandlers }, async (request, reply) => {
      const { id } = request.params as { id: string };

      const existing = await db
        .select({ id: harvestJobs.id, status: harvestJobs.status })
        .from(harvestJobs)
        .where(eq(harvestJobs.id, id))
        .limit(1);

      if (existing.length === 0)
        return reply.status(404).send({ data: null, meta: null, error: 'Job not found' });

      if (existing[0].status === 'processing')
        return reply.status(409).send({ data: null, meta: null, error: 'Cannot delete a job that is still processing' });

      await db.delete(harvestCandidates).where(eq(harvestCandidates.job_id, id));
      await db.delete(harvestJobs).where(eq(harvestJobs.id, id));

      return reply.send({ data: { deleted: true }, meta: null, error: null });
    });
  }
}
