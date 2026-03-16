# Render Engine Multi-Format Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the render engine to support XLSX (template + export), Marp slides (HTML + PPTX), and reveal.js alongside the existing DOCX format.

**Architecture:** Each format has its own renderer module. A shared placeholder engine handles `+++INS+++`/`+++FOR...END-FOR+++` for text-based templates (Marp, reveal.js). The render-engine.ts dispatcher routes by format. All renderers are independent and testable in isolation.

**Tech Stack:** xlsx-template, exceljs, @marp-team/marp-core, reveal.js

**Spec:** `docs/superpowers/specs/2026-03-16-fragmint-render-engine-design.md`

---

## Chunk 1: Dependencies + Shared Placeholder Engine + Schema

### Task 1: Install dependencies and update schema

**Files:**
- Modify: `packages/server/package.json`
- Modify: `packages/server/src/schema/template.ts`
- Modify: `packages/server/src/services/render-engine.ts`

- [ ] **Step 1: Install new dependencies**

```bash
cd /Users/mmaudet/work/fragmint/packages/server
pnpm add xlsx-template exceljs @marp-team/marp-core reveal.js
```

Note: `@marp-team/marp-cli` is used via `npx` at runtime for PPTX export — no need to install it as a dependency.

- [ ] **Step 2: Update output_format enum in template.ts**

Read `packages/server/src/schema/template.ts`. Change:
```typescript
output_format: z.enum(['docx']),
```
to:
```typescript
output_format: z.enum(['docx', 'xlsx', 'slides', 'pptx', 'reveal']),
```

- [ ] **Step 3: Update SupportedFormat in render-engine.ts**

Read `packages/server/src/services/render-engine.ts`. Change:
```typescript
export type SupportedFormat = 'docx' | 'xlsx' | 'pptx';
```
to:
```typescript
export type SupportedFormat = 'docx' | 'xlsx' | 'slides' | 'pptx' | 'reveal';
```

Update the switch statement stubs for the new formats (keep them as `throw new Error('... not yet implemented')` for now — each renderer task will fill them in).

- [ ] **Step 4: Run existing tests**

```bash
npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/
git commit -m "chore: add render engine dependencies, extend output_format enum"
```

### Task 2: Shared placeholder engine

**Files:**
- Create: `packages/server/src/services/render-placeholder.ts`
- Create: `packages/server/src/services/render-placeholder.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect } from 'vitest';
import { resolvePlaceholders } from './render-placeholder.js';

describe('resolvePlaceholders', () => {
  it('replaces +++INS field+++ with value', () => {
    const result = resolvePlaceholders('Hello +++INS name+++!', { name: 'World' });
    expect(result).toBe('Hello World!');
  });

  it('resolves nested paths', () => {
    const result = resolvePlaceholders('+++INS metadata.client+++', { metadata: { client: 'LINAGORA' } });
    expect(result).toBe('LINAGORA');
  });

  it('replaces missing values with empty string', () => {
    const result = resolvePlaceholders('+++INS missing+++', {});
    expect(result).toBe('');
  });

  it('handles FOR loops', () => {
    const tpl = '+++FOR item IN items+++Item: +++INS $item.name+++\n+++END-FOR item+++';
    const result = resolvePlaceholders(tpl, { items: [{ name: 'A' }, { name: 'B' }] });
    expect(result).toContain('Item: A');
    expect(result).toContain('Item: B');
  });

  it('handles nested FOR loop variable access', () => {
    const tpl = '+++FOR p IN products++++++INS $p.title+++ (+++INS $p.price+++)\n+++END-FOR p+++';
    const result = resolvePlaceholders(tpl, { products: [{ title: 'X', price: '10' }, { title: 'Y', price: '20' }] });
    expect(result).toContain('X (10)');
    expect(result).toContain('Y (20)');
  });

  it('leaves text without placeholders unchanged', () => {
    expect(resolvePlaceholders('plain text', {})).toBe('plain text');
  });
});
```

- [ ] **Step 2: Implement render-placeholder.ts**

