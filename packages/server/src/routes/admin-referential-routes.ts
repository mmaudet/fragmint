import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, like, desc, asc, sql } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import {
  fragmentDomains,
  fragmentTags,
  fragmentTagLinks,
  fragments,
  harvestCandidates,
  referentialRenames,
  auditLog,
  users,
} from '../db/schema.js';
import { requireRole } from '../auth/middleware.js';
import type { JobService } from '../services/job-service.js';
import { runRecalculationJob } from '../services/signal-recalc-service.js';
import { computeFlagsForTag, getPreviewForTag } from './admin-metadata-helpers.js';
import {
  type ReferentialType,
  TABLE_MAP,
  TABLE_NAME_MAP,
  VALID_TYPES,
  batchUserInfo,
  formatItem,
  resolveId,
  getFragmentsForItem,
  getCandidatesForItem,
} from './admin-referential-helpers.js';

export function adminReferentialRoutes(
  app: FastifyInstance,
  db: FragmintDb,
  authenticate: ReturnType<typeof import('../auth/middleware.js').buildAuthMiddleware>,
  jobService: JobService,
) {
  const auth = { preHandler: [authenticate, requireRole('admin')] };

  // GET /v1/admin/referential/:type
  app.get('/v1/admin/referential/:type', auth, async (request, reply) => {
    const { type } = request.params as { type: string };
    if (!VALID_TYPES.includes(type as ReferentialType)) {
      return reply.status(400).send({
        data: null,
        meta: null,
        error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}`,
      });
    }
    const refType = type as ReferentialType;
    const table = TABLE_MAP[refType] as any;

    const {
      status: statusParam,
      trust_source: trustSourceParam,
      search,
      prefix: prefixParam,
      sort = 'usage',
      order = 'desc',
      limit = '100',
      offset = '0',
    } = request.query as Record<string, string>;

    const VALID_TRUST_SOURCES = ['human-direct', 'llm-confirmed', 'llm-inferred', 'llm-deviation'];

    const statusFilter =
      !statusParam || statusParam === 'all' ? undefined : eq(table.status, statusParam);

    const trustFilter =
      trustSourceParam && VALID_TRUST_SOURCES.includes(trustSourceParam)
        ? eq(table.trustSource, trustSourceParam)
        : undefined;

    const labelField = (table as any).label;
    const searchFilter = search ? like(labelField, `%${search}%`) : undefined;

    // Prefix filter: only applies to tags (slug format is "prefix:name")
    const prefixFilter =
      refType === 'tag' && prefixParam && prefixParam !== 'all'
        ? prefixParam === 'none'
          ? sql`${fragmentTags.slug} NOT LIKE '%:%'`
          : like(fragmentTags.slug, `${prefixParam}:%`)
        : undefined;

    const conditions = [statusFilter, trustFilter, searchFilter, prefixFilter].filter(
      Boolean,
    ) as any[];

    let orderClause: any;
    switch (sort) {
      case 'name':
        orderClause = order === 'asc' ? asc(labelField) : desc(labelField);
        break;
      case 'created':
        orderClause =
          order === 'asc'
            ? asc((table as any).created_at ?? (table as any).createdAt)
            : desc((table as any).created_at ?? (table as any).createdAt);
        break;
      default:
        if (refType === 'tag') {
          orderClause =
            order === 'asc'
              ? asc(
                  sql`(SELECT COUNT(*) FROM fragment_tag_links WHERE tag_slug = fragment_tags.slug)`,
                )
              : desc(
                  sql`(SELECT COUNT(*) FROM fragment_tag_links WHERE tag_slug = fragment_tags.slug)`,
                );
        } else {
          orderClause =
            order === 'asc' ? asc((table as any).usageCount) : desc((table as any).usageCount);
        }
    }

    let items: any[];
    if (refType === 'tag') {
      items = await db
        .select({
          slug: fragmentTags.slug,
          label: fragmentTags.label,
          category: fragmentTags.category,
          created_at: fragmentTags.created_at,
          proposedBy: fragmentTags.proposedBy,
          trustSource: fragmentTags.trustSource,
          status: fragmentTags.status,
          usageCount: sql<number>`(SELECT COUNT(*) FROM fragment_tag_links WHERE tag_slug = fragment_tags.slug)`,
        })
        .from(fragmentTags)
        .where(and(...conditions))
        .orderBy(orderClause)
        .limit(parseInt(limit, 10))
        .offset(parseInt(offset, 10));
    } else {
      items = await db
        .select()
        .from(table)
        .where(and(...conditions))
        .orderBy(orderClause)
        .limit(parseInt(limit, 10))
        .offset(parseInt(offset, 10));
    }
    const formatted = items.map((item) => formatItem(item, refType));
    const roleMap = await batchUserInfo(db, formatted.map((i) => i.proposedBy).filter(Boolean));

    const formattedWithUsers = formatted.map((item) => ({
      ...item,
      proposedByRole: roleMap[item.proposedBy]?.role ?? null,
      proposedByDisplay: roleMap[item.proposedBy]?.displayName ?? item.proposedBy ?? null,
    }));

    // Load caches for flag computation — needed for both pending and active items.
    let cachedValidatedTags: Array<{ slug: string; label: string }> | undefined;
    const needsFlags = formattedWithUsers.some(
      (i) => i.status === 'pending' || i.status === 'active',
    );
    if (needsFlags) {
      if (refType === 'tag') {
        cachedValidatedTags = await db
          .select({ slug: fragmentTags.slug, label: fragmentTags.label })
          .from(fragmentTags)
          .where(eq(fragmentTags.status, 'active'));
      }
    }

    const itemsWithMeta = await Promise.all(
      formattedWithUsers.map(async (item) => {
        // Archived/rejected items don't need flag computation.
        if (item.status === 'archived' || item.status === 'rejected')
          return { ...item, flags: [], preview: '' };
        if (refType === 'tag') {
          const flags = await computeFlagsForTag(
            db,
            { slug: String(item.id), usageCount: item.usageCount, label: item.label },
            cachedValidatedTags,
          );
          const preview =
            item.status === 'pending' ? await getPreviewForTag(db, String(item.id)) : '';
          return { ...item, flags, preview };
        }
        return { ...item, flags: [], preview: '' };
      }),
    );

    const statsRaw = await db
      .select({
        status: table.status,
        trust_source: table.trustSource,
        count: sql<number>`count(*)`,
      })
      .from(table)
      .groupBy(table.status, table.trustSource);

    const byStatus = { pending: 0, active: 0, rejected: 0, archived: 0 };
    const byTrust: Record<string, number> = {
      'human-direct': 0,
      'llm-confirmed': 0,
      'llm-deviation': 0,
      'llm-inferred': 0,
    };
    let total = 0;
    for (const row of statsRaw) {
      total += row.count;
      if (row.status in byStatus) byStatus[row.status as keyof typeof byStatus] += row.count;
      if (row.trust_source in byTrust) byTrust[row.trust_source] += row.count;
    }

    // Count matching items with active filters (search, status, trust, category).
    const filteredCountRaw = await db
      .select({ count: sql<number>`count(*)` })
      .from(refType === 'tag' ? fragmentTags : table)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    const filteredTotal = filteredCountRaw[0]?.count ?? 0;

    return {
      data: { items: itemsWithMeta, stats: { total, byStatus, byTrust, filteredTotal } },
      meta: null,
      error: null,
    };
  });

  // GET /v1/admin/referential/:type/:id
  app.get('/v1/admin/referential/:type/:id', auth, async (request, reply) => {
    const { type, id } = request.params as { type: string; id: string };
    if (!VALID_TYPES.includes(type as ReferentialType)) {
      return reply.status(400).send({ data: null, meta: null, error: 'Invalid type' });
    }
    const refType = type as ReferentialType;
    const table = TABLE_MAP[refType] as any;
    const { idField, lookupValue } = resolveId(table, id);

    const rows = await db.select().from(table).where(eq(idField, lookupValue)).limit(1);
    if (rows.length === 0)
      return reply.status(404).send({ data: null, meta: null, error: 'Item not found' });

    const formattedItem = formatItem(rows[0], refType);
    let proposedByDisplay: string | null = formattedItem.proposedBy ?? null;
    if (formattedItem.proposedBy && formattedItem.proposedBy !== 'llm-auto') {
      const [userRow] = await db
        .select({ displayName: users.display_name })
        .from(users)
        .where(eq(users.login, formattedItem.proposedBy));
      if (userRow) proposedByDisplay = userRow.displayName;
    }

    const linkedFragments = await getFragmentsForItem(db, refType, lookupValue);
    const renames = await db
      .select()
      .from(referentialRenames)
      .where(
        and(
          eq(referentialRenames.table_name, TABLE_NAME_MAP[refType]),
          eq(referentialRenames.new_value, String(lookupValue)),
        ),
      )
      .orderBy(desc(referentialRenames.renamed_at));

    return {
      data: {
        item: { ...formattedItem, proposedByDisplay },
        linked_fragments: linkedFragments,
        rename_history: renames,
      },
      meta: null,
      error: null,
    };
  });

  // POST /v1/admin/referential/:type/:id/rename-impact
  app.post('/v1/admin/referential/:type/:id/rename-impact', auth, async (request, reply) => {
    const { type, id } = request.params as { type: string; id: string };
    const { new_value } = request.body as { new_value?: string };
    if (!VALID_TYPES.includes(type as ReferentialType)) {
      return reply.status(400).send({ data: null, meta: null, error: 'Invalid type' });
    }
    if (!new_value || typeof new_value !== 'string') {
      return reply.status(400).send({ data: null, meta: null, error: 'new_value is required' });
    }
    const refType = type as ReferentialType;
    const table = TABLE_MAP[refType] as any;
    const { idField: conflictField, lookupValue } = resolveId(table, id);

    const existing = await db.select().from(table).where(eq(conflictField, new_value)).limit(1);
    if (existing.length > 0) {
      const existingId = existing[0].slug;
      if (existingId !== lookupValue) {
        return reply.status(409).send({
          data: null,
          meta: null,
          error: 'A different item with this value already exists',
        });
      }
    }

    const linkedFragments = await getFragmentsForItem(db, refType, lookupValue);
    const linkedCandidates = await getCandidatesForItem(db, refType, lookupValue);
    const estimatedSeconds = Math.ceil(linkedFragments.length * 0.05);

    return {
      data: {
        affected_fragments: linkedFragments.length,
        affected_candidates: linkedCandidates.length,
        fragments_will_recalculate_signals: linkedFragments.length > 0,
        estimated_recalc_duration_seconds: estimatedSeconds,
      },
      meta: null,
      error: null,
    };
  });

  // POST /v1/admin/referential/:type/:id/rename
  app.post('/v1/admin/referential/:type/:id/rename', auth, async (request, reply) => {
    const { type, id } = request.params as { type: string; id: string };
    const { new_value, new_label } = request.body as { new_value?: string; new_label?: string };
    if (!VALID_TYPES.includes(type as ReferentialType)) {
      return reply.status(400).send({ data: null, meta: null, error: 'Invalid type' });
    }
    if (!new_value)
      return reply.status(400).send({ data: null, meta: null, error: 'new_value is required' });

    const refType = type as ReferentialType;
    const table = TABLE_MAP[refType] as any;
    const { idField, lookupValue } = resolveId(table, id);
    const userLogin = (request.user as { login: string }).login;
    const userRole = (request.user as { role: string }).role;

    const currentRows = await db.select().from(table).where(eq(idField, lookupValue)).limit(1);
    if (currentRows.length === 0)
      return reply.status(404).send({ data: null, meta: null, error: 'Item not found' });

    const oldValue = currentRows[0].slug;
    const linkedFragments = await getFragmentsForItem(db, refType, lookupValue);
    const affectedIds = linkedFragments.map((f) => f.id);
    const now = new Date().toISOString();

    try {
      db.transaction((tx) => {
        tx.update(table)
          .set({ slug: new_value, label: new_label ?? new_value, trustSource: 'human-direct' })
          .where(eq((table as any).slug, oldValue))
          .run();

        if (refType === 'domain') {
          tx.update(fragments)
            .set({ domain: new_value })
            .where(eq(fragments.domain, oldValue))
            .run();
          tx.update(harvestCandidates)
            .set({ domain: new_value })
            .where(eq(harvestCandidates.domain, oldValue))
            .run();
        } else if (refType === 'type') {
          tx.update(fragments).set({ type: new_value }).where(eq(fragments.type, oldValue)).run();
          tx.update(harvestCandidates)
            .set({ type: new_value })
            .where(eq(harvestCandidates.type, oldValue))
            .run();
        }

        // Atomically repoint tag links AND update JSON tags column when renaming a tag slug
        if (refType === 'tag') {
          tx.run(
            sql`INSERT OR IGNORE INTO fragment_tag_links (fragment_id, tag_slug) SELECT fragment_id, ${new_value} FROM fragment_tag_links WHERE tag_slug = ${oldValue}`,
          );
          tx.delete(fragmentTagLinks).where(eq(fragmentTagLinks.tag_slug, oldValue)).run();
          // Update the JSON tags array in fragments and harvest_candidates synchronously
          tx.run(
            sql`UPDATE fragments SET tags = replace(tags, '"' || ${oldValue} || '"', '"' || ${new_value} || '"') WHERE tags LIKE '%"' || ${oldValue} || '"%'`,
          );
          tx.run(
            sql`UPDATE harvest_candidates SET tags = replace(tags, '"' || ${oldValue} || '"', '"' || ${new_value} || '"') WHERE tags LIKE '%"' || ${oldValue} || '"%'`,
          );
        }

        tx.insert(referentialRenames)
          .values({
            table_name: TABLE_NAME_MAP[refType],
            old_value: oldValue,
            new_value,
            affected_fragments: linkedFragments.length,
            renamed_by: userLogin,
            renamed_at: now,
            recalculation_job_id: null,
          })
          .run();
      });
    } catch (err: any) {
      return reply
        .status(409)
        .send({ data: null, meta: null, error: `Rename failed: ${err?.message ?? 'conflict'}` });
    }

    await db.insert(auditLog).values({
      timestamp: now,
      user_id: userLogin,
      role: userRole,
      action: `${refType}_renamed`,
      entity_type: TABLE_NAME_MAP[refType],
      entity_id: String(lookupValue),
      diff_summary: `${oldValue} → ${new_value} (${linkedFragments.length} fragments)`,
    } as any);

    let jobId: string | null = null;
    if (affectedIds.length > 0) {
      const job = await jobService.create('recalculate_signals', affectedIds.length, userLogin);
      jobId = job.id;
      await db
        .update(referentialRenames)
        .set({ recalculation_job_id: jobId })
        .where(
          and(
            eq(referentialRenames.table_name, TABLE_NAME_MAP[refType]),
            eq(referentialRenames.old_value, oldValue),
            eq(referentialRenames.new_value, new_value),
          ),
        );
      void runRecalculationJob(jobService, jobId, affectedIds);
    }

    return {
      data: { ok: true, affected_fragments: linkedFragments.length, recalculation_job_id: jobId },
      meta: null,
      error: null,
    };
  });

  // POST /v1/admin/referential/:type/:id/archive
  app.post('/v1/admin/referential/:type/:id/archive', auth, async (request, reply) => {
    const { type, id } = request.params as { type: string; id: string };
    if (!VALID_TYPES.includes(type as ReferentialType)) {
      return reply.status(400).send({ data: null, meta: null, error: 'Invalid type' });
    }
    const refType = type as ReferentialType;
    const table = TABLE_MAP[refType] as any;
    const { idField, lookupValue } = resolveId(table, id);
    const userLogin = (request.user as { login: string }).login;
    const userRole = (request.user as { role: string }).role;

    const rows = await db.select().from(table).where(eq(idField, lookupValue)).limit(1);
    if (rows.length === 0)
      return reply.status(404).send({ data: null, meta: null, error: 'Item not found' });
    if (rows[0].status === 'archived')
      return reply.status(400).send({ data: null, meta: null, error: 'Item is already archived' });

    await db
      .update(table)
      .set({ status: 'archived' })
      .where(eq(idField, lookupValue));

    await db.insert(auditLog).values({
      timestamp: new Date().toISOString(),
      user_id: userLogin,
      role: userRole,
      action: `${refType}_archived`,
      entity_type: TABLE_NAME_MAP[refType],
      entity_id: String(lookupValue),
      diff_summary: `Archived from ${rows[0].status}`,
    } as any);

    return { data: { ok: true }, meta: null, error: null };
  });

  // POST /v1/admin/referential/:type/:id/restore
  app.post('/v1/admin/referential/:type/:id/restore', auth, async (request, reply) => {
    const { type, id } = request.params as { type: string; id: string };
    if (!VALID_TYPES.includes(type as ReferentialType)) {
      return reply.status(400).send({ data: null, meta: null, error: 'Invalid type' });
    }
    const refType = type as ReferentialType;
    const table = TABLE_MAP[refType] as any;
    const { idField, lookupValue } = resolveId(table, id);
    const userLogin = (request.user as { login: string }).login;
    const userRole = (request.user as { role: string }).role;

    const rows = await db.select().from(table).where(eq(idField, lookupValue)).limit(1);
    if (rows.length === 0)
      return reply.status(404).send({ data: null, meta: null, error: 'Item not found' });
    if (rows[0].status === 'active' || rows[0].status === 'pending') {
      return reply.status(400).send({
        data: null,
        meta: null,
        error: `Cannot restore: item is already ${rows[0].status}`,
      });
    }

    await db
      .update(table)
      .set({ status: 'active', trustSource: 'human-direct' })
      .where(eq(idField, lookupValue));

    await db.insert(auditLog).values({
      timestamp: new Date().toISOString(),
      user_id: userLogin,
      role: userRole,
      action: `${refType}_restored`,
      entity_type: TABLE_NAME_MAP[refType],
      entity_id: String(lookupValue),
      diff_summary: `Restored from ${rows[0].status} to active`,
    } as any);

    return { data: { ok: true }, meta: null, error: null };
  });

  // PATCH /v1/admin/referential/:type/:id/category — update category for tags
  app.patch('/v1/admin/referential/:type/:id/category', auth, async (request, reply) => {
    const { type, id } = request.params as { type: string; id: string };
    if (!VALID_TYPES.includes(type as ReferentialType)) {
      return reply.status(400).send({ data: null, meta: null, error: 'Invalid type' });
    }
    const refType = type as ReferentialType;
    const parsed = z.object({ category: z.string().min(1).nullable() }).safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    const { category } = parsed.data;

    if (refType !== 'tag') {
      return reply.status(400).send({
        data: null,
        meta: null,
        error: 'Category update only supported for tag type',
      });
    }
    await db
      .update(fragmentTags)
      .set({ category: category ?? null } as any)
      .where(eq(fragmentTags.slug, id));

    return { data: { ok: true }, meta: null, error: null };
  });
}
