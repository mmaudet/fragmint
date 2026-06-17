# Admin Bulk Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bulk delete on the Validation page (admin = all, contributor/expert = own non-approved) and a "Delete job" button on the Harvest page (admin only).

**Architecture:** Two independent surfaces. Server side: (1) a new `filterOwnedIds` helper + `POST /fragments/bulk-delete-own` endpoint that reuses the existing `bulkDelete` service after filtering by ownership + quality; (2) a `DELETE /v1/harvest/jobs/:id` endpoint that removes the job and all its candidates. Frontend: the `ValidationTabContent` gets a `secondaryBulkAction` prop; the Harvest page gets a confirmation dialog + delete mutation.

**Tech Stack:** Node.js, Fastify 5, Drizzle ORM (SQLite), React 19, TanStack Query, shadcn/ui Dialog, TypeScript

---

## File Map

| File | Change |
|------|--------|
| `packages/web/src/lib/i18n.tsx` | Add 4 new keys: `harvest.deleteJob`, `harvest.deleteJobConfirm`, `validation.deleteSelected`, `validation.deleteSelectedConfirm` |
| `packages/server/src/services/fragment-service.ts` | Add `filterOwnedIds(ids, authorLogin)` method; add `ne` to drizzle-orm import |
| `packages/server/src/routes/fragment-routes.ts` | Add `POST /fragments/bulk-delete-own` (writeHandlers) |
| `packages/server/src/routes/harvest-routes.ts` | Add `DELETE /v1/harvest/jobs/:id` (adminHandlers); import `harvestJobs` + `ne` |
| `packages/web/src/api/hooks/use-harvest.ts` | Add `useDeleteHarvestJob` mutation hook |
| `packages/web/src/pages/harvest.tsx` | Delete job button + confirmation Dialog |
| `packages/web/src/components/validation-tab-content.tsx` | Add `secondaryBulkAction?: BulkAction` prop |
| `packages/web/src/pages/validation.tsx` | Wire delete bulk action for admin + contributor |

---

## Task 1: Add i18n keys

**Files:**
- Modify: `packages/web/src/lib/i18n.tsx`

- [ ] **Step 1: Add 2 keys to the `harvest` section**

In `packages/web/src/lib/i18n.tsx`, find the `harvest:` object (around line 195) and add after the `error` key:

```typescript
    deleteJob: { fr: 'Supprimer le job', en: 'Delete job' },
    deleteJobConfirm: {
      fr: (n: number) => `Supprimer ce job et ses ${n} candidat(s) ?`,
      en: (n: number) => `Delete this job and its ${n} candidate(s)?`,
    },
```

- [ ] **Step 2: Add 2 keys to the `validation` section**

In the `validation:` object (around line 159), add after `bulkError`:

```typescript
    deleteSelected: { fr: 'Supprimer', en: 'Delete' },
    deleteSelectedConfirm: {
      fr: (n: number) => `Supprimer ${n} fragment(s) définitivement ?`,
      en: (n: number) => `Permanently delete ${n} fragment(s)?`,
    },
```

- [ ] **Step 3: Update the `useI18n` / `t` function type if needed**

Check how other function-valued keys are called (e.g. search for an existing `fr: (n:` or `fr: (` pattern in i18n.tsx). If `t()` only handles string values, the plan already supports it: call the key as `t('harvest', 'deleteJobConfirm')(candidates.length)`. Verify no type error by running:

```bash
pnpm --filter @fragmint/web exec tsc --noEmit 2>&1 | grep "i18n"
```

If there are type errors from the function-valued keys, change the values to static strings instead:

```typescript
    deleteJobConfirm: {
      fr: 'Supprimer ce job et tous ses candidats ?',
      en: 'Delete this job and all its candidates?',
    },
    deleteSelectedConfirm: {
      fr: 'Supprimer les fragments sélectionnés définitivement ?',
      en: 'Permanently delete selected fragments?',
    },
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/lib/i18n.tsx
git commit -m "feat(i18n): add delete job and delete selected keys"
```

---

## Task 2: Server — `filterOwnedIds` + `POST /fragments/bulk-delete-own`

