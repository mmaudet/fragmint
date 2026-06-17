# Admin Fragments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/admin/harvest` (candidate review) with `/admin/fragments` — a full fragment management page for admins: list, filter, search, bulk approve/archive/delete, drawer detail.

**Architecture:** New `admin-fragment-routes.ts` on the server adds `GET /v1/admin/fragments` (with filters + stats) and `POST /v1/admin/fragments/bulk-archive`. Frontend: 6 focused components (`StatusBadge`, `OriginBadge`, `AdminFragmentCard`, `FragmentsToolbar`, `FragmentsBulkActions`, `FragmentDetailDrawer`) composed in a new `AdminFragmentsPage`. Old `admin/harvest.tsx` and `admin/harvest-job.tsx` pages are removed; sidebar and router are updated.

**Tech Stack:** Fastify 5, Drizzle ORM (SQLite), React 19, React Query v5, shadcn/ui, Tailwind CSS, Vitest (integration tests)

---

## Decisions & Constraints

- **Workflow strict**: admin can `reviewed→approved` and `*→deprecated` (archive). Admin cannot `draft→reviewed` (user only).
- **"Archive" bypasses QUALITY_TRANSITIONS**: admin has override authority to deprecate any non-deprecated fragment regardless of current state. `bulkDeprecate` in the service skips the transition guard.
- **`origin` replaces `trust_source`** on fragments: the column is `origin` ('manual' / 'harvested' / 'generated'). The spec's "trust_source" filter and badge become an "origin" badge/filter.
- **`domain` not `subject`**: the DB column is `domain` throughout. The spec incorrectly uses "subject".
- **Tags in DB** are stored as JSON string (`"[\"tag1\",\"tag2\"]"`). Parse in route handler before sending to frontend.
- **Existing bulk body param is `ids`** (not `fragment_ids` as spec says). Use `ids` everywhere.
- **Drawer uses existing `GET /v1/fragments/:id` + `PUT /v1/fragments/:id`** (already handle auth for contributor+, admin role qualifies).
- **No entities in list card (V1)**: joining fragment_entities for every list item is expensive. Entities shown only in drawer.
- **Types endpoint**: `GET /v1/fragment-types` (not `/v1/references/types`).
- **Domains endpoint**: `GET /v1/references/subjects`.

---

## File Map

### New files
| File | Purpose |
|------|---------|
| `packages/server/src/routes/admin-fragment-routes.ts` | GET /v1/admin/fragments + POST /v1/admin/fragments/bulk-archive |
| `packages/server/src/routes/admin-fragments.integration.test.ts` | Integration tests for the 2 new routes |
| `packages/web/src/components/admin/status-badge.tsx` | draft/reviewed/approved/deprecated badge |
| `packages/web/src/components/admin/origin-badge.tsx` | manual/harvested/generated badge |
| `packages/web/src/components/admin/fragment-card.tsx` | Admin fragment card (checkbox, actions) |
| `packages/web/src/components/admin/fragments-toolbar.tsx` | Filter bar (status, domain, type, origin, lang, search, sort) |
| `packages/web/src/components/admin/fragments-bulk-actions.tsx` | Bulk approve/archive/delete toolbar |
| `packages/web/src/components/admin/fragment-detail-drawer.tsx` | Drawer: view + edit domain/type/lang/tags |
| `packages/web/src/pages/admin/fragments.tsx` | Admin fragments page (orchestrator) |

### Modified files
| File | Change |
|------|--------|
| `packages/server/src/services/fragment-service.ts` | Add `bulkDeprecate()` method |
| `packages/server/src/index.ts` | Register `adminFragmentRoutes` |
| `packages/web/src/App.tsx` | Remove harvest admin routes, add fragments route |
| `packages/web/src/layouts/admin-layout.tsx` | Sidebar: Harvest → Fragments |

### Deleted files
- `packages/web/src/pages/admin/harvest.tsx`
- `packages/web/src/pages/admin/harvest-job.tsx`

---

## Task 1: `bulkDeprecate` in fragment-service

**Files:**
- Modify: `packages/server/src/services/fragment-service.ts` (after the `bulkApprove` method, around line 726)

- [ ] **Step 1: Add `bulkDeprecate` method after `bulkApprove`**

Open `packages/server/src/services/fragment-service.ts`. Locate the `bulkApprove` method (line ~666). Add immediately after it (before `bulkDelete`):

```typescript
  async bulkDeprecate(
    ids: string[],
    userId: string,
    ip: string | undefined,
    onProgress?: (done: number) => void,
  ): Promise<{ done: number; errors: number }> {
    const now = new Date().toISOString();
    type Group = { git: GitRepository; filePaths: string[]; ids: string[] };
    const groups = new Map<string, Group>();
    let errors = 0;

    for (const id of ids) {
      try {
        const [frag] = await this.db.select().from(fragments).where(eq(fragments.id, id)).limit(1);
        if (!frag || frag.quality === 'deprecated') continue; // already deprecated → skip
        const storePath = await this.resolveStorePath(frag.collection_slug);
        const { frontmatter, body } = readFragment(join(storePath, frag.file_path));
        frontmatter.quality = 'deprecated';
        frontmatter.updated_at = now;
        writeFragment(join(storePath, 'fragments', frontmatter.domain), frontmatter, body);
        if (!groups.has(storePath))
          groups.set(storePath, { git: this.resolveGit(storePath), filePaths: [], ids: [] });
        const g = groups.get(storePath)!;
        g.filePaths.push(frag.file_path);
        g.ids.push(id);
      } catch (e) {
        console.error(`[bulkDeprecate] fragment ${id} failed:`, e);
        errors++;
      }
    }

    let done = 0;
    for (const [, { git, filePaths, ids: gIds }] of groups) {
      try {
        const hash = await git.commitFiles(
          filePaths,
          `chore: bulk archive ${gIds.length} fragments by ${userId}`,
        );
        await this.db
          .update(fragments)
          .set({ quality: 'deprecated', updated_at: now, git_hash: hash })
          .where(inArray(fragments.id, gIds));
        await this.audit.log({
          user_id: userId,
          role: 'admin',
          action: 'bulk_archive',
          fragment_id: gIds.join(','),
          ip_source: ip,
        });
        done += gIds.length;
        onProgress?.(done);
      } catch (e) {
        console.error(`[bulkDeprecate] git commit failed:`, e);
        errors += gIds.length;
      }
    }

    await this.searchService.removeFromIndex(ids);
    return { done, errors };
  }
```

