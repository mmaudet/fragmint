# Fragmint Bugs — Prioritized Tracking

> **For AI agents**: Source of truth for bug status during the mission. Updated after each fix. Reference document for Phase 1 (stabilization).

**Source**: Personal analysis report `01-rapport-analyse-bugs-fragmint-v5.docx` (2026-05-03), 16 bugs documented after one full day of testing.

**Status legend**:
- `OPEN` — Not yet fixed
- `WORKAROUND` — Local hack applied, NOT pushed, needs proper fix
- `PARTIAL` — Partial fix applied, needs verification or completion
- `FIXED` — Properly fixed and tested (local branch)
- `MERGED` — Fixed and pushed to remote
- `DEFERRED` — Acknowledged but out of scope for this mission

---

## Composer

| # | Title | Status |
|---|-------|--------|
| 14 | `domain:cloud` vs `domain:lincloud` mismatch in demo templates | MERGED |
| 15 | UI Composer doesn't send `structured_data` | FIXED |
| 16 | Output format `'docx'` hardcoded in composer-service | MERGED |
| 17 | Slot preview shows different fragments than composed document | FIXED |
| 18 | Manual slot selection missing in UI Composer | OPEN |
| 28 | Composition context (client, objectif) ignoré dans la sélection de fragments | OPEN |
| 20 | Context date `"today"` not converted when sent from UI | FIXED |
| 24 | `$arg.title` always empty in DOCX/reveal templates | FIXED |
| 25 | Download: wrong MIME type + hardcoded `.docx` filename | FIXED |
| 26 | `quality_min` defaults to `draft` instead of `approved` | FIXED |
| — | XLSX devis: slots intro/pricing/conclusion absents du fichier final | OPEN (Q1) |

## Harvester

| # | Title | Status |
|---|-------|--------|
| 11 | Classification contaminated by existing domains | FIXED |
| 12 | Candidate editing missing in UI | OPEN |
| 29 | "Faible confiance" counter always 0 — confidence threshold non-functional | OPEN |
| 30 | Harvester ingestion too slow — sequential classify loop blocks demo | OPEN |
| 31 | `segment()` prompt generates English titles + may translate body for French docs | FIXED |

## Infrastructure / Search

| # | Title | Status |
|---|-------|--------|
| 3 | `EMBEDDING_ENDPOINT` missing `/v1` in docker-compose | MERGED |
| 9 | Milvus unstable (etcd + scalar indexes manquants) | FIXED |
| 32 | Semantic search lacks lexical boost and relevance gating | OPEN |

## Auth / Session

| # | Title | Status |
|---|-------|--------|
| 5 | JWT not persisted between tabs | OPEN |

## Fragments / Bibliothèque

