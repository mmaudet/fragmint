import type { FastifyInstance } from 'fastify';
import { JobService } from '../services/job-service.js';

export function jobRoutes(
  app: FastifyInstance,
  jobService: JobService,
  authenticate: ReturnType<typeof import('../auth/middleware.js').buildAuthMiddleware>,
) {
  app.get('/v1/jobs/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await jobService.getById(id);
    if (!job) return reply.status(404).send({ data: null, meta: null, error: 'Job not found' });
    return { data: job, meta: null, error: null };
  });
}
