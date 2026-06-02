import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { fragmentTags, fragmentDomains } from '../db/schema.js';
import { requireRole } from '../auth/middleware.js';

export function adminMetadataMutationRoutes(
  app: FastifyInstance,
  db: FragmintDb,
  authenticate: ReturnType<typeof import('../auth/middleware.js').buildAuthMiddleware>,
) {
  // POST /v1/admin/metadata/bulk-action
  app.post(
    '/v1/admin/metadata/bulk-action',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      const { action, items } = request.body as {
        action: 'approve' | 'reject';
        items: Array<{ id: string | number; kind: 'tag' | 'domain' }>;
      };
      const results = [];
      for (const item of items) {
        try {
          const stripNew = (s: string) => s.replace(/^NEW:\s*/i, '').trim();
          if (item.kind === 'tag') {
            action === 'approve'
              ? await db
                  .update(fragmentTags)
                  .set({ status: 'active', label: stripNew(String(item.id)) })
                  .where(eq(fragmentTags.slug, String(item.id)))
              : await db
                  .update(fragmentTags)
                  .set({ status: 'rejected' })
                  .where(eq(fragmentTags.slug, String(item.id)));
          } else if (item.kind === 'domain') {
            action === 'approve'
              ? await db
                  .update(fragmentDomains)
                  .set({ status: 'active', label: stripNew(String(item.id)) })
                  .where(eq(fragmentDomains.slug, String(item.id)))
              : await db
                  .update(fragmentDomains)
                  .set({ status: 'rejected' })
                  .where(eq(fragmentDomains.slug, String(item.id)));
          }
          results.push({ id: item.id, success: true });
        } catch (e: any) {
          results.push({ id: item.id, success: false, error: e.message });
        }
      }
      return { success: true, results };
    },
  );
}
