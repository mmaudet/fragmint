// packages/server/src/routes/references-routes.ts
// Public read-only endpoints for validated referential data (subjects, tags)
import type { FastifyInstance } from 'fastify';
import { eq, desc, sql } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { fragmentDomains, fragmentTags } from '../db/schema.js';
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
