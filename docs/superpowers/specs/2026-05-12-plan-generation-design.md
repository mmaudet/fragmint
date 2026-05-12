# Plan Generation — Design

**Date:** 2026-05-12
**Status:** Approved (pending user review of this spec)
**Scope:** New top-level UI tab and supporting server feature that guides a user through generating a complete document from a spec prompt, via an editable plan, semantic fragment selection per section, LLM-written drafts, and final markdown/DOCX export.

---

## 1. Goal

Give a user a guided, multi-step workflow to author a complete document grounded in the fragment library:

1. Provide a free-text specification of what they want.
2. Generate an editable markdown **plan** (titles + short descriptions per section) with the LLM. Iterate on it.
3. Validate the plan. The server parses sections and runs semantic search per section, returning 3–5 candidate fragments.
4. For each section, the user approves / rejects / edits fragments. Edits may stay local to this draft, or be proposed back to the library as new draft fragments.
5. Validate fragment selection. The user clicks "Generate all section drafts" (sequential) or generates sections one at a time.
6. Assemble all sections into a single editable markdown document.
7. Export to `.md` or `.docx` (Pandoc).

The flow is fully resumable: plans are persisted server-side and statuses move forward and backward freely.

---

## 2. Out-of-scope (v1)

- Streaming LLM responses.
- Real-time collaboration / multi-user editing.
- PDF export (only `.md` and `.docx`).
- Reusable plan templates / skeletons.
- Plan-internal audit-log entries (the existing `audit_log` only records library fragment changes).
- Spec file upload (`.docx → Pandoc → spec_prompt`). Captured as a clear follow-on phase; the server already has Pandoc available via the harvest stack.

---

## 3. Data model

A single new table `plans` in the existing SQLite/Drizzle schema. Wizard state lives in a JSON column so the data model can evolve without migrations during iteration.

```ts
plans = sqliteTable('plans', {
  id: text('id').primaryKey(),                  // 'plan_<uuid>'
  title: text('title').notNull(),               // user-provided, default derived from first H2 of the plan
  owner: text('owner').notNull(),               // user.login
  collection_slug: text('collection_slug'),     // active collection at creation
  status: text('status').notNull(),             // 'draft' | 'plan_validated' | 'fragments_validated' | 'completed'
  state_json: text('state_json').notNull(),     // serialized PlanState
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});
```

Indexes: `(owner)`, `(collection_slug)`.

`PlanState` shape (stored as JSON in `state_json`):

```ts
type PlanState = {
  spec_prompt: string;                          // step 1 input
  filters: {                                    // applied to all section searches
    domain?: string;
    lang?: string;
    type?: string;
    tags?: string[];
  };
  plan_markdown: string;                        // step 2 — editable markdown
  writer_prompt_override?: string;              // optional override of generic writer preamble
  sections: PlanSection[];                      // populated after plan validation
  draft_markdown?: string;                      // step 4 — final assembled markdown (editable)
  draft_dirty?: boolean;                        // true once user has manually edited draft_markdown
  export_style_template_id?: string;            // step 4 — picked DOCX style-reference template id (templates table, kind = 'style_reference')
};

type PlanSection = {
  id: string;                                   // stable hash of (title, index) — see §6
  title: string;
  description: string;
  candidates: FragmentCandidate[];              // top 3–5 from semantic search
  selected: SectionFragmentSelection[];         // approve/edit results
  generated_markdown?: string;                  // LLM output for this section
  filters_override?: PlanState['filters'];      // optional per-section
};

type FragmentCandidate = {
  fragment_id: string;
  score: number;
  title: string | null;
  body_excerpt: string | null;
  quality: string;
};

type SectionFragmentSelection = {
  fragment_id: string;                          // original library id
  body: string;                                 // either original or edited body
  edited: boolean;
  propose_to_library: boolean;                  // if true, create a new draft fragment when validate-fragments fires
  proposed_fragment_id?: string;                // set after server-side creation
};
```

**Status transitions** are monotonic only by convention; the user can revisit earlier steps and re-run any action, which transitions status backward where appropriate:

- `draft` — Steps 1–2 active (spec & plan).
- `plan_validated` — Step 3 active (per-section fragment review).
- `fragments_validated` — Step 4 active (per-section draft generation + assemble).
- `completed` — at least one successful export.

Re-validating the plan after edits is supported (§6).

---

## 4. API surface

All routes under `/v1/plans`. New files:

- `packages/server/src/routes/plan-routes.ts`
- `packages/server/src/services/plan-service.ts`
- `packages/server/src/services/plan-prompts.ts` (pure prompt builders)
- `packages/server/src/services/pandoc-render.ts` (thin Pandoc wrapper for md→docx)
- `packages/server/src/schema/plan.ts` (Zod schemas)

