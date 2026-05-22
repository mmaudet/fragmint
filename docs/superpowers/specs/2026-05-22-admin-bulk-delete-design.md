# Admin Bulk Delete — Design Spec

**Date:** 2026-05-22
**Scope:** Two surfaces — Harvest page (delete entire job) + Validation page (delete selected fragments)
**Role gate:**
- Harvest delete job: admin only
- Validation delete selected: admin (any fragment) — ou auteur (ses propres fragments, uniquement avant approval)

---

## Problem

Admins have no way to:
1. Clean up a harvest job after ingestion (delete all candidates + job record)
2. Permanently delete draft/reviewed fragments from the validation queue

---

## Surface 1: Harvest page — Delete Job

### Trigger
Admin-only button in the Phase 2 actions bar (candidate review), alongside the existing "Accept All" / "Reject All" / "Commit" buttons. Only shown when `role === 'admin'`, `!commitResult`, `!allCommitted`, `candidates.length > 0`.

### Interaction
1. Click "Supprimer le job" (trash icon, `variant="destructive"`, `size="sm"`)
2. Confirmation dialog: "Supprimer ce job et ses {N} candidats ?" with Cancel + Confirm (destructive)
3. On confirm: `DELETE /v1/harvest/jobs/:id`
4. On success: clear URL param (`setJobId(null)`), reset files/decisions/modifications state, redirect to upload phase

### Server: `DELETE /v1/harvest/jobs/:id`
- Route file: `packages/server/src/routes/harvest-routes.ts`
- Auth: `adminHandlers`
- Implementation: delete all `harvestCandidates` rows where `job_id = :id`, then delete the `harvestJobs` row
- Response: `{ data: { deleted: true }, meta: null, error: null }`
- Error: 404 if job not found

---

## Surface 2: Validation page — Delete selected fragments

### Trigger
Bouton "Supprimer (N)" (`variant="destructive"`) affiché quand `selectedIds.size > 0` ET que l'utilisateur a le droit de supprimer au moins un des fragments sélectionnés.

**Règles de droit :**
- `admin` : peut supprimer tout fragment sélectionné (draft ou reviewed)
- `contributor` / `expert` : peut supprimer uniquement ses propres fragments (ceux où `fragment.author === currentUser.login`), uniquement dans les onglets review (draft) et approve (reviewed) — pas les approved

**Comportement côté client :** quand l'utilisateur n'est pas admin, filtrer les IDs envoyés à l'endpoint pour n'inclure que les fragments dont il est auteur. Si zéro fragments "supprimables" dans la sélection, le bouton n'apparaît pas.

**Côté serveur :** endpoint `/fragments/bulk-delete` existant (adminHandlers) reste admin-only. Ajouter `/fragments/bulk-delete-own` (contributorHandlers) qui vérifie côté serveur que chaque ID appartient à l'auteur de la requête avant de supprimer — les IDs non autorisés sont ignorés silencieusement (pas d'erreur 403).

### Interaction
1. Admin selects fragments (existing checkbox mechanic)
2. Clicks "Supprimer (N)"
3. Confirmation dialog: "Supprimer {N} fragment(s) définitivement ?" with Cancel + Confirm (destructive)
4. On confirm : appel à `/fragments/bulk-delete` (admin) ou `/fragments/bulk-delete-own` (contributor/expert) selon le rôle, avec les IDs filtrés
5. Polling + toast follows the same `startBulk` pattern already used for review/approve

### Component change: `ValidationTabContent`
Add optional `secondaryBulkAction?: BulkAction` prop. When present, render a second `<Button variant="destructive">` after the primary `bulkAction` button. No other changes to the component.

### Confirmation dialog
Both surfaces use the existing `Dialog` component (`packages/web/src/components/ui/dialog.tsx`). State: `confirmOpen: boolean` + a pending callback. The dialog contains a short message and two buttons: Cancel (outline) + Confirm (destructive).

---

## What is NOT in scope

- Deleting a job that is still in `processing` status (button hidden if `job.status !== 'done'`)
- Bulk delete on the Fragments library page (already exists)
- Delete on individual candidate cards (existing per-card flow unchanged)

---

## Files

| File | Change |
|------|--------|
| `packages/server/src/routes/harvest-routes.ts` | Add `DELETE /v1/harvest/jobs/:id` |
| `packages/server/src/routes/fragment-routes.ts` | Add `POST /fragments/bulk-delete-own` (contributorHandlers, ownership check) |
| `packages/server/src/services/fragment-service.ts` | Add `bulkDeleteOwn(ids, authorLogin)` — filters by author before deleting |
| `packages/web/src/pages/harvest.tsx` | Delete job button + confirmation dialog |
| `packages/web/src/components/validation-tab-content.tsx` | Add `secondaryBulkAction` prop |
| `packages/web/src/pages/validation.tsx` | Pass delete bulk action (admin → bulk-delete, contributor → bulk-delete-own) |
| `packages/web/src/lib/i18n.tsx` | Add `deleteJob`, `deleteJobConfirm`, `deleteSelected`, `deleteSelectedConfirm` keys |