Note: `searchService.removeFromIndex` accepts an array — verify the signature allows it, or call it in a loop.

- [ ] **Step 2: Fix removeFromIndex call if needed**

Check the signature of `searchService.removeFromIndex`. If it only accepts a single ID, replace the last call with:

```typescript
    for (const id of ids) {
      try { await this.searchService.removeFromIndex(id); } catch { /* ignore */ }
    }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors.

---

## Task 2: `adminFragmentRoutes` — new server routes + registration

**Files:**
- Create: `packages/server/src/routes/admin-fragment-routes.ts`
- Modify: `packages/server/src/index.ts` (add import + register call)

- [ ] **Step 1: Create `packages/server/src/routes/admin-fragment-routes.ts`**

```typescript
// packages/server/src/routes/admin-fragment-routes.ts
import type { FastifyInstance } from 'fastify';
import { eq, and, or, desc, asc, like, count, inArray, ne } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { fragments } from '../db/schema.js';
import { requireRole } from '../auth/middleware.js';
import type { buildAuthMiddleware } from '../auth/middleware.js';
import type { FragmentService } from '../services/fragment-service.js';
import type { JobService } from '../services/job-service.js';

export function adminFragmentRoutes(
  app: FastifyInstance,
  db: FragmintDb,
  authenticate: ReturnType<typeof buildAuthMiddleware>,
  fragmentService: FragmentService,
  jobService: JobService,
): void {
  const adminHandlers = [authenticate, requireRole('admin')];

  // ── GET /v1/admin/fragments ─────────────────────────────────────────
  app.get(
    '/v1/admin/fragments',
    { preHandler: adminHandlers },
    async (request, reply) => {
      const q = request.query as {
        quality?: string;
        domain?: string;
        type?: string;
        lang?: string;
        origin?: string;
        search?: string;
        sort?: string;
        limit?: string;
        offset?: string;
      };

      const limit = Math.min(Number(q.limit) || 50, 200);
      const offset = Number(q.offset) || 0;

      const conditions = [];
      if (q.quality) conditions.push(eq(fragments.quality, q.quality));
      if (q.domain) conditions.push(eq(fragments.domain, q.domain));
      if (q.type) conditions.push(eq(fragments.type, q.type));
      if (q.lang) conditions.push(eq(fragments.lang, q.lang));
      if (q.origin) conditions.push(eq(fragments.origin, q.origin));
      if (q.search) {
        const pattern = `%${q.search}%`;
        conditions.push(
          or(
            like(fragments.title, pattern),
            like(fragments.body_excerpt, pattern),
          ),
        );
      }

      const where = conditions.length ? and(...conditions) : undefined;

      const sortMap: Record<string, ReturnType<typeof desc | typeof asc>> = {
        date_desc: desc(fragments.updated_at),
        date_asc: asc(fragments.updated_at),
        title_asc: asc(fragments.title),
        title_desc: desc(fragments.title),
        usage_desc: desc(fragments.uses),
      };
      const orderBy = sortMap[q.sort ?? 'date_desc'] ?? desc(fragments.updated_at);

      const [rows, [{ total }], statusCounts] = await Promise.all([
        db
          .select({
            id: fragments.id,
            title: fragments.title,
            body_excerpt: fragments.body_excerpt,
            domain: fragments.domain,
            type: fragments.type,
            lang: fragments.lang,
            quality: fragments.quality,
            origin: fragments.origin,
            tags: fragments.tags,
            uses: fragments.uses,
            author: fragments.author,
            created_at: fragments.created_at,
            updated_at: fragments.updated_at,
          })
          .from(fragments)
          .where(where)
          .orderBy(orderBy)
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(fragments).where(where),
        db
          .select({ quality: fragments.quality, cnt: count() })
          .from(fragments)
          .groupBy(fragments.quality),
      ]);

      const byStatus = { draft: 0, reviewed: 0, approved: 0, deprecated: 0 };
      for (const row of statusCounts) {
        if (row.quality in byStatus) byStatus[row.quality as keyof typeof byStatus] = row.cnt;
      }

      const items = rows.map((r) => ({
        ...r,
        tags: r.tags ? (JSON.parse(r.tags) as string[]) : [],
      }));

      return reply.send({
        data: {
          items,
          pagination: {
            total,
            limit,
            offset,
            has_more: offset + limit < total,
          },
          stats: {
            total: byStatus.draft + byStatus.reviewed + byStatus.approved + byStatus.deprecated,
            by_status: byStatus,
          },
        },
        meta: null,
        error: null,
      });
    },
  );

  // ── POST /v1/admin/fragments/bulk-archive ───────────────────────────
  app.post(
    '/v1/admin/fragments/bulk-archive',
    { preHandler: adminHandlers },
    async (request, reply) => {
      const { ids } = request.body as { ids: string[] };
      if (!Array.isArray(ids) || ids.length === 0) {
        return reply.status(400).send({ data: null, meta: null, error: 'ids must be a non-empty array' });
      }
      const job = await jobService.create('bulk_archive', ids.length, request.user.login);
      reply.code(202).send({ data: { job_id: job.id }, meta: null, error: null });
      fragmentService
        .bulkDeprecate(ids, request.user.login, request.ip, (done) => jobService.progress(job.id, done))
        .then(({ done, errors }) => jobService.complete(job.id, done, errors))
        .catch(() => jobService.fail(job.id));
    },
  );
}
```

- [ ] **Step 2: Register the routes in `packages/server/src/index.ts`**

Add the import near the other admin route imports (around line 50):

```typescript
import { adminFragmentRoutes } from './routes/admin-fragment-routes.js';
```

Add the registration call after `adminRoutes(...)` (around line 352):

```typescript
  adminFragmentRoutes(app, db, authenticate, fragmentService, jobService);
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors.