```typescript
export function resolvePlaceholders(template: string, data: Record<string, any>): string {
  // 1. Resolve FOR loops first
  let result = resolveForLoops(template, data);
  // 2. Then resolve remaining INS placeholders
  result = result.replace(/\+\+\+INS\s+(.+?)\+\+\+/g, (_, path) => {
    const value = getNestedValue(data, path.trim());
    return value !== undefined && value !== null ? String(value) : '';
  });
  return result;
}

function resolveForLoops(template: string, data: Record<string, any>): string {
  const forRegex = /\+\+\+FOR\s+(\w+)\s+IN\s+(.+?)\+\+\+([\s\S]*?)\+\+\+END-FOR\s+\1\+\+\+/g;
  return template.replace(forRegex, (_, varName, arrayPath, body) => {
    const array = getNestedValue(data, arrayPath.trim());
    if (!Array.isArray(array)) return '';
    return array.map(item => {
      // Replace $varName.field with item values
      let resolved = body.replace(
        new RegExp(`\\+\\+\\+INS\\s+\\$${varName}\\.(.+?)\\+\\+\\+`, 'g'),
        (__, field) => {
          const val = item[field.trim()];
          return val !== undefined && val !== null ? String(val) : '';
        }
      );
      return resolved;
    }).join('');
  });
}

function getNestedValue(obj: Record<string, any>, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/services/render-placeholder.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/render-placeholder.*
git commit -m "feat(render): add shared placeholder engine for text-based templates"
```

---

## Chunk 2: XLSX Renderers

### Task 3: XLSX template renderer

**Files:**
- Create: `packages/server/src/services/render-xlsx.ts`
- Create: `packages/server/src/services/render-xlsx.test.ts`
- Modify: `packages/server/src/services/render-engine.ts`

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect } from 'vitest';
import { renderXlsx } from './render-xlsx.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import XlsxTemplate from 'xlsx-template';
import ExcelJS from 'exceljs';

describe('renderXlsx', () => {
  it('renders a template with substitutions', async () => {
    // Create a minimal xlsx template programmatically
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.getCell('A1').value = '${client}';
    sheet.getCell('B1').value = '${date}';
    const buffer = await workbook.xlsx.writeBuffer();

    const tmpDir = mkdtempSync(join(tmpdir(), 'xlsx-test-'));
    const tplPath = join(tmpDir, 'test.xlsx');
    writeFileSync(tplPath, Buffer.from(buffer));

    const result = await renderXlsx(tplPath, { client: 'LINAGORA', date: '2026-03-16' });
    expect(result.format).toBe('xlsx');
    expect(result.buffer.length).toBeGreaterThan(0);

    // Verify content
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(result.buffer);
    const ws = wb.getWorksheet('Sheet1');
    expect(ws?.getCell('A1').value).toBe('LINAGORA');
    expect(ws?.getCell('B1').value).toBe('2026-03-16');
  });
});
```

- [ ] **Step 2: Implement render-xlsx.ts**

```typescript
import XlsxTemplate from 'xlsx-template';
import { readFileSync } from 'node:fs';
import type { RenderResult } from './render-engine.js';

export async function renderXlsx(
  templatePath: string,
  data: Record<string, any>,
): Promise<RenderResult> {
  const templateBuf = readFileSync(templatePath);
  const template = new XlsxTemplate(templateBuf);
  template.substitute(1, data);
  const output = template.generate({ type: 'nodebuffer' });
  return { buffer: Buffer.from(output as ArrayBuffer), format: 'xlsx' };
}
```

- [ ] **Step 3: Wire into render-engine.ts**

Import and add the `case 'xlsx'` in the switch statement.

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/services/render-xlsx.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/render-xlsx.* packages/server/src/services/render-engine.ts
git commit -m "feat(render): add XLSX template renderer"
```

### Task 4: XLSX data export

**Files:**
- Create: `packages/server/src/services/render-xlsx-export.ts`
- Create: `packages/server/src/services/render-xlsx-export.test.ts`
- Modify: `packages/server/src/routes/fragment-routes.ts`

