---
name: fragmint-composer
description: Use when the user asks to compose, create, search, or export documents using the Fragmint fragment library. Activates MCP tools for the full plan workflow.
---

# Fragmint Document Composer

You have access to the Fragmint fragment library via MCP tools. Use them to drive the complete document composition workflow.

## Required Info Before Starting

**STOP — do NOT call `plan_create` until you have ALL of the following:**

1. **Client name** — the actual name of the organization or person (e.g. "Mairie de Clamart", "IRA", "ANFSI"). Generic words like "client", "prospect", "customer" are NOT valid answers — ask again if needed.
2. Language (`fr` or `en`)
3. Domain or product (e.g. LinShare, Twake Mail, cloud souverain)
4. Document type (proposal, report, presentation…)

**Extract from the user's message first — do NOT ask about something already present:**
- "proposition commerciale" → type = proposal — **do not ask**
- "lintop" / "linshare" / "twake" → domain — **do not ask**
- "en français" or French context → lang = fr — **do not ask**
- "pour la mairie de clamart" / "pour IRA" → client — **do not ask**

Only ask about items **completely absent** from the message. If 3 out of 4 are present, ask only the 1 missing. Ask in **one plain text message**.

**CRITICAL: Never use the `ask`, `confirm`, or `select` tools. Never render an interactive selection menu. Write your question as plain conversational text only.**

---

## Workflow — Sequential Steps, Never Skip

Each step unlocks the next. Do not jump ahead. After each tool call, present the result to the user and guide them to the next step as described.

### Step 1 — Context document (if provided)

If the user provides a file path OR a URL alongside their request, treat it as a reference document. Fetch URLs with WebFetch, write content to a temp .md file, then attach it. Do NOT embed the content in spec_prompt.

If the user attaches or mentions a reference document at any point (before or after outline):
```tool
plan_add_reference({ id: "<plan_id>", file_path: "<absolute_path>" })
```
→ The document is attached as read context for outline + section generation. It is NOT indexed.

**MANDATORY — ask this exact question immediately after `plan_add_reference` returns, before doing anything else:**
> "Ce document est-il réutilisable pour d'autres plans ? Si oui, j'en extrairai des fragments une fois le plan exporté."

**Do NOT list workflow options. Do NOT ask what to do next. Ask only this question, wait for the answer, then continue automatically.**

Store the answer — do not act on it yet (harvest happens at Step 6, after export).

### Step 2 — Create + generate outline

Infer the title from context — do NOT ask. Call both tools immediately:

```tool
plan_create({ title: "Proposition commerciale — [client]", spec_prompt: "…", filters: { lang: "fr", domain: "…" } })
plan_generate({ id: "<plan_id>" })
```

The tool response contains the outline and the next step instruction. Follow it exactly.

### Step 3 — User approves outline

Present the outline as a numbered list. Ask the user to confirm or request changes.
When the user approves:

```tool
plan_validate_outline({ id: "<plan_id>" })
```

`plan_search_all_sections` will fail with an error if this step is skipped.

### [At any point after plan creation] — User provides a URL or file

If the user mentions a URL or file path after the plan exists — do NOT call `plan_generate` or `plan_create`:
- "pour la section X, voici un doc" → `plan_section_add_reference({ id, section_id, file_path })`
- "voici un doc de contexte général" → `plan_add_reference({ id, file_path })`
- For URLs: WebFetch → write to temp file → pass that path

After attaching, the tool response contains the harvest question — display it verbatim and wait for the answer.

### Step 4 — Search fragments

```tool
plan_search_all_sections({ id: "<plan_id>" })
```

The tool response shows ALL fragment candidates per section with title, score, and excerpt.

**→ CHECKPOINT 2: Present ALL found fragments to the user per section. Ask:**
> "Here are the fragments I found for each section. Which ones should I keep? Tell me if you want to remove any."

Wait for feedback. Once the user approves (or specifies exclusions):

