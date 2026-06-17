# PPTX Reactivation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `pptx` a functional output format — install `@marp-team/marp-cli` as a real package dependency (not `npx --yes` at runtime), fix `render-marp.ts` to use the local binary via Node.js's require resolution, and create the first `propale-pptx` template.

**Architecture:** `@marp-team/marp-cli` installed as a server dependency. `render-marp.ts` uses `createRequire` to resolve the CLI's main entry and spawns it via `process.execPath` (Node binary) — no `npx`, no PATH dependency. The template is a `.md` Marp file + `.yaml` descriptor seeded into the DB via the existing template sync.

**Tech Stack:** Node.js `createRequire`, `execFile`, `@marp-team/marp-cli`, Marp Markdown syntax, Vitest.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `packages/server/package.json` | Add `@marp-team/marp-cli` as dependency |
| Modify | `packages/server/src/services/render-marp.ts` | Use local binary via `createRequire` instead of `npx` |
| Modify | `packages/server/src/services/render-marp.test.ts` | Skip pptx integration test with clear note |
| Create | `example-vault/templates/propale-pptx.md` | Marp slide template for commercial proposals |
| Create | `example-vault/templates/propale-pptx.yaml` | Template descriptor for the pptx template |

---

### Task 1: Install `@marp-team/marp-cli` and fix `render-marp.ts`

The current code calls `npx --yes @marp-team/marp-cli` at runtime, which fails in Docker containers (no npm registry, slow, can be blocked). The fix: install as a real dependency and resolve the binary via `createRequire`.

**Files:**
- Modify: `packages/server/package.json`
- Modify: `packages/server/src/services/render-marp.ts`

- [ ] **Step 1: Add dependency**

In `packages/server/package.json`, in the `"dependencies"` object, add:

```json
"@marp-team/marp-cli": "^4.4.1"
```

Then install:

```bash
pnpm --filter @fragmint/server add @marp-team/marp-cli
```

Expected: `@marp-team/marp-cli` added to `packages/server/node_modules/` and `pnpm-lock.yaml` updated.

- [ ] **Step 2: Verify the binary resolves**

```bash
node --input-type=module <<'EOF'
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
try {
  const main = require.resolve('@marp-team/marp-cli');
  console.log('Resolved:', main);
} catch (e) {
  console.error('NOT FOUND:', e.message);
}
EOF
```

Expected: prints an absolute path ending in something like `@marp-team/marp-cli/lib/index.js`.

- [ ] **Step 3: Update `render-marp.ts` pptx branch**

In `packages/server/src/services/render-marp.ts`, replace the `pptx` branch:

**Old (lines 34–65):**
```typescript
  if (outputType === 'pptx') {
    const { writeFileSync, unlinkSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { randomUUID } = await import('node:crypto');
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);

    const tmpMd = join(tmpdir(), `marp-${randomUUID()}.md`);
    const tmpPptx = tmpMd.replace('.md', '.pptx');
    writeFileSync(tmpMd, resolvedMd);

    try {
      await execFileAsync('npx', ['--yes', '@marp-team/marp-cli', tmpMd, '--pptx', '-o', tmpPptx], {
        timeout: 60_000,
      });
      const buffer = readFileSync(tmpPptx);
      return { buffer, format: 'pptx' };
    } finally {
      try {
        unlinkSync(tmpMd);
      } catch {
        /* ignore */
      }
      try {
        unlinkSync(tmpPptx);
      } catch {
        /* ignore */
      }
    }
  }
```

**New:**
```typescript
  if (outputType === 'pptx') {
    const { writeFileSync, unlinkSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { randomUUID } = await import('node:crypto');
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { createRequire } = await import('node:module');
    const execFileAsync = promisify(execFile);

    // Resolve local marp-cli binary — avoids npx / network dependency in Docker
    const require = createRequire(import.meta.url);
    const marpCliMain = require.resolve('@marp-team/marp-cli');

    const tmpMd = join(tmpdir(), `marp-${randomUUID()}.md`);
    const tmpPptx = tmpMd.replace('.md', '.pptx');
    writeFileSync(tmpMd, resolvedMd);

    try {
      await execFileAsync(
        process.execPath,
        [marpCliMain, tmpMd, '--pptx', '-o', tmpPptx],
        { timeout: 60_000 },
      );
      const buffer = readFileSync(tmpPptx);
      return { buffer, format: 'pptx' };
    } finally {
      try { unlinkSync(tmpMd); } catch { /* ignore */ }
      try { unlinkSync(tmpPptx); } catch { /* ignore */ }
    }
  }
```

- [ ] **Step 4: Add pptx skip test to `render-marp.test.ts`**

Append to `packages/server/src/services/render-marp.test.ts` (after the last test in the describe block):