**Files:**
- Modify: `packages/server/src/services/fragment-service.ts`
- Modify: `packages/server/src/routes/fragment-routes.ts`

- [ ] **Step 1: Add `ne` to the drizzle-orm import in `fragment-service.ts`**

Line 2 currently reads:
```typescript
import { eq, and, or, desc, like, isNull, lte, gte, count, inArray } from 'drizzle-orm';
```

Change to:
```typescript
import { eq, and, or, desc, like, isNull, lte, gte, count, inArray, ne } from 'drizzle-orm';
```

- [ ] **Step 2: Add `filterOwnedIds` method to `FragmentService`**

Add this method before `facets()` (search for `async facets(` to find the location):

```typescript
async filterOwnedIds(ids: string[], authorLogin: string): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await this.db
    .select({ id: fragments.id })
    .from(fragments)
    .where(
      and(
        inArray(fragments.id, ids),
        eq(fragments.author, authorLogin),
        ne(fragments.quality, 'approved'),
      ),
    );
  return rows.map((r) => r.id);
}
```

- [ ] **Step 3: TypeScript check**

```bash
pnpm --filter @fragmint/server exec tsc --noEmit 2>&1 | grep "fragment-service"
```

Expected: no output (no new errors in this file).

- [ ] **Step 4: Add `POST /fragments/bulk-delete-own` route**

In `packages/server/src/routes/fragment-routes.ts`, find the `bulk-delete` route (around line 304). Add the following route immediately after it:

```typescript
  // Bulk delete own (contributor/expert — only deletes fragments authored by the requester, non-approved)
  app.post(`${prefix}/fragments/bulk-delete-own`, { preHandler: writeHandlers }, async (request, reply) => {
    if (!jobService) return reply.status(501).send({ data: null, meta: null, error: 'Job service not available' });
    const { ids } = request.body as { ids: string[] };
    if (!Array.isArray(ids) || ids.length === 0)
      return reply.status(400).send({ data: null, meta: null, error: 'ids required' });
    const ownedIds = await fragmentService.filterOwnedIds(ids, request.user.login);
    if (ownedIds.length === 0)
      return reply.code(202).send({ data: { job_id: null, done: 0 }, meta: null, error: null });
    const job = await jobService.create('bulk_delete', ownedIds.length, request.user.login);
    reply.code(202).send({ data: { job_id: job.id }, meta: null, error: null });
    fragmentService
      .bulkDelete(ownedIds, request.user.login, request.ip, (done) => jobService.progress(job.id, done))
      .then(({ done, errors }) => jobService.complete(job.id, done, errors))
      .catch(() => jobService.fail(job.id));
  });
```

- [ ] **Step 5: TypeScript check**

```bash
pnpm --filter @fragmint/server exec tsc --noEmit 2>&1 | grep "fragment-routes\|fragment-service"
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/fragment-service.ts packages/server/src/routes/fragment-routes.ts
git commit -m "feat(server): add filterOwnedIds and bulk-delete-own endpoint"
```

---

## Task 3: Server — `DELETE /v1/harvest/jobs/:id`

**Files:**
- Modify: `packages/server/src/routes/harvest-routes.ts`

- [ ] **Step 1: Add `harvestJobs` and `ne` to the imports**

Line 8 currently reads:
```typescript
import { harvestCandidates, fragmentDomains, fragmentTags } from '../db/schema.js';
```

Change to:
```typescript
import { harvestCandidates, harvestJobs, fragmentDomains, fragmentTags } from '../db/schema.js';
```

Also add `ne` to the drizzle-orm import — line 4 currently reads:
```typescript
import { eq, and } from 'drizzle-orm';
```

Change to:
```typescript
import { eq, and, inArray } from 'drizzle-orm';
```

(`ne` is not needed here — `inArray` and `eq` are sufficient for delete.)

- [ ] **Step 2: Add `adminHandlers` definition**

Check if `adminHandlers` already exists in this file:
```bash
grep -n "adminHandlers" packages/server/src/routes/harvest-routes.ts
```

If it doesn't exist, add it after `contributorHandlers` (around line 30):

