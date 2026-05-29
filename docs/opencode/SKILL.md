---
name: fragmint-composer
description: Use when the user asks to compose, create, search, or export documents using the Fragmint fragment library. Activates MCP tools for the full plan workflow.
---

# Fragmint Document Composer

You have access to the Fragmint fragment library via MCP tools. Use them to drive the complete document composition workflow.

## Core Workflow: Plan → Generate → Search → Export

### 1. Create a plan
```tool
plan_create({
  title: "Proposition commerciale — {client}",
  spec_prompt: "{user's description of the document}",
  filters: { lang: "fr" }
})
```
→ Returns `{ id: "plan-uuid-...", status: "draft" }`

### 2. Generate the outline
```tool
plan_generate({ id: "<plan_id>" })
```
→ Returns the plan with `state.sections[]` filled in (titles + descriptions).
Show the user the section list and ask for approval before proceeding.

### 3. Search fragments for each section
For each section in `state.sections`:
```tool
plan_section_search({ id: "<plan_id>", section_id: "<section.id>" })
```
→ Returns candidates scored by relevance. The top candidates are in `section.candidates`.

### 4. Validate the plan before export
```tool
plan_validate({ id: "<plan_id>" })
```
→ Marks the plan as `plan_validated`. Required before export.

### 5. Export the document
```tool
plan_export({ id: "<plan_id>", format: "docx" })
```
→ Returns `{ format: "docx", content_base64: "..." }`.

To save the file:
```bash
echo "<content_base64>" | base64 -d > output.docx
```

## Fragment Search (standalone)

When the user asks for fragments without a full plan:
```tool
fragment_search({
  query: "{user query}",
  lang: "fr",
  type: "argument",
  collection_slug: "common"
})
```

## Discover Available Fragments

Before composing, check what's available:
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
Readable IDs like `TM-arg-001` (prefix-type-number) are stable human-readable references. UUID lookup also works.

## Key Rules

- **Never hardcode fragment IDs** — always search or use `get_index` to discover them.
- **Always confirm section outline** with the user before running `plan_section_search` on all sections.
- **Filters matter**: `lang: "fr"` is important — don't mix languages unless explicitly asked.
- **Collections**: default is `common`. Use `collection_list` to discover team collections.
- **plan_export docx** returns base64 — always give the user the decode command.
- **Fragments quality**: prefer `approved` > `reviewed` > `draft`. The search service re-ranks by quality automatically.
- **Plan status flow**: draft → plan_generated (after plan_generate) → plan_validated (after plan_validate) → completed.

## Template-Based Composition (alternative to plan workflow)

For quick one-shot composition using a predefined template:
```tool
document_compose({
  template_id: "tpl-proposition-commerciale-001",
  context: { lang: "fr", product: "Twake Workplace", client: "ANFSI" },
  collection_slug: "common"
})
```
→ Returns `{ download_url: "/outputs/...", render_time_ms: N, fragments_resolved: N }`.

Use `collection_list` → template_id from the template list to discover available templates.