**Auth:** `contributor` role required (the "propose to library" path creates fragments). Existing collection middleware applies. Response envelope `{ data, meta, error }` matches `harvest-routes.ts`.

### CRUD

- `POST   /v1/plans` — Body: `{ title?, spec_prompt, filters }`. Creates plan with `status: 'draft'`.
- `GET    /v1/plans` — Owner-scoped list within active collection (admin sees all).
- `GET    /v1/plans/:id` — Full state.
- `PATCH  /v1/plans/:id` — Updates mutable fields (`title`, `spec_prompt`, `filters`, `plan_markdown`, `draft_markdown`, `writer_prompt_override`, `sections`). Last-write-wins; no collab in v1.
- `DELETE /v1/plans/:id` — Owner or admin.

### Generation / validation actions

- `POST /v1/plans/:id/generate-plan` — Body: `{ extra_instructions?: string }`. Calls LLM with `spec_prompt + filters` (and the current plan + revision instructions on re-generation). Writes result to `state.plan_markdown`. Always allowed in any status; resets nothing else automatically.

- `POST /v1/plans/:id/validate-plan` — Parses `plan_markdown` into sections, runs semantic search per section, populates `candidates`. Preserves existing per-section state for sections whose stable id (§6) survives the re-parse. Status → `plan_validated`.

- `POST /v1/plans/:id/sections/:sectionId/search` — Body: `{ filters_override? }`. Re-runs semantic search for one section.

- `POST /v1/plans/:id/validate-fragments` — For each `SectionFragmentSelection` with `propose_to_library: true` and no `proposed_fragment_id`, create a new library draft fragment (see §8). Status → `fragments_validated`.

- `POST /v1/plans/:id/sections/:sectionId/generate` — Build the writer prompt (§7) and call LLM. Returns and stores `generated_markdown` for the section. Frontend uses this in a loop for "Generate all section drafts".

- `POST /v1/plans/:id/assemble` — Concatenates sections into `draft_markdown` (§8). If `draft_dirty` is true, the frontend confirms with the user before calling this — server itself does not gate.

### Export

- `POST /v1/plans/:id/export` — Body: `{ format: 'md' | 'docx', style_template_id?: string }`. Returns binary stream with `Content-Disposition: attachment` and `filename="<slug>.<ext>"`. Sets `status: 'completed'`.
  - For `docx`: if `style_template_id` is provided, the corresponding template (must be `kind: 'style_reference'`) is passed to Pandoc as `--reference-doc`. If omitted, the `PlanState.export_style_template_id` is used; if also unset, falls back to `FRAGMINT_PLAN_DOCX_REFERENCE`; otherwise default Pandoc styling.

### DOCX style-reference templates (registry)

Extension of the existing `templates` table (see §10). New routes for managing style-reference templates only (existing composer template routes are untouched):

- `GET    /v1/templates?kind=style_reference` — List style references (the existing list endpoint gains an optional `kind` filter; default behavior unchanged).
- `POST   /v1/templates/style-reference` — `multipart/form-data` upload: `file` (the `.docx`), `name`, `description?`. No YAML required. Persists a `templates` row with `kind: 'style_reference'`, `output_format: 'docx'`, `yaml_path: null`. The `.docx` is stored in the vault under `templates/` and Git-committed (same pattern as composer template uploads).
- `DELETE /v1/templates/:id` — Existing endpoint; now also valid for style references (admin or owner).

