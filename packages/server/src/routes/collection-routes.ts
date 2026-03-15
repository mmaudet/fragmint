// packages/server/src/routes/collection-routes.ts
import type { FastifyInstance } from 'fastify';
import type { CollectionService } from '../services/collection-service.js';

export function collectionRoutes(
  app: FastifyInstance,
  collectionService: CollectionService,
  authenticate: any,
  requireCollectionRole: (minRole: string) => any,
) {
  // GET /v1/collections — list accessible collections
  app.get('/v1/collections', { preHandler: [authenticate] }, async (request) => {
    const collections = await collectionService.listForUser(request.user.id);
    return { data: collections, meta: { count: collections.length }, error: null };
  });

  // POST /v1/collections — create collection
  app.post('/v1/collections', { preHandler: [authenticate] }, async (request, reply) => {
    const body = request.body as { slug: string; name: string; type: string; description?: string };
    if (body.type === 'system' && request.user.role !== 'admin') {
      return reply.status(403).send({ data: null, meta: null, error: 'Only admins can create system collections' });
    }
    const collection = await collectionService.create(body, request.user.login);
    return reply.status(201).send({ data: collection, meta: null, error: null });
  });

  // GET /v1/collections/:slug
  app.get('/v1/collections/:slug', { preHandler: [authenticate, requireCollectionRole('reader')] }, async (request) => {
    return { data: request.collection, meta: null, error: null };
  });

  // PUT /v1/collections/:slug
  app.put('/v1/collections/:slug', { preHandler: [authenticate, requireCollectionRole('owner')] }, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const body = request.body as { name?: string; description?: string; read_only?: number };
    const collection = request.collection;

    const updates: Record<string, any> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.read_only !== undefined) updates.read_only = body.read_only;

    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({ data: null, meta: null, error: 'No fields to update' });
    }

    // Re-fetch after update
    const updated = await collectionService.getBySlug(slug);
    return { data: { ...collection, ...updates }, meta: null, error: null };
  });

  // DELETE /v1/collections/:slug
  app.delete('/v1/collections/:slug', { preHandler: [authenticate, requireCollectionRole('owner')] }, async (request) => {
    const { slug } = request.params as { slug: string };
    const force = request.user.role === 'admin';
    await collectionService.delete(slug, force);
    return { data: { deleted: true }, meta: null, error: null };
  });

  // POST /v1/collections/:slug/members
  app.post('/v1/collections/:slug/members', { preHandler: [authenticate, requireCollectionRole('manager')] }, async (request, reply) => {
    const body = request.body as { user_id: string; role: string };
    const { slug } = request.params as { slug: string };
    await collectionService.addMember(slug, body.user_id, body.role, request.user.login);
    return reply.status(201).send({ data: { added: true }, meta: null, error: null });
  });

  // DELETE /v1/collections/:slug/members/:userId
  app.delete('/v1/collections/:slug/members/:userId', { preHandler: [authenticate, requireCollectionRole('manager')] }, async (request) => {
    const { slug, userId } = request.params as { slug: string; userId: string };
    await collectionService.removeMember(slug, userId);
    return { data: { removed: true }, meta: null, error: null };
  });

  // POST /v1/collections/:slug/tokens
  app.post('/v1/collections/:slug/tokens', { preHandler: [authenticate, requireCollectionRole('manager')] }, async (request, reply) => {
    // Placeholder for external token creation for collection
    return reply.status(501).send({ data: null, meta: null, error: 'Not yet implemented' });
  });
}
