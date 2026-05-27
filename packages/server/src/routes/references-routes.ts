// packages/server/src/routes/references-routes.ts
// Public read-only endpoints for validated referential data (subjects, entities, tags)
import type { FastifyInstance } from 'fastify';
import { eq, desc, and, sql } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { fragmentDomains, fragmentTags, entities } from '../db/schema.js';
import type { buildAuthMiddleware } from '../auth/middleware.js';

export function referencesRoutes(
  app: FastifyInstance,
  db: FragmintDb,
  authenticate: ReturnType<typeof buildAuthMiddleware>,
): void {
  app.get('/v1/references/subjects', { preHandler: [authenticate] }, async (_req, reply) => {
    const rows = await db
      .select({
        slug: fragmentDomains.slug,
        label: fragmentDomains.label,
        description: fragmentDomains.description,
        usageCount: fragmentDomains.usageCount,
      })
      .from(fragmentDomains)
      .where(eq(fragmentDomains.status, 'active'))
      .orderBy(desc(fragmentDomains.usageCount));

    return reply.send({
      data: rows.map((r) => ({
        slug: r.slug,
        label: r.label,
        description: r.description,
        usage_count: r.usageCount,
      })),
      meta: { count: rows.length },
      error: null,
    });
  });

  app.get(
    '/v1/references/entities',
    {
      preHandler: [authenticate],
      schema: {
        querystring: {
          type: 'object',
          properties: { type: { type: 'string' } },
        },
      },
    },
    async (req, _reply) => {
      const { type } = req.query as { type?: string };
      const where = type
        ? and(eq(entities.status, 'active'), eq(entities.type, type))
        : eq(entities.status, 'active');

      const rows = await db
        .select({
          id: entities.id,
          type: entities.type,
          canonicalName: entities.canonicalName,
          aliases: entities.aliases,
          usageCount: entities.usageCount,
        })
        .from(entities)
        .where(where)
        .orderBy(desc(entities.usageCount));

      return {
        data: rows.map((r) => ({
          id: r.id,
          type: r.type,
          name: r.canonicalName,
          aliases: parseJsonArray(r.aliases),
          usage_count: r.usageCount,
        })),
        meta: { count: rows.length },
        error: null,
      };
    },
  );

  app.get('/v1/references/tags', { preHandler: [authenticate] }, async (_req, reply) => {
    const rows = await db
      .select({
        slug: fragmentTags.slug,
        label: fragmentTags.label,
        category: fragmentTags.category,
        usageCount: sql<number>`(SELECT COUNT(*) FROM fragment_tag_links WHERE tag_slug = ${fragmentTags.slug})`,
      })
      .from(fragmentTags)
      .where(eq(fragmentTags.status, 'active'))
      .orderBy(
        desc(sql`(SELECT COUNT(*) FROM fragment_tag_links WHERE tag_slug = fragment_tags.slug)`),
      );

    return reply.send({
      data: rows.map((r) => ({
        slug: r.slug,
        label: r.label,
        category: r.category,
        usage_count: r.usageCount,
      })),
      meta: { count: rows.length },
      error: null,
    });
  });
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    return JSON.parse(value) as string[];
  } catch {
    return [];
  }
}
