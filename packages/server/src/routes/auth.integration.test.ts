import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer } from '../test-helpers.js';

describe('Auth routes', () => {
  let server: any;

  beforeAll(async () => {
    server = await createTestServer();
  });

  afterAll(async () => {
    await server.app.close();
  });

  it('POST /v1/auth/login returns JWT for valid credentials', async () => {
    const res = await server.app.inject({
      method: 'POST', url: '/v1/auth/login',
      payload: { username: 'mmaudet', password: 'fragmint-dev' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.token).toBeDefined();
    expect(body.data.user.role).toBe('admin');
  });

  it('POST /v1/auth/login rejects invalid password', async () => {
    const res = await server.app.inject({
      method: 'POST', url: '/v1/auth/login',
      payload: { username: 'mmaudet', password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /v1/fragments without auth returns 401', async () => {
    const res = await server.app.inject({ method: 'GET', url: '/v1/fragments' });
    expect(res.statusCode).toBe(401);
  });
});
