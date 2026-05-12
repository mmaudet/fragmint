# Plan Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-step "Plan Generation" feature in Fragmint where a user goes from a spec prompt → editable LLM-generated plan → per-section semantic fragment selection → LLM-written section drafts → final markdown/DOCX export (with selectable DOCX style template).

**Architecture:** New `plans` SQLite table with a JSON `state_json` column for the whole wizard state; class-based `PlanService` exposing CRUD and per-step "actions" (generate-plan, validate-plan, validate-fragments, generate-section, assemble, export); `/v1/plans` Fastify routes mirroring the existing `harvest-routes.ts` shape; Pandoc subprocess for `md → docx` conversion via a thin `pandoc-render.ts` wrapper; extension of the existing `templates` table with a `kind` column to support style-only DOCX references (no YAML). React 19 + shadcn/ui frontend page with a stepper, list view, and four step components.

**Tech Stack:** Node 20, Fastify 5, Drizzle ORM + SQLite (better-sqlite3), Zod, existing `LlmClient` (OpenAI-compatible chat completions to Ollama/ai.linagora.com), Pandoc CLI (already on the server, used by harvest), React 19, TanStack Query, Tailwind, shadcn/ui, `react-markdown` for previews, Vitest for unit + integration tests.

**Reference spec:** `docs/superpowers/specs/2026-05-12-plan-generation-design.md`

---

## File Structure

**New backend files**

- `packages/server/src/services/plan-service.ts` — class-based service with CRUD + action methods.
- `packages/server/src/services/plan-prompts.ts` — pure prompt-builder functions.
- `packages/server/src/services/plan-section-parser.ts` — pure markdown parser (`^## ` splitter, stable IDs).
- `packages/server/src/services/pandoc-render.ts` — thin wrapper around Pandoc CLI for `md → docx`.
- `packages/server/src/services/slugify.ts` — small slug utility shared by exports.
- `packages/server/src/routes/plan-routes.ts` — `/v1/plans/*` Fastify routes.
- `packages/server/src/schema/plan.ts` — Zod schemas for plan inputs.
- `packages/server/src/services/plan-service.test.ts`
- `packages/server/src/services/plan-prompts.test.ts`
- `packages/server/src/services/plan-section-parser.test.ts`
- `packages/server/src/services/pandoc-render.test.ts`
- `packages/server/src/services/slugify.test.ts`
- `packages/server/src/routes/plans.integration.test.ts`
- `packages/server/src/routes/templates-style-reference.integration.test.ts`

**Modified backend files**

- `packages/server/src/db/schema.ts` — add `plans` table; add `kind` column to `templates`.
- `packages/server/src/db/connection.ts` — add inline `CREATE TABLE IF NOT EXISTS plans`; add `ALTER TABLE templates ADD COLUMN kind` in try/catch; relax/handle `yaml_path` nullability.
- `packages/server/src/services/llm-client.ts` — add public `chatMessages(messages)` method.
- `packages/server/src/services/template-service.ts` — add `createStyleReference()` method; add `kind` filter to `list()`.
- `packages/server/src/services/index.ts` — re-export `PlanService`.
- `packages/server/src/routes/template-routes.ts` — add `?kind=` filter to list endpoint and `POST /v1/templates/style-reference`.
- `packages/server/src/index.ts` — instantiate `PlanService`, register `planRoutes`.
- `packages/server/src/config.ts` — add `plan_fragment_max_chars` and `plan_docx_reference_path` config values.

**New frontend files**

- `packages/web/src/pages/plan-generation.tsx` — top-level page (list view + workspace router).
- `packages/web/src/components/plan/spec-step.tsx`
- `packages/web/src/components/plan/fragments-step.tsx`
- `packages/web/src/components/plan/drafts-step.tsx`
- `packages/web/src/components/plan/export-step.tsx`
- `packages/web/src/components/plan/section-fragment-card.tsx`
- `packages/web/src/components/plan/plan-list.tsx`
- `packages/web/src/components/plan/create-plan-dialog.tsx`
- `packages/web/src/components/plan/upload-style-template-dialog.tsx`
- `packages/web/src/api/hooks/use-plans.ts`
- `packages/web/src/api/hooks/use-style-templates.ts`

**Modified frontend files**

- `packages/web/src/App.tsx` — register `/plan-generation` route.
- `packages/web/src/layouts/app-layout.tsx` — sidebar nav entry.
- `packages/web/src/lib/i18n.tsx` — add `planGeneration` translations.
- `packages/web/src/api/types.ts` — add `Plan`, `PlanState`, etc.

---

## Validation Commands

After most tasks you'll run one or more of:

- `pnpm --filter @fragmint/server typecheck`
- `pnpm --filter @fragmint/server test -- <pattern>` (Vitest)
- `pnpm --filter @fragmint/web typecheck`
- `pnpm lint`

For Pandoc-using tests, ensure `pandoc` is available: `which pandoc` should print a path.

---

# Phase 1 — Backend foundations

## Task 1: Add `plans` table to the schema

**Goal:** Persist plan wizard state in SQLite. No code uses the table yet — this task just makes the schema available.

**Files:**
- Modify: `packages/server/src/db/schema.ts` (append a new table definition).
- Modify: `packages/server/src/db/connection.ts` (add inline `CREATE TABLE IF NOT EXISTS plans` in the boot SQL).

- [ ] **Step 1: Add `plans` table to the Drizzle schema**

Append to `packages/server/src/db/schema.ts`:

```ts
export const plans = sqliteTable('plans', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  owner: text('owner').notNull(),
  collection_slug: text('collection_slug'),
  status: text('status').notNull(),
  state_json: text('state_json').notNull(),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});
```

- [ ] **Step 2: Add the inline `CREATE TABLE IF NOT EXISTS` for plans**

Inside `createDb()` in `packages/server/src/db/connection.ts`, append the new statement to the existing `sqlite.exec(\`…\`)` block (right after `harvest_candidates`):

```sql
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  owner TEXT NOT NULL,
  collection_slug TEXT,
  status TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS plans_owner_idx ON plans(owner);
CREATE INDEX IF NOT EXISTS plans_collection_idx ON plans(collection_slug);
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @fragmint/server typecheck`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/db/schema.ts packages/server/src/db/connection.ts
git commit -m "feat(server): add plans table schema for plan-generation feature"
```

---

## Task 2: Add `kind` column to `templates` table

**Goal:** Extend the existing `templates` table to mark composer templates vs. DOCX style references. Existing rows default to `'composer'` and continue to work unchanged.

**Files:**
- Modify: `packages/server/src/db/schema.ts`
- Modify: `packages/server/src/db/connection.ts`

- [ ] **Step 1: Add `kind` column to the Drizzle schema**

In `packages/server/src/db/schema.ts`, find the `templates` table definition and:
1. Add the `kind` column at the end:
   ```ts
   kind: text('kind').notNull().default('composer'),
   ```
2. Change `yaml_path` from `text('yaml_path').notNull()` to `text('yaml_path').notNull().default('')` (we'll store an empty string for style references — no schema breaking change required).

- [ ] **Step 2: Add inline ALTER TABLE to `connection.ts`**

In `packages/server/src/db/connection.ts`, **after** the existing `sqlite.exec(\`…\`)` block (near where the existing `ALTER TABLE api_tokens ADD COLUMN collection_slug` try/catch lives), add:

```ts
try {
  sqlite.exec("ALTER TABLE templates ADD COLUMN kind TEXT NOT NULL DEFAULT 'composer'");
} catch (_) {
  // Column already exists — ignore
}
try {
  sqlite.exec('CREATE INDEX IF NOT EXISTS templates_kind_idx ON templates(kind)');
} catch (_) {
  // Index already exists — ignore
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @fragmint/server typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/db/schema.ts packages/server/src/db/connection.ts
git commit -m "feat(server): add kind column to templates table"
```

---

## Task 3: Section parser (TDD)

**Goal:** A pure deterministic parser that splits a plan markdown into `{ id, title, description }` sections, with stable hash-based IDs.

**Files:**
- Create: `packages/server/src/services/plan-section-parser.ts`
- Create: `packages/server/src/services/plan-section-parser.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/src/services/plan-section-parser.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parsePlanSections, sectionStableId } from './plan-section-parser.js';

describe('parsePlanSections', () => {
  it('splits a markdown plan into H2 sections', () => {
    const md = `## Introduction\n\nThis section introduces the product.\n\n## Pricing\n\nAll prices in euros.`;
    const sections = parsePlanSections(md);
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe('Introduction');
    expect(sections[0].description).toBe('This section introduces the product.');
    expect(sections[1].title).toBe('Pricing');
    expect(sections[1].description).toBe('All prices in euros.');
  });

  it('returns one synthetic section when no H2 is present', () => {
    const md = `Overview\n\nSome free-form text without headings.`;
    const sections = parsePlanSections(md);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Overview');
    expect(sections[0].description).toBe('Some free-form text without headings.');
  });

  it('preserves deeper headings inside the section body', () => {
    const md = `## Section 1\n\nIntro\n\n### Subheading\n\nMore text.`;
    const sections = parsePlanSections(md);
    expect(sections).toHaveLength(1);
    expect(sections[0].description).toContain('### Subheading');
  });

  it('trims whitespace in title and description', () => {
    const md = `##   Hello    \n\n   World   \n`;
    const sections = parsePlanSections(md);
    expect(sections[0].title).toBe('Hello');
    expect(sections[0].description).toBe('World');
  });

  it('handles an empty description', () => {
    const md = `## Empty\n\n## NotEmpty\n\nBody.`;
    const sections = parsePlanSections(md);
    expect(sections[0].description).toBe('');
    expect(sections[1].description).toBe('Body.');
  });

  it('produces stable IDs based on title + index', () => {
    const md = `## A\n\nText\n\n## B\n\nText`;
    const s1 = parsePlanSections(md);
    const s2 = parsePlanSections(md);
    expect(s1[0].id).toBe(s2[0].id);
    expect(s1[1].id).toBe(s2[1].id);
    expect(s1[0].id).not.toBe(s1[1].id);
  });

  it('changes the ID if the title is renamed', () => {
    const a = parsePlanSections('## A\n\nText');
    const b = parsePlanSections('## A renamed\n\nText');
    expect(a[0].id).not.toBe(b[0].id);
  });

  it('returns an empty array for an empty input', () => {
    expect(parsePlanSections('')).toEqual([]);
    expect(parsePlanSections('   \n\n  ')).toEqual([]);
  });
});

