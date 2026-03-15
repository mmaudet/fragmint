// packages/mcp/src/tools/tools.test.ts
import { describe, it, expect, vi } from 'vitest';
import { inventoryHandler, inventoryDefinition } from './fragment-inventory.js';
import { searchHandler, searchDefinition } from './fragment-search.js';
import { getHandler } from './fragment-get.js';
import { createHandler } from './fragment-create.js';
import { updateHandler } from './fragment-update.js';
import { lineageHandler } from './fragment-lineage.js';
import { composeHandler, composeDefinition } from './document-compose.js';
import { collectionListHandler, collectionListDefinition } from './collection-list.js';

function mockClient() {
  return {
    get: vi.fn().mockResolvedValue({ id: 'frag-test', title: 'Test' }),
    post: vi.fn().mockResolvedValue({ total: 5, by_type: {}, gaps: [] }),
    put: vi.fn().mockResolvedValue({ id: 'frag-test', commit_hash: 'abc123' }),
  };
}

describe('collection_list', () => {
  it('has correct definition', () => {
    expect(collectionListDefinition.name).toBe('collection_list');
    expect(collectionListDefinition.description).toContain('List accessible collections');
  });

  it('calls GET /v1/collections', async () => {
    const client = mockClient();
    client.get.mockResolvedValue([{ slug: 'common' }, { slug: 'anfsi' }]);
    const handler = collectionListHandler(client as any);
    const result = await handler({});
    expect(client.get).toHaveBeenCalledWith('/v1/collections');
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(2);
  });

  it('returns error on API failure', async () => {
    const client = mockClient();
    client.get.mockRejectedValue(new Error('Unauthorized'));
    const handler = collectionListHandler(client as any);
    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unauthorized');
  });
});