```tool
plan_approve_fragments({
  id: "<plan_id>",
  exclusions: [{ section_id: "…", exclude_ids: ["frag-…"] }]  // only if user excluded some
})
```

**Do NOT call `plan_generate_all_sections` before calling `plan_approve_fragments`.**

### Step 5 — Generate all sections

```tool
plan_generate_all_sections({ id: "<plan_id>" })
```

Slow (one LLM call per section) — tell the user "Generating sections, this may take a minute…"

### Step 5 — User reviews sections, iterates

Present all sections. Ask: "Which sections would you like to modify?"

For each change:
```tool
plan_generate_section({ id: "<plan_id>", section_id: "<section.id>" })
```

Repeat until the user is satisfied.

### Step 6 — Choose template + export

```tool
template_list()
```

Present available templates and ask the user which one to use. Then:

```tool
plan_export({ id: "<plan_id>", format: "docx", style_template_id: "…" })
```

Give the decode command: `echo "<content_base64>" | base64 -d > output.docx`

### Step 7 — Harvest reference doc (if user said yes)

Before calling, show the user the plan's current metadata and ask for confirmation:
> "Les fragments seront extraits avec : domaine=[x], langue=[y], tags=[z]. C'est correct, ou voulez-vous modifier ?"

Use `plan_get` to retrieve the current filters if needed. Then call with confirmed or overridden values:

```tool
plan_harvest_reference({ id: "<plan_id>", domain: "linagora", lang: "fr", tags: ["innovation"] })
```

This uses stored document content — NO file reading needed. Returns job IDs immediately.
Tell the user: "Extraction en cours, les fragments apparaîtront dans la bibliothèque."
Do NOT spawn subagents. Do NOT call `fragment_harvest`. Do NOT read any file.

---

## Adding a Context Document to a Specific Section

If the user provides a document relevant to one section only (e.g. a technical spec for a pricing section, a client brief for the intro), attach it at section level:

```tool
plan_section_add_reference({
  id: "<plan_id>",
  section_id: "<section.id>",
  file_path: "<absolute_path>"
})
```

The document will be merged with any plan-level reference docs when `plan_generate_section` is called for that section. Other sections are not affected.

**Note**: If the document is relevant to the whole plan, use `plan_add_reference` instead (plan-level). If it's only for one section, use `plan_section_add_reference`.

## Editing a Section Inline

To refine a specific fragment's text within the plan (without touching the library):
```tool
plan_edit_section_fragment({
  id: "<plan_id>",
  section_id: "<section.id>",
  fragment_id: "<fragment.id>",
  body: "<new text>"
})
```
Then call `plan_generate_section` + `plan_assemble` again.

---

## Fragment Search (standalone)

When the user asks for fragments without a full plan:
```tool
fragment_search({ query: "…", lang: "fr", type: "argument", collection_slug: "common" })
```

## Discover Available Fragments

```tool
get_index({ collection_slug: "common" })
```
→ Returns a structured index: domain → type → fragments with readable IDs (e.g. `TM-arg-001`).

```tool
list_subjects({ collection_slug: "common" })
```
→ Returns all domain:type combinations (useful for filters).

## Fragment Lookup by Readable ID

```tool
fragment_get({ id: "TM-arg-001", collection_slug: "common" })
```

---

## Key Rules

- **Never hardcode fragment IDs** — always search or use `get_index`.
- **Never skip `plan_generate_section`** — `plan_assemble` alone leaves prose sections empty.
- **Always confirm the outline** (Checkpoint 1) before running the internal section loop.
- **Never show internal tool calls to the user** — only show section content and ask for feedback.
- **Never list workflow options as a menu** — the skill drives the workflow, the user doesn't choose steps.
- **Never ask "what do you want to do next?"** — proceed automatically to the next step.
- **Never use interactive question tools** (ask/confirm/select) — only plain conversational text.
- **Never stop mid-loop** — once outline is approved, run all section searches + generates + assemble without interruption.
- **Filters matter**: `lang: "fr"` is required — do not mix languages unless explicitly asked.
- **Collections**: default is `common`. Use `collection_list` to discover team collections.
- **plan_export docx/pptx** returns base64 — always give the user the decode command.
- **Fragment quality**: prefer `approved` > `reviewed` > `draft`. Search re-ranks automatically.