Style references are not bound to a collection in v1 (they're global, like the existing composer templates).

All inputs validated with Zod. LLM calls use the existing `LlmClient`, extended with a `chatMessages(messages: ChatMessage[])` overload (the existing `chat(content)` will continue to wrap into a single user message internally).

---

## 5. UI

New page `packages/web/src/pages/plan-generation.tsx`. Route `/plan-generation`. Sidebar entry "Plan Generation" with a writing-style icon (e.g., `PenLine`), placed between Composer and Validation. i18n keys added under `nav.planGeneration` and a new `planGeneration` section in the i18n file.

### List view (no `?id=`)

A grid of plan cards: title, status badge, `updated_at`, "Open" / "Delete" actions, plus "+ New plan" button. Creating a new plan opens a small modal asking for an initial title (optional) and the spec prompt; on save it routes to `?id=<plan_id>`.

### Workspace view (`?id=<plan_id>`)

A stepper at the top with 4 steps reflecting `status`:

```
[1. Spec & Plan] → [2. Section fragments] → [3. Section drafts] → [4. Assemble & Export]
```

Clicking any step jumps to it. No data is lost — all state is persisted.

#### Step 1 — Spec & Plan (status `draft`)

Two-column layout.

**Left column:**
- Spec prompt textarea (large, ~12 rows).
- Filters card: `domain`, `lang`, `type` (selects populated from existing inventory data), `tags` (comma-separated input).
- Optional "Refinement instructions" textarea (used when regenerating).
- "Generate plan" / "Regenerate plan" button — **always enabled**.

**Right column:**
- Markdown plan editor (monospace textarea) showing `plan_markdown`.
- Live preview underneath (using a markdown renderer — `react-markdown` if not already in deps).
- "Validate plan" button — **always enabled**. If `plan_markdown` is empty, server returns an error which surfaces as a toast.

PATCH-on-blur (debounced 1s) saves prompt / filters / plan as the user types.

#### Step 2 — Section fragments (status `plan_validated`)

Two-pane layout.

**Left rail:** vertical list of parsed sections (title + a small informational ✓ once at least one fragment is approved or all explicitly rejected — purely informational, never gates a button).

**Right pane:** the active section.

- Header: title + description (read-only — they come from the plan).
- A row of 3–5 fragment candidate cards (reusing the existing `FragmentCard` / `CandidateCard` pattern). Each card shows score, quality badge, body excerpt, and three buttons:
  - **Approve** — adds to `selected[]` with `body: original`.
  - **Reject** — removes if previously selected.
  - **Edit** — inline textarea + a toggle "Use locally in this draft" vs "Propose as new library draft". Updates `selected[]` entry with `edited: true` and the chosen `propose_to_library` value.
- "Re-search" button (re-runs `/sections/:sectionId/search` with optional per-section filter override).

Sticky bottom bar: **"Validate all sections"** button — **always enabled**.

#### Step 3 — Section drafts (status `fragments_validated`)

Same left rail of sections.

- Top of the right pane: collapsible "Writer prompt override" textarea (`writer_prompt_override`).
- Primary button: **"Generate all section drafts"** — frontend issues sequential POSTs to `/sections/:sectionId/generate` in plan order, showing a progress indicator (`Generating section 2 / 7…`). User can cancel by navigating away.
- Per-section: "Generate" / "Regenerate" button and an editable markdown textarea showing `generated_markdown`. Sections with no approved fragments display a warning badge before generation.
- "Assemble document" button — **always enabled**.

#### Step 4 — Assemble & Export

- Single full-width markdown editor with `draft_markdown` pre-populated.
- Editing the textarea sets `draft_dirty: true` (PATCHed back). If user clicks "Re-assemble" (which calls `/assemble`) while dirty, frontend shows a confirmation modal — "This will overwrite your manual edits. Continue?".
- Live preview tab.
- Two export buttons: **Download .md** and **Download .docx**.
- Next to "Download .docx": a **Style template** dropdown listing all `templates` rows with `kind: 'style_reference'`, plus a "(default styling)" option. Selection is persisted into `state.export_style_template_id` via the normal PATCH. A small "Upload new style template" button opens a modal (file picker + name + optional description) that POSTs to `/v1/templates/style-reference`; on success the new template appears in the dropdown.

### Components

All files stay under 300 lines; refactor if any approaches 400.

- `pages/plan-generation.tsx` — list + workspace shell + step routing.
- `components/plan/spec-step.tsx` — Step 1.
- `components/plan/fragments-step.tsx` — Step 2.
- `components/plan/drafts-step.tsx` — Step 3.
- `components/plan/export-step.tsx` — Step 4.
- `components/plan/section-fragment-card.tsx` — approve/reject/edit wrapper around existing fragment card.

### State

React Query hooks in `packages/web/src/api/hooks/use-plans.ts`:

- `usePlans`, `usePlan`
- `useCreatePlan`, `useUpdatePlan` (debounced), `useDeletePlan`
- `useGeneratePlan`, `useValidatePlan`
- `useSectionSearch`, `useValidateFragments`
- `useGenerateSection`, `useAssemble`
- `useExportPlan`

Mutations invalidate the plan's query on success. No optimistic updates in v1.

---

## 6. Section parsing & re-parse stability

Pure TypeScript, deterministic. Splits `plan_markdown` on `^## ` headings.

- Section **title** = heading text.
- Section **description** = all text between the heading and the next H2 (or EOF), trimmed. Empty allowed.
- Section **id** = stable hash of `(normalized_title + index)`. Allows survival across small edits in body but not across renames or reordering — those are explicit user actions and old per-section data is dropped (with a confirmation toast listing dropped section titles).
- Headings deeper than H2 (`### …`) are preserved as part of the section body.
- Edge case: no H2 found → single synthetic section with title = first line, description = rest.

On re-`validate-plan`, sections whose stable id matches an existing one keep their `candidates`, `selected`, and `generated_markdown`. New sections start empty.

---

## 7. LLM prompts

Pure builders in `plan-prompts.ts`. No prompt is persisted in DB. Default writer prompt is hardcoded; users can override it per-plan via `writer_prompt_override`.

### Plan generator

```
SYSTEM:
You produce structured document plans in Markdown. Output ONLY the plan.
Format: one H2 (## ) per section. Under each H2, a single short paragraph
(1–3 sentences) describing what the section covers. No body content.
No introduction, no conclusion outside the plan, no commentary.

USER:
Context / specification:
<spec_prompt>

Constraints:
- Language: <filters.lang or "fr">
- Domain: <filters.domain or "any">
- Tags: <filters.tags joined or "none">

<if extra_instructions:>
Additional instructions: <extra_instructions>

<if regenerating (plan_markdown non-empty):>
Current plan to revise:
<plan_markdown>

Revision instructions: <extra_instructions>
```

### Per-section writer

```
SYSTEM:
You are an expert technical writer producing one section of a larger
document. Write in <lang>. Be concise and factual.

The "Source fragments" provided are internal raw material — building
blocks of the document being authored. They are NOT external sources
to cite. Do NOT:
- attribute content to them ("according to fragment 1", "as stated in...")
- quote them verbatim or wrap their text in quotation marks
- mention that fragments, notes, or sources exist
- preserve their original phrasing if it doesn't fit the section's
  flow or voice

Instead, rewrite and weave the fragment content into a single coherent
section that reads as original prose. You may rephrase freely, reorder
ideas, and drop fragment content that does not fit the section's scope.
Stay faithful to the facts in the fragments — do not invent additional
facts.

Output ONLY the section body in Markdown. Do not repeat the section
title as a heading. No introduction, no closing remark.

<if writer_prompt_override:>
Additional guidance: <writer_prompt_override>

USER:
Section title: <section.title>
Section description: <section.description>

Source fragments (use these as the basis for the content):
--- Fragment 1 ---
<selected[0].body>
--- Fragment 2 ---
<selected[1].body>
...
```

If a section has zero approved fragments, append: `(no source fragments — write from the description alone, mark uncertain claims)`. UI warns the user before generation in that case.

### Token / timeout

- Default LLM timeout (`FRAGMINT_LLM_TIMEOUT`, 60s) applies to all calls.
- Each fragment body is truncated to `FRAGMINT_PLAN_FRAGMENT_MAX_CHARS` (default 4000 chars) with a `…[truncated]` marker; a warning is logged.
- All errors surface as toasts with the LLM error message; plan state is unchanged so the user can retry.

---

## 8. Assembly, exports, propose-to-library

### Assembly (`/v1/plans/:id/assemble`)

Deterministic, server-side, no LLM. Builds `state.draft_markdown` as:

```
# <plan.title>

## <section[0].title>

<section[0].generated_markdown>

## <section[1].title>

<section[1].generated_markdown>
...
```

- Preserves plan order.
- Sections with no `generated_markdown` are skipped silently. The UI warns the user before they hit "Assemble".
- Idempotent. The frontend handles the "user has manually edited" case by checking `draft_dirty` and confirming before calling assemble.

### Export

- **`md`** — returns `draft_markdown` directly with `Content-Type: text/markdown; charset=utf-8`. No conversion, no tmp files.
- **`docx`** — pipes `draft_markdown` through Pandoc:
  ```
  pandoc -f markdown -t docx [--reference-doc=<ref>] -o <tmp>.docx
  ```
  The wrapper `pandoc-render.ts`:
  - Writes markdown to `os.tmpdir()`.
  - Spawns Pandoc.
  - Reads the output, streams it, deletes both tmp files.
  - 30s timeout.
  - Returns Pandoc stderr (truncated) on error.
  - Resolves `--reference-doc` in this priority:
    1. `style_template_id` from the request body (looked up in `templates` table, must be `kind: 'style_reference'`; 404 / 400 if missing or wrong kind).
    2. `PlanState.export_style_template_id` (same lookup).
    3. `FRAGMINT_PLAN_DOCX_REFERENCE` env var.
    4. Pandoc default styling.

Both exports set `status: 'completed'` and bump `updated_at`.

**Filename:** `slugify(plan.title)` — lowercase, non-`[a-z0-9-]` → `-`, collapsed repeats, trimmed to 80 chars. Fallback `plan-<id>`.

### Propose-to-library path

In `/v1/plans/:id/validate-fragments`, for each selection with `propose_to_library: true` and no `proposed_fragment_id`:

1. Create a new fragment via `FragmentService.create()`:
   - `body` = edited body.
   - `type`, `domain`, `lang`, `tags` inherited from the original fragment.
   - `quality: 'draft'`.
   - `origin: 'plan'`, `origin_source: <plan.id>`.
   - `author: <plan.owner>`.
2. Store the returned id in `selection.proposed_fragment_id`.
3. The section-writer always uses `selection.body` (the edited text). The `proposed_fragment_id` is bookkeeping for traceability into the library.

If fragment creation fails (e.g., user lacks contributor permission on the active collection), the whole call fails atomically with a clear error — no partial state is persisted.

---

## 9. Concurrency & re-entry

- Single owner per plan; no collab locks.
- Two browser tabs on the same plan: last-write-wins. A 409 / `updated_at` mismatch indicator is a v1.1 nice-to-have, not in scope.
- Re-validating after editing the plan: stable section IDs preserve downstream data where possible (see §6).

---

## 10. Migrations

Two new migration files:

```sql
-- packages/server/src/db/migrations/<timestamp>_create_plans.sql
CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  owner TEXT NOT NULL,
  collection_slug TEXT,
  status TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX plans_owner_idx ON plans(owner);
CREATE INDEX plans_collection_idx ON plans(collection_slug);
```

```sql
-- packages/server/src/db/migrations/<timestamp>_templates_add_kind.sql
ALTER TABLE templates ADD COLUMN kind TEXT NOT NULL DEFAULT 'composer';
CREATE INDEX templates_kind_idx ON templates(kind);
```

- All existing templates remain `kind = 'composer'` and continue to work unchanged.
- `kind = 'style_reference'` rows have `yaml_path = ''` (or NULL — see Drizzle migration; existing column is `notNull()` so the migration also relaxes that to nullable, OR we store an empty string and treat empty as "no YAML"). Implementation note: relaxing the constraint is cleaner; both Drizzle and SQLite support `ALTER TABLE` patterns for this (recreate-table-and-copy on SQLite if needed).
- `template-service.ts` gains a new `createStyleReference(docxBuffer, filename, name, description, author)` method that mirrors `create()` but skips YAML handling, sets `kind = 'style_reference'`, and leaves `yaml_path` empty/null. Existing `create()` defaults `kind = 'composer'`.

---

## 11. Testing

- **Unit (Vitest)**:
  - `plan-service.test.ts` — section parsing (including edge cases), stable-id survival across re-parse, idempotent assembly, propose-to-library flow, slugify rules.
  - `plan-prompts.test.ts` — snapshot of assembled prompts for stable inputs.
  - `pandoc-render.test.ts` — wrapper happy path, stderr surfaced on error, timeout.
- **Integration (Vitest + Fastify `inject`)**:
  - `plans.integration.test.ts` — full CRUD; status transitions; auth/role gating; missing/empty fragments; section search re-run; export endpoints with both formats; DOCX export with and without `style_template_id` (validates the priority chain: body → plan state → env var → default); `kind` mismatch on style-template lookup yields a 400.
  - `templates-style-reference.integration.test.ts` — `POST /v1/templates/style-reference` upload, `GET /v1/templates?kind=style_reference` filter, existing composer template uploads remain unaffected.
- **E2E (Playwright)** — deferred to a follow-on phase. Happy-path coverage (create plan → generate → validate plan → approve fragments → generate drafts → export .md) once the UI stabilizes.

---

## 12. Future enhancements

- **Spec file upload (v1.1):** `.docx` / `.pdf` / `.md` upload that runs through Pandoc and pre-fills the spec prompt textarea.
- **Per-collection scoping for style references:** make `templates.collection_slug` meaningful for style-reference rows so different teams see their own.
- **Streaming LLM responses** for the plan and section writer (reduces perceived latency).
- **PDF export** via Pandoc + LaTeX (or weasyprint).
- **Plan templates** (reusable plan skeletons).
- **Audit-log integration** for plan-internal milestones (validate-plan, validate-fragments, export).

---

## 13. Environment variables

New entries (all optional, with defaults):

```
FRAGMINT_PLAN_FRAGMENT_MAX_CHARS    # default 4000 — per-fragment char limit fed to writer LLM
FRAGMINT_PLAN_DOCX_REFERENCE        # optional fallback path to a .docx Pandoc reference-doc, used only when no style template is selected for the plan
```

No changes to existing variables.
