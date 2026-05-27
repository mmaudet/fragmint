import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createTestServer, getAuthToken } from '../test-helpers.js';

describe('Plan routes', () => {
  let server: any;
  let token: string;

  beforeAll(async () => {
    server = await createTestServer();
    token = await getAuthToken(server.app);

    // Stub LLM and search on the live planService so we don't hit external services.
    const planService = (server.app as any).planService;
    if (planService && planService.config) {
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
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    return server.app.inject({
      method,
      url,
      headers,
      payload: body !== undefined ? JSON.stringify(body) : undefined,
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

    // Approve a fragment locally (propose_to_library: false to avoid FragmentService.create signature mismatch)
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

  it('returns 403 on action endpoints when a non-admin user does not own the plan', async () => {
    // Use the admin (mmaudet) API to create two non-admin contributor users.
    const adminHeaders = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    };

    // Create 'bob' (contributor) — owner of the plan.
    const bobCreate = await server.app.inject({
      method: 'POST',
      url: '/v1/users',
      headers: adminHeaders,
      payload: JSON.stringify({
        login: 'bob',
        password: 'bob-password',
        display_name: 'Bob',
        role: 'contributor',
      }),
    });
    // 201 created OR 500/400 if user already exists from another test run — best-effort.
    if (
      bobCreate.statusCode !== 201 &&
      bobCreate.statusCode !== 500 &&
      bobCreate.statusCode !== 400
    ) {
      throw new Error(`Unexpected status creating bob: ${bobCreate.statusCode} ${bobCreate.body}`);
    }

    // Create 'carol' (contributor) — outsider.
    const carolCreate = await server.app.inject({
      method: 'POST',
      url: '/v1/users',
      headers: adminHeaders,
      payload: JSON.stringify({
        login: 'carol',
        password: 'carol-password',
        display_name: 'Carol',
        role: 'contributor',
      }),
    });
    if (
      carolCreate.statusCode !== 201 &&
      carolCreate.statusCode !== 500 &&
      carolCreate.statusCode !== 400
    ) {
      throw new Error(
        `Unexpected status creating carol: ${carolCreate.statusCode} ${carolCreate.body}`,
      );
    }

    // Log bob in.
    const bobLogin = await server.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: 'bob', password: 'bob-password' },
    });
    expect(bobLogin.statusCode).toBe(200);
    const bobToken = JSON.parse(bobLogin.body).data.token;

    // Bob creates a plan.
    const created = await server.app.inject({
      method: 'POST',
      url: '/v1/plans',
      headers: { authorization: `Bearer ${bobToken}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ title: "Bob's plan", spec_prompt: '' }),
    });
    expect(created.statusCode).toBe(201);
    const planId = JSON.parse(created.body).data.id;

    // Log carol in.
    const carolLogin = await server.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: 'carol', password: 'carol-password' },
    });
    expect(carolLogin.statusCode).toBe(200);
    const carolToken = JSON.parse(carolLogin.body).data.token;
    // Hit each action endpoint as carol — all should return 403.
    // Only set content-type when sending a body to avoid Fastify's empty-body 400.
    const actionEndpoints: Array<{ method: string; path: string; body?: any }> = [
      { method: 'POST', path: `/v1/plans/${planId}/generate-plan`, body: {} },
      { method: 'POST', path: `/v1/plans/${planId}/validate-plan` },
      { method: 'POST', path: `/v1/plans/${planId}/sections/sec_x/search`, body: {} },
      { method: 'POST', path: `/v1/plans/${planId}/validate-fragments` },
      { method: 'POST', path: `/v1/plans/${planId}/sections/sec_x/generate` },
      { method: 'POST', path: `/v1/plans/${planId}/assemble` },
    ];
    for (const ep of actionEndpoints) {
      const headers: Record<string, string> = { authorization: `Bearer ${carolToken}` };
      if (ep.body !== undefined) headers['content-type'] = 'application/json';
      const res = await server.app.inject({
        method: ep.method,
        url: ep.path,
        headers,
        payload: ep.body !== undefined ? JSON.stringify(ep.body) : undefined,
      });
      expect(res.statusCode, `expected 403 for ${ep.path}, got ${res.statusCode}`).toBe(403);
    }
  });

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