---

## Local Cache

Results are cached in `~/.fragmint/cache.db` (SQLite). TTLs: index/search = 5 min · fragments/lineage = 30 min · references/collections = 1 hour.

```tool
cache_status()          // hit rate, entry count
cache_sync({ scope: "index", collection_slug: "common" })   // force refresh
cache_clear()           // clear everything (use when corpus changed significantly)
```

---

## Tabular Composition

Fragments with structured data (pricing, SLA, references) carry a `payload` field. Render as native tables with `render_mode: "table"` on a plan section.

### Scenario A — Use an existing collection

```tool
list_collections({ collection_slug: "common" })
get_collection_members({ collection_id: "fc_…" })
compose_table_slot({
  collection_id: "fc_…",
  columns: ["Niveau", "Prise en charge", "Résolution"],
  order_by: { field: "Niveau", direction: "asc" }
})
```

### Scenario B — Ad-hoc search by payload schema

```tool
search_fragments_by_payload({ payload_schema: "pricing-line-v1", limit: 20 })
compose_table_slot({ fragment_ids: ["id1", "id2"], columns: ["libelle", "prix_unitaire"] })
```

### Scenario C — Extract a specific value from a tabular fragment

When the user asks for a specific data point ("total budget", "prix unitaire", "durée SLA critique"), use a two-step lookup:

```tool
// Step 1: find the fragment by semantic search
fragment_search({ query: "budget total estimation EONA-X", type: "pricing", collection_slug: "ira" })
// → returns fragment_id

// Step 2: get full fragment including payload JSON
fragment_get({ id: "<fragment_id>", collection_slug: "ira" })
// → returns { payload: "[{\"Trimestre\":\"T2 2026\",\"Total HT\":\"15 450,00 €\"}, ...]", ... }
```

Then read the `payload` JSON, extract or aggregate the requested field, and answer directly.

**MANDATORY**: `fragment_search` only returns `body_excerpt` (200 chars — incomplete). NEVER compute totals, prices, or any numerical value from `fragment_search` results alone. You MUST call `fragment_get` first to access the full `payload`. If you skip `fragment_get`, your answer will be wrong.

**Tested prompts:**
✅ "Donne moi le budget total de l'estimation EONA-X" → `fragment_search` → `fragment_get` → sum `Total HT` from payload rows
✅ "Quel est le montant du trimestre T1 2027 ?" → `fragment_search` → `fragment_get` → filter row where `Trimestre === "T1 2027"`
✅ "Crée un tableau SLA pour la propale CNB" → `list_collections` → `get_collection_members` → `compose_table_slot`
✅ "Reprends la collection SLA mais seulement Critique et Majeur" → filter member_ids → `compose_table_slot(fragment_ids=[…])`
✅ "Dans l'intro, cite notre engagement critique en prose" → use `body` field → `render_mode: "prose"`
✅ "Fais un tableau de tarifs support" → `search_fragments_by_payload(pricing-line-v1)` → `compose_table_slot`
❌ "Fais un tableau SLA" sans collections → répondre : "Je ne trouve pas de collection SLA. Voulez-vous d'abord uploader un document source ?"

---

## Template-Based Composition (quick one-shot)

```tool
document_compose({
  template_id: "tpl-proposition-commerciale-001",
  context: { lang: "fr", product: "Twake Workplace", client: "ANFSI" },
  collection_slug: "common"
})
```
→ Returns `{ download_url: "…", render_time_ms: N, fragments_resolved: N }`.

Use `template_list` to discover available template IDs before composing.
