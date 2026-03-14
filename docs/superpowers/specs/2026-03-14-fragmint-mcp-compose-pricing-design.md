# MCP document_compose + Devis automatique depuis fragments pricing

**Date:** 2026-03-14
**Status:** Design approved

## Scope

Two small additions to the existing composition engine:

1. **MCP tool `document_compose`** — 7th MCP tool enabling Claude to compose documents directly
2. **Devis automatique** — automatic pricing table generation from pricing fragments with computed totals

### In scope

- MCP tool calling `POST /v1/templates/{id}/compose`
- Auto-compute `total_ht`, `tva`, `total_ttc` in `buildTemplateData()` when pricing fragments are enriched with quantities
- Update devis template YAML to use `type: pricing` slots instead of hardcoded `structured_data.lignes`
- Tests

### Out of scope

- Interactive slot resolution in MCP (deferred)
- XLSX/Slides render engine (separate backlog)
- Frontend changes (Compositeur already works)

## MCP tool `document_compose`

### Tool definition

Add to `packages/mcp/src/index.ts`:

```typescript
{
  name: 'document_compose',
  description: 'Compose a document from a template with context. Returns composition report with download URL.',
  inputSchema: {
    type: 'object',
    properties: {
      template_id: { type: 'string', description: 'Template ID (e.g. "tpl-proposition-commerciale-001")' },
      context: {
        type: 'object',
        description: 'Context variables for composition (e.g. { "lang": "fr", "product": "twake", "client": "Gendarmerie" })',
      },
      overrides: {
        type: 'object',
        description: 'Optional fragment overrides: { slot_key: fragment_id }',
      },
      structured_data: {
        type: 'object',
        description: 'Optional structured data (e.g. { "quantities": { "frag-xxx": 500 } })',
      },
    },
    required: ['template_id', 'context'],
  },
}
```

### Handler

Same pattern as existing tools — HTTP POST to `/v1/templates/{template_id}/compose` with `{ context, overrides, structured_data }`. Returns the full composition report JSON.

## Devis automatique

### Changes to `ComposerService.buildTemplateData()`

After enriching pricing fragments (existing `enrichFragment()` logic with `parseStructuredTags` + `quantities`), compute aggregate totals:

```typescript
// After building the fragments object, compute pricing totals
let totalHt = 0;
let hasPricing = false;

for (const [key, items] of Object.entries(fragments)) {
  const arr = Array.isArray(items) ? items : [items];
  for (const item of arr) {
    if (item.total && typeof item.total === 'string') {
      // Parse French-formatted number back to float
      const num = parseFloat(item.total.replace(/\s/g, '').replace(',', '.'));
      if (!isNaN(num)) {
        totalHt += num;
        hasPricing = true;
      }
    }
  }
}

if (hasPricing) {
  const tva = totalHt * 0.2;
  const totalTtc = totalHt + tva;
  // Add to metadata for use in templates
  result.metadata.total_ht = formatFrenchNumber(totalHt);
  result.metadata.tva = formatFrenchNumber(tva);
  result.metadata.total_ttc = formatFrenchNumber(totalTtc);
}
```

### Update devis template YAML

Update `example-vault/templates/devis-produits.fragmint.yaml`:

Replace `structured_data` section with a pricing fragment slot:

```yaml
fragments:
  - key: introduction
    type: introduction
    domain: souveraineté
    lang: "{{context.lang}}"
    quality_min: approved
    required: true
    fallback: error
    count: 1

  - key: produits
    type: pricing
    domain: "{{context.product}}"
    lang: "{{context.lang}}"
    quality_min: draft
    required: true
    fallback: error
    count: 10
```

Remove the `structured_data` section (no longer needed — pricing comes from fragments).

### Composition flow for devis

1. User calls compose with `context: { lang: "fr", product: "twake" }` and `structured_data: { quantities: { "frag-xxx": 500, "frag-yyy": 1 } }`
2. ComposerService resolves `produits` slot → finds pricing fragments in domain "twake", lang "fr"
3. `buildTemplateData()` enriches each pricing fragment: parses tags (`produit`, `pu`, `unite`), looks up quantity, computes `total = qte * pu`, formats in French
4. After enrichment, computes `total_ht`, `tva`, `total_ttc` and adds to metadata
5. Render engine fills the DOCX template with `fragments.produits[i].produit`, `fragments.produits[i].pu`, etc. + `metadata.total_ht`

## Tests

| Test | File | What |
|------|------|------|
| MCP tool definition | `packages/mcp/src/index.test.ts` | `document_compose` tool exists with correct schema |
| MCP tool handler | `packages/mcp/src/index.test.ts` | Calls compose API, returns report |
| Auto totals | `packages/server/src/services/composer-service.test.ts` | `buildTemplateData` with pricing fragments computes `total_ht`, `tva`, `total_ttc` |
| No pricing | `packages/server/src/services/composer-service.test.ts` | `buildTemplateData` without pricing fragments does NOT add totals to metadata |

## Files

### Create/Modify
- Modify: `packages/mcp/src/index.ts` — add `document_compose` tool + handler
- Modify: `packages/server/src/services/composer-service.ts` — add auto-totals in `buildTemplateData()`
- Modify: `example-vault/templates/devis-produits.fragmint.yaml` — use pricing slot instead of structured_data
- Modify: `packages/mcp/src/index.test.ts` — add tests for new tool
- Modify: `packages/server/src/services/composer-service.test.ts` — add tests for auto-totals

## Deliverables

1. MCP tool `document_compose` — 7th tool in MCP server
2. Auto-compute pricing totals in `buildTemplateData()`
3. Updated devis template YAML
4. ~4 new tests