---

## Task 3: Integration tests for admin fragment routes

**Files:**
- Create: `packages/server/src/routes/admin-fragments.integration.test.ts`

- [ ] **Step 1: Write the integration test file**

```typescript
// packages/server/src/routes/admin-fragments.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer, getAuthToken } from '../test-helpers.js';

describe('Admin fragment routes', () => {
  let server: any;
  let token: string;
  let createdId: string;

  beforeAll(async () => {
    server = await createTestServer();
    token = await getAuthToken(server.app);

    // Create a test fragment via the standard route
    const res = await server.app.inject({
      method: 'POST',
      url: '/v1/fragments',
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        type: 'argument',
        domain: 'test',
        lang: 'fr',
        body: '# Admin test\n\nFragment for admin route tests.',
        tags: ['admin-test'],
      },
    });
    createdId = JSON.parse(res.body).data.id;
  });

  afterAll(async () => {
    await server.app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('GET /v1/admin/fragments returns list with pagination and stats', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: '/v1/admin/fragments',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.data.items)).toBe(true);
    expect(body.data.pagination).toHaveProperty('total');
    expect(body.data.pagination).toHaveProperty('has_more');
    expect(body.data.stats.by_status).toHaveProperty('draft');
    expect(body.data.stats.by_status).toHaveProperty('reviewed');
    expect(body.data.stats.by_status).toHaveProperty('approved');
    expect(body.data.stats.by_status).toHaveProperty('deprecated');
  });

  it('GET /v1/admin/fragments filters by quality', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: '/v1/admin/fragments?quality=draft',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.items.every((i: any) => i.quality === 'draft')).toBe(true);
  });

  it('GET /v1/admin/fragments filters by search', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: '/v1/admin/fragments?search=Admin+test',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.items.some((i: any) => i.id === createdId)).toBe(true);
  });

  it('GET /v1/admin/fragments returns tags as array', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: `/v1/admin/fragments?quality=draft`,
      headers: auth(),
    });
    const body = JSON.parse(res.body);
    const item = body.data.items.find((i: any) => i.id === createdId);
    if (item) {
      expect(Array.isArray(item.tags)).toBe(true);
    }
  });

  it('POST /v1/admin/fragments/bulk-archive returns job_id', async () => {
    // First mark as approved so we can archive
    // (or directly use our draft fragment — bulkDeprecate skips transition check)
    const res = await server.app.inject({
      method: 'POST',
      url: '/v1/admin/fragments/bulk-archive',
      headers: auth(),
      payload: { ids: [createdId] },
    });
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.data.job_id).toBeDefined();
  });

  it('POST /v1/admin/fragments/bulk-archive rejects empty ids', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/v1/admin/fragments/bulk-archive',
      headers: auth(),
      payload: { ids: [] },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
pnpm --filter @fragmint/server test packages/server/src/routes/admin-fragments.integration.test.ts
```

Expected: all tests pass. If `createTestServer` doesn't auto-register `adminFragmentRoutes`, check `test-helpers.ts` — it should call the same server factory as `index.ts`.

---

## Task 4: `StatusBadge` component

**Files:**
- Create: `packages/web/src/components/admin/status-badge.tsx`

- [ ] **Step 1: Create the component**

```typescript
// packages/web/src/components/admin/status-badge.tsx

type Quality = 'draft' | 'reviewed' | 'approved' | 'deprecated';

const STATUS_CONFIG: Record<Quality, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  reviewed: { label: 'Reviewed', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  approved: { label: 'Approved', className: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  deprecated: { label: 'Archivé', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
};

export function StatusBadge({ quality }: { quality: string }) {
  const config = STATUS_CONFIG[quality as Quality] ?? {
    label: quality,
    className: 'bg-gray-100 text-gray-600',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${config.className}`}>
      {config.label}
    </span>
  );
}
```

---

## Task 5: `OriginBadge` component

**Files:**
- Create: `packages/web/src/components/admin/origin-badge.tsx`

- [ ] **Step 1: Create the component**

```typescript
// packages/web/src/components/admin/origin-badge.tsx