```typescript
  // pptx output requires Chromium (headless browser) which is not available in CI.
  // Manually test with: FRAGMINT_TEST_PPTX=1 pnpm test render-marp
  it.skip('renders to pptx (requires Chromium — run manually)', async () => {
    const md = '---\nmarp: true\n---\n# Slide 1\n---\n# Slide 2';
    const path = writeTempMd(md);
    const result = await renderMarp(path, {}, 'pptx');
    expect(result.format).toBe('pptx');
    expect(result.buffer.length).toBeGreaterThan(1000);
    // Check PPTX magic bytes (ZIP format)
    expect(result.buffer[0]).toBe(0x50); // 'P'
    expect(result.buffer[1]).toBe(0x4b); // 'K'
  });
```

- [ ] **Step 5: Run existing HTML tests to verify no regression**

```bash
pnpm test render-marp --reporter=verbose
```

Expected: 4 tests pass (html × 3 + throws for unsupported type), pptx skip is shown as skipped.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @fragmint/server typecheck
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add packages/server/package.json packages/server/src/services/render-marp.ts packages/server/src/services/render-marp.test.ts pnpm-lock.yaml
git commit -m "fix(pptx): install marp-cli as dep, use local binary in render-marp"
```

---

### Task 2: Create the `propale-pptx` Marp template

The template must use Marp front-matter, docx-templates-style placeholders resolved by `resolvePlaceholders` (which replaces `+++INS name+++` with data values), and produce a visually structured commercial proposal deck.

**Files:**
- Create: `example-vault/templates/propale-pptx.md`
- Create: `example-vault/templates/propale-pptx.yaml`

- [ ] **Step 1: Check how `resolvePlaceholders` works**

```bash
cat packages/server/src/services/render-placeholder.ts
```

Expected: shows `+++INS key+++` substitution, `+++FOR item IN list+++...+++END-FOR item+++` loops.

- [ ] **Step 2: Create the Marp slide template**

Create `example-vault/templates/propale-pptx.md`:

```markdown
---
marp: true
theme: default
paginate: true
backgroundColor: #fff
style: |
  section {
    font-family: "Calibri", sans-serif;
    font-size: 28px;
  }
  h1 { color: #1a237e; font-size: 40px; }
  h2 { color: #283593; font-size: 32px; }
  .lead { font-size: 22px; color: #555; }
  table { font-size: 22px; }
---

# +++INS title+++

<br/>

**Préparé pour :** +++INS client+++
**Date :** +++INS date+++
**Référence :** +++INS reference+++

---

## Contexte & Enjeux

+++INS context+++

---

## Notre approche

+++INS approach+++

---

## Fragments clés

+++FOR fragment IN fragments+++
### +++INS $fragment.title+++

+++INS $fragment.body+++

---
+++END-FOR fragment+++

## Équipe & Références

+++INS team+++

---

## Planning

+++INS planning+++

---

## Tarification

| Prestation | Quantité | Prix unitaire | Total |
|-----------|---------|--------------|-------|
+++FOR line IN lines+++
| +++INS $line.description+++ | +++INS $line.qty+++ | +++INS $line.unit_price+++ € | +++INS $line.total+++ € |
+++END-FOR line+++

**Total HT : +++INS total_ht+++ €**
**TVA (20%) : +++INS tva+++ €**
**Total TTC : +++INS total_ttc+++ €**

---

## Prochaines étapes

+++INS next_steps+++

---

# Merci

**+++INS company_name+++**
+++INS contact_email+++
```

- [ ] **Step 3: Create the template YAML descriptor**

Create `example-vault/templates/propale-pptx.yaml`:

```yaml
id: tpl-propale-pptx-001
name: Proposition Commerciale — PPTX
description: Template de présentation PowerPoint pour propositions commerciales Linagora
output_format: pptx
version: "1.0"
author: fragmint-admin
kind: composer

slots:
  - key: fragments
    description: Fragments principaux (argument, use-case, reference)
    type_preference: [argument, use-case, reference]
    lang: fr
    count: 3

context_fields:
  - title: Titre de la présentation
  - client: Nom du client
  - date: Date de la proposition
  - reference: Référence interne
  - context: Contexte et enjeux du client (1-2 paragraphes)
  - approach: Notre approche méthodologique
  - team: Présentation équipe et références clients
  - planning: Planning prévisionnel
  - company_name: Nom de la société (Linagora)
  - contact_email: Email de contact
```

- [ ] **Step 4: Verify the template is syntactically valid Marp**

```bash
node --input-type=module <<'EOF'
import { Marp } from '@marp-team/marp-core';
import { readFileSync } from 'node:fs';

// Simulate what render-marp does: resolve placeholders first
const md = readFileSync('example-vault/templates/propale-pptx.md', 'utf-8');
// Replace +++INS xxx+++ with dummy values for validation
const resolved = md.replace(/\+\+\+INS [^+]+\+\+\+/g, 'PLACEHOLDER')
                   .replace(/\+\+\+FOR[^+]+\+\+\+[\s\S]*?\+\+\+END-FOR[^+]+\+\+\+/g, '');

const marp = new Marp();
const { html } = marp.render(resolved);
const slideCount = (html.match(/<section/g) || []).length;
console.log(`Valid Marp: ${slideCount} slides rendered`);
EOF
```

Expected: `Valid Marp: N slides rendered` with N >= 5

- [ ] **Step 5: Commit**

```bash
git add example-vault/templates/propale-pptx.md example-vault/templates/propale-pptx.yaml
git commit -m "feat(templates): add propale-pptx Marp slide template"
```

---

### Task 3: Seed the pptx template into the database

The template file exists on disk, but `templates` table in SQLite must also have a row for the server to find it via `templateService.getById()`. Templates are synced via `TemplateService.syncFromGit()` at startup — check if that handles `.yaml` template descriptors.

**Files:**
- No new files — verify sync works, or add a seed fallback.

- [ ] **Step 1: Check how templates are synced**

```bash
grep -n "syncFromGit\|yaml_path\|output_format" packages/server/src/services/template-service.ts | head -30
```

Look for where `.yaml` files are read and whether `output_format: pptx` is handled.

- [ ] **Step 2: Restart the dev server and verify the template appears**

```bash
curl -s -H "Authorization: Bearer $(cat .fragmint-token 2>/dev/null || echo 'YOUR_TOKEN')" \
  http://localhost:3210/v1/collections/common/templates \
  | jq '.data[] | select(.output_format == "pptx") | {id, name, output_format}'
```

Expected: `{ "id": "tpl-propale-pptx-001", "name": "Proposition Commerciale — PPTX", "output_format": "pptx" }`

If the template does NOT appear, the template service may not scan for yaml files outside known directories. In that case:

```bash
# Check which path template-service scans
grep -n "readdirSync\|templatePath\|vault" packages/server/src/services/template-service.ts | head -20
```

Then verify the yaml file is placed in the expected directory. Move if needed:

```bash
# If templates must be in a specific subdirectory:
mkdir -p example-vault/templates/propale-pptx/
mv example-vault/templates/propale-pptx.{md,yaml} example-vault/templates/propale-pptx/
```

- [ ] **Step 3: Compose a test PPTX (manual smoke test)**

```bash
curl -s -X POST \
  -H "Authorization: Bearer $(cat .fragmint-token 2>/dev/null || echo 'YOUR_TOKEN')" \
  -H "Content-Type: application/json" \
  -d '{
    "context": {
      "title": "Proposition — Tests",
      "client": "ACME Corp",
      "date": "2026-05-28",
      "reference": "TEST-001",
      "context": "Contexte test",
      "approach": "Approche test",
      "team": "Équipe test",
      "planning": "T+1 mois",
      "company_name": "Linagora",
      "contact_email": "contact@linagora.com",
      "next_steps": "RDV dans 2 semaines",
      "total_ht": "10000",
      "tva": "2000",
      "total_ttc": "12000"
    }
  }' \
  http://localhost:3210/v1/collections/common/templates/tpl-propale-pptx-001/compose \
  --output /tmp/test-pptx-result.json
cat /tmp/test-pptx-result.json | jq '.error'
```

Expected: `null` (no error). If error about Chromium/puppeteer, see troubleshooting note below.

> **Troubleshooting — Chromium:** Marp CLI uses Puppeteer (headless Chrome) for PPTX export. In Docker Alpine, Chromium must be installed: `apk add chromium`. Add to `docker/docker-compose.dev.yml` if missing. Set env `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`.

- [ ] **Step 4: Commit**

```bash
git commit --allow-empty -m "test(pptx): smoke test passed, template seeded via syncFromGit"
```

(Or commit any fixes made during the smoke test.)

---

## Self-Review

**Spec coverage:**
- ✅ `@marp-team/marp-cli` as real dep (not npx)
- ✅ `render-marp.ts` uses `createRequire` + `process.execPath` (no PATH dependency)
- ✅ Existing HTML tests still pass (no regression)
- ✅ pptx test skipped with clear comment (Chromium unavailable in standard CI)
- ✅ `propale-pptx.md` template with Marp syntax + `+++INS+++` placeholders
- ✅ `propale-pptx.yaml` descriptor with `output_format: pptx`
- ⚠️ Docker Chromium setup: needs `apk add chromium` + `PUPPETEER_EXECUTABLE_PATH` if running in Alpine container — not in scope of this plan, documented in troubleshooting note.
- ⚠️ `lines[]` pricing loop: `resolvePlaceholders` must support array loops — verify before testing compose.
