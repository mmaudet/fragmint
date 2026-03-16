# Fragmint — Render Engine Multi-Format (XLSX, Slides, reveal.js)

**Date:** 2026-03-16
**Status:** Design approved

## Scope

Extend the existing render engine wrapper (`render-engine.ts`) to support 4 new output formats alongside the existing DOCX support. Each format has its own renderer module and template syntax.

### Supported formats after implementation

| Format | Renderer | Template file | Lib | Status |
|--------|----------|--------------|-----|--------|
| `docx` | `render-docx.ts` | `.docx` | `docx-templates` | **Existing — no changes** |
| `xlsx` | `render-xlsx.ts` | `.xlsx` | `xlsx-template` | New |
| `slides` | `render-marp.ts` | `.md` | `@marp-team/marp-core` | New |
| `pptx` | `render-marp.ts` | `.md` | `@marp-team/marp-core` | New |
| `reveal` | `render-reveal.ts` | `.html` | `reveal.js` | New |

Additionally: XLSX data export (no template) via `exceljs`.

### In scope

- 4 new renderer modules
- XLSX data export endpoint
- Update `render-engine.ts` dispatcher
- Extend `output_format` Zod enum
- Example templates for each format
- Tests (~10 new)

### Out of scope

- PDF export (requires LibreOffice or Puppeteer — deferred)
- Frontend template upload for non-DOCX formats (backlog — CLI/API sufficient for now)
- Marp theme customization (use default theme)

## Architecture

### Render engine dispatcher

```typescript
// render-engine.ts — extended
export type SupportedFormat = 'docx' | 'xlsx' | 'slides' | 'pptx' | 'reveal';

export async function renderDocument(
  templatePath: string,
  data: Record<string, any>,
  format: SupportedFormat,
): Promise<RenderResult> {
  switch (format) {
    case 'docx':    return renderDocx(templatePath, data);     // existing
    case 'xlsx':    return renderXlsx(templatePath, data);     // new
    case 'slides':  return renderMarp(templatePath, data, 'html');  // new
    case 'pptx':    return renderMarp(templatePath, data, 'pptx'); // new
    case 'reveal':  return renderReveal(templatePath, data);   // new
    default:        throw new Error(`Unsupported format: ${format}`);
  }
}
```

Each renderer is a separate file with a single exported function. The dispatcher imports them all.

### One template = one format

The `.fragmint.yaml` declares `output_format`. The template file format matches:
- `output_format: docx` → template is `.docx`
- `output_format: xlsx` → template is `.xlsx`
- `output_format: slides` or `pptx` → template is `.md` (Marp Markdown)
- `output_format: reveal` → template is `.html`

## Renderers

### DOCX (existing — unchanged)

File: `render-engine.ts` (inline function `renderDocx`)

Uses `docx-templates` with `+++INS field+++` / `+++FOR...END-FOR+++` syntax. No changes.

### XLSX Template

File: `packages/server/src/services/render-xlsx.ts`

Uses `xlsx-template` (MIT). Template is a `.xlsx` file with placeholders in cells:

```
Cell syntax:
  ${metadata.client}              → simple substitution
  ${fragments.introduction.body}  → nested field access
  ${lignes[].produit}             → array loop (repeats the row)
  ${lignes[].qte}
  ${lignes[].pu}
  ${lignes[].total}
```

Implementation:
```typescript
import XlsxTemplate from 'xlsx-template';
import { readFileSync } from 'node:fs';

export async function renderXlsx(templatePath: string, data: Record<string, any>): Promise<RenderResult> {
  const templateBuf = readFileSync(templatePath);
  const template = new XlsxTemplate(templateBuf);
  template.substitute(1, data);  // sheet 1
  const output = template.generate({ type: 'nodebuffer' });
  return { buffer: Buffer.from(output), format: 'xlsx' };
}
```

### XLSX Data Export

File: `packages/server/src/services/render-xlsx-export.ts`

Uses `exceljs` (MIT). No template — generates a .xlsx from structured data (fragment list, inventory, composition report).

New endpoint: `GET /v1/collections/:slug/fragments/export?format=xlsx`

