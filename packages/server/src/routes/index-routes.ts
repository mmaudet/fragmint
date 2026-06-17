// packages/server/src/routes/index-routes.ts
import type { FastifyInstance } from 'fastify';
import type { IndexService } from '../services/index-service.js';
import type { buildAuthMiddleware } from '../auth/middleware.js';

export function indexRoutes(
  app: FastifyInstance,
  indexService: IndexService,
  authenticate: ReturnType<typeof buildAuthMiddleware>,
): void {
  app.get(
    '/v1/index',
    {
      preHandler: [authenticate],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            format: { type: 'string', enum: ['md', 'json'], default: 'md' },
            refresh: { type: 'boolean', default: false },
          },
        },
      },
    },
    async (req, reply) => {
      const { format = 'md', refresh = false } = req.query as {
        format?: 'md' | 'json';
        refresh?: boolean;
      };

      if (refresh) indexService.invalidateCache();

      const result = await indexService.getIndex(format);

      reply.header('Cache-Control', 'max-age=300');
      reply.header('X-Fragmint-Index-Generated-At', new Date().toISOString());

      if (format === 'json') {
        const data = result as import('../services/index-service.js').IndexData;
        return reply.send({ data, meta: { total: data.total }, error: null });
      }

      return reply.type('text/markdown').send(result as string);
    },
  );
}