const ORIGIN_CONFIG: Record<string, { label: string; className: string }> = {
  manual: { label: 'Manuel', className: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  harvested: { label: 'Harvest', className: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  generated: { label: 'Généré', className: 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
};

export function OriginBadge({ origin }: { origin: string }) {
  const config = ORIGIN_CONFIG[origin] ?? { label: origin, className: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs ${config.className}`}>
      {config.label}
    </span>
  );
}
```

---

## Task 6: `AdminFragmentCard` component

**Files:**
- Create: `packages/web/src/components/admin/fragment-card.tsx`

This replaces nothing — it's distinct from the public `packages/web/src/components/fragment-card.tsx`.

- [ ] **Step 1: Create the component**

```typescript
// packages/web/src/components/admin/fragment-card.tsx
import { useState } from 'react';
import { StatusBadge } from './status-badge';
import { OriginBadge } from './origin-badge';
import { ConfirmModal } from './confirm-modal';

export interface AdminFragment {
  id: string;
  title: string | null;
  body_excerpt: string | null;
  domain: string;
  type: string;
  lang: string;
  quality: string;
  origin: string;
  tags: string[];
  uses: number;
  updated_at: string;
  author: string;
}

interface Props {
  fragment: AdminFragment;
  isSelected: boolean;
  onToggleSelect: () => void;
  onOpenDetail: () => void;
  onActionComplete: () => void;
}

export function AdminFragmentCard({ fragment, isSelected, onToggleSelect, onOpenDetail, onActionComplete }: Props) {
  const [pendingAction, setPendingAction] = useState<'archive' | 'delete' | null>(null);
  const [loading, setLoading] = useState(false);

  const handleApprove = async () => {
    setLoading(true);
    try {
      const r = await fetch('/v1/fragments/bulk-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [fragment.id] }),
      });
      if (!r.ok) throw new Error('Approve failed');
      onActionComplete();
    } finally {
      setLoading(false);
    }
  };

  const handleArchive = async () => {
    setLoading(true);
    try {
      const r = await fetch('/v1/admin/fragments/bulk-archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [fragment.id] }),
      });
      if (!r.ok) throw new Error('Archive failed');
      setPendingAction(null);
      onActionComplete();
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/v1/fragments/${fragment.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('Delete failed');
      setPendingAction(null);
      onActionComplete();
    } finally {
      setLoading(false);
    }
  };

  const updatedDate = new Date(fragment.updated_at).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  return (
    <div className={`border rounded-lg p-3 transition-colors ${isSelected ? 'bg-primary/5 border-primary' : 'bg-card hover:bg-muted/30'}`}>
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          aria-label="Sélectionner ce fragment"
          className="mt-1 shrink-0"
        />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className="font-medium text-sm truncate">
              {fragment.title || <em className="text-muted-foreground font-normal">Sans titre</em>}
            </h3>
            <StatusBadge quality={fragment.quality} />
          </div>

          {fragment.body_excerpt && (
            <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{fragment.body_excerpt}</p>
          )}

          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="px-1.5 py-0.5 bg-muted rounded font-mono text-xs">{fragment.domain}</span>
            <span className="px-1.5 py-0.5 bg-muted rounded text-xs">{fragment.type}</span>
            <span>·</span>
            <span>{fragment.lang.toUpperCase()}</span>
            {fragment.tags.length > 0 && (
              <>
                <span>·</span>
                <span className="text-blue-600 dark:text-blue-400">
                  #{fragment.tags.slice(0, 2).join(' #')}
                  {fragment.tags.length > 2 && ` +${fragment.tags.length - 2}`}
                </span>
              </>
            )}
            <span>·</span>
            <OriginBadge origin={fragment.origin} />
            <span>·</span>
            <span title={fragment.updated_at}>{updatedDate}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-1 shrink-0">
          <button
            onClick={onOpenDetail}
            className="px-2 py-1 text-xs border rounded hover:bg-muted"
            title="Voir le détail"
          >
            Voir
          </button>

          {/* Approve — only for reviewed fragments */}
          {fragment.quality === 'reviewed' && (
            <button
              onClick={handleApprove}
              disabled={loading}
              className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              title="Approuver"
            >
              ✓
            </button>
          )}

          {/* Archive — any non-deprecated */}
          {fragment.quality !== 'deprecated' && (
            <button
              onClick={() => setPendingAction('archive')}
              disabled={loading}
              className="px-2 py-1 text-xs border rounded hover:bg-muted text-amber-700 dark:text-amber-400"
              title="Archiver"
            >
              📦
            </button>
          )}

          {/* Delete */}
          <button
            onClick={() => setPendingAction('delete')}
            disabled={loading}
            className="px-2 py-1 text-xs border rounded hover:bg-muted text-red-700 dark:text-red-400"
            title="Supprimer définitivement"
          >
            🗑
          </button>
        </div>
      </div>

      {pendingAction === 'archive' && (
        <ConfirmModal
          title="Archiver ce fragment ?"
          message={`"${fragment.title || fragment.id}" sera passé en statut deprecated et retiré de la composition.`}
          confirmLabel="Archiver"
          onConfirm={handleArchive}
          onClose={() => setPendingAction(null)}
        />
      )}

      {pendingAction === 'delete' && (
        <ConfirmModal
          title="Supprimer définitivement ?"
          message={`"${fragment.title || fragment.id}" sera supprimé du vault Git. Action irréversible.`}
          confirmLabel={`Supprimer`}
          variant="danger"
          onConfirm={handleDelete}
          onClose={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}
```

---

## Task 7: `FragmentsToolbar` component

**Files:**
- Create: `packages/web/src/components/admin/fragments-toolbar.tsx`

- [ ] **Step 1: Create the component**

```typescript
// packages/web/src/components/admin/fragments-toolbar.tsx
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

export interface FragmentsFilters {
  quality: string;
  domain: string;
  type: string;
  lang: string;
  origin: string;
  search: string;
  sort: string;
}

export const DEFAULT_FILTERS: FragmentsFilters = {
  quality: 'reviewed', // default: what needs admin attention
  domain: '',
  type: '',
  lang: '',
  origin: '',
  search: '',
  sort: 'date_desc',
};

interface Props {
  filters: FragmentsFilters;
  onFiltersChange: (updates: Partial<FragmentsFilters>) => void;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function FragmentsToolbar({ filters, onFiltersChange }: Props) {
  const [localSearch, setLocalSearch] = useState(filters.search);
  const debouncedSearch = useDebounce(localSearch, 300);

  useEffect(() => {
    if (debouncedSearch !== filters.search) {
      onFiltersChange({ search: debouncedSearch });
    }
  }, [debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: domains } = useQuery({
    queryKey: ['references', 'subjects'],
    queryFn: async () => {
      const r = await fetch('/v1/references/subjects');
      const json = await r.json();
      return (json.data ?? []) as Array<{ slug: string; label: string }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: types } = useQuery({
    queryKey: ['fragment-types'],
    queryFn: async () => {
      const r = await fetch('/v1/fragment-types');
      const json = await r.json();
      return (json.data ?? []) as Array<{ slug: string; label: string }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Search */}
      <input
        type="text"
        placeholder="Rechercher titre ou contenu…"
        value={localSearch}
        onChange={(e) => setLocalSearch(e.target.value)}
        className="px-3 py-1.5 border rounded-md text-sm flex-1 min-w-[180px] bg-background"
      />

      {/* Status */}
      <select
        value={filters.quality}
        onChange={(e) => onFiltersChange({ quality: e.target.value })}
        className="px-2 py-1.5 border rounded-md text-sm bg-background"
      >
        <option value="">Tous statuts</option>
        <option value="draft">Draft</option>
        <option value="reviewed">Reviewed</option>
        <option value="approved">Approved</option>
        <option value="deprecated">Archivés</option>
      </select>

      {/* Domain */}
      <select
        value={filters.domain}
        onChange={(e) => onFiltersChange({ domain: e.target.value })}
        className="px-2 py-1.5 border rounded-md text-sm bg-background"
      >
        <option value="">Tous domaines</option>
        {domains?.map((d) => (
          <option key={d.slug} value={d.slug}>{d.label}</option>
        ))}
      </select>

      {/* Type */}
      <select
        value={filters.type}
        onChange={(e) => onFiltersChange({ type: e.target.value })}
        className="px-2 py-1.5 border rounded-md text-sm bg-background"
      >
        <option value="">Tous types</option>
        {types?.map((t) => (
          <option key={t.slug} value={t.slug}>{t.label}</option>
        ))}
      </select>

      {/* Origin */}
      <select
        value={filters.origin}
        onChange={(e) => onFiltersChange({ origin: e.target.value })}
        className="px-2 py-1.5 border rounded-md text-sm bg-background"
      >
        <option value="">Toutes origines</option>
        <option value="manual">Manuel</option>
        <option value="harvested">Harvest</option>
        <option value="generated">Généré</option>
      </select>

      {/* Lang */}
      <select
        value={filters.lang}
        onChange={(e) => onFiltersChange({ lang: e.target.value })}
        className="px-2 py-1.5 border rounded-md text-sm bg-background"
      >
        <option value="">Toutes langues</option>
        <option value="fr">FR</option>
        <option value="en">EN</option>
        <option value="es">ES</option>
        <option value="pt">PT</option>
      </select>

      {/* Sort */}
      <select
        value={filters.sort}
        onChange={(e) => onFiltersChange({ sort: e.target.value })}
        className="px-2 py-1.5 border rounded-md text-sm bg-background"
      >
        <option value="date_desc">Plus récent</option>
        <option value="date_asc">Plus ancien</option>
        <option value="title_asc">Titre A→Z</option>
        <option value="title_desc">Titre Z→A</option>
        <option value="usage_desc">Plus utilisés</option>
      </select>
    </div>
  );
}
```

---

## Task 8: `FragmentsBulkActions` component

**Files:**
- Create: `packages/web/src/components/admin/fragments-bulk-actions.tsx`

- [ ] **Step 1: Create the component**

```typescript
// packages/web/src/components/admin/fragments-bulk-actions.tsx
import { useState } from 'react';
import { ConfirmModal } from './confirm-modal';

interface Props {
  selectedIds: string[];
  onComplete: () => void;
  onCancel: () => void;
}

type BulkAction = 'approve' | 'archive' | 'delete';

const ENDPOINTS: Record<BulkAction, string> = {
  approve: '/v1/fragments/bulk-approve',
  archive: '/v1/admin/fragments/bulk-archive',
  delete: '/v1/fragments/bulk-delete',
};

const ACTION_LABELS: Record<BulkAction, string> = {
  approve: 'Approuver',
  archive: 'Archiver',
  delete: 'Supprimer',
};

export function FragmentsBulkActions({ selectedIds, onComplete, onCancel }: Props) {
  const [pendingAction, setPendingAction] = useState<BulkAction | null>(null);
  const [loading, setLoading] = useState(false);

  const executeAction = async (action: BulkAction) => {
    setLoading(true);
    try {
      const r = await fetch(ENDPOINTS[action], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? `${action} failed`);
      }
      setPendingAction(null);
      onComplete();
    } catch (e: any) {
      alert(`Erreur : ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const n = selectedIds.length;

  return (
    <div className="flex items-center justify-between bg-primary/5 border border-primary/20 rounded-lg px-4 py-2.5">
      <span className="text-sm font-medium">
        {n} fragment{n > 1 ? 's' : ''} sélectionné{n > 1 ? 's' : ''}
      </span>

      <div className="flex gap-2">
        <button
          onClick={() => setPendingAction('approve')}
          disabled={loading}
          className="px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
        >
          Approuver
        </button>
        <button
          onClick={() => setPendingAction('archive')}
          disabled={loading}
          className="px-3 py-1.5 bg-amber-600 text-white text-sm rounded hover:bg-amber-700 disabled:opacity-50"
        >
          Archiver
        </button>
        <button
          onClick={() => setPendingAction('delete')}
          disabled={loading}
          className="px-3 py-1.5 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50"
        >
          Supprimer
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 border text-sm rounded hover:bg-muted"
        >
          Désélectionner
        </button>
      </div>

      {pendingAction === 'approve' && (
        <ConfirmModal
          title="Approuver les fragments ?"
          message={`${n} fragment${n > 1 ? 's' : ''} seront approuvés. Les fragments non "reviewed" seront ignorés par le serveur.`}
          confirmLabel={`Approuver ${n}`}
          onConfirm={() => executeAction('approve')}
          onClose={() => setPendingAction(null)}
        />
      )}
      {pendingAction === 'archive' && (
        <ConfirmModal
          title="Archiver les fragments ?"
          message={`${n} fragment${n > 1 ? 's' : ''} passeront en "deprecated" et ne seront plus utilisables en composition.`}
          confirmLabel={`Archiver ${n}`}
          onConfirm={() => executeAction('archive')}
          onClose={() => setPendingAction(null)}
        />
      )}
      {pendingAction === 'delete' && (
        <ConfirmModal
          title="Supprimer définitivement ?"
          message={`${n} fragment${n > 1 ? 's' : ''} seront supprimés du vault Git. Action irréversible.`}
          confirmLabel={`Supprimer ${n}`}
          variant="danger"
          onConfirm={() => executeAction('delete')}
          onClose={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}
```

---

## Task 9: `FragmentDetailDrawer` component

**Files:**
- Create: `packages/web/src/components/admin/fragment-detail-drawer.tsx`

Uses existing `GET /v1/fragments/:id` (returns `{ data: { ...fragment, body, frontmatter } }`) and `PUT /v1/fragments/:id`.

- [ ] **Step 1: Create the component**

```typescript
// packages/web/src/components/admin/fragment-detail-drawer.tsx
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { StatusBadge } from './status-badge';
import { OriginBadge } from './origin-badge';

interface Props {
  fragmentId: string;
  onClose: () => void;
  onUpdate: () => void;
}

export function FragmentDetailDrawer({ fragmentId, onClose, onUpdate }: Props) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ domain: '', type: '', lang: '', tags: '' });

  const { data: frag, isLoading } = useQuery({
    queryKey: ['fragment-detail', fragmentId],
    queryFn: async () => {
      const r = await fetch(`/v1/fragments/${fragmentId}`);
      if (!r.ok) throw new Error('Fragment not found');
      const json = await r.json();
      return json.data as {
        id: string; title: string | null; body: string; body_excerpt: string | null;
        domain: string; type: string; lang: string; quality: string; origin: string;
        tags: string[] | null; uses: number; author: string;
        created_at: string; updated_at: string;
      };
    },
  });

  useEffect(() => {
    if (frag) {
      setForm({
        domain: frag.domain,
        type: frag.type,
        lang: frag.lang,
        tags: (frag.tags ?? []).join(', '),
      });
    }
  }, [frag]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const tags = form.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const r = await fetch(`/v1/fragments/${fragmentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: form.domain, type: form.type, lang: form.lang, tags }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? 'Update failed');
      }
      return r.json();
    },
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ['fragment-detail', fragmentId] });
      onUpdate();
    },
    onError: (e: any) => alert(`Erreur : ${e.message}`),
  });

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Détail du fragment"
        className="fixed inset-y-0 right-0 w-full max-w-[640px] bg-background shadow-2xl z-50 border-l overflow-y-auto flex flex-col"
      >
        {/* Header */}
        <div className="sticky top-0 bg-background border-b px-5 py-3 flex items-center justify-between z-10">
          <button onClick={onClose} className="text-sm hover:underline text-muted-foreground">
            ← Fermer
          </button>
          {frag && (
            <div className="flex items-center gap-2">
              <StatusBadge quality={frag.quality} />
              {!editing ? (
                <button
                  onClick={() => setEditing(true)}
                  className="px-3 py-1 text-sm border rounded hover:bg-muted"
                >
                  Éditer
                </button>
              ) : (
                <>
                  <button
                    onClick={() => { setEditing(false); }}
                    className="px-3 py-1 text-sm border rounded hover:bg-muted"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={() => updateMutation.mutate()}
                    disabled={updateMutation.isPending}
                    className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded disabled:opacity-50"
                  >
                    {updateMutation.isPending ? '…' : 'Enregistrer'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 p-6 space-y-5">
          {isLoading && <p className="text-muted-foreground text-sm">Chargement…</p>}

          {frag && (
            <>
              {/* Title */}
              <h2 className="text-lg font-semibold">
                {frag.title || <em className="text-muted-foreground font-normal">Sans titre</em>}
              </h2>

              {/* Metadata grid */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Domaine</label>
                  {editing ? (
                    <input
                      value={form.domain}
                      onChange={(e) => setForm({ ...form, domain: e.target.value })}
                      className="w-full px-2 py-1 border rounded text-sm font-mono bg-background"
                    />
                  ) : (
                    <code className="text-sm">{frag.domain}</code>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Type</label>
                  {editing ? (
                    <input
                      value={form.type}
                      onChange={(e) => setForm({ ...form, type: e.target.value })}
                      className="w-full px-2 py-1 border rounded text-sm font-mono bg-background"
                    />
                  ) : (
                    <code className="text-sm">{frag.type}</code>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Langue</label>
                  {editing ? (
                    <select
                      value={form.lang}
                      onChange={(e) => setForm({ ...form, lang: e.target.value })}
                      className="w-full px-2 py-1 border rounded text-sm bg-background"
                    >
                      <option value="fr">fr</option>
                      <option value="en">en</option>
                      <option value="es">es</option>
                      <option value="pt">pt</option>
                    </select>
                  ) : (
                    <span className="text-sm">{frag.lang}</span>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Utilisations</label>
                  <span className="text-sm">{frag.uses}</span>
                </div>
              </div>

              {/* Tags */}
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Tags</label>
                {editing ? (
                  <input
                    value={form.tags}
                    onChange={(e) => setForm({ ...form, tags: e.target.value })}
                    placeholder="tag1, tag2, tag3"
                    className="w-full px-2 py-1 border rounded text-sm bg-background"
                  />
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {(frag.tags ?? []).length === 0 ? (
                      <span className="text-xs text-muted-foreground">Aucun tag</span>
                    ) : (
                      (frag.tags ?? []).map((t) => (
                        <span key={t} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded dark:bg-blue-900/30 dark:text-blue-300">
                          #{t}
                        </span>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Origin */}
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Origine</label>
                <OriginBadge origin={frag.origin} />
              </div>

              {/* Body (read-only V1) */}
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Contenu <span className="text-muted-foreground/60">(lecture seule)</span>
                </label>
                <pre className="text-xs whitespace-pre-wrap font-sans bg-muted/40 rounded p-3 max-h-80 overflow-y-auto border">
                  {frag.body ?? frag.body_excerpt ?? '(vide)'}
                </pre>
              </div>

              {/* System info */}
              <div className="border-t pt-4 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div><strong>ID</strong> : <code className="text-xs">{frag.id}</code></div>
                <div><strong>Auteur</strong> : {frag.author}</div>
                <div><strong>Créé</strong> : {new Date(frag.created_at).toLocaleString('fr-FR')}</div>
                <div><strong>Modifié</strong> : {new Date(frag.updated_at).toLocaleString('fr-FR')}</div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
```

---

## Task 10: `AdminFragmentsPage` page

**Files:**
- Create: `packages/web/src/pages/admin/fragments.tsx`

- [ ] **Step 1: Create the page**

```typescript
// packages/web/src/pages/admin/fragments.tsx
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FragmentsToolbar,
  DEFAULT_FILTERS,
  type FragmentsFilters,
} from '@/components/admin/fragments-toolbar';
import { AdminFragmentCard, type AdminFragment } from '@/components/admin/fragment-card';
import { FragmentsBulkActions } from '@/components/admin/fragments-bulk-actions';
import { FragmentDetailDrawer } from '@/components/admin/fragment-detail-drawer';
import { StatusBadge } from '@/components/admin/status-badge';

export default function AdminFragmentsPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<FragmentsFilters>(DEFAULT_FILTERS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [drawerFragmentId, setDrawerFragmentId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const LIMIT = 50;

  const updateFilters = (updates: Partial<FragmentsFilters>) => {
    setFilters((prev) => ({ ...prev, ...updates }));
    setSelectedIds(new Set());
    setPage(0);
  };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-fragments', filters, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        sort: filters.sort,
        limit: String(LIMIT),
        offset: String(page * LIMIT),
      });
      if (filters.quality) params.set('quality', filters.quality);
      if (filters.domain) params.set('domain', filters.domain);
      if (filters.type) params.set('type', filters.type);
      if (filters.lang) params.set('lang', filters.lang);
      if (filters.origin) params.set('origin', filters.origin);
      if (filters.search) params.set('search', filters.search);
      const r = await fetch(`/v1/admin/fragments?${params}`);
      if (!r.ok) throw new Error('Failed to fetch fragments');
      return (await r.json()).data as {
        items: AdminFragment[];
        pagination: { total: number; limit: number; offset: number; has_more: boolean };
        stats: { total: number; by_status: Record<string, number> };
      };
    },
  });

  const items = data?.items ?? [];
  const pagination = data?.pagination;
  const stats = data?.stats;

  const allSelected = items.length > 0 && items.every((f) => selectedIds.has(f.id));
  const someSelected = items.some((f) => selectedIds.has(f.id));

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const onBulkComplete = () => {
    setSelectedIds(new Set());
    refetch();
    queryClient.invalidateQueries({ queryKey: ['admin-fragments'] });
  };

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Fragments</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gérez les fragments : filtrer par statut, approuver en masse, archiver, supprimer.
        </p>
      </div>

      {/* Global stats */}
      {stats && (
        <div className="flex flex-wrap gap-3 text-sm border-b pb-3">
          {(['reviewed', 'draft', 'approved', 'deprecated'] as const).map((q) => (
            <button
              key={q}
              onClick={() => updateFilters({ quality: filters.quality === q ? '' : q })}
              className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
              title={`Filtrer par ${q}`}
            >
              <StatusBadge quality={q} />
              <span className="font-semibold">{stats.by_status[q] ?? 0}</span>
            </button>
          ))}
          <span className="text-muted-foreground ml-auto">{stats.total} fragments total</span>
        </div>
      )}

      {/* Toolbar */}
      <FragmentsToolbar filters={filters} onFiltersChange={updateFilters} />

      {/* Bulk actions */}
      {selectedIds.size > 0 && (
        <FragmentsBulkActions
          selectedIds={Array.from(selectedIds)}
          onComplete={onBulkComplete}
          onCancel={() => setSelectedIds(new Set())}
        />
      )}

      {/* List */}
      {isLoading ? (
        <p className="text-muted-foreground text-sm">Chargement…</p>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          Aucun fragment ne correspond aux filtres
        </div>
      ) : (
        <div className="space-y-2">
          {/* Select all header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
              onChange={() => (allSelected
                ? setSelectedIds(new Set())
                : setSelectedIds(new Set(items.map((f) => f.id)))
              )}
              aria-label="Tout sélectionner"
            />
            <span>
              {allSelected
                ? `Tous les ${items.length} fragments sélectionnés`
                : someSelected
                ? `${selectedIds.size} sur ${items.length}`
                : `Tout sélectionner (${items.length})`}
            </span>
          </div>

          {items.map((fragment) => (
            <AdminFragmentCard
              key={fragment.id}
              fragment={fragment}
              isSelected={selectedIds.has(fragment.id)}
              onToggleSelect={() => toggleSelect(fragment.id)}
              onOpenDetail={() => setDrawerFragmentId(fragment.id)}
              onActionComplete={onBulkComplete}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination && (pagination.total > LIMIT) && (
        <div className="flex items-center justify-between border-t pt-3">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            className="px-3 py-1.5 border rounded text-sm disabled:opacity-40 hover:bg-muted"
          >
            ← Précédent
          </button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1} · {pagination.total} fragments
          </span>
          <button
            onClick={() => setPage(page + 1)}
            disabled={!pagination.has_more}
            className="px-3 py-1.5 border rounded text-sm disabled:opacity-40 hover:bg-muted"
          >
            Suivant →
          </button>
        </div>
      )}

      {/* Detail drawer */}
      {drawerFragmentId && (
        <FragmentDetailDrawer
          fragmentId={drawerFragmentId}
          onClose={() => setDrawerFragmentId(null)}
          onUpdate={onBulkComplete}
        />
      )}
    </div>
  );
}
```

---

## Task 11: Wiring — Router, sidebar, cleanup

**Files:**
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/layouts/admin-layout.tsx`
- Delete: `packages/web/src/pages/admin/harvest.tsx`
- Delete: `packages/web/src/pages/admin/harvest-job.tsx`

- [ ] **Step 1: Update `App.tsx` — replace harvest routes with fragments route**

In `packages/web/src/App.tsx`:

Remove these lines:
```typescript
import AdminHarvestPage from '@/pages/admin/harvest';
import AdminHarvestJobPage from '@/pages/admin/harvest-job';
```

Add this import near the other admin imports:
```typescript
import AdminFragmentsPage from '@/pages/admin/fragments';
```

In the admin `<Routes>` block, replace:
```typescript
<Route path="harvest" element={<AdminHarvestPage />} />
<Route path="harvest/jobs/:jobId" element={<AdminHarvestJobPage />} />
```
with:
```typescript
<Route path="fragments" element={<AdminFragmentsPage />} />
```

- [ ] **Step 2: Update `admin-layout.tsx` — sidebar nav item**

In `packages/web/src/layouts/admin-layout.tsx`, line 34, replace:
```typescript
  { to: '/admin/harvest', label: 'Harvest', icon: FileStack },
```
with:
```typescript
  { to: '/admin/fragments', label: 'Fragments', icon: FileStack },
```

- [ ] **Step 3: Delete old admin harvest pages**

```bash
rm packages/web/src/pages/admin/harvest.tsx
rm packages/web/src/pages/admin/harvest-job.tsx
```

- [ ] **Step 4: Check for orphaned imports**

```bash
grep -r "admin/harvest\|AdminHarvestPage\|AdminHarvestJobPage" packages/web/src/ --include="*.tsx" --include="*.ts"
```

Expected: no output (all references removed).

- [ ] **Step 5: TypeScript check**

```bash
pnpm --filter @fragmint/web typecheck
```

Expected: no errors.

---

## Task 12: Final validation

- [ ] **Step 1: Run all server tests**

```bash
pnpm --filter @fragmint/server test
```

Expected: all tests pass (including new `admin-fragments.integration.test.ts`).

- [ ] **Step 2: Run full lint + typecheck**

```bash
pnpm lint
pnpm --filter @fragmint/server typecheck
pnpm --filter @fragmint/web typecheck
```

Expected: no errors.

- [ ] **Step 3: Manual smoke test checklist**

Start the dev server and verify:
- [ ] `/admin/fragments` loads with `quality=reviewed` filter active by default
- [ ] Stats bar shows clickable badges (draft / reviewed / approved / deprecated)
- [ ] Clicking a stat badge filters the list
- [ ] Search is debounced (no request on every keystroke, fires after 300ms pause)
- [ ] Domain, type, origin, lang dropdowns work and combine with search
- [ ] Selecting fragments shows the bulk actions bar
- [ ] "Tout sélectionner" checkbox selects all visible items
- [ ] Bulk "Approuver" fires confirm modal → submits → list refreshes
- [ ] Bulk "Archiver" fires confirm modal → submits → list refreshes
- [ ] Bulk "Supprimer" fires confirm modal (danger variant) → submits → list refreshes
- [ ] Individual "✓" (approve) visible only on `reviewed` fragments → works
- [ ] Individual "📦" (archive) visible on non-deprecated fragments → confirm modal → works
- [ ] Individual "🗑" (delete) → confirm modal (danger) → works
- [ ] "Voir" opens the detail drawer
- [ ] Drawer closes on Escape or clicking overlay
- [ ] Drawer "Éditer" enables domain/type/lang/tags fields
- [ ] Saving drawer updates the list on close
- [ ] `/admin/harvest` returns 404
- [ ] Sidebar shows "Fragments" (not "Harvest") as the first nav item
- [ ] User harvest page `/harvest` is unaffected

---

## Notes for implementer

1. **`removeFromIndex` in `bulkDeprecate`**: check if `SearchService.removeFromIndex` accepts a single `string` or `string[]`. If single, wrap in a loop (see Task 1, Step 2).

2. **Auth on the drawer's `PUT /v1/fragments/:id`**: uses `writeHandlers` (contributor+). Admin role satisfies this — no change needed.

3. **`GET /v1/fragment-types` auth**: check if this endpoint requires auth. If it returns 401 without a token, add the auth header to the fetch in `FragmentsToolbar`.

4. **`asc` import**: `asc` is not currently imported in `fragment-service.ts`, but the new `admin-fragment-routes.ts` imports it directly from `drizzle-orm` — no change to the service import needed.

5. **File size limit**: `fragment-service.ts` is already large. `bulkDeprecate` adds ~40 lines. Still within acceptable limits — no split required.