```typescript
import ExcelJS from 'exceljs';

export async function exportFragmentsToXlsx(fragments: Fragment[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Fragments');

  sheet.columns = [
    { header: 'ID', key: 'id', width: 40 },
    { header: 'Titre', key: 'title', width: 40 },
    { header: 'Type', key: 'type', width: 15 },
    { header: 'Domaine', key: 'domain', width: 20 },
    { header: 'Langue', key: 'lang', width: 8 },
    { header: 'Qualité', key: 'quality', width: 12 },
    { header: 'Auteur', key: 'author', width: 15 },
    { header: 'Créé le', key: 'created_at', width: 20 },
  ];

  for (const f of fragments) {
    sheet.addRow(f);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
```

### Marp (slides HTML + PPTX)

File: `packages/server/src/services/render-marp.ts`

Uses `@marp-team/marp-core` (MIT). Template is a `.md` file with Marp front matter and placeholders:

```markdown
---
marp: true
theme: default
paginate: true
---

# +++INS metadata.client+++

## +++INS fragments.introduction.title+++

+++INS fragments.introduction.body+++

---

## Arguments

+++FOR arg IN fragments.arguments+++

### +++INS $arg.title+++

+++INS $arg.body+++

---

+++END-FOR arg+++

## Conclusion

+++INS fragments.conclusion.body+++
```

Implementation:
1. Read template Markdown
2. Replace placeholders using the same `+++INS+++` / `+++FOR...END-FOR+++` engine as docx-templates (simple string-based replacement — no XML complexity)
3. Pass resolved Markdown to Marp Core → HTML or PPTX

```typescript
import { Marp } from '@marp-team/marp-core';

export async function renderMarp(
  templatePath: string,
  data: Record<string, any>,
  outputType: 'html' | 'pptx',
): Promise<RenderResult> {
  const templateMd = readFileSync(templatePath, 'utf-8');

  // Replace placeholders (simple string substitution)
  const resolvedMd = resolvePlaceholders(templateMd, data);

  if (outputType === 'html') {
    const marp = new Marp();
    const { html, css } = marp.render(resolvedMd);
    const fullHtml = `<!DOCTYPE html><html><head><style>${css}</style></head><body>${html}</body></html>`;
    return { buffer: Buffer.from(fullHtml), format: 'slides' };
  }

  if (outputType === 'pptx') {
    // Use @marp-team/marp-cli for PPTX export
    // Write resolved markdown to temp file, run marp CLI
    const { execFileAsync } = await import('./exec-helpers.js');
    const tmpMd = writeTempFile(resolvedMd, '.md');
    const tmpPptx = tmpMd.replace('.md', '.pptx');
    await execFileAsync('npx', ['@marp-team/marp-cli', tmpMd, '--pptx', '-o', tmpPptx]);
    const buffer = readFileSync(tmpPptx);
    return { buffer, format: 'pptx' };
  }
}
```

### Placeholder resolution for Markdown/HTML templates

Since Marp and reveal.js templates are text-based (not XML like DOCX), we use a simple string replacement engine:

```typescript
function resolvePlaceholders(template: string, data: Record<string, any>): string {
  // 1. Replace +++INS field+++ with data values
  let result = template.replace(/\+\+\+INS\s+(.+?)\+\+\+/g, (_, path) => {
    return getNestedValue(data, path.trim()) ?? '';
  });

  // 2. Handle +++FOR var IN array+++ ... +++END-FOR var+++ loops
  result = resolveForLoops(result, data);

  return result;
}
```

This is a lightweight engine shared between Marp and reveal.js renderers. It lives in a shared file: `render-placeholder.ts`.

### reveal.js (HTML interactif)

File: `packages/server/src/services/render-reveal.ts`

Template is a `.html` file with reveal.js `<section>` elements and `+++INS+++` placeholders:

```html
<section>
  <h1>+++INS metadata.client+++</h1>
  <p>+++INS fragments.introduction.body+++</p>
</section>
<section>
  <h2>Arguments</h2>
  +++FOR arg IN fragments.arguments+++
  <section>
    <h3>+++INS $arg.title+++</h3>
    <p>+++INS $arg.body+++</p>
  </section>
  +++END-FOR arg+++
</section>
```

Implementation:
1. Read template HTML
2. Replace placeholders via `resolvePlaceholders()`
3. Wrap in a full reveal.js HTML document with CSS/JS embedded (reveal.js CDN or bundled)

