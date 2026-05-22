import type { FastifyInstance } from 'fastify';
import { eq, and, desc } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { fragments, supersedureProposals } from '../db/schema.js';
import { requireRole } from '../auth/middleware.js';

type ProposalRow = typeof supersedureProposals.$inferSelect;

function serializeProposal(p: ProposalRow) {
  return {
    id: p.id,
    new_fragment_id: p.newFragmentId,
    old_fragment_id: p.oldFragmentId,
    similarity_score: p.similarityScore,
    llm_judgment: p.llmJudgment,
    llm_confidence: p.llmConfidence,
    llm_reasoning: p.llmReasoning,
    elements_lost_in_new: p.elementsLostInNew,
    status: p.status,
    resolved_by: p.resolvedBy,
    resolved_at: p.resolvedAt,
    created_at: p.createdAt,
  };
}

export function adminSupersedureRoutes(
  app: FastifyInstance,
  db: FragmintDb,
  authenticate: ReturnType<typeof import('../auth/middleware.js').buildAuthMiddleware>,
) {
  // GET /v1/admin/supersedure/proposals
  app.get(
    '/v1/admin/supersedure/proposals',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      const { status = 'pending' } = (request.query ?? {}) as { status?: string };

      const proposals = await db
        .select()
        .from(supersedureProposals)
        .where(eq(supersedureProposals.status, status))
        .orderBy(desc(supersedureProposals.createdAt))
        .limit(100);

      const enriched = await Promise.all(
        proposals.map(async (p) => {
          const [newFrag, oldFrag] = await Promise.all([
            db
              .select({
                id: fragments.id,
                title: fragments.title,
                body_excerpt: fragments.body_excerpt,
                domain: fragments.domain,
                type: fragments.type,
                lang: fragments.lang,
                quality: fragments.quality,
                created_at: fragments.created_at,
              })
              .from(fragments)
              .where(eq(fragments.id, p.newFragmentId))
              .limit(1),
            db
              .select({
                id: fragments.id,
                title: fragments.title,
                body_excerpt: fragments.body_excerpt,
                domain: fragments.domain,
                type: fragments.type,
                lang: fragments.lang,
                quality: fragments.quality,
                created_at: fragments.created_at,
              })
              .from(fragments)
              .where(eq(fragments.id, p.oldFragmentId))
              .limit(1),
          ]);
          return {
            ...serializeProposal(p),
            new_fragment: newFrag[0] ?? null,
            old_fragment: oldFrag[0] ?? null,
          };
        }),
      );

      return { data: enriched, meta: { count: enriched.length }, error: null };
    },
  );

  // GET /v1/admin/supersedure/proposals/:id
  app.get(
    '/v1/admin/supersedure/proposals/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const rows = await db
        .select()
        .from(supersedureProposals)
        .where(eq(supersedureProposals.id, id))
        .limit(1);
      if (rows.length === 0) {
        return reply.status(404).send({ data: null, meta: null, error: 'Not found' });
      }
      return { data: rows[0], meta: null, error: null };
    },
  );

  // POST /v1/admin/supersedure/proposals/:id/confirm
  app.post(
    '/v1/admin/supersedure/proposals/:id/confirm',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const now = new Date().toISOString();
      const resolvedBy = (request.user as { login: string }).login;

      const rows = await db
        .select()
        .from(supersedureProposals)
        .where(and(eq(supersedureProposals.id, id), eq(supersedureProposals.status, 'pending')))
        .limit(1);
      if (rows.length === 0) {
        return reply
          .status(404)
          .send({ data: null, meta: null, error: 'Proposal not found or already resolved' });
      }
      const proposal = rows[0];

      db.transaction((tx) => {
        tx.update(fragments)
          .set({ quality: 'deprecated', superseded_by: proposal.newFragmentId, updated_at: now } as any)
          .where(eq(fragments.id, proposal.oldFragmentId))
          .run();
        tx.update(fragments)
          .set({ supersedes: proposal.oldFragmentId, updated_at: now } as any)
          .where(eq(fragments.id, proposal.newFragmentId))
          .run();
        tx.update(supersedureProposals)
          .set({ status: 'confirmed', resolvedBy, resolvedAt: now })
          .where(eq(supersedureProposals.id, id))
          .run();
      });

      return { data: { id }, meta: null, error: null };
    },
  );

  // POST /v1/admin/supersedure/proposals/:id/coexist
  app.post(
    '/v1/admin/supersedure/proposals/:id/coexist',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const now = new Date().toISOString();
      const resolvedBy = (request.user as { login: string }).login;

      const updated = await db
        .update(supersedureProposals)
        .set({ status: 'coexist', resolvedBy, resolvedAt: now })
        .where(and(eq(supersedureProposals.id, id), eq(supersedureProposals.status, 'pending')))
        .returning({ id: supersedureProposals.id });

      if (updated.length === 0) {
        return reply
          .status(404)
          .send({ data: null, meta: null, error: 'Proposal not found or already resolved' });
      }
      return { data: { id }, meta: null, error: null };
    },
  );

  // POST /v1/admin/supersedure/proposals/:id/reject
  app.post(
    '/v1/admin/supersedure/proposals/:id/reject',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const now = new Date().toISOString();
      const resolvedBy = (request.user as { login: string }).login;

      const updated = await db
        .update(supersedureProposals)
        .set({ status: 'rejected', resolvedBy, resolvedAt: now })
        .where(and(eq(supersedureProposals.id, id), eq(supersedureProposals.status, 'pending')))
        .returning({ id: supersedureProposals.id });

      if (updated.length === 0) {
        return reply
          .status(404)
          .send({ data: null, meta: null, error: 'Proposal not found or already resolved' });
      }
      return { data: { id }, meta: null, error: null };
    },
  );

  // GET /v1/admin/supersedure/stats
  app.get(
    '/v1/admin/supersedure/stats',
    { preHandler: [authenticate, requireRole('admin')] },
    async () => {
      const all = await db
        .select({ status: supersedureProposals.status })
        .from(supersedureProposals);

      const counts = { pending: 0, confirmed: 0, rejected: 0, coexist: 0 };
      for (const row of all) {
        const s = row.status as keyof typeof counts;
        if (s in counts) counts[s]++;
      }

      return { data: { ...counts, total: all.length }, meta: null, error: null };
    },
  );

  // POST /v1/admin/supersedure/proposals/bulk-reject
  app.post(
    '/v1/admin/supersedure/proposals/bulk-reject',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request) => {
      const { new_fragment_id } = request.body as { new_fragment_id: string };
      const now = new Date().toISOString();
      const resolvedBy = (request.user as { login: string }).login;

      const updated = await db
        .update(supersedureProposals)
        .set({ status: 'rejected', resolvedBy, resolvedAt: now })
        .where(
          and(
            eq(supersedureProposals.newFragmentId, new_fragment_id),
            eq(supersedureProposals.status, 'pending'),
          ),
        )
        .returning({ id: supersedureProposals.id });

      return { data: { count: updated.length }, meta: null, error: null };
    },
  );
}
