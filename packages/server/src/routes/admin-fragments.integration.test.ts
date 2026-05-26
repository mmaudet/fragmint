// packages/server/src/routes/admin-fragments.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer, getAuthToken } from '../test-helpers.js';

describe('Admin fragment routes', () => {
  let server: any;
  let token: string;
  let createdId: string;

  beforeAll(async () => {
    server = await createTestServer();
    token = await getAuthToken(server.app);

    // Create a test fragment via the standard route
    const res = await server.app.inject({
      method: 'POST',
      url: '/v1/fragments',
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        type: 'argument',
        domain: 'test',
        lang: 'fr',
        body: '# Admin test\n\nFragment for admin route tests.',
        tags: ['admin-test'],
      },
    });
    createdId = JSON.parse(res.body).data.id;
  });

  afterAll(async () => {
    await server.app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('GET /v1/admin/fragments returns list with pagination and stats', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: '/v1/admin/fragments',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.data.items)).toBe(true);
    expect(body.data.pagination).toHaveProperty('total');
    expect(body.data.pagination).toHaveProperty('has_more');
    expect(body.data.stats.by_status).toHaveProperty('draft');
    expect(body.data.stats.by_status).toHaveProperty('reviewed');
    expect(body.data.stats.by_status).toHaveProperty('approved');
    expect(body.data.stats.by_status).toHaveProperty('deprecated');
  });

  it('GET /v1/admin/fragments filters by quality', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: '/v1/admin/fragments?quality=draft',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.items.every((i: any) => i.quality === 'draft')).toBe(true);
  });

  it('GET /v1/admin/fragments filters by search', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: '/v1/admin/fragments?search=Admin+test',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.items.some((i: any) => i.id === createdId)).toBe(true);
  });

  it('GET /v1/admin/fragments returns tags as array', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: '/v1/admin/fragments?quality=draft',
      headers: auth(),
    });
    const body = JSON.parse(res.body);
    const item = body.data.items.find((i: any) => i.id === createdId);
    expect(item).toBeDefined();
    expect(Array.isArray(item.tags)).toBe(true);
  });

  it('POST /v1/admin/fragments/bulk-archive returns job_id', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/v1/admin/fragments/bulk-archive',
      headers: auth(),
      payload: { ids: [createdId] },
    });
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.data.job_id).toBeDefined();
  });

  it('POST /v1/admin/fragments/bulk-archive rejects empty ids', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/v1/admin/fragments/bulk-archive',
      headers: auth(),
      payload: { ids: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /v1/admin/fragments returns 401 without auth', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: '/v1/admin/fragments',
    });
    expect(res.statusCode).toBe(401);
  });
});
