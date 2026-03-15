// packages/server/src/routes/harvest-routes.ts
import type { FastifyInstance } from 'fastify';
import { requireRole } from '../auth/middleware.js';
import type { HarvesterService, ValidationInput } from '../services/harvester-service.js';

export function harvestRoutes(
  app: FastifyInstance,
  harvesterService: HarvesterService,
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
  const expertHandlers = options?.collectionMiddleware
    ? [authenticate, options.collectionMiddleware]
    : [authenticate, requireRole('expert')];

  // POST /v1/harvest — upload .docx files for harvesting
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
      return reply.status(400).send({ data: null, meta: null, error: 'No .docx files provided' });
    }

    const jobId = await harvesterService.harvest(files, filenames, options, request.user.login);

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
  app.post(`${prefix}/harvest/:jobId/validate`, { preHandler: expertHandlers }, async (request, reply) => {
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
  });
}
