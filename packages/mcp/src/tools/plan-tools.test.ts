// packages/mcp/src/tools/plan-tools.test.ts
import { describe, it, expect, vi } from 'vitest';
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
} from './plan-tools.js';

describe('plan_create', () => {
  it('has correct definition', () => {
    expect(planCreateDefinition.name).toBe('plan_create');
    expect(planCreateDefinition.inputSchema.required).toContain('spec_prompt');
  });

  it('calls POST /v1/plans with body', async () => {
    const client = {
      post: vi.fn().mockResolvedValue({ id: 'plan-abc', title: 'My Plan', status: 'draft' }),
    };
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
    const result = await planCreateHandler(client as any)({ spec_prompt: 'x' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unauthorized');
  });
});

describe('plan_list', () => {
  it('has correct definition', () => {
    expect(planListDefinition.name).toBe('plan_list');
  });

  it('calls GET /v1/plans', async () => {
    const client = {
      get: vi.fn().mockResolvedValue([{ id: 'plan-1', title: 'Plan A', status: 'draft' }]),
    };
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
    const client = {
      get: vi.fn().mockResolvedValue({ id: 'plan-1', title: 'Plan A', state: {} }),
    };
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

describe('plan_generate', () => {
  it('has id in required', () => {
    expect(planGenerateDefinition.inputSchema.required).toContain('id');
  });

  it('calls POST /v1/plans/:id/generate-plan', async () => {
    const client = {
      post: vi
        .fn()
        .mockResolvedValue({ id: 'plan-1', status: 'plan_generated', state: { sections: [] } }),
    };
    const result = await planGenerateHandler(client as any)({
      id: 'plan-1',
      extra_instructions: 'Focus on pricing',
    });
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
    const client = {
      post: vi
        .fn()
        .mockResolvedValue({ id: 'plan-1', state: { sections: [{ id: 'sec-1', candidates: [] }] } }),
    };
    const result = await planSectionSearchHandler(client as any)({
      id: 'plan-1',
      section_id: 'sec-1',
    });
    expect(client.post).toHaveBeenCalledWith('/v1/plans/plan-1/sections/sec-1/search', {});
    expect(result.isError).toBeUndefined();
  });
});

describe('plan_export', () => {
  it('has id and format in required', () => {
    expect(planExportDefinition.inputSchema.required).toContain('id');
    expect(planExportDefinition.inputSchema.required).toContain('format');
  });

  it('calls postText for md format — does not send style_template_id', async () => {
    const client = {
      postText: vi.fn().mockResolvedValue('# Plan\n## Intro'),
    };
    const result = await planExportHandler(client as any)({ id: 'plan-1', format: 'md' });
    expect(client.postText).toHaveBeenCalledWith('/v1/plans/plan-1/export', { format: 'md' });
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
    expect(client.postBinary).toHaveBeenCalledWith('/v1/plans/plan-1/export', { format: 'docx' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.format).toBe('docx');
    expect(parsed.content_base64).toBe('UEsDBBQA...');
  });

  it('includes style_template_id in docx body when provided', async () => {
    const client = {
      postBinary: vi.fn().mockResolvedValue('base64data'),
    };
    await planExportHandler(client as any)({
      id: 'plan-1',
      format: 'docx',
      style_template_id: 'tpl-corporate',
    });
    expect(client.postBinary).toHaveBeenCalledWith('/v1/plans/plan-1/export', {
      format: 'docx',
      style_template_id: 'tpl-corporate',
    });
  });

  it('returns error when format is invalid', async () => {
    const client = {};
    const result = await planExportHandler(client as any)({ id: 'plan-1', format: 'pdf' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('format must be');
  });
});
