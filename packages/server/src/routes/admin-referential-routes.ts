import type { FastifyInstance } from 'fastify';
import { and, eq, like, desc, asc, sql } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import {
  fragmentDomains,
  fragmentTags,
  entities,
  fragments,
  fragmentEntities,
  harvestCandidates,
  referentialRenames,
  auditLog,
  users,
} from '../db/schema.js';
import { requireRole } from '../auth/middleware.js';
import type { JobService } from '../services/job-service.js';
import { runRecalculationJob } from '../services/signal-recalc-service.js';
import { computeFlagsForTag, computeFlagsForEntity, getPreviewForTag, getPreviewForEntity } from './admin-metadata-helpers.js';
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
  renameTagInJson,
} from './admin-referential-helpers.js';

export function adminReferentialRoutes(
  app: FastifyInstance,
  db: FragmintDb,
  authenticate: ReturnType<typeof import('../auth/middleware.js').buildAuthMiddleware>,
  jobService: JobService,
) {
  const auth = { preHandler: [authenticate, requireRole('admin')] };

  // GET /v1/admin/referential/cooccurrence — registered BEFORE :type to avoid param conflict
  app.get('/v1/admin/referential/cooccurrence', auth, async (request, reply) => {
    const { top_entities = '20', category } = request.query as { top_entities?: string; category?: string };
    const topN = Math.min(parseInt(top_entities, 10) || 20, 50);

    const entityConditions: any[] = [eq(entities.status, 'active')];
    if (category) entityConditions.push(eq(entities.type, category));

    const topEntities = await db.select({
      id: entities.id,
      name: entities.canonicalName,
      category: entities.type,
      usage_count: entities.usageCount,
    }).from(entities).where(and(...entityConditions)).orderBy(desc(entities.usageCount)).limit(topN);

    const domains = await db.select({ slug: fragmentDomains.slug, label: fragmentDomains.label })
      .from(fragmentDomains).where(eq(fragmentDomains.status, 'active'))
      .orderBy(desc(fragmentDomains.usageCount));

    const cells: { domain: string; entity: string; count: number }[] = [];
    for (const domain of domains) {
      for (const entity of topEntities) {
        const rows = await db
          .select({ count: sql<number>`count(distinct ${fragments.id})` })
          .from(fragments)
          .innerJoin(fragmentEntities, eq(fragmentEntities.fragment_id, fragments.id))
          .where(and(
            eq(fragments.domain, domain.slug),
            eq(fragmentEntities.entity_id, entity.id),
            eq(fragments.quality, 'approved'),
          ));
        if (rows[0].count > 0) {
          cells.push({ domain: domain.slug, entity: entity.name, count: rows[0].count });
        }
      }
    }

    return { data: { domains: domains.map((d) => d.slug), entities: topEntities, cells, generated_at: new Date().toISOString() }, meta: null, error: null };
  });

  // GET /v1/admin/referential/:type
  app.get('/v1/admin/referential/:type', auth, async (request, reply) => {
    const { type } = request.params as { type: string };
    if (!VALID_TYPES.includes(type as ReferentialType)) {
      return reply.status(400).send({ data: null, meta: null, error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` });
    }
    const refType = type as ReferentialType;
    const table = TABLE_MAP[refType] as any;

    const {
      status: statusParam,
      trust_source: trustSourceParam,
      search,
      category,
      sort = 'usage',
      order = 'desc',
      limit = '100',
      offset = '0',
    } = request.query as Record<string, string>;

    const VALID_TRUST_SOURCES = ['human-direct', 'llm-confirmed', 'llm-inferred', 'llm-deviation'];

    const statusFilter = !statusParam || statusParam === 'all'
      ? undefined
      : eq(table.status, statusParam);

    const trustFilter = trustSourceParam && VALID_TRUST_SOURCES.includes(trustSourceParam)
      ? eq(table.trustSource, trustSourceParam)
      : undefined;

    const labelField = refType === 'entity' ? entities.canonicalName : (table as any).label;
    const searchFilter = search ? like(labelField, `%${search}%`) : undefined;
    const categoryFilter = refType === 'entity' && category ? eq(entities.type, category) : undefined;

    const conditions = [statusFilter, trustFilter, searchFilter, categoryFilter].filter(Boolean) as any[];

    let orderClause: any;
    switch (sort) {
      case 'name':
        orderClause = order === 'asc' ? asc(labelField) : desc(labelField);
        break;
      case 'created':
        orderClause = order === 'asc' ? asc((table as any).created_at ?? (table as any).createdAt) : desc((table as any).created_at ?? (table as any).createdAt);
        break;
      default:
        orderClause = order === 'asc' ? asc((table as any).usageCount) : desc((table as any).usageCount);
    }

    const items = await db.select().from(table).where(and(...conditions)).orderBy(orderClause)
      .limit(parseInt(limit, 10)).offset(parseInt(offset, 10));
    const formatted = items.map((item) => formatItem(item, refType));
    const roleMap = await batchUserInfo(db, formatted.map((i) => i.proposedBy).filter(Boolean));

    const formattedWithUsers = formatted.map((item) => ({
      ...item,
      proposedByRole: roleMap[item.proposedBy]?.role ?? null,
      proposedByDisplay: roleMap[item.proposedBy]?.displayName ?? item.proposedBy ?? null,
    }));

    const hasPending = formattedWithUsers.some((i) => i.status === 'pending');
    let cachedValidatedTags: Array<{ slug: string; label: string }> | undefined;
    let cachedValidatedEntities: Array<{ type: string; normalizedName: string; canonicalName: string }> | undefined;
    if (hasPending) {
      if (refType === 'tag') {
        cachedValidatedTags = await db.select({ slug: fragmentTags.slug, label: fragmentTags.label })
          .from(fragmentTags).where(eq(fragmentTags.validated, 1));
      } else if (refType === 'entity') {
        cachedValidatedEntities = await db.select({
          type: entities.type, normalizedName: entities.normalizedName, canonicalName: entities.canonicalName,
        }).from(entities).where(eq(entities.validated, 1));
      }
    }

    const itemsWithMeta = await Promise.all(
      formattedWithUsers.map(async (item) => {
        if (item.status !== 'pending') return { ...item, flags: [], preview: '' };
        if (refType === 'tag') {
          const [flags, preview] = await Promise.all([
            computeFlagsForTag(db, { slug: String(item.id), usageCount: item.usageCount, label: item.label }, cachedValidatedTags),
            getPreviewForTag(db, String(item.id)),
          ]);
          return { ...item, flags, preview };
        }
        if (refType === 'entity') {
          const [flags, preview] = await Promise.all([
            computeFlagsForEntity(db, { id: Number(item.id), type: item.category ?? '', name: item.label, normalizedName: (item.label ?? '').toLowerCase().trim() }, cachedValidatedEntities),
            getPreviewForEntity(db, Number(item.id)),
          ]);
          return { ...item, flags, preview };
        }
        return { ...item, flags: [], preview: '' };
      }),
    );

    const statsRaw = await db
      .select({ status: table.status, trust_source: table.trustSource, count: sql<number>`count(*)` })
      .from(table).groupBy(table.status, table.trustSource);

    const byStatus = { pending: 0, active: 0, rejected: 0, archived: 0 };
    const byTrust: Record<string, number> = { 'human-direct': 0, 'llm-confirmed': 0, 'llm-deviation': 0, 'llm-inferred': 0 };
    let total = 0;
    for (const row of statsRaw) {
      total += row.count;
      if (row.status in byStatus) byStatus[row.status as keyof typeof byStatus] += row.count;
      if (row.trust_source in byTrust) byTrust[row.trust_source] += row.count;
    }

    return {
      data: { items: itemsWithMeta, stats: { total, byStatus, byTrust } },
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
    const { idField, lookupValue } = resolveId(refType, table, id);

    const rows = await db.select().from(table).where(eq(idField, lookupValue)).limit(1);
    if (rows.length === 0) return reply.status(404).send({ data: null, meta: null, error: 'Item not found' });

    const formattedItem = formatItem(rows[0], refType);
    let proposedByDisplay: string | null = formattedItem.proposedBy ?? null;
    if (formattedItem.proposedBy && formattedItem.proposedBy !== 'llm-auto') {
      const [userRow] = await db.select({ displayName: users.display_name })
        .from(users).where(eq(users.login, formattedItem.proposedBy));
      if (userRow) proposedByDisplay = userRow.displayName;
    }

    const linkedFragments = await getFragmentsForItem(db, refType, lookupValue);
    const renames = await db.select().from(referentialRenames)
      .where(and(eq(referentialRenames.table_name, TABLE_NAME_MAP[refType]), eq(referentialRenames.new_value, String(lookupValue))))
      .orderBy(desc(referentialRenames.renamed_at));

    return {
      data: { item: { ...formattedItem, proposedByDisplay }, linked_fragments: linkedFragments, rename_history: renames },
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
    const conflictField = refType === 'entity' ? entities.canonicalName : (table as any).slug;
    const lookupValue = refType === 'entity' ? parseInt(id, 10) : id;

    const existing = await db.select().from(table).where(eq(conflictField, new_value)).limit(1);
    if (existing.length > 0) {
      const existingId = refType === 'entity' ? existing[0].id : existing[0].slug;
      if (existingId !== lookupValue) {
        return reply.status(409).send({ data: null, meta: null, error: 'A different item with this value already exists' });
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
    if (!new_value) return reply.status(400).send({ data: null, meta: null, error: 'new_value is required' });

    const refType = type as ReferentialType;
    const table = TABLE_MAP[refType] as any;
    const { idField, lookupValue } = resolveId(refType, table, id);
    const userLogin = (request.user as { login: string }).login;
    const userRole = (request.user as { role: string }).role;

    const currentRows = await db.select().from(table).where(eq(idField, lookupValue)).limit(1);
    if (currentRows.length === 0) return reply.status(404).send({ data: null, meta: null, error: 'Item not found' });

    const oldValue = refType === 'entity' ? currentRows[0].canonicalName : currentRows[0].slug;
    const linkedFragments = await getFragmentsForItem(db, refType, lookupValue);
    const affectedIds = linkedFragments.map((f) => f.id);
    const now = new Date().toISOString();

    db.transaction((tx) => {
      if (refType === 'entity') {
        tx.update(entities).set({ canonicalName: new_value, normalizedName: new_value.toLowerCase().trim(), trustSource: 'human-direct' })
          .where(eq(entities.id, lookupValue as number)).run();
      } else {
        tx.update(table).set({ slug: new_value, label: new_label ?? new_value, trustSource: 'human-direct' })
          .where(eq((table as any).slug, oldValue)).run();
      }

      if (refType === 'domain') {
        tx.update(fragments).set({ domain: new_value }).where(eq(fragments.domain, oldValue)).run();
        tx.update(harvestCandidates).set({ domain: new_value }).where(eq(harvestCandidates.domain, oldValue)).run();
      } else if (refType === 'type') {
        tx.update(fragments).set({ type: new_value }).where(eq(fragments.type, oldValue)).run();
        tx.update(harvestCandidates).set({ type: new_value }).where(eq(harvestCandidates.type, oldValue)).run();
      }

      tx.insert(referentialRenames).values({
        table_name: TABLE_NAME_MAP[refType],
        old_value: oldValue,
        new_value,
        affected_fragments: linkedFragments.length,
        renamed_by: userLogin,
        renamed_at: now,
        recalculation_job_id: null,
      }).run();
    });

    // For tags: JSON update outside transaction (requires async)
    if (refType === 'tag') {
      await renameTagInJson(db, oldValue, new_value);
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
      await db.update(referentialRenames)
        .set({ recalculation_job_id: jobId })
        .where(and(
          eq(referentialRenames.table_name, TABLE_NAME_MAP[refType]),
          eq(referentialRenames.old_value, oldValue),
          eq(referentialRenames.new_value, new_value),
        ));
      void runRecalculationJob(jobService, jobId, affectedIds);
    }

    return { data: { ok: true, affected_fragments: linkedFragments.length, recalculation_job_id: jobId }, meta: null, error: null };
  });

  // POST /v1/admin/referential/:type/:id/archive
  app.post('/v1/admin/referential/:type/:id/archive', auth, async (request, reply) => {
    const { type, id } = request.params as { type: string; id: string };
    if (!VALID_TYPES.includes(type as ReferentialType)) {
      return reply.status(400).send({ data: null, meta: null, error: 'Invalid type' });
    }
    const refType = type as ReferentialType;
    const table = TABLE_MAP[refType] as any;
    const { idField, lookupValue } = resolveId(refType, table, id);
    const userLogin = (request.user as { login: string }).login;
    const userRole = (request.user as { role: string }).role;

    const rows = await db.select().from(table).where(eq(idField, lookupValue)).limit(1);
    if (rows.length === 0) return reply.status(404).send({ data: null, meta: null, error: 'Item not found' });
    if (rows[0].status === 'archived') return reply.status(400).send({ data: null, meta: null, error: 'Item is already archived' });

    await db.update(table).set({ status: 'archived', validated: 0 }).where(eq(idField, lookupValue));

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
    const { idField, lookupValue } = resolveId(refType, table, id);
    const userLogin = (request.user as { login: string }).login;
    const userRole = (request.user as { role: string }).role;

    const rows = await db.select().from(table).where(eq(idField, lookupValue)).limit(1);
    if (rows.length === 0) return reply.status(404).send({ data: null, meta: null, error: 'Item not found' });
    if (rows[0].status === 'active' || rows[0].status === 'pending') {
      return reply.status(400).send({ data: null, meta: null, error: `Cannot restore: item is already ${rows[0].status}` });
    }

    await db.update(table).set({ status: 'active', validated: 1, trustSource: 'human-direct' }).where(eq(idField, lookupValue));

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
}