- [ ] **Step 1: Write test**

Test that `exportFragmentsToXlsx` produces a valid XLSX buffer with correct columns and rows.

- [ ] **Step 2: Implement render-xlsx-export.ts**

Use ExcelJS to create a workbook with fragment data: ID, Titre, Type, Domaine, Langue, Qualité, Auteur, Créé le.

- [ ] **Step 3: Add export endpoint**

In `fragment-routes.ts`, add:
```
GET ${prefix}/fragments/export
```
Query param: `format=xlsx` (only xlsx for now).
Returns the XLSX buffer with appropriate Content-Type and Content-Disposition headers.

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/services/render-xlsx-export.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/render-xlsx-export.* packages/server/src/routes/fragment-routes.ts
git commit -m "feat(render): add XLSX data export endpoint"
```

---

## Chunk 3: Marp + reveal.js Renderers

### Task 5: Marp renderer (slides HTML + PPTX)

**Files:**
- Create: `packages/server/src/services/render-marp.ts`
- Create: `packages/server/src/services/render-marp.test.ts`
- Modify: `packages/server/src/services/render-engine.ts`

- [ ] **Step 1: Write test for HTML output**

```typescript
import { describe, it, expect } from 'vitest';
import { renderMarp } from './render-marp.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('renderMarp', () => {
  it('renders Markdown template to HTML with resolved placeholders', async () => {
    const md = `---
marp: true
---

# +++INS title+++

+++INS body+++

---

## Slide 2

+++FOR item IN items+++
- +++INS $item.name+++
+++END-FOR item+++
`;
    const tmpDir = mkdtempSync(join(tmpdir(), 'marp-test-'));
    const tplPath = join(tmpDir, 'test.md');
    writeFileSync(tplPath, md);

    const result = await renderMarp(tplPath, {
      title: 'Test Presentation',
      body: 'Content here',
      items: [{ name: 'Alpha' }, { name: 'Beta' }],
    }, 'html');

    expect(result.format).toBe('slides');
    const html = result.buffer.toString();
    expect(html).toContain('Test Presentation');
    expect(html).toContain('Content here');
    expect(html).toContain('Alpha');
    expect(html).toContain('Beta');
    expect(html).toContain('<html');
  });
});
```

- [ ] **Step 2: Implement render-marp.ts**

Read Markdown template, resolve placeholders via `resolvePlaceholders()`, then pass to Marp Core for HTML rendering.

For PPTX: use `@marp-team/marp-cli` via `npx` (write resolved MD to temp file, run marp CLI, read output PPTX). If marp-cli is not available, throw a clear error.

- [ ] **Step 3: Wire into render-engine.ts**

Add `case 'slides'` and `case 'pptx'` in the switch.

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/services/render-marp.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/render-marp.* packages/server/src/services/render-engine.ts
git commit -m "feat(render): add Marp renderer for slides (HTML + PPTX)"
```

### Task 6: reveal.js renderer

**Files:**
- Create: `packages/server/src/services/render-reveal.ts`
- Create: `packages/server/src/services/render-reveal.test.ts`
- Modify: `packages/server/src/services/render-engine.ts`

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect } from 'vitest';
import { renderReveal } from './render-reveal.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('renderReveal', () => {
  it('renders HTML template to full reveal.js document', async () => {
    const html = `<section>
  <h1>+++INS title+++</h1>
  <p>+++INS body+++</p>
</section>
<section>
  +++FOR slide IN slides+++
  <section><h2>+++INS $slide.heading+++</h2></section>
  +++END-FOR slide+++
</section>`;

    const tmpDir = mkdtempSync(join(tmpdir(), 'reveal-test-'));
    const tplPath = join(tmpDir, 'test.html');
    writeFileSync(tplPath, html);

    const result = await renderReveal(tplPath, {
      title: 'My Talk',
      body: 'Introduction',
      slides: [{ heading: 'Part 1' }, { heading: 'Part 2' }],
    });

    expect(result.format).toBe('reveal');
    const output = result.buffer.toString();
    expect(output).toContain('My Talk');
    expect(output).toContain('Introduction');
    expect(output).toContain('Part 1');
    expect(output).toContain('Part 2');
    expect(output).toContain('reveal.js');
    expect(output).toContain('Reveal.initialize');
  });
});
```

- [ ] **Step 2: Implement render-reveal.ts**

Read HTML template, resolve placeholders, wrap in full reveal.js HTML document with CSS/JS from CDN (with a TODO comment for air-gap bundling).

- [ ] **Step 3: Wire into render-engine.ts**

Add `case 'reveal'` in the switch.

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/services/render-reveal.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/render-reveal.* packages/server/src/services/render-engine.ts
git commit -m "feat(render): add reveal.js renderer for interactive presentations"
```

