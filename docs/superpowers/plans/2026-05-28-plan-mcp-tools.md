# Plan MCP Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the full Plan API through the MCP server so that Claude/OpenCode can drive the complete document composition workflow (create plan → generate outline → search sections → export docx).

**Architecture:** One new file `packages/mcp/src/tools/plan-tools.ts` with 6 tool pairs (definition + handler). Two new methods on `FragmintApiClient`: `postText()` and `postBinary()` for plan export which returns raw content (not JSON envelope). All 6 tools registered in `packages/mcp/src/index.ts`.

**Tech Stack:** TypeScript, MCP SDK, `FragmintApiClient` pattern (closure over client instance), Vitest tests in `tools.test.ts`.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `packages/mcp/src/client.ts` | Add `postText()` and `postBinary()` (raw content methods) |
| Create | `packages/mcp/src/tools/plan-tools.ts` | 6 plan tools: plan_create, plan_list, plan_get, plan_generate, plan_section_search, plan_export |
| Modify | `packages/mcp/src/index.ts` | Register 6 new tools |
| Modify | `packages/mcp/src/tools/tools.test.ts` | Tests for plan tools |

---

### Task 1: Add `postText` and `postBinary` to `FragmintApiClient`

The plan export endpoint returns raw binary (docx) or raw text (md), NOT the JSON `{ data, meta, error }` envelope. The existing `getText()` method is GET-only. We need POST variants.

**Files:**
- Modify: `packages/mcp/src/client.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/mcp/src/tools/tools.test.ts` at the top-level (before the describe blocks):

```typescript
import { FragmintApiClient } from '../client.js';
```

And add a new describe block at the end of the file:

```typescript
describe('FragmintApiClient.postText / postBinary', () => {
  it('postText returns response body as string', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('# My Plan\n\n## Intro'),
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new FragmintApiClient('http://localhost:3210', 'tok-test');
    const text = await client.postText('/v1/plans/plan-1/export', { format: 'md' });
    expect(text).toBe('# My Plan\n\n## Intro');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3210/v1/plans/plan-1/export',
      expect.objectContaining({ method: 'POST' }),
    );
    vi.unstubAllGlobals();
  });

  it('postBinary returns base64-encoded content', async () => {
    const bytes = Buffer.from('PK\x03\x04fake-docx'); // fake zip magic bytes
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(bytes.buffer),
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new FragmintApiClient('http://localhost:3210', 'tok-test');
    const b64 = await client.postBinary('/v1/plans/plan-1/export', { format: 'docx' });
    expect(b64).toBe(bytes.toString('base64'));
    vi.unstubAllGlobals();
  });

  it('postBinary throws on HTTP error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Plan not found'),
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new FragmintApiClient('http://localhost:3210', 'tok-test');
    await expect(client.postBinary('/v1/plans/bad/export', { format: 'docx' })).rejects.toThrow(
      'HTTP 404',
    );
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test --reporter=verbose 2>&1 | grep -A 5 "postText / postBinary"
```

Expected: FAIL — `postText is not a function` / `postBinary is not a function`

- [ ] **Step 3: Add `postText` and `postBinary` to `client.ts`**

In `packages/mcp/src/client.ts`, add after the `postMultipart` method (before the `private async request` method):

```typescript
  async postText(path: string, body?: unknown): Promise<string> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.text();
  }

  async postBinary(path: string, body?: unknown): Promise<string> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const buffer = await res.arrayBuffer();
    return Buffer.from(buffer).toString('base64');
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test --reporter=verbose 2>&1 | grep -A 5 "postText / postBinary"
```

Expected: PASS — 3 tests pass

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @fragmint/mcp exec tsc --noEmit
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add packages/mcp/src/client.ts packages/mcp/src/tools/tools.test.ts
git commit -m "feat(mcp): add postText + postBinary to client"
```

---

### Task 2: Create `plan-tools.ts` — plan_create, plan_list, plan_get

**Files:**
- Create: `packages/mcp/src/tools/plan-tools.ts`
- Modify: `packages/mcp/src/tools/tools.test.ts`

- [ ] **Step 1: Write the failing tests for plan_create, plan_list, plan_get**

Add to `packages/mcp/src/tools/tools.test.ts`:

```typescript
import {
  planCreateDefinition,
  planCreateHandler,
  planListDefinition,
  planListHandler,
  planGetDefinition,
  planGetHandler,
} from './plan-tools.js';

