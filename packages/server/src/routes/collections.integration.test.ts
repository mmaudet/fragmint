import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer, getAuthToken } from '../test-helpers.js';

describe('Collection routes', () => {
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

  it('GET /v1/collections returns common after auto-migration', async () => {
    // In test mode the dev user is created after the collections migration,
    // so we add the membership explicitly to simulate auto-assign behavior.
    await server.app.inject({
      method: 'POST', url: '/v1/collections/common/members',
      headers: auth(),
      payload: { user_id: 'mmaudet', role: 'reader' },
    });

    const res = await server.app.inject({
      method: 'GET', url: '/v1/collections', headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toBeInstanceOf(Array);
    const common = body.data.find((c: any) => c.slug === 'common');
    expect(common).toBeDefined();
    expect(common.role).toBeDefined();
  });

  it('POST /v1/collections creates a team collection', async () => {
    const res = await server.app.inject({
      method: 'POST', url: '/v1/collections',
      headers: auth(),
      payload: { slug: 'test-team', name: 'Test Team', type: 'team' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.slug).toBe('test-team');

    // Verify it appears via GET /v1/collections/:slug (admin has implicit access)
    const detailRes = await server.app.inject({
      method: 'GET', url: '/v1/collections/test-team', headers: auth(),
    });
    expect(detailRes.statusCode).toBe(200);
    const detailBody = JSON.parse(detailRes.body);
    expect(detailBody.data.slug).toBe('test-team');
    expect(detailBody.data.name).toBe('Test Team');
  });

  it('POST /v1/collections/:slug/members adds a member', async () => {
    const res = await server.app.inject({
      method: 'POST', url: '/v1/collections/test-team/members',
      headers: auth(),
      payload: { user_id: 'some-user-id', role: 'reader' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.added).toBe(true);
  });

  it('GET /v1/collections/:slug returns collection detail', async () => {
    const res = await server.app.inject({
      method: 'GET', url: '/v1/collections/common', headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.slug).toBe('common');
    expect(body.data.name).toBe('Common');
    expect(body.data.type).toBe('system');
  });

  it('Backward compat: /v1/fragments returns fragments', async () => {
    const res = await server.app.inject({
      method: 'GET', url: '/v1/fragments', headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toBeInstanceOf(Array);
  });

  it('GET /v1/collections/nonexistent returns 404', async () => {
    const res = await server.app.inject({
      method: 'GET', url: '/v1/collections/nonexistent', headers: auth(),
    });
    expect(res.statusCode).toBe(404);
  });
});