---

## Chunk 4: Example Templates + Final Verification

### Task 7: Example templates

**Files:**
- Create: `example-vault/templates/presentation.md` (Marp)
- Create: `example-vault/templates/presentation.fragmint.yaml`
- Create: `example-vault/templates/presentation-interactive.html` (reveal.js)
- Create: `example-vault/templates/presentation-interactive.fragmint.yaml`

- [ ] **Step 1: Create Marp template**

`presentation.md`:
```markdown
---
marp: true
theme: default
paginate: true
---

# +++INS metadata.client+++

**+++INS metadata.product+++** — +++INS metadata.date+++

---

## Contexte

+++INS fragments.introduction.body+++

---

+++FOR arg IN fragments.arguments+++

## +++INS $arg.title+++

+++INS $arg.body+++

---

+++END-FOR arg+++

## Conclusion

+++INS fragments.conclusion.body+++
```

`presentation.fragmint.yaml`:
```yaml
id: tpl-presentation-marp-001
name: Présentation Marp
description: "Présentation automatique depuis les fragments"
output_format: slides
carbone_template: presentation.md
version: "1.0"

fragments:
  - key: introduction
    type: introduction
    domain: "{{context.product}}"
    lang: "{{context.lang}}"
    quality_min: approved
    required: true
    fallback: error
    count: 1
  - key: arguments
    type: argument
    domain: "{{context.product}}"
    lang: "{{context.lang}}"
    quality_min: reviewed
    required: false
    fallback: skip
    count: 5
  - key: conclusion
    type: conclusion
    domain: "{{context.product}}"
    lang: "{{context.lang}}"
    quality_min: reviewed
    required: false
    fallback: skip
    count: 1

context_schema:
  lang:
    type: string
    enum: [fr, en]
    required: true
  product:
    type: string
    required: true
  client:
    type: string
    required: false
  date:
    type: date
    default: today
```

- [ ] **Step 2: Create reveal.js template**

Similar structure but with HTML `<section>` elements and `presentation-interactive.fragmint.yaml` with `output_format: reveal`.

- [ ] **Step 3: Commit**

```bash
git add example-vault/templates/
git commit -m "feat(templates): add Marp and reveal.js example templates"
```

### Task 8: Final verification

- [ ] **Step 1: Run all server tests**

```bash
cd /Users/mmaudet/work/fragmint/packages/server && npx vitest run
```

- [ ] **Step 2: Run MCP and frontend tests**

```bash
cd /Users/mmaudet/work/fragmint/packages/mcp && npx vitest run
cd /Users/mmaudet/work/fragmint/packages/web && npx vitest run
```

- [ ] **Step 3: Fix any failures and commit**

---

## Task Dependencies

```
Task 1 (deps + schema) → Task 2 (placeholder engine)
Task 2 → Task 3 (XLSX template)    ← can parallel with Task 5, 6
Task 2 → Task 4 (XLSX export)      ← can parallel with Task 3, 5, 6
Task 2 → Task 5 (Marp)             ← can parallel with Task 3, 4, 6
Task 2 → Task 6 (reveal.js)        ← can parallel with Task 3, 4, 5
Tasks 3-6 → Task 7 (examples)
Task 7 → Task 8 (verification)
```

Tasks 3, 4, 5, 6 are fully independent and can run in parallel after Task 2.