```typescript
  const adminHandlers = options?.collectionMiddleware
    ? [authenticate, options.collectionMiddleware]
    : [authenticate, requireRole('admin')];
```

- [ ] **Step 3: Add the DELETE route**

Find the end of the harvest routes file (last `app.` route). Add before the closing brace of `harvestRoutes`:

```typescript
  // DELETE /v1/harvest/jobs/:id — admin only, deletes job + all its candidates
  app.delete(`${prefix}/harvest/jobs/:id`, { preHandler: adminHandlers }, async (request, reply) => {
    if (!db) return reply.status(501).send({ data: null, meta: null, error: 'DB not available' });
    const { id } = request.params as { id: string };

    const existing = await db
      .select({ id: harvestJobs.id })
      .from(harvestJobs)
      .where(eq(harvestJobs.id, id))
      .limit(1);

    if (existing.length === 0)
      return reply.status(404).send({ data: null, meta: null, error: 'Job not found' });

    await db.delete(harvestCandidates).where(eq(harvestCandidates.job_id, id));
    await db.delete(harvestJobs).where(eq(harvestJobs.id, id));

    return reply.send({ data: { deleted: true }, meta: null, error: null });
  });
```

- [ ] **Step 4: TypeScript check**

```bash
pnpm --filter @fragmint/server exec tsc --noEmit 2>&1 | grep "harvest-routes"
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/harvest-routes.ts
git commit -m "feat(server): add DELETE /harvest/jobs/:id endpoint"
```

---

## Task 4: Frontend — `useDeleteHarvestJob` hook

**Files:**
- Modify: `packages/web/src/api/hooks/use-harvest.ts`

- [ ] **Step 1: Add the mutation hook**

In `packages/web/src/api/hooks/use-harvest.ts`, add after `useValidateCandidates`:

```typescript
export function useDeleteHarvestJob(collectionSlug: string) {
  return useMutation({
    mutationFn: (jobId: string) =>
      apiRequest<{ deleted: boolean }>(
        'DELETE',
        collectionApiUrl(collectionSlug, `/harvest/jobs/${jobId}`),
      ),
  });
}
```

- [ ] **Step 2: TypeScript check**

```bash
pnpm --filter @fragmint/web exec tsc --noEmit 2>&1 | grep "use-harvest"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/api/hooks/use-harvest.ts
git commit -m "feat(web): add useDeleteHarvestJob hook"
```

---

## Task 5: Frontend — Harvest page delete job button + dialog

**Files:**
- Modify: `packages/web/src/pages/harvest.tsx`

- [ ] **Step 1: Add imports**

At the top of `harvest.tsx`, add to the existing imports:

```typescript
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useDeleteHarvestJob } from '@/api/hooks/use-harvest';
import { useAuth } from '@/lib/auth-context';
```

- [ ] **Step 2: Add state and hook**

Inside `HarvestPage()`, after the existing hooks (around line 69), add:

```typescript
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const deleteJobMutation = useDeleteHarvestJob(activeCollection);
```

- [ ] **Step 3: Add `handleDeleteJob` handler**

After `handleCommit` (around line 169), add:

```typescript
  const handleDeleteJob = () => {
    if (!jobId) return;
    deleteJobMutation.mutate(jobId, {
      onSuccess: () => {
        setDeleteConfirmOpen(false);
        sessionStorage.removeItem(`harvest-decisions-${jobId}`);
        sessionStorage.removeItem(`harvest-mods-${jobId}`);
        setJobId(null);
        setFiles([]);
        _setDecisions({});
        _setModifications({});
        toast.success(t('harvest', 'deleteJob'));
      },
      onError: (err: any) => toast.error(err.message ?? 'Erreur'),
    });
  };
```

- [ ] **Step 4: Add the delete button to the actions bar**

Find the actions bar (around line 382–405):

```tsx
      {/* Actions */}
      {!commitResult && !allCommitted && candidates.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={acceptAll}>
```

Add the delete button at the end of that div (after the Commit button, before the closing `</div>`):

```tsx
          {isAdmin && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={deleteJobMutation.isPending}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              {t('harvest', 'deleteJob')}
            </Button>
          )}
```

Also add `Trash2` to the lucide-react import at the top:

