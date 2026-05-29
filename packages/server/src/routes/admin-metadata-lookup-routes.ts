import type { FastifyInstance } from 'fastify';
import { eq, and, or, like } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { fragmentDomains, fragmentTags, fragmentFunctions } from '../db/schema.js';
import { requireRole } from '../auth/middleware.js';

export function adminMetadataLookupRoutes(
  app: FastifyInstance,
  db: FragmintDb,
  authenticate: ReturnType<typeof import('../auth/middleware.js').buildAuthMiddleware>,
) {
  // GET /v1/admin/metadata/references/lookup — autocomplete for metadata fields
  app.get(
    '/v1/admin/metadata/references/lookup',
    { preHandler: [authenticate, requireRole('contributor')] },
    async (request, reply) => {
      const {
        kind,
        q = '',
        limit: limitStr,
      } = (request.query ?? {}) as {
        kind?: string;
        q?: string;
        limit?: string;
      };
      const search = (q as string).trim();
      const maxResults = Math.min(parseInt(limitStr ?? '10', 10) || 10, 50);

      if (kind === 'domain') {
        const conditions: any[] = [eq(fragmentDomains.validated, 1)];
        if (search)
          conditions.push(
            or(
              like(fragmentDomains.slug, `%${search}%`),
              like(fragmentDomains.label, `%${search}%`),
            ),
          );
        const rows = await db
          .select({ slug: fragmentDomains.slug, label: fragmentDomains.label })
          .from(fragmentDomains)
          .where(and(...conditions))
          .limit(maxResults);
        return reply.send({
          data: rows.map((r) => ({ slug: r.slug, label: r.label })),
          meta: null,
          error: null,
        });
      }

      if (kind === 'tag') {
        const conditions: any[] = [eq(fragmentTags.validated, 1)];
        if (search)
          conditions.push(
            or(like(fragmentTags.slug, `%${search}%`), like(fragmentTags.label, `%${search}%`)),
          );
        const rows = await db
          .select({ slug: fragmentTags.slug, label: fragmentTags.label })
          .from(fragmentTags)
          .where(and(...conditions))
          .limit(maxResults);
        return reply.send({
          data: rows.map((r) => ({ slug: r.slug, label: r.label })),
          meta: null,
          error: null,
        });
      }

      if (kind === 'function') {
        const conditions: any[] = [eq(fragmentFunctions.validated, 1)];
        if (search)
          conditions.push(
            or(
              like(fragmentFunctions.slug, `%${search}%`),
              like(fragmentFunctions.label, `%${search}%`),
            ),
          );
        const rows = await db
          .select({ slug: fragmentFunctions.slug, label: fragmentFunctions.label })
          .from(fragmentFunctions)
          .where(and(...conditions))
          .limit(maxResults);
        return reply.send({
          data: rows.map((r) => ({ slug: r.slug, label: r.label })),
          meta: null,
          error: null,
        });
      }

      return reply.send({ data: [], meta: null, error: null });
    },
  );
}
