// packages/server/src/routes/harvest-routes.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, inArray } from 'drizzle-orm';
import { requireRole } from '../auth/middleware.js';
import type { HarvesterService, ValidationInput } from '../services/harvester-service.js';
import type { FragmintDb } from '../db/connection.js';
import { harvestCandidates, harvestJobs, fragmentDomains, fragmentTags } from '../db/schema.js';
import { type UploadHints, UploadHintsSchema } from '../schema/trust-source.js';

function worstTrust(trustSourcesJson: string | null | undefined): string {
  const vals = Object.values(
    trustSourcesJson ? (JSON.parse(trustSourcesJson) as Record<string, string>) : {},
  );
  if (vals.includes('llm-deviation')) return 'llm-deviation';
  if (vals.includes('llm-inferred')) return 'llm-inferred';
  if (vals.includes('llm-confirmed')) return 'llm-confirmed';
  return 'human-direct';
}

export function harvestRoutes(
  app: FastifyInstance,
  harvesterService: HarvesterService,
  authenticate: ReturnType<typeof import('../auth/middleware.js').buildAuthMiddleware>,
  options?: {
    prefix?: string;
    collectionMiddleware?: any;
    db?: FragmintDb;
  },
) {
  const prefix = options?.prefix ?? '/v1';
  const db = options?.db;
  const readHandlers = options?.collectionMiddleware
    ? [authenticate, options.collectionMiddleware]
    : [authenticate, requireRole('reader')];
  const expertHandlers = options?.collectionMiddleware
    ? [authenticate, options.collectionMiddleware]
    : [authenticate, requireRole('expert')];
  const contributorHandlers = options?.collectionMiddleware
    ? [authenticate, options.collectionMiddleware]
    : [authenticate, requireRole('contributor')];
  const adminHandlers = options?.collectionMiddleware
    ? [authenticate, options.collectionMiddleware]
    : [authenticate, requireRole('admin')];

  // POST /v1/harvest — upload documents for harvesting (docx only)
  app.post(`${prefix}/harvest`, { preHandler: expertHandlers }, async (request, reply) => {
    const files: Buffer[] = [];
    const filenames: string[] = [];
    let options: { min_confidence: number } = { min_confidence: 0.5 };
    let uploadHints: UploadHints | undefined;

    const parts = request.parts();
    for await (const part of parts) {
      if (part.type === 'file') {
        if (part.filename.endsWith('.docx')) {
          const buffers: Buffer[] = [];
          for await (const chunk of part.file) {
            buffers.push(chunk);
          }
          files.push(Buffer.concat(buffers));
          filenames.push(part.filename);
        }
      } else if (part.type === 'field' && part.fieldname === 'options') {
        try {
          options = JSON.parse(part.value as string);
        } catch {
          return reply.status(400).send({ data: null, meta: null, error: 'Invalid options JSON' });
        }
      } else if (part.type === 'field' && part.fieldname === 'upload_hints') {
        try {
          const parsed = JSON.parse(part.value as string);
          const result = UploadHintsSchema.safeParse(parsed);
          if (!result.success) {
            return reply.status(400).send({
              data: null,
              meta: null,
              error: 'Invalid upload_hints: ' + result.error.issues[0]?.message,
            });
          }
          uploadHints = result.data;
        } catch {
          return reply
            .status(400)
            .send({ data: null, meta: null, error: 'Invalid upload_hints JSON' });
        }
      }
    }

    if (files.length === 0) {
      return reply.status(400).send({
        data: null,
        meta: null,
        error: 'No .docx files provided',
      });
    }

    const collectionSlug = request.collection?.slug ?? null;
    const jobId = await harvesterService.harvest(
      files,
      filenames,
      options,
      request.user.login,
      collectionSlug,
      uploadHints,
    );

    return reply.status(202).send({
      data: { job_id: jobId, status: 'processing', files: filenames },
      meta: null,
      error: null,
    });
  });

  // GET /v1/harvest/:jobId — get harvest job status and candidates
  app.get(`${prefix}/harvest/:jobId`, { preHandler: readHandlers }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = await harvesterService.getJob(jobId);

    if (!job) {
      return reply.status(404).send({ data: null, meta: null, error: 'Harvest job not found' });
    }

    return { data: job, meta: null, error: null };
  });

  // POST /v1/harvest/:jobId/validate — validate harvest candidates
  app.post(
    `${prefix}/harvest/:jobId/validate`,
    { preHandler: expertHandlers },
    async (request, reply) => {
      const { jobId } = request.params as { jobId: string };
      const body = request.body as ValidationInput;

      if (!body || (!body.accepted && !body.modified && !body.merged && !body.rejected)) {
        return reply.status(400).send({ data: null, meta: null, error: 'Missing validation data' });
      }

      const validation: ValidationInput = {
        accepted: body.accepted ?? [],
        modified: body.modified ?? [],
        merged: body.merged ?? [],
        rejected: body.rejected ?? [],
      };

      const result = await harvesterService.validate(jobId, validation, request.user.login);

      return { data: result, meta: null, error: null };
    },
  );

  // PATCH /v1/harvest/:jobId/candidates/:candidateId — contributor edits metadata inline
  if (db) {
    app.patch(
      `${prefix}/harvest/:jobId/candidates/:candidateId`,
      { preHandler: contributorHandlers },
      async (request, reply) => {
        const { jobId, candidateId } = request.params as { jobId: string; candidateId: string };
        const parsed = z
          .object({
            domain: z.string().optional(),
            tags: z.array(z.string()).optional(),
            entities_json: z.string().optional(),
          })
          .safeParse(request.body);
        if (!parsed.success)
          return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });

        const now = new Date().toISOString();
        const userLogin = (request.user as any).login as string;

        if (parsed.data.domain) {
          await db
            .insert(fragmentDomains)
            .values({
              slug: parsed.data.domain,
              label: parsed.data.domain,
              validated: 1,
              proposedBy: `user:${userLogin}`,
              created_at: now,
            })
            .onConflictDoNothing();
        }
        for (const tag of parsed.data.tags ?? []) {
          await db
            .insert(fragmentTags)
            .values({
              slug: tag,
              label: tag,
              validated: 1,
              proposedBy: `user:${userLogin}`,
              created_at: now,
            })
            .onConflictDoNothing();
        }

        await db
          .update(harvestCandidates)
          .set({
            ...(parsed.data.domain && { domain: parsed.data.domain }),
            ...(parsed.data.tags && { tags: JSON.stringify(parsed.data.tags) }),
            ...(parsed.data.entities_json && { entities_json: parsed.data.entities_json }),
            metadata_status: 'human-validated',
          })
          .where(and(eq(harvestCandidates.id, candidateId), eq(harvestCandidates.job_id, jobId)));

        return {
          data: { id: candidateId, metadata_status: 'human-validated' },
          meta: null,
          error: null,
        };
      },
    );
  }

  // GET /v1/harvest/jobs/:id/debrief — trust source stats for a job
  if (db) {
    app.get(
      `${prefix}/harvest/jobs/:id/debrief`,
      { preHandler: expertHandlers },
      async (request, reply) => {
        const { id } = request.params as { id: string };

        const [jobRow] = await db
          .select({ status: harvestJobs.status, upload_hints: harvestJobs.upload_hints })
          .from(harvestJobs)
          .where(eq(harvestJobs.id, id))
          .limit(1);

        if (!jobRow) {
          return reply.status(404).send({ data: null, meta: null, error: 'Job not found' });
        }

        const candidateRows = await db
          .select({ trust_sources_json: harvestCandidates.trust_sources_json })
          .from(harvestCandidates)
          .where(eq(harvestCandidates.job_id, id));

        const byTrust = { high: 0, mixed: 0, low: 0 };
        const byTrustSource = {
          'human-direct': 0,
          'llm-confirmed': 0,
          'llm-deviation': 0,
          'llm-inferred': 0,
        };

        for (const row of candidateRows) {
          const worst = worstTrust(row.trust_sources_json);
          byTrustSource[worst as keyof typeof byTrustSource]++;
          if (worst === 'human-direct' || worst === 'llm-confirmed') byTrust.high++;
          else if (worst === 'llm-deviation') byTrust.mixed++;
          else byTrust.low++;
        }

        const autoValidated = byTrustSource['human-direct'] + byTrustSource['llm-confirmed'];
        const toReview = byTrustSource['llm-deviation'] + byTrustSource['llm-inferred'];

        return reply.send({
          data: {
            job_id: id,
            job_status: jobRow.status,
            upload_hints: jobRow.upload_hints ? JSON.parse(jobRow.upload_hints) : null,
            had_hints: !!jobRow.upload_hints,
            fragments: {
              total: candidateRows.length,
              by_trust: byTrust,
            },
            metadata: {
              auto_validated: autoValidated,
              to_review: toReview,
              breakdown: byTrustSource,
            },
          },
          meta: null,
          error: null,
        });
      },
    );

    // GET /v1/admin/harvest/candidates — list pending candidates for admin validation
    app.get(
      `${prefix}/admin/harvest/candidates`,
      { preHandler: adminHandlers },
      async (request) => {
        const {
          job_id,
          trust_level,
          limit = 500,
          offset = 0,
        } = (request.query ?? {}) as {
          job_id?: string;
          trust_level?: 'high' | 'mixed' | 'low';
          limit?: number;
          offset?: number;
        };

        const conditions: ReturnType<typeof eq>[] = [eq(harvestCandidates.status, 'pending')];
        if (job_id) conditions.push(eq(harvestCandidates.job_id, job_id));

        const rows = await db
          .select()
          .from(harvestCandidates)
          .where(and(...conditions))
          .orderBy(harvestCandidates.job_id)
          .limit(Number(limit))
          .offset(Number(offset));

        const filtered = trust_level
          ? rows.filter((c) => {
              const worst = worstTrust(c.trust_sources_json);
              if (trust_level === 'high')
                return worst === 'human-direct' || worst === 'llm-confirmed';
              if (trust_level === 'mixed') return worst === 'llm-deviation';
              return worst === 'llm-inferred';
            })
          : rows;

        return { data: filtered, meta: { total: filtered.length }, error: null };
      },
    );

    // POST /v1/admin/harvest/candidates/bulk-accept
    app.post(
      `${prefix}/admin/harvest/candidates/bulk-accept`,
      { preHandler: adminHandlers },
      async (request, reply) => {
        const parsed = z
          .object({ candidate_ids: z.array(z.string()).min(1) })
          .safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
        }
        const { candidate_ids } = parsed.data;

        const candidates = await db
          .select()
          .from(harvestCandidates)
          .where(
            and(
              inArray(harvestCandidates.id, candidate_ids),
              eq(harvestCandidates.status, 'pending'),
            ),
          );

        const accepted = await harvesterService.bulkAccept(candidates, request.user.login);
        return reply.send({ data: { accepted }, meta: null, error: null });
      },
    );

    // POST /v1/admin/harvest/candidates/bulk-reject
    app.post(
      `${prefix}/admin/harvest/candidates/bulk-reject`,
      { preHandler: adminHandlers },
      async (request, reply) => {
        const parsed = z
          .object({ candidate_ids: z.array(z.string()).min(1) })
          .safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
        }
        const { candidate_ids } = parsed.data;
        const result = await db
          .update(harvestCandidates)
          .set({ status: 'rejected' })
          .where(
            and(
              inArray(harvestCandidates.id, candidate_ids),
              eq(harvestCandidates.status, 'pending'),
            ),
          );
        return reply.send({
          data: { rejected: result.changes ?? candidate_ids.length },
          meta: null,
          error: null,
        });
      },
    );

    // POST /v1/admin/harvest/candidates/reject-all — reject ALL pending, optionally scoped to a job
    app.post(
      `${prefix}/admin/harvest/candidates/reject-all`,
      { preHandler: adminHandlers },
      async (request, reply) => {
        const { job_id } = (request.body ?? {}) as { job_id?: string };
        const conditions = [eq(harvestCandidates.status, 'pending')];
        if (job_id) conditions.push(eq(harvestCandidates.job_id, job_id));
        const result = await db
          .update(harvestCandidates)
          .set({ status: 'rejected' })
          .where(and(...conditions));
        return reply.send({ data: { rejected: result.changes ?? 0 }, meta: null, error: null });
      },
    );
  }

  // DELETE /v1/harvest/jobs/:id — admin only, deletes job + all its candidates
  if (db) {
    app.delete(
      `${prefix}/harvest/jobs/:id`,
      { preHandler: adminHandlers },
      async (request, reply) => {
        const { id } = request.params as { id: string };

        const existing = await db
          .select({ id: harvestJobs.id, status: harvestJobs.status })
          .from(harvestJobs)
          .where(eq(harvestJobs.id, id))
          .limit(1);

        if (existing.length === 0)
          return reply.status(404).send({ data: null, meta: null, error: 'Job not found' });

        if (existing[0].status === 'processing')
          return reply.status(409).send({
            data: null,
            meta: null,
            error: 'Cannot delete a job that is still processing',
          });

        await db.delete(harvestCandidates).where(eq(harvestCandidates.job_id, id));
        await db.delete(harvestJobs).where(eq(harvestJobs.id, id));

        return reply.send({ data: { deleted: true }, meta: null, error: null });
      },
    );
  }
}
