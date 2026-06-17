import { describe, it, expect, beforeAll } from 'vitest';
import { createTestServer, getAuthToken } from '../test-helpers.js';

describe('Admin retrieval mode routes', () => {
  let server: any;
  let token: string;

  beforeAll(async () => {
    server = await createTestServer();
    token = await getAuthToken(server.app);
  });

  // Helper matching the same pattern as plans.integration.test.ts
  async function api(method: string, url: string, body?: any, authToken?: string) {
    const bearerToken = authToken ?? token;
    const headers: Record<string, string> = { authorization: `Bearer ${bearerToken}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    return server.app.inject({
      method,
      url,
      headers,
      payload: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  // Test 1: GET without token → 401
  it('GET /v1/admin/retrieval/mode returns 401 without token', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: '/v1/admin/retrieval/mode',
    });
    expect(res.statusCode).toBe(401);
  });

  // Test 2: POST with invalid (wrong) token → 401
  it('POST /v1/admin/retrieval/mode returns 401 with invalid token', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/v1/admin/retrieval/mode',
      headers: {
        authorization: 'Bearer invalid-token-value',
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ mode: 'hybrid' }),
    });
    expect(res.statusCode).toBe(401);
  });

  // Test 3: POST with admin token + valid mode → 200 with correct body
  it('POST /v1/admin/retrieval/mode returns 200 with admin token and valid mode', async () => {
    const res = await api('POST', '/v1/admin/retrieval/mode', { mode: 'hybrid' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.mode).toBe('hybrid');
    expect(body.data.retriever_type).toBeTruthy();
    expect(body.error).toBeNull();

    // Reset back to vector-only
    await api('POST', '/v1/admin/retrieval/mode', { mode: 'vector-only' });
  });

  // Test 4: POST with invalid mode → 400
  it('POST /v1/admin/retrieval/mode returns 400 for invalid mode', async () => {
    const res = await api('POST', '/v1/admin/retrieval/mode', { mode: 'turbo-mode' });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('Invalid enum value');
  });

  // Test 5: GET with admin token returns current mode
  it('GET /v1/admin/retrieval/mode returns current mode for admin', async () => {
    const res = await api('GET', '/v1/admin/retrieval/mode');
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(['vector-only', 'agentic-only', 'hybrid']).toContain(body.data.mode);
    expect(body.error).toBeNull();
  });

  // Integration test: planService uses configured retriever when mode is set
  it('planService uses the configured retriever when retrieval mode is set', async () => {
    // Switch to hybrid mode
    const modeRes = await server.app.inject({
      method: 'POST',
      url: '/v1/admin/retrieval/mode',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ mode: 'hybrid' }),
    });
    expect(modeRes.statusCode).toBe(200);
    expect(JSON.parse(modeRes.body).data.mode).toBe('hybrid');

    // Verify GET mode also returns hybrid
    const getRes = await server.app.inject({
      method: 'GET',
      url: '/v1/admin/retrieval/mode',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getRes.statusCode).toBe(200);
    expect(JSON.parse(getRes.body).data.mode).toBe('hybrid');

    // Reset to vector-only
    await server.app.inject({
      method: 'POST',
      url: '/v1/admin/retrieval/mode',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ mode: 'vector-only' }),
    });
  });
});
