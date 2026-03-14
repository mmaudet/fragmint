import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer, getAuthToken } from '../test-helpers.js';

describe('Fragment routes', () => {
  let server: any;
  let token: string;

  beforeAll(async () => {
    server = await createTestServer();
    token = await getAuthToken(server.app);
  });

  afterAll(async () => {
    await server.app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('POST /v1/fragments creates a fragment', async () => {
    const res = await server.app.inject({
      method: 'POST', url: '/v1/fragments',
      headers: auth(),
      payload: {
        type: 'argument', domain: 'test', lang: 'fr',
        body: '# Test argument\n\nThis is a test.', tags: ['test'],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.id).toMatch(/^frag-/);
    expect(body.data.quality).toBe('draft');
  });

  it('GET /v1/fragments lists fragments', async () => {
    const res = await server.app.inject({
      method: 'GET', url: '/v1/fragments', headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('POST /v1/fragments/search returns results', async () => {
    const res = await server.app.inject({
      method: 'POST', url: '/v1/fragments/search',
      headers: auth(),
      payload: { query: 'test' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('POST /v1/fragments/inventory returns counts', async () => {
    const res = await server.app.inject({
      method: 'POST', url: '/v1/fragments/inventory',
      headers: auth(),
      payload: { topic: 'test' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.total).toBeGreaterThanOrEqual(0);
  });
});