| # | Title | Status |
|---|-------|--------|
| 1 | `valid_from`/`valid_until` missing in TypeScript Fragment type | MERGED |
| 7 | Empty fragment cards in semantic search | MERGED (via #1) |
| 23 | Reveal template: `pricing` slot resolved but never rendered | FIXED |

## Templates / Git

| # | Title | Status |
|---|-------|--------|
| 2 | Git user not configured in Dockerfile | MERGED |
| 13 | Templates not persisted in Git vault | MERGED |
| 33 | PPTX format non-functional — `marp-cli` missing + no template | OPEN |

## API / Docs

| # | Title | Status |
|---|-------|--------|
| 8 | `/review` and `/approve` endpoints not documented | OPEN |
| 19 | SQLite 0/1 integers render as text in collection selector | MERGED |

## Inventaire / UI

| # | Title | Status |
|---|-------|--------|
| 35 | Inventory "Couverture par domaine" shows language breakdown, not domain | OPEN |
| 36 | Inventory gaps table: `*` in Langue column not user-readable | OPEN |
| 37 | Validation page shows no fragments after harvest commit — draft vs reviewed mismatch | OPEN — P1 |

---

## Detailed Bug Reports

### #35 — Inventory "Couverture par domaine" shows language breakdown, not domain [OPEN]

**Status**: OPEN

**Description**: The Inventory page section titled "Couverture par domaine" displays a single aggregated `CoverageBar` (FR total / EN total) instead of one bar per domain. The backend `inventory()` method returns `by_lang: { fr: { approved, reviewed, draft }, en: {...} }` — grouped by language quality, with no domain dimension. The title is misleading.

**Root cause**: `packages/server/src/services/fragment-service.ts` line 482 builds `byLang` keyed by `lang → quality → count`. No `by_domain` structure is computed. `packages/web/src/pages/inventory.tsx` line 136 passes `frTotal` and `enTotal` (sums of all qualities for each language) to a single `CoverageBar`.

**Fix (1-2h)**:
1. Add `by_domain` to the inventory service: `{ commercial: { approved: X, draft: Y }, technical: {...} }`
2. Update the UI to render one `CoverageBar` per domain entry

**Quick fix (15 min)**: Rename the section title to "Couverture par langue" to match what the UI actually shows.

**Files affected**: `packages/server/src/services/fragment-service.ts`, `packages/web/src/pages/inventory.tsx`

---

### #37 — Validation page shows no fragments after harvest commit [OPEN — P1]

**Status**: OPEN

**Description**: After committing harvest candidates, the UI shows a toast "committed in draft — go to validation" and redirects to `/validation`. The validation page is empty.

**Root cause**: `packages/web/src/pages/validation.tsx` fetches only `quality: 'reviewed'` fragments:
```tsx
const { data: fragments } = useFragments(activeCollection, { quality: 'reviewed' });
```
The harvester creates fragments with `quality: 'draft'`. The quality lifecycle is `draft → reviewed → approved`. There is no UI step to transition from `draft` to `reviewed` — `draft` fragments are invisible in the UI after commit.

Both backend endpoints exist and work:
- `POST /fragments/:id/review` — `draft → reviewed`
- `POST /fragments/:id/approve` — `reviewed → approved`

Both hooks exist: `useReviewFragment`, `useApproveFragment`.

**Fix (Option B — full workflow, ~1h)**:
Split the validation page into two sections:
1. **"À reviewer"** — fetches `quality: draft`, shows `useReviewFragment` action ("Marquer comme reviewed")
2. **"À approuver"** — fetches `quality: reviewed`, shows `useApproveFragment` action ("Approuver")

No backend changes needed.

**Files affected**: `packages/web/src/pages/validation.tsx`

---

### #36 — Inventory gaps table: `*` in Langue column not user-readable [OPEN]

**Status**: OPEN

**Description**: The "Lacunes détectées" table displays `*` in the Langue column for `no_approved` gaps. The `*` is generated intentionally in `fragment-service.ts` line 508 to mean "gap applies to all languages" (the type/domain pair has no approved fragment in any language). A user reading the table sees `*` with no explanation.

**Root cause**: `gaps.push({ type, domain, lang: '*', status: 'no_approved' })` — the wildcard is never translated in the UI (`gap.lang` rendered directly in `inventory.tsx` line 170).

**Fix (15 min)**: In `inventory.tsx`, render `gap.lang === '*' ? t('inventory', 'allLanguages') : gap.lang` — reuses the existing i18n key already used for the coverage section label.

**Files affected**: `packages/web/src/pages/inventory.tsx`

---

### #26 — `quality_min` defaults to `draft` instead of `approved` [FIXED]

**Status**: FIXED (local)

**Description**: `FragmentSlotSchema` had `quality_min: z.enum([...]).default('draft')`. Per mmaudet's spec (guide-utilisation.md), only `approved` fragments may be used in composition. Draft fragments were appearing in composed documents.

**Fix**: Changed default to `'approved'` in `packages/server/src/schema/template.ts`. Improved error message to name the quality filter and slot metadata when no fragment is found.

---

### #11 — Harvester classification contaminated by existing domains [FIXED]

**Status**: FIXED (2026-05-10)

**Description**: `classify()` injected only DB-derived domains into the LLM prompt. If DB contained only `lincloud`, everything got classified as `lincloud` — including completely unrelated content (recipes, Kubernetes docs, etc.).

**Fix**: Union approach — hardcoded seed taxonomy (`harvester-taxonomy.ts`) merged with DB domains at harvest time:
```typescript
const existingTypes = [...new Set([...HARVESTER_TYPES, ...dbTypes])];
const existingDomains = [...new Set([...HARVESTER_DOMAINS, ...dbDomains])];
```
Seed domains: `lincloud, commercial, pricing, legal, technical, methodology, other`. The LLM always has a full baseline regardless of DB state. Custom domains added via fragments are also included.

**Validated**: Re-harvested `recettes-mamie-suzanne.docx` after fix → correctly classified as `other` (not `lincloud`). Created `cuisine` domain via curl → appeared in next harvest.

**Files affected**: `packages/server/src/services/harvester-service.ts`, `packages/server/src/services/harvester-taxonomy.ts` (new file)

---

### #29 — "Faible confiance" counter always 0 — confidence threshold non-functional [OPEN]

**Status**: OPEN

**Tested 2026-05-10 (tests 1-4)**: Slider set to maximum (95%) → "Faible confiance" = 0. All fragments at 95%.

**Updated observation (test 5, proposition-aura-complete.docx)**: Confidence IS variable when content is genuinely ambiguous:
- 80% for "PROPOSITION COMMERCIALE" (cover page, no classifiable content → double `other/other`)
- 90% for edge cases (signature block, section headers without body)
- 95% for standard classifiable content

The mechanism is NOT completely broken — it signals ambiguity at the extremes. However granularity remains coarse (no variation between 90–95%) and the slider UI cap at 95% still prevents filtering the majority of fragments.

**Root cause**: Two compounding issues:
1. LLM always returns exactly `0.95` with a closed taxonomy list — it has a valid answer for everything (including `other` catch-all), so it never expresses uncertainty
2. The code check is `confidence < minConfidence` → `0.95 < 0.95` = false, never triggers

The only exception observed: "Tarification" returned 1.0 (exact keyword match `pricing/pricing`). Confirms the LLM CAN vary, but only at the extremes.

**Impact**: The "Confiance minimum" slider in the UI has no effect. Users cannot filter low-confidence classifications. `lowConfidenceCount` is always 0 in stats.

**Proposed fix — Combine two approaches**:

*Approach 1 (prompt calibration)*: Add multi-criteria confidence definition to `classify()` prompt:
- 0.95–1.0: explicit keyword match + sufficient length + only one option fits
- 0.75–0.90: two of the above
- 0.50–0.75: one criterion, or `other` used because nothing fits perfectly
- < 0.50: `other` AND no option comes close

*Approach 2 (two-candidate output)*: Ask the LLM for primary and alternative classifications. Compute confidence as `primary.confidence - alternative.confidence`. Mechanical measure of hesitation, more robust than self-report.

Combined: Approach 1 pushes the LLM to differentiate scores; Approach 2 provides a fallback metric if the model still outputs uniform scores.

**Full implementation checklist** (not just the 4 code lines):
- [ ] Modify `Classification` interface in `llm-client.ts`
- [ ] Update `classify()` prompt with calibration criteria + two-candidate format
- [ ] Update `harvester-service.ts` to compute final confidence from primary/alternative delta
- [ ] Test with real model (gpt-oss-120b) — open-weight models may not follow complex JSON schemas reliably
- [ ] Test fallback when both candidates return 0.95 (delta = 0 → default to 0.5)
- [ ] Verify JSON response format doesn't break (more complex structure = higher LLM failure rate)
- [ ] Re-test on all 4 harvester test documents to validate improvement
- [ ] Document new behavior in `docs/`

**Risk**: gpt-oss-120b may ignore calibration instructions and keep returning 0.95. If so, the fix yields no improvement. Validate with model before full implementation.

**Files affected**: `packages/server/src/services/llm-client.ts`, `packages/server/src/services/harvester-service.ts`

---

### #12 — Harvester candidate editing not implemented in UI [P1, OPEN]

**Status**: OPEN

**Description**: Harvester UI doesn't allow editing domain, type, or title before accepting a candidate. Only Accept/Reject available. API supports `modified[]` but UI doesn't use it.

**Fix**: Add edit mode on each candidate card.

**Files affected**: `packages/web/src/components/harvester/*.tsx`

---

### #5 — JWT not persisted between tabs [OPEN]

**Status**: OPEN

**Description**: JWT stored in JavaScript memory only. New tab or page refresh forces re-login. In-progress Harvester jobs lost.

**Fix**: Store JWT in `localStorage` or `sessionStorage` with expiration matching TTL (8h).

**Demo impact**: CRITICAL — refresh during demo = loss of session.

---

### #8 — `/review` and `/approve` endpoints not documented [OPEN]

**Status**: OPEN

**Description**: `POST /v1/fragments/:id/review` and `/approve` absent from `docs/api.md`.

---

### #18 — Manual slot selection missing in UI Composer [OPEN]

**Status**: OPEN

**Description**: UI doesn't allow choosing which fragment goes in which slot. API supports `overrides` map but UI doesn't expose it.

**Fix**: Add a 'Change' button on each slot that opens a fragment selector.

---

### #28 — Composer lacks intent field — fragment selection not context-aware [OPEN — Phase 3 feature]

**Status**: OPEN

**Current state**: The Composer has no field for expressing the intent of a composition. The only fields (`client`, `date`, `reference`) are rendering metadata — they are injected into the template (`{client}`) but **do not influence which fragments are selected**.

Fragment selection is built solely from slot metadata in the YAML (`type` + `domain`):
```typescript
// composer-service.ts:571
const query = [slot.type, domain].filter(Boolean).join(' ');
// → "argument commercial" — identical regardless of the composition context
```

There is no way to express "proposal for a banking client migrating email for 500 users" or "presentation focused on data sovereignty". Two completely different compositions produce the exact same fragments.

**Core issue**: Without an intent field, fragment selection is purely metadata-based (type + domain + lang). Two compositions for very different clients — a public administration and a private bank — produce identical outputs. Adding an intent field makes Milvus search semantic: fragments are ranked by relevance to the actual composition context, not just by metadata filters.

**Demo impact**: HIGH — without this, the demo cannot show the difference between static metadata filtering and semantic selection. The value of the embedding stack is not visible.

**Deliverable #3 impact**: Phase 3 explicitly requires "composition adaptation to a provided context". Without this fix, the demo cannot show any difference between a proposal for Airbus and one for an SME.

**Implementation plan (3 steps)** — see also C1 in `limitations-evolutions-questions.md`:

**Step 1 — Add `objective` field to template YAMLs (~1h)**
Add a free-text `objective` field to each template's `context_schema`. The Composer UI already renders all `context_schema` fields dynamically — the field appears in the UI with no frontend changes required.

**Step 2 — Enrich Milvus query with context (~2h)**
Use `context` values (including `objective`) to build a semantically richer search query in `resolveSlot()`:
```typescript
const contextHint = Object.entries(context)
  .filter(([k, v]) => k !== 'date' && typeof v === 'string')
  .map(([_, v]) => v).join(' ');
const query = [slot.type, domain, contextHint].filter(Boolean).join(' ');
// → "argument commercial Airbus email migration 500 users"
```

**Step 3 — LLM-as-a-ranker (~1d)**
After Milvus retrieval, pass the top-N candidates to the LLM with the full context to select the most relevant fragment for this specific client. The LLM can reason on business relevance where Milvus only computes cosine similarity.

**Sequencing**: Steps 1+2 first (~3h), Step 3 after.

**Files affected**: template YAMLs, `packages/server/src/services/composer-service.ts`

---

### #30 — Harvester ingestion too slow — sequential classify loop [OPEN — P1]

**Status**: OPEN — parallelization attempt reverted (2026-05-10), new action plan defined (2026-05-12)

**Description**: 30-page document takes 5–10 min to ingest. Unacceptable for live demo and corpus ingestion (~50 docs planned).

**Root cause**:
- Pipeline is sequential: for each candidate, `segment()` then `classify()` run one at a time
- 30–40 candidates × ~10s each = 5–7 min minimum
- `classify()` accounts for ~80% of total time

**Parallelization attempt — FAILED (2026-05-10)**:
Batching 5 `classify()` calls via `Promise.all` was tried and **made ingestion slower**, not faster. Reverted.
Why it failed: Ollama processes LLM requests **sequentially by default** (`OLLAMA_NUM_PARALLEL=1`). Sending 5 concurrent requests queues them with HTTP overhead but no parallelism gain.

---

**Action plan — Quick wins (~1h30, gain combiné 8-12x) — 2026-05-12**

**Action 1 — Multi-classification batched (1h) — gain 5-10x**

Modifier le prompt `classify()` pour accepter une liste de N candidats et retourner un JSON array :

```
Input: [{id, body, title}, {id, body, title}, ...]
Output: [{id, type, domain, lang, confidence}, ...]
```

Batch de 5-10 candidats par appel LLM. Amortit le coût fixe de chaque appel sur N candidats.
Avantage : neutre sur la qualité (même modèle, même prompt, même contexte).
Risque : valider que le modèle retourne un JSON array bien formé — à tester sur OpenRouter avant de déployer.

**Action 2 — Modèle plus petit pour classify (30 min) — gain 3-5x supplémentaire**

Garder `mistral-nemo:12b` pour `segment()` (raisonnement complexe requis).
Tester `qwen2.5:7b-instruct` pour `classify()` — **déjà installé localement**, aucun `ollama pull` nécessaire.
Gain attendu : 3-5x sur le temps classify.

⚠️ **Risque qualité non négligeable** : sur nos tests, mistral-nemo:12b produit déjà 54-85% `technical` / `methodology` fourre-tout. Un modèle 7B peut aggraver ce pattern sur des documents complexes. Ne pas activer avant golden dataset (voir EVALS.md).

**Résultat combiné attendu :**
- Document AURA (30 pages, ~24 candidats) : 5-10 min → 30-60 secondes
- Document court (memo, 13 candidats) : ~2 min → 10-20 secondes
- Suffisant pour démo Maudet et corpus Linagora

---

**Trade-off vitesse / qualité :**

| Levier | Vitesse | Qualité |
|--------|---------|---------|
| Modèle plus petit pour classify | +++ | -- (à mesurer) |
| Multi-classification batched | +++ | ~ (neutre) |
| Définitions enrichies dans prompt | - (prompt plus long) | +++ |
| Few-shot examples | - (prompt plus long) | +++ |
| Golden dataset | ~ (mesure) | ~ (mesure, pas amélioration) |

**Décision** : faire batching (neutre qualité) + définitions/few-shots (améliore qualité). L'allongement du prompt est amorti par le batching. Modèle plus petit : seulement après validation golden dataset.

**Ordre d'implémentation recommandé :**
1. Définitions enrichies dans `classify()` — 30 min, zéro risque
2. Batching classify — 1h, neutre qualité
3. Few-shot examples — 1h, après observation des échecs persistants
4. Golden dataset — en parallèle, prérequis pour valider le modèle plus petit
5. Modèle plus petit — seulement si le golden dataset valide le seuil qualité

---

**Phase V2 (synthèse) :**
- Two-phase ingestion (UX) : phase 1 rapide visible, phase 2 async enrichissement
- Progress bar : `GET /v1/harvest/:jobId` avec `progress.percentage`, polling 2s côté UI
- Skip `segment()` pour docs structurés (bypass LLM sur sections H1/H2 claires)
- Cache embeddings : `hash(body)` → vector pour ré-ingestion sans recalcul
- GPU local : matériel, hors scope code

**Phase non recommandée :**
- Streaming pipeline : 4-6h pour gain marginal ~30% sur vitesse perçue — mentionner en synthèse uniquement

**Files affected**: `packages/server/src/services/harvester-service.ts`, `packages/server/src/services/llm-client.ts`

---

### #31 — `segment()` prompt generates English titles + may translate body [FIXED]

**Status**: FIXED (2026-05-10)

**Description**: The `segment()` prompt was written in English with no instruction to preserve the source language. For French documents, the LLM:
1. Generated `title` values in English (confirmed: "Challenges in Transition", "Call for Action" on a French doc)
2. May have paraphrased or translated `body` content (unconfirmed — DB wiped before verification, but the prompt said "identify" not "copy verbatim")

**Root cause** (`llm-client.ts:68`): Prompt had no language preservation rules. English prompt + English-fluent model = English output regardless of source language.

**Fix**: Rewrote `segment()` prompt with explicit rules:
- `body`: copy exact original text verbatim — do NOT translate, paraphrase, or summarize
- `title`: short label in the SAME language as the body
- `lang`: ISO 639-1 code

**Validated (2026-05-10)**:
- `memo-sans-structure.docx` (FR) : 0/15 titres EN, tous bodies FR ✅
- `kubernetes-best-practices.docx` (EN) : 9/9 titres EN, tous bodies EN ✅ (bonus : granularité H2, 9 fragments au lieu de 4)
No over-correction observed. Fix confirmed in both directions.

**Files affected**: `packages/server/src/services/llm-client.ts`

---

### #32 — Semantic search lacks lexical boost and relevance gating [P2]

**Status**: OPEN

**Description**: The search uses pure cosine similarity on Milvus, which has 3 limitations that combine to degrade UX:

1. No minimum similarity threshold — top-N results always returned regardless of actual relevance
2. No similarity score shown in UI — users cannot judge result quality
3. No lexical boost — searching "linshare" doesn't prioritize fragments containing the word "linshare" over semantically similar fragments

**Symptom observed (2026-05-10)**: Searching "linshare" returned LinCloud fragments exclusively, because no LinShare fragments existed in the corpus. The system silently fell back to "semantically nearest" content (LinCloud is close: same editor, same collaboration domain) without indicating that no actual matches were found.

**Impact**: A user searching for product-specific content gets silently redirected to unrelated content. Impossible to distinguish "no results" from "low-relevance results".

**Recommended fix priorities (V2)**:
1. **High priority** — Hybrid search (BM25 lexical + Milvus semantic, weighted blend). Standard pattern in modern RAG systems. Effort: 4-8h with libraries like Reciprocal Rank Fusion.
2. **Medium priority** — Display similarity score on result cards. Effort: 1h.
3. **Low priority** — Minimum threshold gate (configurable). Effort: 30 min, but choosing the right threshold per use case is hard.

**Why this is not P1**: This is a UX/quality-of-results issue, not a data integrity or correctness bug. The system returns valid data, just not always relevant. For the demo, mitigation is to ensure the corpus contains content matching realistic search queries.

**Files affected**: `packages/server/src/search/search-service.ts`, `packages/web/src/components/search/` (UI score display)

---

### #34 — Collection role enforcement incomplete for content operations [OPEN — P2]

**Status**: OPEN

**Description**: The 5-level collection role hierarchy (`reader → contributor → expert → manager → owner`) is defined in the schema and enforced for collection management operations (add members, delete collection). However, for content operations under `/v1/collections/:slug/fragments`, `/v1/collections/:slug/templates`, and `/v1/collections/:slug/harvest`, **all operations are gated at `reader` level only**.

Root cause in `packages/server/src/index.ts`:
```typescript
fragmentRoutes(app, fragmentService, authenticate, {
  prefix: collPrefix,
  collectionMiddleware: requireCollRole('reader'),  // same for read, write, expert, admin
});
```

In `fragment-routes.ts`, `writeHandlers`, `expertHandlers`, and `adminHandlers` all receive the same `collectionMiddleware` — the `reader` minimum. A collection `reader` can therefore create, modify, and approve fragments within that collection.

**Non-collection routes** (`/v1/fragments`, `/v1/templates`, `/v1/harvest`) correctly use global roles (`requireRole('contributor')` for write, `requireRole('expert')` for approve, etc.).

**Impact**: Multi-user collection scenarios where some members should be read-only (`reader`) and others write-capable (`contributor`) do not work as expected. The distinction exists in the DB schema and membership table but is not enforced at the API level.

**Fix**: Pass the correct minimum role per handler group in `index.ts`:
```typescript
fragmentRoutes(app, fragmentService, authenticate, {
  prefix: collPrefix,
  collectionMiddleware: requireCollRole('reader'),       // read
  writeMiddleware: requireCollRole('contributor'),       // write
  expertMiddleware: requireCollRole('expert'),           // approve
  adminMiddleware: requireCollRole('manager'),           // admin ops
});
```
And update `fragmentRoutes`, `templateRoutes`, `harvestRoutes` to accept and use these per-level middlewares.

**Files affected**: `packages/server/src/index.ts`, `packages/server/src/routes/fragment-routes.ts`, `packages/server/src/routes/template-routes.ts`, `packages/server/src/routes/harvest-routes.ts`

---

### #33 — PPTX format non-functional [OPEN]

**Status**: OPEN

**Description**: The contract explicitly requires PPTX as a deliverable output format. The render code path exists (`render-marp.ts`, `outputType: 'pptx'`) but the format is not usable for two reasons:

1. **Missing dependency**: `@marp-team/marp-cli` is not installed as a package dependency — only `@marp-team/marp-core` is. The code calls `npx --yes @marp-team/marp-cli` at composition time, which is unreliable in a Docker container (network dependency, slow, can fail silently).

2. **No template**: There is no template with `output_format: pptx` in the vault. All slide templates use `output_format: slides` (Marp HTML). The Composer UI has no PPTX option available to users.

**Important distinction**: `slides` (Marp→HTML, working) and `pptx` (Marp→PowerPoint, broken) are two separate formats in the code. The brief requires `pptx`, not `slides`.

**Fix**:
1. Add `@marp-team/marp-cli` to `packages/server/package.json` devDependencies and rebuild Docker image
2. Create a `tpl-lincloud-pptx.yaml` template with `output_format: pptx` and Linagora branding
3. Test end-to-end generation

**Known limitation post-fix**: Marp→PPTX produces PowerPoint files with limited layout control (no custom master slides, limited font embedding). Quality may be below "ready to send to a client". Native PptxGenJS would give full control — deferred to V2.

**Files affected**: `packages/server/package.json`, `packages/server/Dockerfile`, new template YAML