describe('sectionStableId', () => {
  it('is deterministic for the same inputs', () => {
    expect(sectionStableId('Title', 0)).toBe(sectionStableId('Title', 0));
  });
  it('changes with index', () => {
    expect(sectionStableId('Title', 0)).not.toBe(sectionStableId('Title', 1));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @fragmint/server test -- plan-section-parser`
Expected: FAIL — "Cannot find module './plan-section-parser.js'".

- [ ] **Step 3: Implement the parser**

Create `packages/server/src/services/plan-section-parser.ts`:

```ts
import { createHash } from 'node:crypto';

export interface ParsedSection {
  id: string;
  title: string;
  description: string;
}

export function sectionStableId(title: string, index: number): string {
  const normalized = title.trim().toLowerCase().replace(/\s+/g, ' ');
  const hash = createHash('sha256').update(`${index}:${normalized}`).digest('hex');
  return `sec_${hash.slice(0, 12)}`;
}

const H2_RE = /^##\s+(.+?)\s*$/;

export function parsePlanSections(markdown: string): ParsedSection[] {
  const trimmed = markdown.trim();
  if (trimmed === '') return [];

  const lines = markdown.split('\n');
  const headingIndices: { line: number; title: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(H2_RE);
    if (m) headingIndices.push({ line: i, title: m[1].trim() });
  }

  if (headingIndices.length === 0) {
    const [firstLine, ...rest] = trimmed.split('\n');
    return [
      {
        id: sectionStableId(firstLine.trim(), 0),
        title: firstLine.trim(),
        description: rest.join('\n').trim(),
      },
    ];
  }

  const sections: ParsedSection[] = [];
  for (let i = 0; i < headingIndices.length; i++) {
    const start = headingIndices[i].line + 1;
    const end = i + 1 < headingIndices.length ? headingIndices[i + 1].line : lines.length;
    const description = lines.slice(start, end).join('\n').trim();
    const title = headingIndices[i].title;
    sections.push({ id: sectionStableId(title, i), title, description });
  }
  return sections;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @fragmint/server test -- plan-section-parser`
Expected: PASS — all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/plan-section-parser.ts packages/server/src/services/plan-section-parser.test.ts
git commit -m "feat(server): add deterministic plan section parser"
```

---

## Task 4: Slugify utility (TDD)

**Goal:** Tiny shared helper that turns plan titles into filename-safe slugs.

**Files:**
- Create: `packages/server/src/services/slugify.ts`
- Create: `packages/server/src/services/slugify.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/src/services/slugify.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { slugify } from './slugify.js';

describe('slugify', () => {
  it('lowercases and replaces spaces', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });
  it('removes accents and special chars', () => {
    expect(slugify('Réseau & sécurité!')).toBe('reseau-securite');
  });
  it('collapses repeated dashes', () => {
    expect(slugify('a---b')).toBe('a-b');
  });
  it('trims leading/trailing dashes', () => {
    expect(slugify('---a---')).toBe('a');
  });
  it('truncates to 80 chars', () => {
    const long = 'a'.repeat(200);
    expect(slugify(long).length).toBeLessThanOrEqual(80);
  });
  it('returns "plan" when input slugs to empty', () => {
    expect(slugify('!!!')).toBe('plan');
    expect(slugify('   ')).toBe('plan');
    expect(slugify('')).toBe('plan');
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @fragmint/server test -- slugify`
Expected: FAIL — "Cannot find module './slugify.js'".

- [ ] **Step 3: Implement**

Create `packages/server/src/services/slugify.ts`:

```ts
export function slugify(input: string, fallback = 'plan'): string {
  const lowered = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  const cleaned = lowered
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  const truncated = cleaned.slice(0, 80).replace(/-+$/, '');
  return truncated === '' ? fallback : truncated;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @fragmint/server test -- slugify`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/slugify.ts packages/server/src/services/slugify.test.ts
git commit -m "feat(server): add slugify utility for export filenames"
```

---

# Phase 2 — LLM client & Pandoc

## Task 5: Extend `LlmClient` with `chatMessages()`

**Goal:** Allow callers (plan-generator and section-writer) to pass full `{role, content}[]` arrays instead of a single user message.

**Files:**
- Modify: `packages/server/src/services/llm-client.ts`
- Modify: `packages/server/src/services/llm-client.test.ts` (extend existing test file — DO NOT replace; check it exists first with `ls packages/server/src/services/llm-client.test.ts`).

- [ ] **Step 1: Write the failing test**

Append to `packages/server/src/services/llm-client.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { LlmClient } from './llm-client.js';

describe('LlmClient.chatMessages', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends messages array through and returns assistant content', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content: 'hello back' } }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new LlmClient({
      endpoint: 'http://localhost:11434/v1',
      model: 'm',
      temperature: 0,
      timeout: 5000,
    });

    const result = await client.chatMessages([
      { role: 'system', content: 'be helpful' },
      { role: 'user', content: 'hi' },
    ]);

    expect(result).toBe('hello back');
    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.messages).toEqual([
      { role: 'system', content: 'be helpful' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('throws when the server returns a non-ok status', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500, statusText: 'X' }));
    const client = new LlmClient({
      endpoint: 'http://localhost:11434/v1',
      model: 'm',
      temperature: 0,
      timeout: 5000,
    });
    await expect(client.chatMessages([{ role: 'user', content: 'hi' }])).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @fragmint/server test -- llm-client`
Expected: FAIL — `client.chatMessages is not a function`.

- [ ] **Step 3: Implement**

In `packages/server/src/services/llm-client.ts`:

1. Add the `ChatMessage` interface near the top, after `LlmClientConfig`:

```ts
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
```

2. Refactor the existing private `chat()` to internally call a new public method `chatMessages()`. Replace the existing `chat` method body with:

```ts
private async chat(content: string): Promise<string> {
  return this.chatMessages([{ role: 'user', content }]);
}

async chatMessages(messages: ChatMessage[]): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), this.config.timeout);
  try {
    const res = await fetch(`${this.config.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        temperature: this.config.temperature,
        messages,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`LLM request failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run tests to verify all pass (existing + new)**

Run: `pnpm --filter @fragmint/server test -- llm-client`
Expected: PASS — existing tests still pass and new tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/llm-client.ts packages/server/src/services/llm-client.test.ts
git commit -m "feat(server): expose chatMessages on LlmClient"
```

---

## Task 6: Plan prompts module (TDD)

**Goal:** Pure builders for the two prompts: plan generator and per-section writer.

**Files:**
- Create: `packages/server/src/services/plan-prompts.ts`
- Create: `packages/server/src/services/plan-prompts.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/src/services/plan-prompts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildPlanMessages, buildSectionMessages } from './plan-prompts.js';

describe('buildPlanMessages', () => {
  it('builds a system + user message pair from a spec prompt', () => {
    const msgs = buildPlanMessages({
      spec_prompt: 'A doc about cloud security',
      filters: { lang: 'fr', domain: 'cloud', tags: ['twake'] },
    });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('## ');
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toContain('A doc about cloud security');
    expect(msgs[1].content).toContain('Language: fr');
    expect(msgs[1].content).toContain('Domain: cloud');
    expect(msgs[1].content).toContain('Tags: twake');
  });

  it('falls back to defaults when filters are missing', () => {
    const msgs = buildPlanMessages({ spec_prompt: 'x', filters: {} });
    expect(msgs[1].content).toContain('Language: fr');
    expect(msgs[1].content).toContain('Domain: any');
    expect(msgs[1].content).toContain('Tags: none');
  });

  it('includes a revision block when a current plan and instructions are provided', () => {
    const msgs = buildPlanMessages({
      spec_prompt: 's',
      filters: {},
      current_plan: '## Old\n\nOld desc',
      extra_instructions: 'Add a section on pricing',
    });
    expect(msgs[1].content).toContain('Current plan to revise:');
    expect(msgs[1].content).toContain('## Old');
    expect(msgs[1].content).toContain('Revision instructions: Add a section on pricing');
  });
});

describe('buildSectionMessages', () => {
  it('embeds title, description, and fragment bodies', () => {
    const msgs = buildSectionMessages({
      section: { title: 'Intro', description: 'Welcomes the reader' },
      fragments: [{ body: 'Fragment one body' }, { body: 'Fragment two body' }],
      lang: 'fr',
      max_chars: 4000,
    });
    const user = msgs.find((m) => m.role === 'user')!;
    expect(user.content).toContain('Section title: Intro');
    expect(user.content).toContain('Section description: Welcomes the reader');
    expect(user.content).toContain('--- Fragment 1 ---');
    expect(user.content).toContain('Fragment one body');
    expect(user.content).toContain('--- Fragment 2 ---');
    expect(user.content).toContain('Fragment two body');
  });

  it('truncates fragment bodies that exceed max_chars', () => {
    const long = 'x'.repeat(5000);
    const msgs = buildSectionMessages({
      section: { title: 'T', description: 'D' },
      fragments: [{ body: long }],
      lang: 'fr',
      max_chars: 100,
    });
    const user = msgs.find((m) => m.role === 'user')!;
    expect(user.content).toContain('…[truncated]');
    expect(user.content.length).toBeLessThan(long.length);
  });

  it('adds the no-fragments hint when no fragments are provided', () => {
    const msgs = buildSectionMessages({
      section: { title: 'T', description: 'D' },
      fragments: [],
      lang: 'fr',
      max_chars: 4000,
    });
    const user = msgs.find((m) => m.role === 'user')!;
    expect(user.content).toContain('no source fragments');
  });

  it('embeds writer_prompt_override in the system message when present', () => {
    const msgs = buildSectionMessages({
      section: { title: 'T', description: 'D' },
      fragments: [],
      lang: 'fr',
      max_chars: 4000,
      writer_prompt_override: 'Use bullet points.',
    });
    expect(msgs[0].content).toContain('Use bullet points.');
  });

  it('forbids quotation/attribution in the system message', () => {
    const msgs = buildSectionMessages({
      section: { title: 'T', description: 'D' },
      fragments: [],
      lang: 'fr',
      max_chars: 4000,
    });
    expect(msgs[0].content).toContain('NOT external sources');
    expect(msgs[0].content).toContain('quote them verbatim');
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @fragmint/server test -- plan-prompts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/server/src/services/plan-prompts.ts`:

```ts
import type { ChatMessage } from './llm-client.js';

export interface PlanFilters {
  domain?: string;
  lang?: string;
  type?: string;
  tags?: string[];
}

export interface BuildPlanArgs {
  spec_prompt: string;
  filters: PlanFilters;
  current_plan?: string;
  extra_instructions?: string;
}

const PLAN_SYSTEM = `You produce structured document plans in Markdown. Output ONLY the plan.
Format: one H2 (## ) per section. Under each H2, a single short paragraph
(1–3 sentences) describing what the section covers. No body content.
No introduction, no conclusion outside the plan, no commentary.`;

export function buildPlanMessages(args: BuildPlanArgs): ChatMessage[] {
  const lang = args.filters.lang ?? 'fr';
  const domain = args.filters.domain ?? 'any';
  const tags = args.filters.tags && args.filters.tags.length > 0
    ? args.filters.tags.join(', ')
    : 'none';

  const parts: string[] = [];
  parts.push(`Context / specification:\n${args.spec_prompt}`);
  parts.push('');
  parts.push('Constraints:');
  parts.push(`- Language: ${lang}`);
  parts.push(`- Domain: ${domain}`);
  parts.push(`- Tags: ${tags}`);

  if (args.extra_instructions && !args.current_plan) {
    parts.push('');
    parts.push(`Additional instructions: ${args.extra_instructions}`);
  }

  if (args.current_plan && args.current_plan.trim() !== '') {
    parts.push('');
    parts.push('Current plan to revise:');
    parts.push(args.current_plan);
    parts.push('');
    parts.push(`Revision instructions: ${args.extra_instructions ?? ''}`.trim());
  }

  return [
    { role: 'system', content: PLAN_SYSTEM },
    { role: 'user', content: parts.join('\n') },
  ];
}

export interface BuildSectionArgs {
  section: { title: string; description: string };
  fragments: Array<{ body: string }>;
  lang: string;
  max_chars: number;
  writer_prompt_override?: string;
}

const WRITER_SYSTEM_BASE = `You are an expert technical writer producing one section of a larger
document. Write in {LANG}. Be concise and factual.

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
title as a heading. No introduction, no closing remark.`;

function truncate(body: string, max: number): string {
  if (body.length <= max) return body;
  return body.slice(0, max) + '\n…[truncated]';
}

export function buildSectionMessages(args: BuildSectionArgs): ChatMessage[] {
  let system = WRITER_SYSTEM_BASE.replace('{LANG}', args.lang);
  if (args.writer_prompt_override && args.writer_prompt_override.trim() !== '') {
    system += `\n\nAdditional guidance: ${args.writer_prompt_override.trim()}`;
  }

  const lines: string[] = [];
  lines.push(`Section title: ${args.section.title}`);
  lines.push(`Section description: ${args.section.description}`);
  lines.push('');
  if (args.fragments.length === 0) {
    lines.push('(no source fragments — write from the description alone, mark uncertain claims)');
  } else {
    lines.push('Source fragments (use these as the basis for the content):');
    args.fragments.forEach((f, i) => {
      lines.push(`--- Fragment ${i + 1} ---`);
      lines.push(truncate(f.body, args.max_chars));
    });
  }

  return [
    { role: 'system', content: system },
    { role: 'user', content: lines.join('\n') },
  ];
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @fragmint/server test -- plan-prompts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/plan-prompts.ts packages/server/src/services/plan-prompts.test.ts
git commit -m "feat(server): add plan and section writer prompt builders"
```

---

## Task 7: Pandoc render service (TDD)

**Goal:** Convert markdown to a DOCX buffer via the Pandoc CLI. Optional `--reference-doc` path. 30s timeout. Clean up tmp files.

**Files:**
- Create: `packages/server/src/services/pandoc-render.ts`
- Create: `packages/server/src/services/pandoc-render.test.ts`

**Prerequisite:** `pandoc` must be on the PATH. Check with `which pandoc`. The harvest pipeline already relies on it, so dev environments should have it. CI: ensure pandoc is installed (already true if harvest tests pass).

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/services/pandoc-render.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderMarkdownToDocx } from './pandoc-render.js';

describe('renderMarkdownToDocx', () => {
  it('produces a DOCX buffer with a recognizable header', async () => {
    const buf = await renderMarkdownToDocx('# Hello\n\nWorld.');
    // .docx files are ZIP archives, starting with PK\x03\x04
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf.length).toBeGreaterThan(100);
  }, 15000);

  it('throws with a helpful message on invalid reference-doc path', async () => {
    await expect(
      renderMarkdownToDocx('# x', '/nonexistent/path.docx'),
    ).rejects.toThrow(/reference|pandoc/i);
  }, 15000);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @fragmint/server test -- pandoc-render`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/server/src/services/pandoc-render.ts`:

```ts
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const TIMEOUT_MS = 30_000;

export async function renderMarkdownToDocx(
  markdown: string,
  referenceDocPath?: string,
): Promise<Buffer> {
  if (referenceDocPath && !existsSync(referenceDocPath)) {
    throw new Error(`Pandoc reference-doc not found: ${referenceDocPath}`);
  }

  const id = randomUUID();
  const mdPath = join(tmpdir(), `fragmint-plan-${id}.md`);
  const docxPath = join(tmpdir(), `fragmint-plan-${id}.docx`);
  writeFileSync(mdPath, markdown, 'utf-8');

  const args = ['-f', 'markdown', '-t', 'docx', '-o', docxPath];
  if (referenceDocPath) args.push(`--reference-doc=${referenceDocPath}`);
  args.push(mdPath);

  try {
    await runPandoc(args);
    return readFileSync(docxPath);
  } finally {
    if (existsSync(mdPath)) try { unlinkSync(mdPath); } catch (_) {}
    if (existsSync(docxPath)) try { unlinkSync(docxPath); } catch (_) {}
  }
}

function runPandoc(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('pandoc', args);
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Pandoc timed out after 30s'));
    }, TIMEOUT_MS);
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Pandoc spawn error: ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      const truncated = stderr.length > 500 ? stderr.slice(0, 500) + '\n[truncated]' : stderr;
      reject(new Error(`Pandoc exited with code ${code}: ${truncated}`));
    });
  });
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @fragmint/server test -- pandoc-render`
Expected: PASS — both tests pass (assumes `pandoc` is on PATH).

If `pandoc` is missing, the test errors with "pandoc spawn error: ENOENT" — install Pandoc and re-run.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/pandoc-render.ts packages/server/src/services/pandoc-render.test.ts
git commit -m "feat(server): add Pandoc markdown to docx render service"
```

---

# Phase 3 — Plan service + Zod schemas

## Task 8: Plan Zod schemas

**Goal:** Validate API inputs and provide TypeScript types for the wizard state.

**Files:**
- Create: `packages/server/src/schema/plan.ts`

- [ ] **Step 1: Create the schema file**

Create `packages/server/src/schema/plan.ts`:

```ts
import { z } from 'zod';

export const PLAN_STATUSES = ['draft', 'plan_validated', 'fragments_validated', 'completed'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const PlanFiltersSchema = z.object({
  domain: z.string().optional(),
  lang: z.string().optional(),
  type: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const FragmentCandidateSchema = z.object({
  fragment_id: z.string(),
  score: z.number(),
  title: z.string().nullable(),
  body_excerpt: z.string().nullable(),
  quality: z.string(),
});

export const SectionFragmentSelectionSchema = z.object({
  fragment_id: z.string(),
  body: z.string(),
  edited: z.boolean(),
  propose_to_library: z.boolean(),
  proposed_fragment_id: z.string().optional(),
});

export const PlanSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  candidates: z.array(FragmentCandidateSchema).default([]),
  selected: z.array(SectionFragmentSelectionSchema).default([]),
  generated_markdown: z.string().optional(),
  filters_override: PlanFiltersSchema.optional(),
});

export const PlanStateSchema = z.object({
  spec_prompt: z.string().default(''),
  filters: PlanFiltersSchema.default({}),
  plan_markdown: z.string().default(''),
  writer_prompt_override: z.string().optional(),
  sections: z.array(PlanSectionSchema).default([]),
  draft_markdown: z.string().optional(),
  draft_dirty: z.boolean().optional(),
  export_style_template_id: z.string().optional(),
});

export type PlanState = z.infer<typeof PlanStateSchema>;
export type PlanSection = z.infer<typeof PlanSectionSchema>;
export type PlanFilters = z.infer<typeof PlanFiltersSchema>;
export type SectionFragmentSelection = z.infer<typeof SectionFragmentSelectionSchema>;
export type FragmentCandidate = z.infer<typeof FragmentCandidateSchema>;

export const CreatePlanSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  spec_prompt: z.string().default(''),
  filters: PlanFiltersSchema.default({}),
});

export const UpdatePlanSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  spec_prompt: z.string().optional(),
  filters: PlanFiltersSchema.optional(),
  plan_markdown: z.string().optional(),
  draft_markdown: z.string().optional(),
  draft_dirty: z.boolean().optional(),
  writer_prompt_override: z.string().optional(),
  sections: z.array(PlanSectionSchema).optional(),
  export_style_template_id: z.string().nullable().optional(),
});

export const GeneratePlanSchema = z.object({
  extra_instructions: z.string().optional(),
});

export const SectionSearchSchema = z.object({
  filters_override: PlanFiltersSchema.optional(),
});

export const ExportPlanSchema = z.object({
  format: z.enum(['md', 'docx']),
  style_template_id: z.string().optional(),
});
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @fragmint/server typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/schema/plan.ts
git commit -m "feat(server): add Zod schemas for plan inputs and state"
```

---

## Task 9: PlanService — CRUD methods (TDD)

**Goal:** Implement `create`, `get`, `list`, `update`, `delete` against the `plans` table. State is JSON-serialized in `state_json`.

**Files:**
- Create: `packages/server/src/services/plan-service.ts`
- Create: `packages/server/src/services/plan-service.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/src/services/plan-service.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../db/connection.js';
import { PlanService } from './plan-service.js';

function makeService() {
  const db = createDb(':memory:');
  return new PlanService(db, {
    fragmentMaxChars: 4000,
    docxReferencePath: undefined,
  });
}

describe('PlanService CRUD', () => {
  let svc: ReturnType<typeof makeService>;
  beforeEach(() => { svc = makeService(); });

  it('creates a plan with default state and status="draft"', async () => {
    const p = await svc.create({
      title: 'My plan',
      owner: 'alice',
      collection_slug: 'common',
      spec_prompt: 'hello',
      filters: { lang: 'fr' },
    });
    expect(p.id).toMatch(/^plan_/);
    expect(p.status).toBe('draft');
    expect(p.state.spec_prompt).toBe('hello');
    expect(p.state.filters.lang).toBe('fr');
    expect(p.state.sections).toEqual([]);
  });

  it('defaults the title to "Untitled plan" when not provided', async () => {
    const p = await svc.create({ owner: 'alice', collection_slug: null, spec_prompt: '' });
    expect(p.title).toBe('Untitled plan');
  });

  it('lists plans scoped to owner and collection', async () => {
    await svc.create({ title: 'A', owner: 'alice', collection_slug: 'common', spec_prompt: '' });
    await svc.create({ title: 'B', owner: 'alice', collection_slug: 'other', spec_prompt: '' });
    await svc.create({ title: 'C', owner: 'bob', collection_slug: 'common', spec_prompt: '' });

    const aliceCommon = await svc.list({ owner: 'alice', collection_slug: 'common' });
    expect(aliceCommon.map((p) => p.title).sort()).toEqual(['A']);
  });

  it('returns null when get is called with a missing id', async () => {
    expect(await svc.get('plan_missing')).toBeNull();
  });

  it('updates mutable fields and bumps updated_at', async () => {
    const p = await svc.create({ owner: 'a', collection_slug: 'c', spec_prompt: 'x' });
    const before = p.updated_at;
    await new Promise((r) => setTimeout(r, 10));
    const updated = await svc.update(p.id, { title: 'Renamed', plan_markdown: '## Intro' });
    expect(updated!.title).toBe('Renamed');
    expect(updated!.state.plan_markdown).toBe('## Intro');
    expect(updated!.updated_at).not.toBe(before);
  });

  it('deletes a plan', async () => {
    const p = await svc.create({ owner: 'a', collection_slug: null, spec_prompt: '' });
    const ok = await svc.remove(p.id);
    expect(ok).toBe(true);
    expect(await svc.get(p.id)).toBeNull();
  });

  it('returns null when updating a missing plan', async () => {
    expect(await svc.update('plan_missing', { title: 'X' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @fragmint/server test -- plan-service`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement (skeleton + CRUD)**

Create `packages/server/src/services/plan-service.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { eq, and, desc } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { plans } from '../db/schema.js';
import {
  PlanStateSchema,
  type PlanState,
  type PlanStatus,
  type PlanFilters,
} from '../schema/plan.js';

export interface PlanServiceConfig {
  fragmentMaxChars: number;
  docxReferencePath?: string;
}

export interface PlanRecord {
  id: string;
  title: string;
  owner: string;
  collection_slug: string | null;
  status: PlanStatus;
  state: PlanState;
  created_at: string;
  updated_at: string;
}

export interface CreatePlanInput {
  title?: string;
  owner: string;
  collection_slug: string | null;
  spec_prompt: string;
  filters?: PlanFilters;
}

export interface ListPlansInput {
  owner: string;
  collection_slug?: string | null;
}

export interface UpdatePlanInput {
  title?: string;
  spec_prompt?: string;
  filters?: PlanFilters;
  plan_markdown?: string;
  draft_markdown?: string;
  draft_dirty?: boolean;
  writer_prompt_override?: string;
  sections?: PlanState['sections'];
  export_style_template_id?: string | null;
  status?: PlanStatus;
}

function rowToRecord(row: typeof plans.$inferSelect): PlanRecord {
  return {
    id: row.id,
    title: row.title,
    owner: row.owner,
    collection_slug: row.collection_slug,
    status: row.status as PlanStatus,
    state: PlanStateSchema.parse(JSON.parse(row.state_json)),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class PlanService {
  constructor(private db: FragmintDb, private config: PlanServiceConfig) {}

  async create(input: CreatePlanInput): Promise<PlanRecord> {
    const id = `plan_${randomUUID()}`;
    const now = new Date().toISOString();
    const state: PlanState = PlanStateSchema.parse({
      spec_prompt: input.spec_prompt,
      filters: input.filters ?? {},
      plan_markdown: '',
      sections: [],
    });
    await this.db.insert(plans).values({
      id,
      title: input.title?.trim() && input.title.trim() !== '' ? input.title.trim() : 'Untitled plan',
      owner: input.owner,
      collection_slug: input.collection_slug,
      status: 'draft',
      state_json: JSON.stringify(state),
      created_at: now,
      updated_at: now,
    });
    return (await this.get(id))!;
  }

  async list(input: ListPlansInput): Promise<PlanRecord[]> {
    const conds = [eq(plans.owner, input.owner)];
    if (input.collection_slug !== undefined && input.collection_slug !== null) {
      conds.push(eq(plans.collection_slug, input.collection_slug));
    }
    const rows = await this.db
      .select()
      .from(plans)
      .where(and(...conds))
      .orderBy(desc(plans.updated_at));
    return rows.map(rowToRecord);
  }

  async get(id: string): Promise<PlanRecord | null> {
    const rows = await this.db.select().from(plans).where(eq(plans.id, id)).limit(1);
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async update(id: string, input: UpdatePlanInput): Promise<PlanRecord | null> {
    const existing = await this.get(id);
    if (!existing) return null;

    const newState: PlanState = { ...existing.state };
    if (input.spec_prompt !== undefined) newState.spec_prompt = input.spec_prompt;
    if (input.filters !== undefined) newState.filters = input.filters;
    if (input.plan_markdown !== undefined) newState.plan_markdown = input.plan_markdown;
    if (input.draft_markdown !== undefined) newState.draft_markdown = input.draft_markdown;
    if (input.draft_dirty !== undefined) newState.draft_dirty = input.draft_dirty;
    if (input.writer_prompt_override !== undefined)
      newState.writer_prompt_override = input.writer_prompt_override;
    if (input.sections !== undefined) newState.sections = input.sections;
    if (input.export_style_template_id === null) {
      delete newState.export_style_template_id;
    } else if (input.export_style_template_id !== undefined) {
      newState.export_style_template_id = input.export_style_template_id;
    }

    const now = new Date().toISOString();
    await this.db
      .update(plans)
      .set({
        title: input.title?.trim() && input.title.trim() !== '' ? input.title.trim() : existing.title,
        status: input.status ?? existing.status,
        state_json: JSON.stringify(newState),
        updated_at: now,
      })
      .where(eq(plans.id, id));
    return await this.get(id);
  }

  async remove(id: string): Promise<boolean> {
    await this.db.delete(plans).where(eq(plans.id, id));
    return true;
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @fragmint/server test -- plan-service`
Expected: PASS — 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/plan-service.ts packages/server/src/services/plan-service.test.ts
git commit -m "feat(server): add PlanService with CRUD methods"
```

---

## Task 10: PlanService — action methods (TDD)

**Goal:** Add the action methods: `generatePlan`, `validatePlan`, `searchSection`, `validateFragments`, `generateSection`, `assemble`, `exportMarkdown`, `exportDocx`. Keep them coordinated with the spec's state-transition rules.

**Files:**
- Modify: `packages/server/src/services/plan-service.ts`
- Modify: `packages/server/src/services/plan-service.test.ts`
- Note: this task is sizeable. Use a fake `LlmClient` and a fake `SearchService` in tests.

- [ ] **Step 1: Add action tests**

Append to `packages/server/src/services/plan-service.test.ts`:

```ts
import { vi } from 'vitest';
import type { LlmClient } from './llm-client.js';
import type { SearchService } from '../search/search-service.js';
import type { FragmentService } from './fragment-service.js';

function fakeLlm(responses: string[]): LlmClient {
  let i = 0;
  return {
    chatMessages: vi.fn(async () => responses[i++] ?? ''),
  } as unknown as LlmClient;
}

function fakeSearch(results: any[]): SearchService {
  return { search: vi.fn(async () => results) } as unknown as SearchService;
}

function fakeFragments(createdId = 'frag_new'): FragmentService {
  return {
    create: vi.fn(async () => ({ id: createdId })),
    getById: vi.fn(async (id: string) => ({
      id,
      body: `body of ${id}`,
      type: 'introduction',
      domain: 'cloud',
      lang: 'fr',
      tags: '["t1"]',
      collection_slug: 'common',
    })),
  } as unknown as FragmentService;
}

function makeServiceFull(opts: {
  llm?: LlmClient;
  search?: SearchService;
  fragments?: FragmentService;
} = {}) {
  const db = createDb(':memory:');
  return new PlanService(db, {
    fragmentMaxChars: 4000,
    docxReferencePath: undefined,
    llm: opts.llm,
    search: opts.search,
    fragments: opts.fragments,
  });
}

describe('PlanService.generatePlan', () => {
  it('stores the LLM-generated markdown into the plan', async () => {
    const llm = fakeLlm(['## Intro\n\nWelcomes.\n\n## Pricing\n\nCosts.']);
    const svc = makeServiceFull({ llm });
    const p = await svc.create({ owner: 'a', collection_slug: null, spec_prompt: 'cloud doc' });
    const out = await svc.generatePlan(p.id, {});
    expect(out!.state.plan_markdown).toContain('## Intro');
    expect(llm.chatMessages).toHaveBeenCalledTimes(1);
  });
});

describe('PlanService.validatePlan', () => {
  it('parses sections, populates candidates via search, and sets status', async () => {
    const llm = fakeLlm([]);
    const search = fakeSearch([
      { id: 'f1', score: 0.9, title: 'F1', body_excerpt: 'b1', quality: 'reviewed' },
      { id: 'f2', score: 0.8, title: 'F2', body_excerpt: 'b2', quality: 'draft' },
    ]);
    const svc = makeServiceFull({ llm, search });
    const p = await svc.create({ owner: 'a', collection_slug: null, spec_prompt: '' });
    await svc.update(p.id, { plan_markdown: '## A\n\nDescA\n\n## B\n\nDescB' });

    const out = await svc.validatePlan(p.id);
    expect(out!.status).toBe('plan_validated');
    expect(out!.state.sections).toHaveLength(2);
    expect(out!.state.sections[0].candidates).toHaveLength(2);
    expect(out!.state.sections[0].candidates[0].fragment_id).toBe('f1');
  });

  it('preserves existing per-section selections when re-validating with same section titles', async () => {
    const llm = fakeLlm([]);
    const search = fakeSearch([{ id: 'fX', score: 0.9, title: 'X', body_excerpt: 'x', quality: 'draft' }]);
    const svc = makeServiceFull({ llm, search });
    const p = await svc.create({ owner: 'a', collection_slug: null, spec_prompt: '' });
    await svc.update(p.id, { plan_markdown: '## Keep\n\nDesc' });
    const v1 = await svc.validatePlan(p.id);
    await svc.update(p.id, {
      sections: v1!.state.sections.map((s) => ({
        ...s,
        selected: [
          { fragment_id: 'fX', body: 'edited body', edited: true, propose_to_library: false },
        ],
      })),
    });
    const v2 = await svc.validatePlan(p.id);
    expect(v2!.state.sections[0].selected).toHaveLength(1);
    expect(v2!.state.sections[0].selected[0].body).toBe('edited body');
  });
});

describe('PlanService.searchSection', () => {
  it('refreshes candidates for a single section', async () => {
    const search = fakeSearch([{ id: 'fNEW', score: 1, title: 'new', body_excerpt: 'nb', quality: 'approved' }]);
    const svc = makeServiceFull({ search, llm: fakeLlm([]) });
    const p = await svc.create({ owner: 'a', collection_slug: null, spec_prompt: '' });
    await svc.update(p.id, { plan_markdown: '## S\n\nD' });
    const v = await svc.validatePlan(p.id);
    const sid = v!.state.sections[0].id;
    const out = await svc.searchSection(p.id, sid, {});
    expect(out!.state.sections[0].candidates[0].fragment_id).toBe('fNEW');
  });
});

describe('PlanService.validateFragments', () => {
  it('creates library drafts for selections with propose_to_library=true', async () => {
    const search = fakeSearch([{ id: 'fSrc', score: 1, title: 't', body_excerpt: 'b', quality: 'draft' }]);
    const fragments = fakeFragments('frag_proposed');
    const svc = makeServiceFull({ llm: fakeLlm([]), search, fragments });
    const p = await svc.create({ owner: 'alice', collection_slug: 'common', spec_prompt: '' });
    await svc.update(p.id, { plan_markdown: '## S\n\nD' });
    const v = await svc.validatePlan(p.id);
    const sid = v!.state.sections[0].id;
    await svc.update(p.id, {
      sections: v!.state.sections.map((s) =>
        s.id === sid
          ? {
              ...s,
              selected: [
                { fragment_id: 'fSrc', body: 'edited', edited: true, propose_to_library: true },
              ],
            }
          : s,
      ),
    });
    const out = await svc.validateFragments(p.id);
    expect(out!.status).toBe('fragments_validated');
    expect(out!.state.sections[0].selected[0].proposed_fragment_id).toBe('frag_proposed');
    expect((fragments.create as any).mock.calls.length).toBe(1);
  });

  it('does not re-create a library draft if proposed_fragment_id is already set', async () => {
    const fragments = fakeFragments('frag_should_not_create');
    const svc = makeServiceFull({ llm: fakeLlm([]), search: fakeSearch([]), fragments });
    const p = await svc.create({ owner: 'alice', collection_slug: 'common', spec_prompt: '' });
    await svc.update(p.id, {
      plan_markdown: '## S\n\nD',
      sections: [
        {
          id: 'sec_aaa',
          title: 'S',
          description: 'D',
          candidates: [],
          selected: [
            {
              fragment_id: 'fSrc',
              body: 'b',
              edited: true,
              propose_to_library: true,
              proposed_fragment_id: 'frag_existing',
            },
          ],
        },
      ],
      status: 'plan_validated',
    });
    await svc.validateFragments(p.id);
    expect((fragments.create as any).mock.calls.length).toBe(0);
  });
});

describe('PlanService.generateSection', () => {
  it('calls the LLM with title/description/fragments and stores generated_markdown', async () => {
    const llm = fakeLlm(['Generated body of the section.']);
    const svc = makeServiceFull({ llm, search: fakeSearch([]) });
    const p = await svc.create({ owner: 'a', collection_slug: null, spec_prompt: '' });
    await svc.update(p.id, {
      plan_markdown: '## A\n\nD',
      sections: [
        {
          id: 'sec_aaa',
          title: 'A',
          description: 'D',
          candidates: [],
          selected: [
            { fragment_id: 'f1', body: 'frag body', edited: false, propose_to_library: false },
          ],
        },
      ],
      status: 'fragments_validated',
    });
    const out = await svc.generateSection(p.id, 'sec_aaa');
    expect(out!.state.sections[0].generated_markdown).toContain('Generated body');
    expect(llm.chatMessages).toHaveBeenCalledTimes(1);
  });
});

describe('PlanService.assemble', () => {
  it('concatenates section bodies into draft_markdown', async () => {
    const svc = makeServiceFull({ llm: fakeLlm([]), search: fakeSearch([]) });
    const p = await svc.create({ owner: 'a', collection_slug: null, spec_prompt: '', title: 'Doc' });
    await svc.update(p.id, {
      sections: [
        { id: 's1', title: 'A', description: 'D', candidates: [], selected: [], generated_markdown: 'Body A.' },
        { id: 's2', title: 'B', description: 'D', candidates: [], selected: [], generated_markdown: 'Body B.' },
      ],
      status: 'fragments_validated',
    });
    const out = await svc.assemble(p.id);
    expect(out!.state.draft_markdown).toContain('# Doc');
    expect(out!.state.draft_markdown).toContain('## A');
    expect(out!.state.draft_markdown).toContain('Body A.');
    expect(out!.state.draft_markdown).toContain('## B');
  });
});

describe('PlanService.exportMarkdown / exportDocx', () => {
  it('exportMarkdown returns the draft and bumps status to completed', async () => {
    const svc = makeServiceFull({ llm: fakeLlm([]), search: fakeSearch([]) });
    const p = await svc.create({ owner: 'a', collection_slug: null, spec_prompt: '' });
    await svc.update(p.id, { draft_markdown: '# X', status: 'fragments_validated' });
    const md = await svc.exportMarkdown(p.id);
    expect(md.content).toBe('# X');
    expect(md.filename).toMatch(/\.md$/);
    const after = await svc.get(p.id);
    expect(after!.status).toBe('completed');
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @fragmint/server test -- plan-service`
Expected: FAIL — methods don't exist yet.

- [ ] **Step 3: Implement action methods in PlanService**

Update `packages/server/src/services/plan-service.ts`:

1. Extend imports at the top:

```ts
import { buildPlanMessages, buildSectionMessages } from './plan-prompts.js';
import { parsePlanSections } from './plan-section-parser.js';
import { slugify } from './slugify.js';
import { renderMarkdownToDocx } from './pandoc-render.js';
import type { LlmClient } from './llm-client.js';
import type { SearchService } from '../search/search-service.js';
import type { FragmentService } from './fragment-service.js';
```

2. Expand `PlanServiceConfig` and constructor to accept optional dependencies (for test injection):

```ts
export interface PlanServiceConfig {
  fragmentMaxChars: number;
  docxReferencePath?: string;
  llm?: LlmClient;
  search?: SearchService;
  fragments?: FragmentService;
}
```

3. Add a helper to resolve dependencies (throws if not configured when needed):

```ts
private requireLlm(): LlmClient {
  if (!this.config.llm) throw new Error('PlanService: LlmClient not configured');
  return this.config.llm;
}
private requireSearch(): SearchService {
  if (!this.config.search) throw new Error('PlanService: SearchService not configured');
  return this.config.search;
}
private requireFragments(): FragmentService {
  if (!this.config.fragments) throw new Error('PlanService: FragmentService not configured');
  return this.config.fragments;
}
```

4. Add the action methods at the bottom of the class:

```ts
async generatePlan(
  id: string,
  args: { extra_instructions?: string },
): Promise<PlanRecord | null> {
  const p = await this.get(id);
  if (!p) return null;
  const messages = buildPlanMessages({
    spec_prompt: p.state.spec_prompt,
    filters: p.state.filters,
    current_plan: p.state.plan_markdown,
    extra_instructions: args.extra_instructions,
  });
  const out = await this.requireLlm().chatMessages(messages);
  return this.update(id, { plan_markdown: out.trim() });
}

async validatePlan(id: string): Promise<PlanRecord | null> {
  const p = await this.get(id);
  if (!p) return null;
  const parsed = parsePlanSections(p.state.plan_markdown);
  const oldById = new Map(p.state.sections.map((s) => [s.id, s]));

  const search = this.requireSearch();
  const newSections = await Promise.all(parsed.map(async (ps) => {
    const previous = oldById.get(ps.id);
    const filters = previous?.filters_override ?? p.state.filters;
    const results = await search.search(
      `${ps.title}\n${ps.description}`,
      {
        domain: filters.domain ? [filters.domain] : undefined,
        type: filters.type ? [filters.type] : undefined,
        lang: filters.lang,
        tags: filters.tags,
        collectionSlug: p.collection_slug ?? undefined,
      },
      5,
    );
    const candidates = results.map((r: any) => ({
      fragment_id: r.id,
      score: r.score,
      title: r.title,
      body_excerpt: r.body_excerpt,
      quality: r.quality,
    }));
    return {
      id: ps.id,
      title: ps.title,
      description: ps.description,
      candidates,
      selected: previous?.selected ?? [],
      generated_markdown: previous?.generated_markdown,
      filters_override: previous?.filters_override,
    };
  }));

  return this.update(id, { sections: newSections, status: 'plan_validated' });
}

async searchSection(
  planId: string,
  sectionId: string,
  args: { filters_override?: PlanFilters },
): Promise<PlanRecord | null> {
  const p = await this.get(planId);
  if (!p) return null;
  const section = p.state.sections.find((s) => s.id === sectionId);
  if (!section) return null;
  const filters = args.filters_override ?? section.filters_override ?? p.state.filters;
  const results = await this.requireSearch().search(
    `${section.title}\n${section.description}`,
    {
      domain: filters.domain ? [filters.domain] : undefined,
      type: filters.type ? [filters.type] : undefined,
      lang: filters.lang,
      tags: filters.tags,
      collectionSlug: p.collection_slug ?? undefined,
    },
    5,
  );
  const candidates = results.map((r: any) => ({
    fragment_id: r.id,
    score: r.score,
    title: r.title,
    body_excerpt: r.body_excerpt,
    quality: r.quality,
  }));
  const updatedSections = p.state.sections.map((s) =>
    s.id === sectionId ? { ...s, candidates, filters_override: args.filters_override ?? s.filters_override } : s,
  );
  return this.update(planId, { sections: updatedSections });
}

async validateFragments(id: string): Promise<PlanRecord | null> {
  const p = await this.get(id);
  if (!p) return null;
  const fragments = this.requireFragments();

  const newSections = await Promise.all(p.state.sections.map(async (s) => {
    const newSelected = await Promise.all(s.selected.map(async (sel) => {
      if (!sel.propose_to_library || sel.proposed_fragment_id) return sel;
      const original = await fragments.getById(sel.fragment_id);
      const created = await (fragments as any).create({
        type: (original as any)?.type ?? 'other',
        domain: (original as any)?.domain ?? 'other',
        lang: (original as any)?.lang ?? 'fr',
        body: sel.body,
        quality: 'draft',
        origin: 'plan',
        origin_source: id,
        author: p.owner,
        tags: (original as any)?.tags,
        collection_slug: p.collection_slug,
      });
      return { ...sel, proposed_fragment_id: created.id };
    }));
    return { ...s, selected: newSelected };
  }));

  return this.update(id, { sections: newSections, status: 'fragments_validated' });
}

async generateSection(planId: string, sectionId: string): Promise<PlanRecord | null> {
  const p = await this.get(planId);
  if (!p) return null;
  const section = p.state.sections.find((s) => s.id === sectionId);
  if (!section) return null;
  const messages = buildSectionMessages({
    section: { title: section.title, description: section.description },
    fragments: section.selected.map((s) => ({ body: s.body })),
    lang: p.state.filters.lang ?? 'fr',
    max_chars: this.config.fragmentMaxChars,
    writer_prompt_override: p.state.writer_prompt_override,
  });
  const out = await this.requireLlm().chatMessages(messages);
  const updatedSections = p.state.sections.map((s) =>
    s.id === sectionId ? { ...s, generated_markdown: out.trim() } : s,
  );
  return this.update(planId, { sections: updatedSections });
}

async assemble(id: string): Promise<PlanRecord | null> {
  const p = await this.get(id);
  if (!p) return null;
  const parts: string[] = [`# ${p.title}`, ''];
  for (const s of p.state.sections) {
    if (!s.generated_markdown) continue;
    parts.push(`## ${s.title}`);
    parts.push('');
    parts.push(s.generated_markdown.trim());
    parts.push('');
  }
  return this.update(id, { draft_markdown: parts.join('\n'), draft_dirty: false });
}

async exportMarkdown(id: string): Promise<{ content: string; filename: string }> {
  const p = await this.get(id);
  if (!p) throw new Error('Plan not found');
  await this.update(id, { status: 'completed' });
  return {
    content: p.state.draft_markdown ?? '',
    filename: `${slugify(p.title)}.md`,
  };
}

async exportDocx(
  id: string,
  args: { styleTemplatePath?: string },
): Promise<{ content: Buffer; filename: string }> {
  const p = await this.get(id);
  if (!p) throw new Error('Plan not found');
  const reference = args.styleTemplatePath ?? this.config.docxReferencePath;
  const buf = await renderMarkdownToDocx(p.state.draft_markdown ?? '', reference);
  await this.update(id, { status: 'completed' });
  return { content: buf, filename: `${slugify(p.title)}.docx` };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @fragmint/server test -- plan-service`
Expected: PASS — all CRUD + action tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/plan-service.ts packages/server/src/services/plan-service.test.ts
git commit -m "feat(server): add PlanService action methods (generate/validate/assemble/export)"
```

---

# Phase 4 — Style-reference templates

## Task 11: TemplateService — `createStyleReference` (TDD)

**Goal:** Allow uploading a `.docx` as a style reference (no YAML). Persists with `kind: 'style_reference'`, `yaml_path: ''`.

**Files:**
- Modify: `packages/server/src/services/template-service.ts`
- Modify: `packages/server/src/services/template-service.test.ts` (extend existing test file).

- [ ] **Step 1: Add test**

Append to `packages/server/src/services/template-service.test.ts` (read it first; pattern should mirror existing `create()` tests):

```ts
import { describe, it, expect } from 'vitest';
// ...if not already imported above
import { TemplateService } from './template-service.js';

describe('TemplateService.createStyleReference', () => {
  it('persists a style_reference template without YAML', async () => {
    // Reuse the existing test harness helper that creates a temp store + service.
    // If a helper like `makeTemplateService()` exists in the file, use it; otherwise
    // copy the boilerplate from the `create()` test above this block.
    const { svc } = await makeTemplateService();
    const docx = Buffer.from('PK\x03\x04 fake docx');
    const result = await svc.createStyleReference(
      docx,
      'corporate-style.docx',
      'Corporate Style',
      'Standard layout for proposals',
      'alice',
      'contributor',
    );
    expect(result.id).toMatch(/^tpl_style_/);
    const row = await svc.getById(result.id);
    expect(row!.kind).toBe('style_reference');
    expect(row!.yaml_path).toBe('');
    expect(row!.output_format).toBe('docx');
  });

  it('rejects filenames containing path-traversal sequences', async () => {
    const { svc } = await makeTemplateService();
    const docx = Buffer.from('PK\x03\x04');
    await expect(
      svc.createStyleReference(docx, '../evil.docx', 'X', null, 'a', 'contributor'),
    ).rejects.toThrow();
  });
});
```

If `makeTemplateService` does not already exist in the file, use the boilerplate from an existing test in this file to set up `db`, `audit`, and a temp `storePath`, then `new TemplateService(...)`.

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @fragmint/server test -- template-service`
Expected: FAIL — `svc.createStyleReference is not a function`.

- [ ] **Step 3: Implement**

In `packages/server/src/services/template-service.ts`:

1. Update the existing `list()` method to support a `kind` filter. Find this block:
   ```ts
   async list(filters?: { output_format?: string; limit?: number; offset?: number }) {
     const conditions = [];
     if (filters?.output_format) {
       conditions.push(eq(templates.output_format, filters.output_format));
     }
   ```
   and change the signature + add another conditional:
   ```ts
   async list(filters?: { output_format?: string; kind?: string; limit?: number; offset?: number }) {
     const conditions = [];
     if (filters?.output_format) {
       conditions.push(eq(templates.output_format, filters.output_format));
     }
     if (filters?.kind) {
       conditions.push(eq(templates.kind, filters.kind));
     }
   ```

   And handle multiple `where()` conditions: replace `.where(conditions.length ? conditions[0] : undefined)` with `.where(conditions.length ? (conditions.length === 1 ? conditions[0] : and(...conditions)) : undefined)` — at the top of the file, add `and` to the existing `drizzle-orm` import.

2. Add the new method to the class:

```ts
async createStyleReference(
  docxBuffer: Buffer,
  docxFilename: string,
  name: string,
  description: string | null,
  author: string,
  authorRole: string,
  ip?: string,
) {
  if (docxFilename.includes('..') || docxFilename.includes('/')) {
    throw new Error('Invalid filename: must not contain ".." or "/"');
  }

  const id = `tpl_style_${randomUUID()}`;
  const now = new Date().toISOString();
  const templatesDir = join(this.storePath, 'templates');
  mkdirSync(templatesDir, { recursive: true });

  // Prefix the on-disk filename with the id to avoid collisions with composer templates.
  const safeName = `${id}-${docxFilename}`;
  const docxPath = join(templatesDir, safeName);
  writeFileSync(docxPath, docxBuffer);
  const relDocxPath = relative(this.storePath, docxPath);

  const commitHash = await this.git.commitFiles(
    [relDocxPath],
    `template: create style-reference ${name} (${id})`,
  );

  await this.db.insert(templates).values({
    id,
    name,
    description,
    output_format: 'docx',
    version: '1.0.0',
    template_path: relDocxPath,
    yaml_path: '',
    author,
    created_at: now,
    updated_at: now,
    git_hash: commitHash,
    kind: 'style_reference',
  });

  await this.audit.log({
    user_id: author,
    role: authorRole,
    action: 'template:create_style_reference',
    fragment_id: id,
    ip_source: ip,
  });

  return { id, template_path: relDocxPath };
}
```

3. Add `import { randomUUID } from 'node:crypto';` at the top if not already present.

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @fragmint/server test -- template-service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/template-service.ts packages/server/src/services/template-service.test.ts
git commit -m "feat(server): add createStyleReference + kind filter to TemplateService"
```

---

## Task 12: Template routes — `?kind=` + style-reference upload (TDD via integration test)

**Goal:** Surface `kind` filter on list, add `POST /v1/templates/style-reference`.

**Files:**
- Modify: `packages/server/src/routes/template-routes.ts`
- Create: `packages/server/src/routes/templates-style-reference.integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `packages/server/src/routes/templates-style-reference.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import FormData from 'form-data';
import { createTestServer, getAuthToken } from '../test-helpers.js';

describe('Style-reference template routes', () => {
  let server: any;
  let token: string;

  beforeAll(async () => {
    server = await createTestServer();
    token = await getAuthToken(server.app);
  });

  it('uploads a style-reference and lists it via ?kind=style_reference', async () => {
    const form = new FormData();
    form.append('name', 'Corporate Style');
    form.append('description', 'Std proposal layout');
    form.append('file', Buffer.from('PK\x03\x04 fake'), {
      filename: 'corporate.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    const upload = await server.app.inject({
      method: 'POST',
      url: '/v1/templates/style-reference',
      headers: { authorization: `Bearer ${token}`, ...form.getHeaders() },
      payload: form.getBuffer(),
    });
    expect(upload.statusCode).toBe(201);
    const uploaded = JSON.parse(upload.body);
    expect(uploaded.data.id).toMatch(/^tpl_style_/);

    const list = await server.app.inject({
      method: 'GET',
      url: '/v1/templates?kind=style_reference',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.statusCode).toBe(200);
    const listed = JSON.parse(list.body);
    expect(listed.data.some((t: any) => t.id === uploaded.data.id)).toBe(true);
  });

  it('rejects upload missing the file part', async () => {
    const form = new FormData();
    form.append('name', 'NoFile');

    const res = await server.app.inject({
      method: 'POST',
      url: '/v1/templates/style-reference',
      headers: { authorization: `Bearer ${token}`, ...form.getHeaders() },
      payload: form.getBuffer(),
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @fragmint/server test -- templates-style-reference`
Expected: FAIL — 404 on POST (route doesn't exist yet) and ?kind filter not respected.

- [ ] **Step 3: Implement route changes**

In `packages/server/src/routes/template-routes.ts`:

1. Find the existing `GET /v1/templates` handler. It currently reads `output_format` from the query. Add `kind` similarly:

```ts
const query = request.query as Record<string, string>;
const rows = await templateService.list({
  output_format: query.output_format,
  kind: query.kind,
  limit: query.limit ? parseInt(query.limit) : undefined,
  offset: query.offset ? parseInt(query.offset) : undefined,
});
```

(Verify this matches the existing shape — if the route already destructures differently, adapt.)

2. Add a new route handler for the style-reference upload. Right after the existing `POST /v1/templates` handler:

```ts
app.post(`${prefix}/templates/style-reference`, { preHandler: writeHandlers }, async (request, reply) => {
  let fileBuf: Buffer | null = null;
  let filename = '';
  let name = '';
  let description: string | null = null;

  for await (const part of request.parts()) {
    if (part.type === 'file' && part.fieldname === 'file') {
      const chunks: Buffer[] = [];
      for await (const c of part.file) chunks.push(c);
      fileBuf = Buffer.concat(chunks);
      filename = part.filename;
    } else if (part.type === 'field') {
      const val = part.value as string;
      if (part.fieldname === 'name') name = val;
      if (part.fieldname === 'description') description = val;
    }
  }

  if (!fileBuf || !filename) {
    return reply.status(400).send({ data: null, meta: null, error: 'Missing file part' });
  }
  if (!name) {
    return reply.status(400).send({ data: null, meta: null, error: 'Missing name field' });
  }

  const result = await templateService.createStyleReference(
    fileBuf,
    filename,
    name,
    description,
    request.user.login,
    request.user.role,
    request.ip,
  );

  return reply.status(201).send({ data: result, meta: null, error: null });
});
```

If `writeHandlers` doesn't exist in this file, use the same handler array as the existing `POST /v1/templates` route (`expertHandlers` or whatever it uses — adapt accordingly; the spec calls for `contributor` role minimum).

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @fragmint/server test -- templates-style-reference`
Expected: PASS — both tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/template-routes.ts packages/server/src/routes/templates-style-reference.integration.test.ts
git commit -m "feat(server): add style-reference template upload and kind filter"
```

---

# Phase 5 — Plan routes & server wiring

## Task 13: Plan routes

**Goal:** Mount all `/v1/plans/*` routes. Single file. Each handler delegates to `PlanService`.

**Files:**
- Create: `packages/server/src/routes/plan-routes.ts`

- [ ] **Step 1: Create the routes file**

Create `packages/server/src/routes/plan-routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { requireRole } from '../auth/middleware.js';
import type { PlanService } from '../services/plan-service.js';
import type { TemplateService } from '../services/template-service.js';
import {
  CreatePlanSchema,
  UpdatePlanSchema,
  GeneratePlanSchema,
  SectionSearchSchema,
  ExportPlanSchema,
} from '../schema/plan.js';
import { join } from 'node:path';

export function planRoutes(
  app: FastifyInstance,
  planService: PlanService,
  templateService: TemplateService,
  storePath: string,
  authenticate: ReturnType<typeof import('../auth/middleware.js').buildAuthMiddleware>,
  options?: { prefix?: string; collectionMiddleware?: any },
) {
  const prefix = options?.prefix ?? '/v1';
  const readHandlers = options?.collectionMiddleware
    ? [authenticate, options.collectionMiddleware]
    : [authenticate, requireRole('reader')];
  const writeHandlers = options?.collectionMiddleware
    ? [authenticate, options.collectionMiddleware]
    : [authenticate, requireRole('contributor')];

  // CREATE
  app.post(`${prefix}/plans`, { preHandler: writeHandlers }, async (request, reply) => {
    const parsed = CreatePlanSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    }
    const plan = await planService.create({
      title: parsed.data.title,
      owner: request.user.login,
      collection_slug: request.collection?.slug ?? null,
      spec_prompt: parsed.data.spec_prompt,
      filters: parsed.data.filters,
    });
    return reply.status(201).send({ data: plan, meta: null, error: null });
  });

  // LIST
  app.get(`${prefix}/plans`, { preHandler: readHandlers }, async (request) => {
    const plans = await planService.list({
      owner: request.user.login,
      collection_slug: request.collection?.slug,
    });
    return { data: plans, meta: { count: plans.length }, error: null };
  });

  // GET
  app.get(`${prefix}/plans/:id`, { preHandler: readHandlers }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const plan = await planService.get(id);
    if (!plan) return reply.status(404).send({ data: null, meta: null, error: 'Plan not found' });
    if (plan.owner !== request.user.login && request.user.role !== 'admin') {
      return reply.status(403).send({ data: null, meta: null, error: 'Forbidden' });
    }
    return { data: plan, meta: null, error: null };
  });

  // PATCH
  app.patch(`${prefix}/plans/:id`, { preHandler: writeHandlers }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpdatePlanSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    }
    const existing = await planService.get(id);
    if (!existing) return reply.status(404).send({ data: null, meta: null, error: 'Plan not found' });
    if (existing.owner !== request.user.login && request.user.role !== 'admin') {
      return reply.status(403).send({ data: null, meta: null, error: 'Forbidden' });
    }
    const updated = await planService.update(id, parsed.data);
    return { data: updated, meta: null, error: null };
  });

  // DELETE
  app.delete(`${prefix}/plans/:id`, { preHandler: writeHandlers }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await planService.get(id);
    if (!existing) return reply.status(404).send({ data: null, meta: null, error: 'Plan not found' });
    if (existing.owner !== request.user.login && request.user.role !== 'admin') {
      return reply.status(403).send({ data: null, meta: null, error: 'Forbidden' });
    }
    await planService.remove(id);
    return reply.status(204).send();
  });

  // ACTIONS
  app.post(`${prefix}/plans/:id/generate-plan`, { preHandler: writeHandlers }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = GeneratePlanSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    }
    const out = await planService.generatePlan(id, parsed.data);
    if (!out) return reply.status(404).send({ data: null, meta: null, error: 'Plan not found' });
    return { data: out, meta: null, error: null };
  });

  app.post(`${prefix}/plans/:id/validate-plan`, { preHandler: writeHandlers }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const out = await planService.validatePlan(id);
    if (!out) return reply.status(404).send({ data: null, meta: null, error: 'Plan not found' });
    return { data: out, meta: null, error: null };
  });

  app.post(
    `${prefix}/plans/:id/sections/:sectionId/search`,
    { preHandler: writeHandlers },
    async (request, reply) => {
      const { id, sectionId } = request.params as { id: string; sectionId: string };
      const parsed = SectionSearchSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
      }
      const out = await planService.searchSection(id, sectionId, parsed.data);
      if (!out) return reply.status(404).send({ data: null, meta: null, error: 'Plan or section not found' });
      return { data: out, meta: null, error: null };
    },
  );

  app.post(`${prefix}/plans/:id/validate-fragments`, { preHandler: writeHandlers }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const out = await planService.validateFragments(id);
    if (!out) return reply.status(404).send({ data: null, meta: null, error: 'Plan not found' });
    return { data: out, meta: null, error: null };
  });

  app.post(
    `${prefix}/plans/:id/sections/:sectionId/generate`,
    { preHandler: writeHandlers },
    async (request, reply) => {
      const { id, sectionId } = request.params as { id: string; sectionId: string };
      const out = await planService.generateSection(id, sectionId);
      if (!out) return reply.status(404).send({ data: null, meta: null, error: 'Plan or section not found' });
      return { data: out, meta: null, error: null };
    },
  );

  app.post(`${prefix}/plans/:id/assemble`, { preHandler: writeHandlers }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const out = await planService.assemble(id);
    if (!out) return reply.status(404).send({ data: null, meta: null, error: 'Plan not found' });
    return { data: out, meta: null, error: null };
  });

  // EXPORT
  app.post(`${prefix}/plans/:id/export`, { preHandler: writeHandlers }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ExportPlanSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    }

    const plan = await planService.get(id);
    if (!plan) return reply.status(404).send({ data: null, meta: null, error: 'Plan not found' });
    if (plan.owner !== request.user.login && request.user.role !== 'admin') {
      return reply.status(403).send({ data: null, meta: null, error: 'Forbidden' });
    }

    if (parsed.data.format === 'md') {
      const { content, filename } = await planService.exportMarkdown(id);
      return reply
        .type('text/markdown; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(content);
    }

    // docx — resolve style template path
    const styleId = parsed.data.style_template_id ?? plan.state.export_style_template_id;
    let stylePath: string | undefined;
    if (styleId) {
      const tpl = await templateService.getById(styleId);
      if (!tpl) {
        return reply.status(400).send({ data: null, meta: null, error: 'Style template not found' });
      }
      if ((tpl as any).kind !== 'style_reference') {
        return reply.status(400).send({ data: null, meta: null, error: 'Template is not a style reference' });
      }
      stylePath = join(storePath, (tpl as any).template_path);
    }
    const { content, filename } = await planService.exportDocx(id, { styleTemplatePath: stylePath });
    return reply
      .type('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(content);
  });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @fragmint/server typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/routes/plan-routes.ts
git commit -m "feat(server): add /v1/plans Fastify routes"
```

---

## Task 14: Wire `PlanService` and `planRoutes` into the server bootstrap

**Goal:** Instantiate the new service with its dependencies and register routes alongside the others.

**Files:**
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/services/index.ts`
- Modify: `packages/server/src/config.ts`

- [ ] **Step 1: Re-export PlanService**

In `packages/server/src/services/index.ts`, add:

```ts
export { PlanService } from './plan-service.js';
```

- [ ] **Step 2: Add config keys**

In `packages/server/src/config.ts`, find the `loadConfig()` function (or equivalent default-builder). Add two new fields with sensible defaults:

```ts
plan_fragment_max_chars: parseInt(process.env.FRAGMINT_PLAN_FRAGMENT_MAX_CHARS ?? '4000', 10),
plan_docx_reference_path: process.env.FRAGMINT_PLAN_DOCX_REFERENCE,
```

Also add them to the exported `FragmintConfig` type:

```ts
plan_fragment_max_chars: number;
plan_docx_reference_path?: string;
```

- [ ] **Step 3: Instantiate the service and register the routes**

In `packages/server/src/index.ts`:

1. Add imports (near the other route/service imports):

```ts
import { PlanService } from './services/plan-service.js';
import { planRoutes } from './routes/plan-routes.js';
```

2. Inside the bootstrap function, after `harvesterService` is constructed (~line 205-212), add:

```ts
const planService = new PlanService(db, {
  fragmentMaxChars: config.plan_fragment_max_chars,
  docxReferencePath: config.plan_docx_reference_path,
  llm: llmClient,
  search: searchService,
  fragments: fragmentService,
});
```

3. Register routes alongside the others (~line 220-235). Plans are global (not per-collection) — collection scoping happens inside the handlers via `request.collection?.slug`:

```ts
planRoutes(app, planService, templateService, storePath, authenticate);
```

- [ ] **Step 4: Verify typecheck and full unit-test suite**

Run: `pnpm --filter @fragmint/server typecheck`
Expected: PASS.

Run: `pnpm --filter @fragmint/server test`
Expected: PASS — all existing tests + new tests still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/index.ts packages/server/src/services/index.ts packages/server/src/config.ts
git commit -m "feat(server): wire PlanService and planRoutes into server bootstrap"
```

---

## Task 15: Plan routes integration test

**Goal:** End-to-end test of the route surface through `app.inject()`.

**Files:**
- Create: `packages/server/src/routes/plans.integration.test.ts`

- [ ] **Step 1: Write the integration test**

Create `packages/server/src/routes/plans.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createTestServer, getAuthToken } from '../test-helpers.js';

describe('Plan routes', () => {
  let server: any;
  let token: string;

  beforeAll(async () => {
    server = await createTestServer();
    token = await getAuthToken(server.app);

    // Stub the LLM and search so we don't hit external services during tests.
    const planService = (server.app as any).planService ?? null;
    if (planService) {
      planService.config.llm = {
        chatMessages: vi.fn(async () => '## A\n\nDesc A\n\n## B\n\nDesc B'),
      };
      planService.config.search = {
        search: vi.fn(async () => [
          { id: 'f1', score: 0.9, title: 'F1', body_excerpt: 'b1', quality: 'reviewed' },
        ]),
      };
    }
  });

  async function api(method: string, url: string, body?: any) {
    return server.app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: body ? JSON.stringify(body) : undefined,
    });
  }

  it('runs the full happy path: create → patch → generate → validate → search → validate-fragments → assemble → export md', async () => {
    const created = await api('POST', '/v1/plans', { title: 'IT plan', spec_prompt: 'hello' });
    expect(created.statusCode).toBe(201);
    const id = JSON.parse(created.body).data.id;

    const generated = await api('POST', `/v1/plans/${id}/generate-plan`, {});
    expect(generated.statusCode).toBe(200);
    expect(JSON.parse(generated.body).data.state.plan_markdown).toContain('## A');

    const validated = await api('POST', `/v1/plans/${id}/validate-plan`);
    const sections = JSON.parse(validated.body).data.state.sections;
    expect(sections).toHaveLength(2);

    const sid = sections[0].id;
    const reSearched = await api('POST', `/v1/plans/${id}/sections/${sid}/search`, {});
    expect(reSearched.statusCode).toBe(200);

    // Approve a fragment locally
    await api('PATCH', `/v1/plans/${id}`, {
      sections: sections.map((s: any, i: number) =>
        i === 0
          ? {
              ...s,
              selected: [
                { fragment_id: 'f1', body: 'edited body', edited: true, propose_to_library: false },
              ],
            }
          : s,
      ),
    });
    const fragsValidated = await api('POST', `/v1/plans/${id}/validate-fragments`);
    expect(JSON.parse(fragsValidated.body).data.status).toBe('fragments_validated');

    const sectionGen = await api('POST', `/v1/plans/${id}/sections/${sid}/generate`);
    expect(sectionGen.statusCode).toBe(200);

    const assembled = await api('POST', `/v1/plans/${id}/assemble`);
    expect(JSON.parse(assembled.body).data.state.draft_markdown).toContain('# IT plan');

    const exported = await api('POST', `/v1/plans/${id}/export`, { format: 'md' });
    expect(exported.statusCode).toBe(200);
    expect(exported.body).toContain('# IT plan');
  });

  it('returns 404 on unknown plan id', async () => {
    const res = await api('GET', '/v1/plans/plan_nonexistent');
    expect(res.statusCode).toBe(404);
  });

  it('rejects export with invalid format', async () => {
    const created = await api('POST', '/v1/plans', { title: 'X', spec_prompt: '' });
    const id = JSON.parse(created.body).data.id;
    const res = await api('POST', `/v1/plans/${id}/export`, { format: 'pdf' });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Note about the LLM stub**

The stubbing approach above mutates `planService.config.llm` after the server is constructed. For that to work, the server must expose `planService` on the Fastify instance OR the test must use a different strategy. The simplest fix is to expose `planService` as a Fastify decorator in `index.ts`:

In `packages/server/src/index.ts`, after constructing `planService`, add:

```ts
(app as any).planService = planService;
```

(Pattern mirrors how the existing `fragmentService` is exposed — check the file; if there's a `app.decorate('xxxService', ...)` pattern in use, follow that instead.)

- [ ] **Step 3: Run the integration test**

Run: `pnpm --filter @fragmint/server test -- plans.integration`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/plans.integration.test.ts packages/server/src/index.ts
git commit -m "test(server): add integration test for plan routes happy path"
```

---

# Phase 6 — Frontend foundations

## Task 16: API types

**Goal:** TypeScript types that mirror the server's `Plan` / `PlanState`. These are consumed by the React Query hooks and components.

**Files:**
- Modify: `packages/web/src/api/types.ts`

- [ ] **Step 1: Read existing file**

Read `packages/web/src/api/types.ts` to confirm style (interfaces vs types, naming).

- [ ] **Step 2: Append type definitions**

Append the following to `packages/web/src/api/types.ts`:

```ts
export type PlanStatus = 'draft' | 'plan_validated' | 'fragments_validated' | 'completed';

export interface PlanFilters {
  domain?: string;
  lang?: string;
  type?: string;
  tags?: string[];
}

export interface FragmentCandidate {
  fragment_id: string;
  score: number;
  title: string | null;
  body_excerpt: string | null;
  quality: string;
}

export interface SectionFragmentSelection {
  fragment_id: string;
  body: string;
  edited: boolean;
  propose_to_library: boolean;
  proposed_fragment_id?: string;
}

export interface PlanSection {
  id: string;
  title: string;
  description: string;
  candidates: FragmentCandidate[];
  selected: SectionFragmentSelection[];
  generated_markdown?: string;
  filters_override?: PlanFilters;
}

export interface PlanState {
  spec_prompt: string;
  filters: PlanFilters;
  plan_markdown: string;
  writer_prompt_override?: string;
  sections: PlanSection[];
  draft_markdown?: string;
  draft_dirty?: boolean;
  export_style_template_id?: string;
}

export interface Plan {
  id: string;
  title: string;
  owner: string;
  collection_slug: string | null;
  status: PlanStatus;
  state: PlanState;
  created_at: string;
  updated_at: string;
}

export interface StyleTemplate {
  id: string;
  name: string;
  description: string | null;
  template_path: string;
  kind: 'composer' | 'style_reference';
  output_format: string;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @fragmint/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/api/types.ts
git commit -m "feat(web): add Plan and StyleTemplate TypeScript types"
```

---

## Task 17: React Query hooks (`use-plans`, `use-style-templates`)

**Goal:** Centralize all plan-related fetches/mutations behind hooks.

**Files:**
- Create: `packages/web/src/api/hooks/use-plans.ts`
- Create: `packages/web/src/api/hooks/use-style-templates.ts`

- [ ] **Step 1: Read existing hook example**

Read `packages/web/src/api/hooks/use-fragments.ts` (or any existing hook) to confirm the API client pattern. The `apiFetch` helper or similar should already exist in `packages/web/src/api/client.ts`.

- [ ] **Step 2: Create `use-plans.ts`**

Create `packages/web/src/api/hooks/use-plans.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';
import type {
  Plan,
  PlanFilters,
  PlanSection,
} from '@/api/types';

const KEY = ['plans'] as const;

export function usePlans() {
  return useQuery<Plan[]>({
    queryKey: KEY,
    queryFn: async () => {
      const res = await apiFetch('/v1/plans');
      return res.data as Plan[];
    },
  });
}

export function usePlan(id: string | null) {
  return useQuery<Plan>({
    queryKey: [...KEY, id],
    enabled: !!id,
    queryFn: async () => {
      const res = await apiFetch(`/v1/plans/${id}`);
      return res.data as Plan;
    },
  });
}

export function useCreatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { title?: string; spec_prompt: string; filters?: PlanFilters }) => {
      const res = await apiFetch('/v1/plans', { method: 'POST', body: JSON.stringify(input) });
      return res.data as Plan;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdatePlan(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Plan['state']> & {
      title?: string;
      status?: Plan['status'];
      sections?: PlanSection[];
      export_style_template_id?: string | null;
    }) => {
      const res = await apiFetch(`/v1/plans/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      return res.data as Plan;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...KEY, id] });
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
}

export function useDeletePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/v1/plans/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useGeneratePlan(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { extra_instructions?: string }) => {
      const res = await apiFetch(`/v1/plans/${id}/generate-plan`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return res.data as Plan;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, id] }),
  });
}

export function useValidatePlan(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/v1/plans/${id}/validate-plan`, { method: 'POST' });
      return res.data as Plan;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, id] }),
  });
}

export function useSectionSearch(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { sectionId: string; filters_override?: PlanFilters }) => {
      const res = await apiFetch(`/v1/plans/${id}/sections/${args.sectionId}/search`, {
        method: 'POST',
        body: JSON.stringify({ filters_override: args.filters_override }),
      });
      return res.data as Plan;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, id] }),
  });
}

export function useValidateFragments(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/v1/plans/${id}/validate-fragments`, { method: 'POST' });
      return res.data as Plan;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, id] }),
  });
}

export function useGenerateSection(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sectionId: string) => {
      const res = await apiFetch(`/v1/plans/${id}/sections/${sectionId}/generate`, { method: 'POST' });
      return res.data as Plan;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, id] }),
  });
}

export function useAssemble(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/v1/plans/${id}/assemble`, { method: 'POST' });
      return res.data as Plan;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, id] }),
  });
}

// Export returns a blob directly (markdown text or docx binary). Caller handles download.
export async function exportPlan(
  id: string,
  format: 'md' | 'docx',
  style_template_id?: string,
): Promise<Blob> {
  const token = localStorage.getItem('fragmint_token') ?? '';
  const res = await fetch(`/v1/plans/${id}/export`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ format, style_template_id }),
  });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  return await res.blob();
}
```

(Note: if `apiFetch` already wraps `localStorage.getItem('fragmint_token')` and adds the auth header, mirror that here for `exportPlan`. The pattern above uses the same key the existing client uses — verify with `grep -rn "fragmint_token" packages/web/src`.)

- [ ] **Step 3: Create `use-style-templates.ts`**

Create `packages/web/src/api/hooks/use-style-templates.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';
import type { StyleTemplate } from '@/api/types';

const KEY = ['style-templates'] as const;

export function useStyleTemplates() {
  return useQuery<StyleTemplate[]>({
    queryKey: KEY,
    queryFn: async () => {
      const res = await apiFetch('/v1/templates?kind=style_reference');
      return res.data as StyleTemplate[];
    },
  });
}

export function useUploadStyleTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { file: File; name: string; description?: string }) => {
      const form = new FormData();
      form.append('file', input.file);
      form.append('name', input.name);
      if (input.description) form.append('description', input.description);
      const token = localStorage.getItem('fragmint_token') ?? '';
      const res = await fetch('/v1/templates/style-reference', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const json = await res.json();
      return json.data as { id: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm --filter @fragmint/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/api/hooks/use-plans.ts packages/web/src/api/hooks/use-style-templates.ts
git commit -m "feat(web): add React Query hooks for plans and style templates"
```

---

## Task 18: i18n + sidebar nav + route registration

**Goal:** Make the new page reachable. No real UI yet — placeholder component.

**Files:**
- Modify: `packages/web/src/lib/i18n.tsx`
- Modify: `packages/web/src/layouts/app-layout.tsx`
- Modify: `packages/web/src/App.tsx`
- Create: `packages/web/src/pages/plan-generation.tsx` (placeholder)

- [ ] **Step 1: Add i18n keys**

Read `packages/web/src/lib/i18n.tsx` and locate the `fr` and `en` translation objects. Add a `nav.planGeneration` key and a new top-level `planGeneration` section. Append (inside the appropriate object literals — adapt to existing nesting):

```ts
// FR
nav: {
  ...,
  planGeneration: 'Génération de plan',
},
planGeneration: {
  title: 'Génération de plan',
  newPlan: 'Nouveau plan',
  specPrompt: 'Spécification',
  filters: 'Filtres',
  generatePlan: 'Générer le plan',
  regeneratePlan: 'Régénérer',
  refinementInstructions: 'Instructions complémentaires',
  validatePlan: 'Valider le plan',
  validateAllSections: 'Valider toutes les sections',
  generateAllSections: 'Générer tous les drafts',
  assemble: 'Assembler le document',
  downloadMd: 'Télécharger .md',
  downloadDocx: 'Télécharger .docx',
  styleTemplate: 'Modèle de style',
  defaultStyling: '(style par défaut)',
  uploadStyleTemplate: 'Importer un nouveau modèle',
  approve: 'Approuver',
  reject: 'Rejeter',
  edit: 'Éditer',
  useLocally: 'Utiliser localement',
  proposeToLibrary: 'Proposer à la bibliothèque',
  reSearch: 'Re-rechercher',
  regenerate: 'Régénérer',
  writerOverride: 'Instructions au rédacteur',
},

// EN — same keys, English values
nav: {
  ...,
  planGeneration: 'Plan generation',
},
planGeneration: {
  title: 'Plan generation',
  newPlan: 'New plan',
  specPrompt: 'Specification',
  filters: 'Filters',
  generatePlan: 'Generate plan',
  regeneratePlan: 'Regenerate',
  refinementInstructions: 'Refinement instructions',
  validatePlan: 'Validate plan',
  validateAllSections: 'Validate all sections',
  generateAllSections: 'Generate all section drafts',
  assemble: 'Assemble document',
  downloadMd: 'Download .md',
  downloadDocx: 'Download .docx',
  styleTemplate: 'Style template',
  defaultStyling: '(default styling)',
  uploadStyleTemplate: 'Upload new template',
  approve: 'Approve',
  reject: 'Reject',
  edit: 'Edit',
  useLocally: 'Use locally',
  proposeToLibrary: 'Propose to library',
  reSearch: 'Re-search',
  regenerate: 'Regenerate',
  writerOverride: 'Writer instructions',
},
```

- [ ] **Step 2: Add the sidebar entry**

In `packages/web/src/layouts/app-layout.tsx`:

1. Add an icon import (line 23-31):
   ```ts
   import { ..., PenLine } from 'lucide-react';
   ```
2. Add a nav item entry inside `navItems` (right before `validation`):
   ```ts
   { to: '/plan-generation', label: t('nav', 'planGeneration'), icon: PenLine },
   ```

- [ ] **Step 3: Create the placeholder page**

Create `packages/web/src/pages/plan-generation.tsx`:

```tsx
import { useI18n } from '@/lib/i18n';

export default function PlanGenerationPage() {
  const { t } = useI18n();
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">{t('planGeneration', 'title')}</h1>
      <p className="text-muted-foreground mt-2">Coming next.</p>
    </div>
  );
}
```

- [ ] **Step 4: Register the route**

In `packages/web/src/App.tsx`:

1. Add import:
   ```ts
   import PlanGenerationPage from '@/pages/plan-generation';
   ```
2. Add a `<Route>` inside the protected routes block:
   ```tsx
   <Route path="/plan-generation" element={<PlanGenerationPage />} />
   ```

- [ ] **Step 5: Verify typecheck and start dev**

Run: `pnpm --filter @fragmint/web typecheck`
Expected: PASS.

Optional: `pnpm --filter @fragmint/web dev` and visit `http://localhost:5173/ui/plan-generation` to see the placeholder. Sidebar should show the entry.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/lib/i18n.tsx packages/web/src/layouts/app-layout.tsx packages/web/src/App.tsx packages/web/src/pages/plan-generation.tsx
git commit -m "feat(web): add Plan Generation route, nav entry, and i18n keys"
```

---

# Phase 7 — UI

## Task 19: Plan list view + create dialog

**Goal:** Replace the placeholder with a list view that shows existing plans and lets the user create a new one. Workspace view is still a stub.

**Files:**
- Create: `packages/web/src/components/plan/plan-list.tsx`
- Create: `packages/web/src/components/plan/create-plan-dialog.tsx`
- Modify: `packages/web/src/pages/plan-generation.tsx`

- [ ] **Step 1: Create the list component**

Create `packages/web/src/components/plan/plan-list.tsx`:

```tsx
import { useNavigate } from 'react-router-dom';
import { usePlans, useDeletePlan } from '@/api/hooks/use-plans';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/lib/i18n';
import { Trash2 } from 'lucide-react';

export function PlanList({ onCreate }: { onCreate: () => void }) {
  const { data: plans, isLoading } = usePlans();
  const remove = useDeletePlan();
  const nav = useNavigate();
  const { t } = useI18n();

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('planGeneration', 'title')}</h1>
        <Button onClick={onCreate}>+ {t('planGeneration', 'newPlan')}</Button>
      </div>
      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (plans ?? []).length === 0 ? (
        <p className="text-muted-foreground">No plans yet.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(plans ?? []).map((p) => (
            <Card key={p.id} className="cursor-pointer hover:shadow-md">
              <CardHeader>
                <CardTitle className="truncate">{p.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Badge variant="secondary">{p.status}</Badge>
                <p className="text-xs text-muted-foreground">
                  Updated {new Date(p.updated_at).toLocaleString()}
                </p>
                <div className="flex gap-2 pt-2">
                  <Button size="sm" onClick={() => nav(`/plan-generation?id=${p.id}`)}>
                    Open
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove.mutate(p.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create the create dialog**

Create `packages/web/src/components/plan/create-plan-dialog.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreatePlan } from '@/api/hooks/use-plans';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';

export function CreatePlanDialog({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [title, setTitle] = useState('');
  const [specPrompt, setSpecPrompt] = useState('');
  const create = useCreatePlan();
  const nav = useNavigate();
  const { t } = useI18n();

  async function handleSubmit() {
    const plan = await create.mutateAsync({ title: title || undefined, spec_prompt: specPrompt });
    onOpenChange(false);
    setTitle('');
    setSpecPrompt('');
    nav(`/plan-generation?id=${plan.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('planGeneration', 'newPlan')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Textarea
            placeholder={t('planGeneration', 'specPrompt')}
            rows={8}
            value={specPrompt}
            onChange={(e) => setSpecPrompt(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={create.isPending}>
            {t('planGeneration', 'newPlan')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

If the project does not yet have a `dialog` and `textarea` shadcn primitive, add them: `pnpm --filter @fragmint/web exec shadcn add dialog textarea` (or follow the project's existing component-registration approach — check `packages/web/components.json` and `packages/web/src/components/ui/`).

- [ ] **Step 3: Wire into the page**

Replace `packages/web/src/pages/plan-generation.tsx`:

```tsx
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PlanList } from '@/components/plan/plan-list';
import { CreatePlanDialog } from '@/components/plan/create-plan-dialog';

export default function PlanGenerationPage() {
  const [params] = useSearchParams();
  const id = params.get('id');
  const [createOpen, setCreateOpen] = useState(false);

  if (!id) {
    return (
      <>
        <PlanList onCreate={() => setCreateOpen(true)} />
        <CreatePlanDialog open={createOpen} onOpenChange={setCreateOpen} />
      </>
    );
  }

  return (
    <div className="p-6">
      <p className="text-muted-foreground">Workspace stub for plan {id} — implemented in next tasks.</p>
    </div>
  );
}
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm --filter @fragmint/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/plan/plan-list.tsx packages/web/src/components/plan/create-plan-dialog.tsx packages/web/src/pages/plan-generation.tsx
git commit -m "feat(web): add plan list view and create dialog"
```

---

## Task 20: Workspace shell with stepper

**Goal:** Frame around the four steps. Step components themselves are still stubs that the next tasks fill in.

**Files:**
- Modify: `packages/web/src/pages/plan-generation.tsx`
- Create: `packages/web/src/components/plan/workspace.tsx`

- [ ] **Step 1: Create the workspace shell**

Create `packages/web/src/components/plan/workspace.tsx`:

```tsx
import { useState } from 'react';
import { usePlan } from '@/api/hooks/use-plans';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { SpecStep } from './spec-step';
import { FragmentsStep } from './fragments-step';
import { DraftsStep } from './drafts-step';
import { ExportStep } from './export-step';

const STEPS = ['Spec & Plan', 'Section fragments', 'Section drafts', 'Assemble & Export'];

function defaultStepFromStatus(status: string | undefined): number {
  switch (status) {
    case 'plan_validated': return 1;
    case 'fragments_validated': return 2;
    case 'completed': return 3;
    default: return 0;
  }
}

export function Workspace({ planId }: { planId: string }) {
  const { data: plan, isLoading } = usePlan(planId);
  const [step, setStep] = useState<number | null>(null);
  const { t } = useI18n();

  if (isLoading || !plan) return <p className="p-6 text-muted-foreground">Loading…</p>;

  const activeStep = step ?? defaultStepFromStatus(plan.status);

  return (
    <div className="flex flex-col h-full">
      <header className="border-b p-4 flex items-center gap-4">
        <h2 className="text-xl font-semibold flex-shrink-0">{plan.title}</h2>
        <nav className="flex items-center gap-2 overflow-x-auto">
          {STEPS.map((label, i) => (
            <Button
              key={i}
              size="sm"
              variant={i === activeStep ? 'default' : 'ghost'}
              onClick={() => setStep(i)}
              className={cn('text-xs whitespace-nowrap')}
            >
              {i + 1}. {label}
            </Button>
          ))}
        </nav>
      </header>
      <div className="flex-1 overflow-y-auto">
        {activeStep === 0 && <SpecStep plan={plan} />}
        {activeStep === 1 && <FragmentsStep plan={plan} />}
        {activeStep === 2 && <DraftsStep plan={plan} />}
        {activeStep === 3 && <ExportStep plan={plan} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add step stubs**

Create stub files (so the workspace compiles before Tasks 21-24 fill them in):

Create `packages/web/src/components/plan/spec-step.tsx`:

```tsx
import type { Plan } from '@/api/types';

export function SpecStep({ plan: _plan }: { plan: Plan }) {
  return <div className="p-6">Spec & Plan step (Task 21).</div>;
}
```

Create `packages/web/src/components/plan/fragments-step.tsx`:

```tsx
import type { Plan } from '@/api/types';

export function FragmentsStep({ plan: _plan }: { plan: Plan }) {
  return <div className="p-6">Section fragments step (Task 22).</div>;
}
```

Create `packages/web/src/components/plan/drafts-step.tsx`:

```tsx
import type { Plan } from '@/api/types';

export function DraftsStep({ plan: _plan }: { plan: Plan }) {
  return <div className="p-6">Section drafts step (Task 23).</div>;
}
```

Create `packages/web/src/components/plan/export-step.tsx`:

```tsx
import type { Plan } from '@/api/types';

export function ExportStep({ plan: _plan }: { plan: Plan }) {
  return <div className="p-6">Assemble & Export step (Task 24).</div>;
}
```

- [ ] **Step 3: Wire workspace into the page**

In `packages/web/src/pages/plan-generation.tsx`, replace the workspace stub block with:

```tsx
import { Workspace } from '@/components/plan/workspace';
// …
if (id) return <Workspace planId={id} />;
```

(Keep the list+dialog branch as-is.)

- [ ] **Step 4: Verify typecheck**

Run: `pnpm --filter @fragmint/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/plan packages/web/src/pages/plan-generation.tsx
git commit -m "feat(web): add plan workspace shell with stepper and stub steps"
```

---

## Task 21: Step 1 — Spec & Plan

**Goal:** Two-column layout. Left: spec prompt + filters + refinement instructions + Generate button. Right: editable markdown plan with preview + Validate button. Both buttons always enabled.

**Files:**
- Modify: `packages/web/src/components/plan/spec-step.tsx`

**Dependency:** Install `react-markdown` if not already present.

- [ ] **Step 1: Check / install `react-markdown`**

Run: `pnpm --filter @fragmint/web ls react-markdown` — if missing, run `pnpm --filter @fragmint/web add react-markdown`.

- [ ] **Step 2: Replace the stub with the full step**

Replace `packages/web/src/components/plan/spec-step.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import type { Plan } from '@/api/types';
import { useGeneratePlan, useUpdatePlan, useValidatePlan } from '@/api/hooks/use-plans';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useI18n } from '@/lib/i18n';
import { toast } from 'sonner';

export function SpecStep({ plan }: { plan: Plan }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const update = useUpdatePlan(plan.id);
  const generate = useGeneratePlan(plan.id);
  const validate = useValidatePlan(plan.id);

  const [specPrompt, setSpecPrompt] = useState(plan.state.spec_prompt);
  const [domain, setDomain] = useState(plan.state.filters.domain ?? '');
  const [lang, setLang] = useState(plan.state.filters.lang ?? '');
  const [type, setType] = useState(plan.state.filters.type ?? '');
  const [tagsStr, setTagsStr] = useState((plan.state.filters.tags ?? []).join(', '));
  const [refinement, setRefinement] = useState('');
  const [planMarkdown, setPlanMarkdown] = useState(plan.state.plan_markdown);

  // Debounced auto-save on edits
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      update.mutate({
        spec_prompt: specPrompt,
        filters: {
          domain: domain || undefined,
          lang: lang || undefined,
          type: type || undefined,
          tags: tagsStr.split(',').map((s) => s.trim()).filter(Boolean),
        },
        plan_markdown: planMarkdown,
      });
    }, 1000);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specPrompt, domain, lang, type, tagsStr, planMarkdown]);

  async function handleGenerate() {
    try {
      const out = await generate.mutateAsync({ extra_instructions: refinement || undefined });
      setPlanMarkdown(out.state.plan_markdown);
    } catch (e: any) {
      toast.error(`Generation failed: ${e.message ?? e}`);
    }
  }

  async function handleValidate() {
    try {
      await validate.mutateAsync();
      nav(`/plan-generation?id=${plan.id}`, { replace: true });
      // Workspace will switch to step 2 once status is plan_validated
    } catch (e: any) {
      toast.error(`Validation failed: ${e.message ?? e}`);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-6">
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle>{t('planGeneration', 'specPrompt')}</CardTitle></CardHeader>
          <CardContent>
            <Textarea rows={12} value={specPrompt} onChange={(e) => setSpecPrompt(e.target.value)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('planGeneration', 'filters')}</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            <Input placeholder="domain" value={domain} onChange={(e) => setDomain(e.target.value)} />
            <Input placeholder="lang (e.g. fr)" value={lang} onChange={(e) => setLang(e.target.value)} />
            <Input placeholder="type" value={type} onChange={(e) => setType(e.target.value)} />
            <Input placeholder="tags (comma-separated)" value={tagsStr} onChange={(e) => setTagsStr(e.target.value)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('planGeneration', 'refinementInstructions')}</CardTitle></CardHeader>
          <CardContent>
            <Textarea
              rows={4}
              placeholder="(optional) e.g. add a section about pricing"
              value={refinement}
              onChange={(e) => setRefinement(e.target.value)}
            />
            <Button className="mt-3" onClick={handleGenerate} disabled={generate.isPending}>
              {plan.state.plan_markdown ? t('planGeneration', 'regeneratePlan') : t('planGeneration', 'generatePlan')}
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle>Plan (markdown)</CardTitle></CardHeader>
          <CardContent>
            <Textarea
              rows={20}
              className="font-mono text-sm"
              value={planMarkdown}
              onChange={(e) => setPlanMarkdown(e.target.value)}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Preview</CardTitle></CardHeader>
          <CardContent className="prose dark:prose-invert max-w-none">
            <ReactMarkdown>{planMarkdown}</ReactMarkdown>
          </CardContent>
        </Card>
        <div className="flex justify-end">
          <Button onClick={handleValidate} disabled={validate.isPending}>
            {t('planGeneration', 'validatePlan')}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify typecheck and dev**

Run: `pnpm --filter @fragmint/web typecheck`
Expected: PASS.

Optional: start dev (`pnpm --filter @fragmint/web dev`) and verify the form renders, debounced save works, and clicking Generate hits the API.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/plan/spec-step.tsx packages/web/package.json packages/web/pnpm-lock.yaml
git commit -m "feat(web): implement Step 1 (Spec & Plan) of plan generation"
```

---

## Task 22: Step 2 — Section fragments

**Goal:** Left rail of sections; right pane has 3-5 candidate cards per section with Approve / Reject / Edit + propose-to-library toggle. Sticky "Validate all sections" bar.

**Files:**
- Create: `packages/web/src/components/plan/section-fragment-card.tsx`
- Modify: `packages/web/src/components/plan/fragments-step.tsx`

- [ ] **Step 1: Create the per-card component**

Create `packages/web/src/components/plan/section-fragment-card.tsx`:

```tsx
import { useState } from 'react';
import type { FragmentCandidate, SectionFragmentSelection } from '@/api/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Check, X, Pencil } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export function SectionFragmentCard({
  candidate,
  selection,
  onChange,
}: {
  candidate: FragmentCandidate;
  selection: SectionFragmentSelection | undefined;
  onChange: (sel: SectionFragmentSelection | null) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(selection?.body ?? candidate.body_excerpt ?? '');
  const [propose, setPropose] = useState(selection?.propose_to_library ?? false);
  const approved = !!selection;

  function approve() {
    onChange({
      fragment_id: candidate.fragment_id,
      body: candidate.body_excerpt ?? '',
      edited: false,
      propose_to_library: false,
    });
  }

  function reject() { onChange(null); }

  function commitEdit() {
    onChange({
      fragment_id: candidate.fragment_id,
      body,
      edited: true,
      propose_to_library: propose,
    });
    setEditing(false);
  }

  return (
    <Card className={approved ? 'border-primary' : ''}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm truncate">{candidate.title ?? candidate.fragment_id}</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{candidate.quality}</Badge>
            <span className="text-xs text-muted-foreground">score {candidate.score.toFixed(2)}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {editing ? (
          <>
            <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={propose}
                onChange={(e) => setPropose(e.target.checked)}
              />
              {t('planGeneration', 'proposeToLibrary')}
            </label>
            <div className="flex gap-2">
              <Button size="sm" onClick={commitEdit}>{t('planGeneration', 'approve')}</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm whitespace-pre-wrap line-clamp-3">
              {selection?.body ?? candidate.body_excerpt}
            </p>
            <div className="flex gap-2">
              {approved ? (
                <Button size="sm" variant="ghost" onClick={reject}><X className="h-4 w-4" /></Button>
              ) : (
                <Button size="sm" onClick={approve}><Check className="h-4 w-4 mr-1" />{t('planGeneration', 'approve')}</Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4 mr-1" />{t('planGeneration', 'edit')}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Replace the stub with the full step**

Replace `packages/web/src/components/plan/fragments-step.tsx`:

```tsx
import { useState } from 'react';
import type { Plan, PlanSection, SectionFragmentSelection } from '@/api/types';
import { useSectionSearch, useUpdatePlan, useValidateFragments } from '@/api/hooks/use-plans';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { SectionFragmentCard } from './section-fragment-card';
import { toast } from 'sonner';

export function FragmentsStep({ plan }: { plan: Plan }) {
  const { t } = useI18n();
  const [activeIdx, setActiveIdx] = useState(0);
  const update = useUpdatePlan(plan.id);
  const search = useSectionSearch(plan.id);
  const validate = useValidateFragments(plan.id);

  const sections = plan.state.sections;
  const active = sections[activeIdx];

  function updateSection(sectionId: string, fn: (s: PlanSection) => PlanSection) {
    const next = sections.map((s) => (s.id === sectionId ? fn(s) : s));
    update.mutate({ sections: next });
  }

  function applySelectionChange(
    section: PlanSection,
    candidateId: string,
    sel: SectionFragmentSelection | null,
  ) {
    const next: PlanSection = {
      ...section,
      selected: sel
        ? [...section.selected.filter((s) => s.fragment_id !== candidateId), sel]
        : section.selected.filter((s) => s.fragment_id !== candidateId),
    };
    updateSection(section.id, () => next);
  }

  return (
    <div className="flex h-full">
      <aside className="w-64 border-r overflow-y-auto p-3 space-y-1">
        {sections.map((s, i) => {
          const reviewed = s.selected.length > 0;
          return (
            <button
              key={s.id}
              onClick={() => setActiveIdx(i)}
              className={cn(
                'w-full text-left px-2 py-1.5 rounded text-sm flex items-center justify-between',
                i === activeIdx ? 'bg-primary/15' : 'hover:bg-muted',
              )}
            >
              <span className="truncate">{i + 1}. {s.title}</span>
              {reviewed && <span className="text-primary text-xs">✓</span>}
            </button>
          );
        })}
      </aside>

      <main className="flex-1 flex flex-col">
        <div className="flex-1 overflow-y-auto p-6">
          {!active ? (
            <p className="text-muted-foreground">No sections.</p>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>{active.title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{active.description}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => search.mutate({ sectionId: active.id })}
                    disabled={search.isPending}
                  >
                    {t('planGeneration', 'reSearch')}
                  </Button>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-4">
                {active.candidates.map((c) => (
                  <SectionFragmentCard
                    key={c.fragment_id}
                    candidate={c}
                    selection={active.selected.find((s) => s.fragment_id === c.fragment_id)}
                    onChange={(sel) => applySelectionChange(active, c.fragment_id, sel)}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        <div className="border-t p-3 flex justify-end">
          <Button
            onClick={async () => {
              try {
                await validate.mutateAsync();
              } catch (e: any) {
                toast.error(`Validation failed: ${e.message ?? e}`);
              }
            }}
            disabled={validate.isPending}
          >
            {t('planGeneration', 'validateAllSections')}
          </Button>
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @fragmint/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/plan/section-fragment-card.tsx packages/web/src/components/plan/fragments-step.tsx
git commit -m "feat(web): implement Step 2 (section fragment review)"
```

---

## Task 23: Step 3 — Section drafts (with sequential generate-all)

**Goal:** Per-section "Generate" + "Regenerate" buttons and editable markdown. A top-level "Generate all section drafts" button that loops sequentially with a progress indicator.

**Files:**
- Modify: `packages/web/src/components/plan/drafts-step.tsx`

- [ ] **Step 1: Replace the stub with the full step**

Replace `packages/web/src/components/plan/drafts-step.tsx`:

```tsx
import { useState } from 'react';
import type { Plan, PlanSection } from '@/api/types';
import { useGenerateSection, useUpdatePlan, useAssemble } from '@/api/hooks/use-plans';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useI18n } from '@/lib/i18n';
import { toast } from 'sonner';

export function DraftsStep({ plan }: { plan: Plan }) {
  const { t } = useI18n();
  const [activeIdx, setActiveIdx] = useState(0);
  const [override, setOverride] = useState(plan.state.writer_prompt_override ?? '');
  const [progress, setProgress] = useState<{ i: number; total: number } | null>(null);
  const update = useUpdatePlan(plan.id);
  const generate = useGenerateSection(plan.id);
  const assemble = useAssemble(plan.id);

  const sections = plan.state.sections;
  const active = sections[activeIdx];

  async function generateOne(sectionId: string) {
    try {
      await generate.mutateAsync(sectionId);
    } catch (e: any) {
      toast.error(`Section generation failed: ${e.message ?? e}`);
    }
  }

  async function generateAll() {
    setProgress({ i: 0, total: sections.length });
    for (let i = 0; i < sections.length; i++) {
      setProgress({ i, total: sections.length });
      try {
        await generate.mutateAsync(sections[i].id);
      } catch (e: any) {
        toast.error(`Failed on section "${sections[i].title}": ${e.message ?? e}`);
        break;
      }
    }
    setProgress(null);
  }

  function saveSectionMarkdown(s: PlanSection, md: string) {
    update.mutate({
      sections: sections.map((x) => (x.id === s.id ? { ...x, generated_markdown: md } : x)),
    });
  }

  return (
    <div className="flex h-full">
      <aside className="w-64 border-r overflow-y-auto p-3 space-y-1">
        {sections.map((s, i) => (
          <button
            key={s.id}
            onClick={() => setActiveIdx(i)}
            className={
              'w-full text-left px-2 py-1.5 rounded text-sm flex items-center justify-between ' +
              (i === activeIdx ? 'bg-primary/15' : 'hover:bg-muted')
            }
          >
            <span className="truncate">{i + 1}. {s.title}</span>
            {s.generated_markdown && <span className="text-primary text-xs">✓</span>}
          </button>
        ))}
      </aside>

      <main className="flex-1 flex flex-col">
        <div className="border-b p-4 space-y-3">
          <details>
            <summary className="text-sm cursor-pointer">{t('planGeneration', 'writerOverride')}</summary>
            <Textarea
              rows={4}
              className="mt-2"
              value={override}
              onChange={(e) => setOverride(e.target.value)}
              onBlur={() => update.mutate({ writer_prompt_override: override })}
            />
          </details>
          <div className="flex items-center gap-3">
            <Button onClick={generateAll} disabled={progress !== null}>
              {progress
                ? `Generating section ${progress.i + 1} / ${progress.total}…`
                : t('planGeneration', 'generateAllSections')}
            </Button>
            <Button variant="outline" onClick={() => assemble.mutate()}>
              {t('planGeneration', 'assemble')}
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {!active ? (
            <p className="text-muted-foreground">No sections.</p>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>{active.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{active.description}</p>
                {active.selected.length === 0 && (
                  <p className="text-amber-600 text-sm">No fragments approved — output may be weak.</p>
                )}
                <Button size="sm" onClick={() => generateOne(active.id)} disabled={generate.isPending}>
                  {active.generated_markdown
                    ? t('planGeneration', 'regenerate')
                    : t('planGeneration', 'generatePlan')}
                </Button>
                <Textarea
                  rows={18}
                  className="font-mono text-sm"
                  value={active.generated_markdown ?? ''}
                  onChange={(e) => saveSectionMarkdown(active, e.target.value)}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @fragmint/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/plan/drafts-step.tsx
git commit -m "feat(web): implement Step 3 (section drafts with sequential generate-all)"
```

---

## Task 24: Step 4 — Assemble & Export (with style template selector)

**Goal:** Full-width editable markdown, two export buttons, style-template dropdown, upload-new-template dialog.

**Files:**
- Create: `packages/web/src/components/plan/upload-style-template-dialog.tsx`
- Modify: `packages/web/src/components/plan/export-step.tsx`

- [ ] **Step 1: Create the upload dialog**

Create `packages/web/src/components/plan/upload-style-template-dialog.tsx`:

```tsx
import { useState } from 'react';
import { useUploadStyleTemplate } from '@/api/hooks/use-style-templates';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { toast } from 'sonner';

export function UploadStyleTemplateDialog({
  open,
  onOpenChange,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onUploaded: (id: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const upload = useUploadStyleTemplate();
  const { t } = useI18n();

  async function handleUpload() {
    if (!file || !name) {
      toast.error('Pick a file and provide a name');
      return;
    }
    const created = await upload.mutateAsync({ file, name, description: description || undefined });
    onUploaded(created.id);
    onOpenChange(false);
    setFile(null);
    setName('');
    setDescription('');
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('planGeneration', 'uploadStyleTemplate')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            type="file"
            accept=".docx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button onClick={handleUpload} disabled={upload.isPending}>Upload</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Replace the export step stub**

Replace `packages/web/src/components/plan/export-step.tsx`:

```tsx
import { useState } from 'react';
import type { Plan } from '@/api/types';
import { useAssemble, useUpdatePlan, exportPlan } from '@/api/hooks/use-plans';
import { useStyleTemplates } from '@/api/hooks/use-style-templates';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useI18n } from '@/lib/i18n';
import { UploadStyleTemplateDialog } from './upload-style-template-dialog';
import { toast } from 'sonner';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportStep({ plan }: { plan: Plan }) {
  const { t } = useI18n();
  const update = useUpdatePlan(plan.id);
  const assemble = useAssemble(plan.id);
  const styleTemplates = useStyleTemplates();
  const [draft, setDraft] = useState(plan.state.draft_markdown ?? '');
  const [uploadOpen, setUploadOpen] = useState(false);
  const styleId = plan.state.export_style_template_id ?? '';

  async function handleReassemble() {
    if (plan.state.draft_dirty && !confirm('This will overwrite your manual edits. Continue?')) return;
    try {
      const out = await assemble.mutateAsync();
      setDraft(out.state.draft_markdown ?? '');
    } catch (e: any) {
      toast.error(`Assemble failed: ${e.message ?? e}`);
    }
  }

  async function handleExport(format: 'md' | 'docx') {
    try {
      const blob = await exportPlan(plan.id, format, styleId || undefined);
      const ext = format === 'md' ? 'md' : 'docx';
      downloadBlob(blob, `${plan.title || 'plan'}.${ext}`);
    } catch (e: any) {
      toast.error(`Export failed: ${e.message ?? e}`);
    }
  }

  function onDraftChange(v: string) {
    setDraft(v);
    update.mutate({ draft_markdown: v, draft_dirty: true });
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={handleReassemble}>{t('planGeneration', 'assemble')}</Button>
        <Button onClick={() => handleExport('md')}>{t('planGeneration', 'downloadMd')}</Button>

        <Select
          value={styleId}
          onValueChange={(v) => update.mutate({ export_style_template_id: v === '__none__' ? null : v })}
        >
          <SelectTrigger className="w-64"><SelectValue placeholder={t('planGeneration', 'styleTemplate')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{t('planGeneration', 'defaultStyling')}</SelectItem>
            {(styleTemplates.data ?? []).map((tpl) => (
              <SelectItem key={tpl.id} value={tpl.id}>{tpl.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="ghost" size="sm" onClick={() => setUploadOpen(true)}>
          + {t('planGeneration', 'uploadStyleTemplate')}
        </Button>
        <Button onClick={() => handleExport('docx')}>{t('planGeneration', 'downloadDocx')}</Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Final markdown</CardTitle></CardHeader>
        <CardContent>
          <Textarea
            rows={32}
            className="font-mono text-sm"
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
          />
        </CardContent>
      </Card>

      <UploadStyleTemplateDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={(id) => update.mutate({ export_style_template_id: id })}
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @fragmint/web typecheck`
Expected: PASS.

- [ ] **Step 4: Manual smoke test in the browser**

Start dev server: `pnpm --filter @fragmint/web dev` (and `docker compose -f docker/docker-compose.dev.yml up` for the server).

Visit `http://localhost:5173/ui/plan-generation`:

1. Create a new plan; navigate to step 1.
2. Fill a spec prompt, click "Generate plan", verify markdown appears.
3. Click "Validate plan"; verify step 2 lists sections with candidate fragments.
4. Approve some fragments; click "Validate all sections".
5. Click "Generate all section drafts"; verify progress label updates section-by-section.
6. Click "Assemble document"; verify draft markdown is populated in step 4.
7. Click "Download .md"; verify a `.md` file is downloaded.
8. (Optional) Upload a `.docx` as a style template; pick it from the dropdown; click "Download .docx"; verify a `.docx` is downloaded.

- [ ] **Step 5: Lint and full test sweep**

Run: `pnpm lint`
Expected: PASS (fix lint issues if any).

Run: `pnpm test`
Expected: PASS — all tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/plan/upload-style-template-dialog.tsx packages/web/src/components/plan/export-step.tsx
git commit -m "feat(web): implement Step 4 (assemble + export with style template)"
```

---

# Done

After Task 24 the feature is shippable end-to-end:

- Create → spec → generate plan → edit → validate → review fragments → validate → generate drafts → assemble → export `.md` / `.docx` (with optional style template).
- 100% server-side state persistence.
- Unit tests for every pure backend module; integration tests for the route surface and the style-reference template upload path.
- Conventional-commit history with atomic per-task commits.

Refer back to the spec `docs/superpowers/specs/2026-05-12-plan-generation-design.md` for the design rationale of any decisions you encounter while implementing.
