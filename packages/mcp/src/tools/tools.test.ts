// packages/mcp/src/tools/tools.test.ts
import { describe, it, expect, vi } from 'vitest';
import { inventoryHandler } from './fragment-inventory.js';
import { searchHandler } from './fragment-search.js';
import { getHandler } from './fragment-get.js';
import { createHandler } from './fragment-create.js';
import { updateHandler } from './fragment-update.js';
import { lineageHandler } from './fragment-lineage.js';
import { composeHandler, composeDefinition } from './document-compose.js';

function mockClient() {
  return {
    get: vi.fn().mockResolvedValue({ id: 'frag-test', title: 'Test' }),
    post: vi.fn().mockResolvedValue({ total: 5, by_type: {}, gaps: [] }),
    put: vi.fn().mockResolvedValue({ id: 'frag-test', commit_hash: 'abc123' }),
  };
}

describe('fragment_inventory', () => {
  it('calls POST /v1/fragments/inventory', async () => {
    const client = mockClient();
    const handler = inventoryHandler(client as any);
    const result = await handler({ topic: 'souveraineté' });
    expect(client.post).toHaveBeenCalledWith('/v1/fragments/inventory', { topic: 'souveraineté', lang: undefined });
    expect(result.isError).toBeUndefined();
  });

  it('returns error on API failure', async () => {
    const client = mockClient();
    client.post.mockRejectedValue(new Error('API down'));
    const handler = inventoryHandler(client as any);
    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('API down');
  });
});

describe('fragment_search', () => {
  it('calls POST /v1/fragments/search with filters', async () => {
    const client = mockClient();
    client.post.mockResolvedValue([{ id: 'f1', score: 0.9 }]);
    const handler = searchHandler(client as any);
    const result = await handler({ query: 'test', type: 'argument', lang: 'fr' });
    expect(client.post).toHaveBeenCalledWith('/v1/fragments/search', {
      query: 'test', limit: 10,
      filters: { type: ['argument'], lang: 'fr' },
    });
    expect(result.isError).toBeUndefined();
  });
});

describe('fragment_get', () => {
  it('calls GET /v1/fragments/:id', async () => {
    const client = mockClient();
    const handler = getHandler(client as any);
    const result = await handler({ id: 'frag-test' });
    expect(client.get).toHaveBeenCalledWith('/v1/fragments/frag-test');
    expect(result.isError).toBeUndefined();
  });

  it('fetches history when include_history is true', async () => {
    const client = mockClient();
    client.get.mockResolvedValueOnce({ id: 'frag-test' })
              .mockResolvedValueOnce([{ commit: 'abc' }]);
    const handler = getHandler(client as any);
    await handler({ id: 'frag-test', include_history: true });
    expect(client.get).toHaveBeenCalledTimes(2);
    expect(client.get).toHaveBeenCalledWith('/v1/fragments/frag-test/history');
  });
});

describe('fragment_create', () => {
  it('calls POST /v1/fragments', async () => {
    const client = mockClient();
    client.post.mockResolvedValue({ id: 'frag-new', commit_hash: 'abc', quality: 'draft' });
    const handler = createHandler(client as any);
    const result = await handler({ type: 'argument', domain: 'test', lang: 'fr', body: '# Test' });
    expect(client.post).toHaveBeenCalledWith('/v1/fragments', {
      type: 'argument', domain: 'test', lang: 'fr', body: '# Test',
      tags: [], parent_id: null,
    });
    expect(result.isError).toBeUndefined();
  });
});

describe('fragment_update', () => {
  it('calls PUT /v1/fragments/:id', async () => {
    const client = mockClient();
    const handler = updateHandler(client as any);
    const result = await handler({ id: 'frag-test', body: '# Updated' });
    expect(client.put).toHaveBeenCalledWith('/v1/fragments/frag-test', { body: '# Updated' });
    expect(result.isError).toBeUndefined();
  });
});

describe('fragment_lineage', () => {
  it('calls GET /v1/fragments/:id/lineage and adds community_cluster', async () => {
    const client = mockClient();
    client.get.mockResolvedValue({ root: {}, children: [], translations: [] });
    const handler = lineageHandler(client as any);
    const result = await handler({ id: 'frag-test' });
    expect(client.get).toHaveBeenCalledWith('/v1/fragments/frag-test/lineage');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.community_cluster).toBeNull();
  });
});

describe('document_compose', () => {
  it('has correct definition with required fields', () => {
    expect(composeDefinition.name).toBe('document_compose');
    expect(composeDefinition.inputSchema.required).toEqual(['template_id', 'context']);
    expect(composeDefinition.inputSchema.properties).toHaveProperty('template_id');
    expect(composeDefinition.inputSchema.properties).toHaveProperty('context');
    expect(composeDefinition.inputSchema.properties).toHaveProperty('overrides');
    expect(composeDefinition.inputSchema.properties).toHaveProperty('structured_data');
  });

  it('calls POST /v1/templates/:id/compose', async () => {
    const client = mockClient();
    client.post.mockResolvedValue({
      download_url: '/docs/out.pdf',
      render_time_ms: 320,
      fragments_resolved: 5,
    });
    const handler = composeHandler(client as any);
    const result = await handler({
      template_id: 'tpl-proposition-001',
      context: { lang: 'fr', product: 'twake' },
    });
    expect(client.post).toHaveBeenCalledWith('/v1/templates/tpl-proposition-001/compose', {
      context: { lang: 'fr', product: 'twake' },
      overrides: undefined,
      structured_data: undefined,
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.download_url).toBe('/docs/out.pdf');
  });

  it('returns error on API failure', async () => {
    const client = mockClient();
    client.post.mockRejectedValue(new Error('Template not found'));
    const handler = composeHandler(client as any);
    const result = await handler({ template_id: 'bad', context: {} });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Template not found');
  });
});