```typescript
import { Upload, Loader2, CheckCircle, XCircle, AlertTriangle, FileText, Trash2 } from 'lucide-react';
```

- [ ] **Step 5: Add the confirmation Dialog**

Before the closing `</div>` of the harvest page return (after `<CandidateDetailSheet ... />`), add:

```tsx
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('harvest', 'deleteJob')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t('harvest', 'deleteJobConfirm')}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              {t('common', 'cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteJob}
              disabled={deleteJobMutation.isPending}
            >
              {deleteJobMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-1" />
              )}
              {t('harvest', 'deleteJob')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 6: Check `t('common', 'cancel')` key exists**

```bash
grep "cancel" packages/web/src/lib/i18n.tsx | head -5
```

If the key is named differently (e.g. `'annuler'`), use the correct key.

- [ ] **Step 7: TypeScript check**

```bash
pnpm --filter @fragmint/web exec tsc --noEmit 2>&1 | grep "harvest"
```

Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/pages/harvest.tsx
git commit -m "feat(web): add delete job button and dialog to harvest page"
```

---

## Task 6: Frontend — ValidationTabContent `secondaryBulkAction` + Validation page wiring

**Files:**
- Modify: `packages/web/src/components/validation-tab-content.tsx`
- Modify: `packages/web/src/pages/validation.tsx`

- [ ] **Step 1: Add `secondaryBulkAction` prop to `ValidationTabContent`**

In `packages/web/src/components/validation-tab-content.tsx`, find the `ValidationTabContentProps` interface (around line 26) and add the new prop:

```typescript
interface ValidationTabContentProps {
  // ... existing props ...
  secondaryBulkAction?: BulkAction | null;
}
```

Update the function signature to destructure it:

```typescript
export function ValidationTabContent({
  fragments, total, isLoading, isSearching, page, onPageChange, pageSize, onPageSizeChange,
  search, onSearchChange, searchPlaceholder, description, emptyText,
  selectedCardId, selectedIds, onCardClick, onToggle, onSelectAll, isAllSelected, bulkAction,
  secondaryBulkAction,
}: ValidationTabContentProps) {
```

In the toolbar (around line 117), after the primary `bulkAction` button render, add:

```tsx
        {secondaryBulkAction && secondaryBulkAction.count > 0 && (
          <Button
            size="sm"
            variant="destructive"
            onClick={secondaryBulkAction.onClick}
            disabled={secondaryBulkAction.isPending}
          >
            {secondaryBulkAction.label} ({secondaryBulkAction.count})
          </Button>
        )}
```

- [ ] **Step 2: Add imports to `validation.tsx`**

In `packages/web/src/pages/validation.tsx`, add:

```typescript
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Trash2 } from 'lucide-react';
```

Update the `apiRequest` / `apiRequestFull` imports if not already imported — check the existing imports.

- [ ] **Step 3: Add delete state to `ValidationPage`**

After the existing state declarations (around line 38), add:

```typescript
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [deletePending, setDeletePending] = useState(false);
```

- [ ] **Step 4: Add `handleBulkDelete` function**

After `startBulk` (around line 108), add:

```typescript
  const isAdmin = (currentUser?.role ?? '') === 'admin';

  const handleBulkDelete = (ids: string[]) => {
    setPendingDeleteIds(ids);
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (pendingDeleteIds.length === 0) return;
    const endpoint = isAdmin ? '/fragments/bulk-delete' : '/fragments/bulk-delete-own';
    setDeleteConfirmOpen(false);
    setDeletePending(true);
    try {
      const result = await apiRequest<{ job_id: string | null; done?: number }>(
        'POST',
        collectionApiUrl(activeCollection, endpoint),
        { ids: pendingDeleteIds },
      );
      if (!result.job_id) {
        // bulk-delete-own returned 0 owned IDs
        toast.info('Aucun fragment supprimable dans la sélection');
        setDeletePending(false);
        return;
      }
      toast.info(t('validation', 'bulkProcessing'));
      const poll = async (): Promise<void> => {
        const job = await apiRequest<{ status: string; done: number; error_count: number }>(
          'GET',
          `/v1/jobs/${result.job_id}`,
        );
        if (job.status === 'done' || job.status === 'error') {
          toast.success(`${job.done} ${t('fragments', 'bulkDeleteSuccess')}`);
          queryClient.invalidateQueries({ queryKey: ['fragments'] });
          setSelectedDraftIds(new Set());
          setSelectedReviewedIds(new Set());
          setDeletePending(false);
        } else {
          setTimeout(poll, 1000);
        }
      };
      poll();
    } catch (e: any) {
      toast.error(e.message ?? 'Erreur');
      setDeletePending(false);
    }
  };
```