describe('fragment_inventory', () => {
  it('has collection_slug in definition', () => {
    expect(inventoryDefinition.inputSchema.properties).toHaveProperty('collection_slug');
  });

  it('calls POST with default collection (common)', async () => {
    const client = mockClient();
    const handler = inventoryHandler(client as any);
    const result = await handler({ topic: 'souveraineté' });
    expect(client.post).toHaveBeenCalledWith('/v1/collections/common/fragments/inventory', { topic: 'souveraineté', lang: undefined });
    expect(result.isError).toBeUndefined();
  });

  it('calls POST with explicit collection_slug', async () => {
    const client = mockClient();
    const handler = inventoryHandler(client as any);
    await handler({ topic: 'test', collection_slug: 'anfsi' });
    expect(client.post).toHaveBeenCalledWith('/v1/collections/anfsi/fragments/inventory', { topic: 'test', lang: undefined });
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
  it('has collection_slugs in definition', () => {
    expect(searchDefinition.inputSchema.properties).toHaveProperty('collection_slugs');
  });

  it('calls POST with default collection (common)', async () => {
    const client = mockClient();
    client.post.mockResolvedValue([{ id: 'f1', score: 0.9 }]);
    const handler = searchHandler(client as any);
    const result = await handler({ query: 'test', type: 'argument', lang: 'fr' });
    expect(client.post).toHaveBeenCalledWith('/v1/collections/common/fragments/search', {
      query: 'test', limit: 10,
      filters: { type: ['argument'], lang: 'fr' },
    });
    expect(result.isError).toBeUndefined();
  });

  it('uses first slug when collection_slugs is an array', async () => {
    const client = mockClient();
    client.post.mockResolvedValue([]);
    const handler = searchHandler(client as any);
    await handler({ query: 'test', collection_slugs: ['anfsi', 'common'] });
    expect(client.post).toHaveBeenCalledWith('/v1/collections/anfsi/fragments/search', expect.any(Object));
  });
});

describe('fragment_get', () => {
  it('calls GET with default collection', async () => {
    const client = mockClient();
    const handler = getHandler(client as any);
    const result = await handler({ id: 'frag-test' });
    expect(client.get).toHaveBeenCalledWith('/v1/collections/common/fragments/frag-test');
    expect(result.isError).toBeUndefined();
  });

  it('calls GET with explicit collection_slug', async () => {
    const client = mockClient();
    const handler = getHandler(client as any);
    await handler({ id: 'frag-test', collection_slug: 'anfsi' });
    expect(client.get).toHaveBeenCalledWith('/v1/collections/anfsi/fragments/frag-test');
  });

  it('fetches history when include_history is true', async () => {
    const client = mockClient();
    client.get.mockResolvedValueOnce({ id: 'frag-test' })
              .mockResolvedValueOnce([{ commit: 'abc' }]);
    const handler = getHandler(client as any);
    await handler({ id: 'frag-test', include_history: true, collection_slug: 'anfsi' });
    expect(client.get).toHaveBeenCalledTimes(2);
    expect(client.get).toHaveBeenCalledWith('/v1/collections/anfsi/fragments/frag-test/history');
  });
});

describe('fragment_create', () => {
  it('calls POST with default collection', async () => {
    const client = mockClient();
    client.post.mockResolvedValue({ id: 'frag-new', commit_hash: 'abc', quality: 'draft' });
    const handler = createHandler(client as any);
    const result = await handler({ type: 'argument', domain: 'test', lang: 'fr', body: '# Test' });
    expect(client.post).toHaveBeenCalledWith('/v1/collections/common/fragments', {
      type: 'argument', domain: 'test', lang: 'fr', body: '# Test',
      tags: [], parent_id: null,
    });
    expect(result.isError).toBeUndefined();
  });

  it('calls POST with explicit collection_slug', async () => {
    const client = mockClient();
    client.post.mockResolvedValue({ id: 'frag-new' });
    const handler = createHandler(client as any);
    await handler({ type: 'argument', domain: 'test', lang: 'fr', body: '# Test', collection_slug: 'anfsi' });
    expect(client.post).toHaveBeenCalledWith('/v1/collections/anfsi/fragments', expect.any(Object));
  });
});

describe('fragment_update', () => {
  it('calls PUT with default collection', async () => {
    const client = mockClient();
    const handler = updateHandler(client as any);
    const result = await handler({ id: 'frag-test', body: '# Updated' });
    expect(client.put).toHaveBeenCalledWith('/v1/collections/common/fragments/frag-test', { body: '# Updated' });
    expect(result.isError).toBeUndefined();
  });

  it('calls PUT with explicit collection_slug and excludes it from body', async () => {
    const client = mockClient();
    const handler = updateHandler(client as any);
    await handler({ id: 'frag-test', body: '# Updated', collection_slug: 'anfsi' });
    expect(client.put).toHaveBeenCalledWith('/v1/collections/anfsi/fragments/frag-test', { body: '# Updated' });
  });
});

describe('fragment_lineage', () => {
  it('calls GET with default collection and adds community_cluster', async () => {
    const client = mockClient();
    client.get.mockResolvedValue({ root: {}, children: [], translations: [] });
    const handler = lineageHandler(client as any);
    const result = await handler({ id: 'frag-test' });
    expect(client.get).toHaveBeenCalledWith('/v1/collections/common/fragments/frag-test/lineage');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.community_cluster).toBeNull();
  });

  it('calls GET with explicit collection_slug', async () => {
    const client = mockClient();
    client.get.mockResolvedValue({ root: {} });
    const handler = lineageHandler(client as any);
    await handler({ id: 'frag-test', collection_slug: 'anfsi' });
    expect(client.get).toHaveBeenCalledWith('/v1/collections/anfsi/fragments/frag-test/lineage');
  });
});

describe('document_compose', () => {
  it('has correct definition with required fields and collection_slug', () => {
    expect(composeDefinition.name).toBe('document_compose');
    expect(composeDefinition.inputSchema.required).toEqual(['template_id', 'context']);
    expect(composeDefinition.inputSchema.properties).toHaveProperty('collection_slug');
  });

  it('calls POST with default collection', async () => {
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
    expect(client.post).toHaveBeenCalledWith('/v1/collections/common/templates/tpl-proposition-001/compose', {
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