describe('plan_create', () => {
  it('has correct definition', () => {
    expect(planCreateDefinition.name).toBe('plan_create');
    expect(planCreateDefinition.inputSchema.required).toBeUndefined();
  });

  it('calls POST /v1/plans with body', async () => {
    const client = { post: vi.fn().mockResolvedValue({ id: 'plan-abc', title: 'My Plan', status: 'draft' }) };
    const result = await planCreateHandler(client as any)({
      title: 'My Plan',
      spec_prompt: 'Proposal for client X',
    });
    expect(client.post).toHaveBeenCalledWith('/v1/plans', {
      title: 'My Plan',
      spec_prompt: 'Proposal for client X',
      filters: {},
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe('plan-abc');
  });

  it('returns error on API failure', async () => {
    const client = { post: vi.fn().mockRejectedValue(new Error('Unauthorized')) };
    const result = await planCreateHandler(client as any)({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unauthorized');
  });
});

describe('plan_list', () => {
  it('has correct definition', () => {
    expect(planListDefinition.name).toBe('plan_list');
  });

  it('calls GET /v1/plans', async () => {
    const client = { get: vi.fn().mockResolvedValue([{ id: 'plan-1', title: 'Plan A', status: 'draft' }]) };
    const result = await planListHandler(client as any)({});
    expect(client.get).toHaveBeenCalledWith('/v1/plans');
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
  });
});

describe('plan_get', () => {
  it('has id in required', () => {
    expect(planGetDefinition.inputSchema.required).toContain('id');
  });

  it('calls GET /v1/plans/:id', async () => {
    const client = { get: vi.fn().mockResolvedValue({ id: 'plan-1', title: 'Plan A', state: {} }) };
    const result = await planGetHandler(client as any)({ id: 'plan-1' });
    expect(client.get).toHaveBeenCalledWith('/v1/plans/plan-1');
    expect(result.isError).toBeUndefined();
  });

  it('returns error when id is missing', async () => {
    const client = { get: vi.fn() };
    const result = await planGetHandler(client as any)({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('id is required');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test --reporter=verbose 2>&1 | grep -A 3 "plan_create\|plan_list\|plan_get"
```

Expected: FAIL — cannot find module `./plan-tools.js`

- [ ] **Step 3: Create `packages/mcp/src/tools/plan-tools.ts`**

```typescript
// packages/mcp/src/tools/plan-tools.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';

// ── plan_create ──────────────────────────────────────────────────────────────

export const planCreateDefinition: ToolDefinition = {
  name: 'plan_create',
  description:
    'Create a new document plan. A plan drives the multi-step composition workflow: spec → outline → section retrieval → export. Returns the plan ID needed for all follow-up operations.',
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Human-readable plan title (e.g. "Proposition commerciale — ANFSI")',
      },
      spec_prompt: {
        type: 'string',
        description:
          'Natural-language brief describing the document to compose. Used by plan_generate to create the outline.',
      },
      filters: {
        type: 'object',
        description:
          'Optional fragment filters: { lang?: "fr"|"en", domain?: string|string[], type?: string, tags?: string[] }',
      },
    },
  },
};

export function planCreateHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const { title, spec_prompt, filters } = args;
      const result = await client.post('/v1/plans', {
        title: title as string | undefined,
        spec_prompt: (spec_prompt as string) ?? '',
        filters: (filters as object) ?? {},
      });
      return toolSuccess(result);
    } catch (err) {
      return toolError(`plan_create failed: ${(err as Error).message}`);
    }
  };
}

// ── plan_list ────────────────────────────────────────────────────────────────

export const planListDefinition: ToolDefinition = {
  name: 'plan_list',
  description:
    'List all plans owned by the authenticated user. Returns id, title, status, and created_at for each plan.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

export function planListHandler(client: FragmintApiClient): ToolHandler {
  return async (_args) => {
    try {
      const result = await client.get('/v1/plans');
      return toolSuccess(result);
    } catch (err) {
      return toolError(`plan_list failed: ${(err as Error).message}`);
    }
  };
}

// ── plan_get ─────────────────────────────────────────────────────────────────

export const planGetDefinition: ToolDefinition = {
  name: 'plan_get',
  description:
    'Get a plan by ID, including full state: spec_prompt, sections with their candidates and selections, generated markdown, and export settings.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Plan ID (returned by plan_create or plan_list)',
      },
    },
    required: ['id'],
  },
};

export function planGetHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    const id = args.id as string | undefined;
    if (!id) return toolError('plan_get: id is required');
    try {
      const result = await client.get(`/v1/plans/${id}`);
      return toolSuccess(result);
    } catch (err) {
      return toolError(`plan_get failed: ${(err as Error).message}`);
    }
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test --reporter=verbose 2>&1 | grep -A 3 "plan_create\|plan_list\|plan_get"
```

Expected: PASS — 6 tests pass

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @fragmint/mcp exec tsc --noEmit
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add packages/mcp/src/tools/plan-tools.ts packages/mcp/src/tools/tools.test.ts
git commit -m "feat(mcp): plan_create, plan_list, plan_get tools"
```

---

### Task 3: Add plan_generate, plan_section_search, plan_export to `plan-tools.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/mcp/src/tools/tools.test.ts`:

```typescript
import {
  planGenerateDefinition,
  planGenerateHandler,
  planSectionSearchDefinition,
  planSectionSearchHandler,
  planExportDefinition,
  planExportHandler,
} from './plan-tools.js';

describe('plan_generate', () => {
  it('has id in required', () => {
    expect(planGenerateDefinition.inputSchema.required).toContain('id');
  });

  it('calls POST /v1/plans/:id/generate-plan', async () => {
    const client = { post: vi.fn().mockResolvedValue({ id: 'plan-1', status: 'plan_generated', state: { sections: [] } }) };
    const result = await planGenerateHandler(client as any)({ id: 'plan-1', extra_instructions: 'Focus on pricing' });
    expect(client.post).toHaveBeenCalledWith('/v1/plans/plan-1/generate-plan', {
      extra_instructions: 'Focus on pricing',
    });
    expect(result.isError).toBeUndefined();
  });

  it('returns error when id is missing', async () => {
    const client = { post: vi.fn() };
    const result = await planGenerateHandler(client as any)({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('id is required');
  });
});

describe('plan_section_search', () => {
  it('has id and section_id in required', () => {
    expect(planSectionSearchDefinition.inputSchema.required).toContain('id');
    expect(planSectionSearchDefinition.inputSchema.required).toContain('section_id');
  });

  it('calls POST /v1/plans/:id/sections/:sectionId/search', async () => {
    const client = { post: vi.fn().mockResolvedValue({ id: 'plan-1', state: { sections: [{ id: 'sec-1', candidates: [] }] } }) };
    const result = await planSectionSearchHandler(client as any)({ id: 'plan-1', section_id: 'sec-1' });
    expect(client.post).toHaveBeenCalledWith('/v1/plans/plan-1/sections/sec-1/search', {});
    expect(result.isError).toBeUndefined();
  });
});

describe('plan_export', () => {
  it('has id and format in required', () => {
    expect(planExportDefinition.inputSchema.required).toContain('id');
    expect(planExportDefinition.inputSchema.required).toContain('format');
  });

  it('calls postText for md format', async () => {
    const client = {
      postText: vi.fn().mockResolvedValue('# Plan\n## Intro'),
    };
    const result = await planExportHandler(client as any)({ id: 'plan-1', format: 'md' });
    expect(client.postText).toHaveBeenCalledWith('/v1/plans/plan-1/export', { format: 'md', style_template_id: undefined });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.format).toBe('md');
    expect(parsed.content).toContain('# Plan');
  });

  it('calls postBinary for docx format', async () => {
    const client = {
      postBinary: vi.fn().mockResolvedValue('UEsDBBQA...'),
    };
    const result = await planExportHandler(client as any)({ id: 'plan-1', format: 'docx' });
    expect(client.postBinary).toHaveBeenCalledWith('/v1/plans/plan-1/export', { format: 'docx', style_template_id: undefined });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.format).toBe('docx');
    expect(parsed.content_base64).toBe('UEsDBBQA...');
  });

  it('returns error when format is invalid', async () => {
    const client = {};
    const result = await planExportHandler(client as any)({ id: 'plan-1', format: 'pdf' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('format must be');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test --reporter=verbose 2>&1 | grep -A 3 "plan_generate\|plan_section_search\|plan_export"
```

Expected: FAIL — `planGenerateDefinition is not exported`

- [ ] **Step 3: Add the three remaining tools to `plan-tools.ts`**

Append to `packages/mcp/src/tools/plan-tools.ts`:

```typescript
// ── plan_generate ─────────────────────────────────────────────────────────────

export const planGenerateDefinition: ToolDefinition = {
  name: 'plan_generate',
  description:
    'Generate a structured outline (sections) for a plan from its spec_prompt. Updates plan status to plan_generated. Run this after plan_create to get sections you can then populate via plan_section_search.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Plan ID' },
      extra_instructions: {
        type: 'string',
        description: 'Additional LLM instructions to guide outline generation (optional)',
      },
    },
    required: ['id'],
  },
};

export function planGenerateHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    const id = args.id as string | undefined;
    if (!id) return toolError('plan_generate: id is required');
    try {
      const result = await client.post(`/v1/plans/${id}/generate-plan`, {
        extra_instructions: args.extra_instructions as string | undefined,
      });
      return toolSuccess(result);
    } catch (err) {
      return toolError(`plan_generate failed: ${(err as Error).message}`);
    }
  };
}

// ── plan_section_search ──────────────────────────────────────────────────────

export const planSectionSearchDefinition: ToolDefinition = {
  name: 'plan_section_search',
  description:
    'Search fragment candidates for a specific section of a plan. The server uses the configured retrieval mode (vector-only, agentic-only, or hybrid) to rank fragments by relevance to the section title and context. Returns an updated plan with candidates filled in for that section.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Plan ID' },
      section_id: { type: 'string', description: 'Section ID (from plan state.sections[].id)' },
      filters_override: {
        type: 'object',
        description:
          'Optional filter overrides for this section: { domain?: string, lang?: string, type?: string }',
      },
    },
    required: ['id', 'section_id'],
  },
};

export function planSectionSearchHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    const id = args.id as string | undefined;
    const sectionId = args.section_id as string | undefined;
    if (!id) return toolError('plan_section_search: id is required');
    if (!sectionId) return toolError('plan_section_search: section_id is required');
    try {
      const body: Record<string, unknown> = {};
      if (args.filters_override) body.filters_override = args.filters_override;
      const result = await client.post(
        `/v1/plans/${id}/sections/${sectionId}/search`,
        body,
      );
      return toolSuccess(result);
    } catch (err) {
      return toolError(`plan_section_search failed: ${(err as Error).message}`);
    }
  };
}

// ── plan_export ──────────────────────────────────────────────────────────────

export const planExportDefinition: ToolDefinition = {
  name: 'plan_export',
  description:
    'Export a plan as markdown (returns text) or docx (returns base64-encoded binary). For docx, decode with `base64 -d > output.docx` or use a base64 decoding tool. Markdown export is useful for previewing; docx is the deliverable.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Plan ID' },
      format: {
        type: 'string',
        enum: ['md', 'docx'],
        description: '"md" for Markdown text, "docx" for Word document (base64-encoded)',
      },
      style_template_id: {
        type: 'string',
        description: 'Optional style reference template ID to apply corporate styling to docx',
      },
    },
    required: ['id', 'format'],
  },
};

export function planExportHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    const id = args.id as string | undefined;
    const format = args.format as string | undefined;
    if (!id) return toolError('plan_export: id is required');
    if (format !== 'md' && format !== 'docx')
      return toolError('plan_export: format must be "md" or "docx"');
    const styleTemplateId = args.style_template_id as string | undefined;
    try {
      if (format === 'md') {
        const content = await client.postText(`/v1/plans/${id}/export`, {
          format: 'md',
          style_template_id: styleTemplateId,
        });
        return toolSuccess({ format: 'md', content });
      } else {
        const content_base64 = await client.postBinary(`/v1/plans/${id}/export`, {
          format: 'docx',
          style_template_id: styleTemplateId,
        });
        return toolSuccess({
          format: 'docx',
          content_base64,
          note: 'Decode with: echo "<content_base64>" | base64 -d > output.docx',
        });
      }
    } catch (err) {
      return toolError(`plan_export failed: ${(err as Error).message}`);
    }
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test --reporter=verbose 2>&1 | grep -A 3 "plan_generate\|plan_section_search\|plan_export"
```

Expected: PASS — 8 tests pass

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @fragmint/mcp exec tsc --noEmit
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add packages/mcp/src/tools/plan-tools.ts packages/mcp/src/tools/tools.test.ts
git commit -m "feat(mcp): plan_generate, plan_section_search, plan_export tools"
```

---

### Task 4: Register the 6 plan tools in `packages/mcp/src/index.ts`

**Files:**
- Modify: `packages/mcp/src/index.ts`

- [ ] **Step 1: Add imports for the 6 plan tools**

At the top of `packages/mcp/src/index.ts`, after the existing imports, add:

```typescript
import {
  planCreateDefinition,
  planCreateHandler,
  planListDefinition,
  planListHandler,
  planGetDefinition,
  planGetHandler,
  planGenerateDefinition,
  planGenerateHandler,
  planSectionSearchDefinition,
  planSectionSearchHandler,
  planExportDefinition,
  planExportHandler,
} from './tools/plan-tools.js';
```

- [ ] **Step 2: Register in the tools array**

In `packages/mcp/src/index.ts`, in the `tools` array (after the last existing entry), add:

```typescript
  { definition: planCreateDefinition, handler: planCreateHandler(client) },
  { definition: planListDefinition, handler: planListHandler(client) },
  { definition: planGetDefinition, handler: planGetHandler(client) },
  { definition: planGenerateDefinition, handler: planGenerateHandler(client) },
  { definition: planSectionSearchDefinition, handler: planSectionSearchHandler(client) },
  { definition: planExportDefinition, handler: planExportHandler(client) },
```

- [ ] **Step 3: Verify tool count**

```bash
node -e "
import('./packages/mcp/dist/index.js').catch(() => {});
" 2>/dev/null || echo "Build needed"
grep -c "definition:" packages/mcp/src/index.ts
```

Expected: 19 tool registrations (13 existing + 6 plan tools)

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @fragmint/mcp exec tsc --noEmit
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/index.ts
git commit -m "feat(mcp): register 6 plan tools"
```

---

## Self-Review

**Spec coverage:**
- ✅ plan_create → POST /v1/plans
- ✅ plan_list → GET /v1/plans
- ✅ plan_get → GET /v1/plans/:id
- ✅ plan_generate → POST /v1/plans/:id/generate-plan
- ✅ plan_section_search → POST /v1/plans/:id/sections/:sectionId/search
- ✅ plan_export → POST /v1/plans/:id/export (md + docx)
- ✅ postText + postBinary in client.ts
- ⚠️ plan_assemble, plan_validate, plan_add_fragment not covered — deferred (advanced workflow, LLM can chain the raw API)

**Type consistency:** All tool definitions use `ToolDefinition` / `ToolHandler` from `../types.js`. Handler closures take `FragmintApiClient` and return `ToolHandler`. Consistent with existing tools pattern.
