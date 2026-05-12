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
});