```typescript
export async function renderReveal(
  templatePath: string,
  data: Record<string, any>,
): Promise<RenderResult> {
  const templateHtml = readFileSync(templatePath, 'utf-8');
  const resolvedHtml = resolvePlaceholders(templateHtml, data);

  const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/theme/white.css">
</head>
<body>
  <div class="reveal"><div class="slides">
    ${resolvedHtml}
  </div></div>
  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.js"></script>
  <script>Reveal.initialize();</script>
</body>
</html>`;

  return { buffer: Buffer.from(fullHtml), format: 'reveal' };
}
```

Note: For air-gap deployments, reveal.js CSS/JS should be bundled locally instead of CDN. This can be a follow-up improvement.

## Schema changes

### Update TemplateYamlSchema

In `packages/server/src/schema/template.ts`:

```typescript
output_format: z.enum(['docx', 'xlsx', 'slides', 'pptx', 'reveal']),
```

### Update SupportedFormat type

In `render-engine.ts`:
```typescript
export type SupportedFormat = 'docx' | 'xlsx' | 'slides' | 'pptx' | 'reveal';
```

## XLSX Export endpoint

New route in `packages/server/src/routes/fragment-routes.ts`:

```
GET /v1/collections/:slug/fragments/export?format=xlsx
```

- Role: reader
- Returns: `.xlsx` file with all fragments of the collection as rows
- Content-Type: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `xlsx-template` | ^2 | XLSX template rendering |
| `exceljs` | ^4 | XLSX data export |
| `@marp-team/marp-core` | ^4 | Marp Markdown → HTML |
| `@marp-team/marp-cli` | ^4 | Marp Markdown → PPTX |
| `reveal.js` | ^5 | reveal.js HTML generation |

## Example templates

### `example-vault/templates/devis.xlsx`

XLSX spreadsheet with:
- Header: `${metadata.client}`, `${metadata.date}`, `${metadata.ref}`
- Table: `${lignes[].produit}` | `${lignes[].description}` | `${lignes[].qte}` | `${lignes[].pu}` | `${lignes[].total}`
- Totals row

### `example-vault/templates/presentation.md`

Marp Markdown with:
- Title slide: client name + date
- Introduction slide from fragment
- Arguments slides (loop)
- Conclusion slide

### `example-vault/templates/presentation-interactive.html`

reveal.js HTML with:
- Same structure as Marp but with reveal.js sections
- Transitions and animations

### YAML definitions

Each template has its `.fragmint.yaml` with the appropriate `output_format`.

## File structure

```
packages/server/src/services/
├── render-engine.ts          # Extended dispatcher (existing)
├── render-xlsx.ts            # XLSX template renderer (new)
├── render-xlsx-export.ts     # XLSX data export (new)
├── render-marp.ts            # Marp slides/PPTX renderer (new)
├── render-reveal.ts          # reveal.js renderer (new)
├── render-placeholder.ts     # Shared placeholder resolution for text templates (new)
└── composer-service.ts       # Unchanged — calls renderDocument()
```

## Testing

| Test | Description |
|------|-------------|
| render-xlsx | Template .xlsx with substitution → valid XLSX file |
| render-xlsx-export | Fragment list → XLSX with correct columns and rows |
| render-marp-html | Marp .md template → HTML single-file with resolved content |
| render-marp-pptx | Marp .md template → valid PPTX file (if marp-cli available) |
| render-reveal | HTML template → full reveal.js HTML with resolved content |
| render-placeholder | +++INS+++ and +++FOR...END-FOR+++ replacement on plain text |
| render-engine dispatch | renderDocument() dispatches to correct renderer by format |
| XLSX export endpoint | GET .../export?format=xlsx returns valid XLSX |

**Target:** ~10 new tests.

## Deliverables

1. `render-placeholder.ts` — shared placeholder engine for text templates
2. `render-xlsx.ts` — XLSX template renderer
3. `render-xlsx-export.ts` — XLSX data export
4. `render-marp.ts` — Marp renderer (HTML + PPTX)
5. `render-reveal.ts` — reveal.js renderer
6. Updated `render-engine.ts` dispatcher
7. Updated `output_format` Zod enum
8. XLSX export endpoint
9. Example templates (xlsx, marp, reveal)
10. Tests (~10)
