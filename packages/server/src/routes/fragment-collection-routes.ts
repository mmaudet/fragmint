import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/middleware.js';
import type { FragmentCollectionService } from '../services/fragment-collection-service.js';

const CreateFragmentCollectionSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  payloadSchema: z.string().optional(),
  memberIds: z.array(z.string()).optional(),
  sourceDocument: z.string().optional(),
  collectionSlug: z.string().optional(),
});

const ListFragmentCollectionsSchema = z.object({
  collection_slug: z.string().optional(),
  fragment_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export function fragmentCollectionRoutes(
  app: FastifyInstance,
  service: FragmentCollectionService,
  authenticate: ReturnType<typeof import('../auth/middleware.js').buildAuthMiddleware>,
  options?: { prefix?: string },
) {
  const prefix = options?.prefix ?? '/v1';
  const readerHandlers = [authenticate, requireRole('reader')];
  const contributorHandlers = [authenticate, requireRole('contributor')];
  const adminHandlers = [authenticate, requireRole('admin')];

  // GET /v1/fragment-collections
  app.get(`${prefix}/fragment-collections`, { preHandler: readerHandlers }, async (request) => {
    const parsed = ListFragmentCollectionsSchema.safeParse(request.query);
    if (!parsed.success) {
      return { data: null, meta: null, error: parsed.error.message };
    }
    const { collection_slug, fragment_id, limit } = parsed.data;
    const items = fragment_id
      ? await service.getByFragmentId(fragment_id)
      : await service.list({ collectionSlug: collection_slug, limit });
    return { data: items, meta: { count: items.length }, error: null };
  });

  // GET /v1/fragment-collections/:id
  app.get(
    `${prefix}/fragment-collections/:id`,
    { preHandler: readerHandlers },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const item = await service.getById(id);
      if (!item) {
        return reply
          .status(404)
          .send({ data: null, meta: null, error: 'Fragment collection not found' });
      }
      return { data: item, meta: null, error: null };
    },
  );

  // POST /v1/fragment-collections
  app.post(
    `${prefix}/fragment-collections`,
    { preHandler: contributorHandlers },
    async (request, reply) => {
      const parsed = CreateFragmentCollectionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ data: null, meta: null, error: parsed.error.message });
      }

      const result = await service.create({
        ...parsed.data,
        createdBy: request.user.login,
      });

      return reply.status(201).send({ data: result, meta: null, error: null });
    },
  );

  // DELETE /v1/fragment-collections/:id
  app.delete(
    `${prefix}/fragment-collections/:id`,
    { preHandler: adminHandlers },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const existing = await service.getById(id);
      if (!existing) {
        return reply
          .status(404)
          .send({ data: null, meta: null, error: 'Fragment collection not found' });
      }
      await service.delete(id);
      return { data: { id }, meta: null, error: null };
    },
  );
}
