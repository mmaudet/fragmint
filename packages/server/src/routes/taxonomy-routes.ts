import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { fragmentTypes, fragmentDomains, fragmentTags } from '../db/schema.js';
import { requireRole } from '../auth/middleware.js';

const createTypeSchema = z.object({
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  label: z.string().min(1).optional(),
  description: z.string().optional(),
});

const createTagSchema = z.object({
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  label: z.string().min(1).optional(),
  category: z.string().optional(),
});

export function taxonomyRoutes(
  app: FastifyInstance,
  db: FragmintDb,
  authenticate: ReturnType<typeof import('../auth/middleware.js').buildAuthMiddleware>,
) {
  // ─── Fragment types ────────────────────────────────────────────────────────

  app.get('/v1/fragment-types', async () => {
    const rows = await db.select().from(fragmentTypes).orderBy(fragmentTypes.slug);
    return { data: rows, meta: { count: rows.length }, error: null };
  });

  app.post(
    '/v1/fragment-types',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const parsed = createTypeSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
      const { slug, label, description } = parsed.data;
      const now = new Date().toISOString();
      const existing = await db.select().from(fragmentTypes).where(eq(fragmentTypes.slug, slug));
      if (existing.length > 0)
        return reply.status(409).send({ data: null, meta: null, error: `Type '${slug}' already exists` });
      await db.insert(fragmentTypes).values({ slug, label: label ?? slug, description: description ?? null, created_at: now });
      return reply.status(201).send({ data: { slug, label: label ?? slug }, meta: null, error: null });
    },
  );

  app.delete(
    '/v1/fragment-types/:slug',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const existing = await db.select().from(fragmentTypes).where(eq(fragmentTypes.slug, slug));
      if (existing.length === 0)
        return reply.status(404).send({ data: null, meta: null, error: `Type '${slug}' not found` });
      await db.delete(fragmentTypes).where(eq(fragmentTypes.slug, slug));
      return reply.status(204).send();
    },
  );

  // ─── Fragment domains ─────────────────────────────────────────────────────

  app.get('/v1/fragment-domains', async () => {
    const rows = await db.select().from(fragmentDomains).orderBy(fragmentDomains.slug);
    return { data: rows, meta: { count: rows.length }, error: null };
  });

  app.post(
    '/v1/fragment-domains',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const parsed = createTypeSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
      const { slug, label, description } = parsed.data;
      const now = new Date().toISOString();
      const existing = await db.select().from(fragmentDomains).where(eq(fragmentDomains.slug, slug));
      if (existing.length > 0)
        return reply.status(409).send({ data: null, meta: null, error: `Domain '${slug}' already exists` });
      await db.insert(fragmentDomains).values({ slug, label: label ?? slug, description: description ?? null, created_at: now });
      return reply.status(201).send({ data: { slug, label: label ?? slug }, meta: null, error: null });
    },
  );

  app.delete(
    '/v1/fragment-domains/:slug',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const existing = await db.select().from(fragmentDomains).where(eq(fragmentDomains.slug, slug));
      if (existing.length === 0)
        return reply.status(404).send({ data: null, meta: null, error: `Domain '${slug}' not found` });
      await db.delete(fragmentDomains).where(eq(fragmentDomains.slug, slug));
      return reply.status(204).send();
    },
  );

  // ─── Fragment tags ─────────────────────────────────────────────────────────

  app.get('/v1/fragment-tags', async () => {
    const rows = await db.select().from(fragmentTags).orderBy(fragmentTags.slug);
    return { data: rows, meta: { count: rows.length }, error: null };
  });

  app.post(
    '/v1/fragment-tags',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const parsed = createTagSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
      const { slug, label, category } = parsed.data;
      const now = new Date().toISOString();
      const existing = await db.select().from(fragmentTags).where(eq(fragmentTags.slug, slug));
      if (existing.length > 0)
        return reply.status(409).send({ data: null, meta: null, error: `Tag '${slug}' already exists` });
      await db.insert(fragmentTags).values({ slug, label: label ?? slug, category: category ?? null, created_at: now });
      return reply.status(201).send({ data: { slug, label: label ?? slug }, meta: null, error: null });
    },
  );

  app.delete(
    '/v1/fragment-tags/:slug',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const existing = await db.select().from(fragmentTags).where(eq(fragmentTags.slug, slug));
      if (existing.length === 0)
        return reply.status(404).send({ data: null, meta: null, error: `Tag '${slug}' not found` });
      await db.delete(fragmentTags).where(eq(fragmentTags.slug, slug));
      return reply.status(204).send();
    },
  );
}