- [ ] **Step 5: Wire `secondaryBulkAction` into both `ValidationTabContent` instances**

For the **review tab** (around line 136), add `secondaryBulkAction` to the props:

```tsx
          secondaryBulkAction={
            selectedDraftIds.size > 0 && (isAdmin || canReview(currentUser))
              ? {
                  label: <><Trash2 className="mr-2 h-3.5 w-3.5" />{t('validation', 'deleteSelected')}</>,
                  count: selectedDraftIds.size,
                  onClick: () => handleBulkDelete(Array.from(selectedDraftIds)),
                  isPending: deletePending,
                }
              : null
          }
```

For the **approve tab** (around line 165), add:

```tsx
          secondaryBulkAction={
            selectedReviewedIds.size > 0 && (isAdmin || canApprove(currentUser))
              ? {
                  label: <><Trash2 className="mr-2 h-3.5 w-3.5" />{t('validation', 'deleteSelected')}</>,
                  count: selectedReviewedIds.size,
                  onClick: () => handleBulkDelete(Array.from(selectedReviewedIds)),
                  isPending: deletePending,
                }
              : null
          }
```

- [ ] **Step 6: Add confirmation dialog**

Before the closing `</div>` of `ValidationPage` return (after `<FragmentDetail ... />`), add:

```tsx
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('validation', 'deleteSelected')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t('validation', 'deleteSelectedConfirm')}
            {!isAdmin && (
              <span className="block mt-1 text-xs">
                Seuls vos propres fragments non approuvés seront supprimés.
              </span>
            )}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              {t('validation', 'cancel')}
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deletePending}>
              {deletePending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-1" />
              )}
              {t('validation', 'deleteSelected')} ({pendingDeleteIds.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

(`Loader2` is already imported in `validation.tsx` via existing bulk actions — check and add if missing.)

- [ ] **Step 7: TypeScript check (both packages)**

```bash
pnpm --filter @fragmint/server exec tsc --noEmit 2>&1 | grep -v "node_modules" | grep "error" | head -10
pnpm --filter @fragmint/web exec tsc --noEmit 2>&1 | grep -v "node_modules" | grep "error" | head -10
```

Expected: no new errors in the modified files.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/components/validation-tab-content.tsx packages/web/src/pages/validation.tsx
git commit -m "feat(web): bulk delete on validation page — admin and own fragments"
```

---

## Self-Review

**Spec coverage:**
- ✅ Harvest delete job (admin only) → Tasks 3, 4, 5
- ✅ Validation delete selected, admin (any fragment) → Task 6
- ✅ Validation delete selected, contributor/expert (own non-approved) → Tasks 2, 6
- ✅ Confirmation dialog on both surfaces → Tasks 5, 6
- ✅ i18n keys → Task 1

**Placeholder scan:** No TBD/TODO in any task. All code blocks are complete.

**Type consistency:**
- `filterOwnedIds(ids: string[], authorLogin: string): Promise<string[]>` — defined in Task 2, called in Task 2 (route)
- `useDeleteHarvestJob` — defined in Task 4, called in Task 5
- `secondaryBulkAction?: BulkAction | null` — defined in Task 6 (component), passed in Task 6 (page)
- `BulkAction` interface (label, count, onClick, isPending) — reused as-is from existing component

**Known gaps to verify at runtime:**
- `t('common', 'cancel')` key — Step 6 of Task 5 verifies it exists
- `Loader2` import in `validation.tsx` — Step 6 of Task 6 notes to check
- `deleteJobConfirm` / `deleteSelectedConfirm` as function vs string — Task 1 Step 3 handles both cases
