import { describe, it, expect, beforeAll } from 'vitest';
import { createTestServer, getAuthToken } from '../test-helpers.js';

describe('Plan template routes', () => {
  let server: any;
  let token: string;

  beforeAll(async () => {
    server = await createTestServer();
    token = await getAuthToken(server.app);
  });

  async function api(method: string, url: string, body?: any) {
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    return server.app.inject({
      method, url, headers,
      payload: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  const FIXTURE = {
    name: 'Template PAS test',
    version: '1.0.0',
    description: 'Template de test',
    sections: [
      { title: 'Introduction', description: 'Présentation du contexte', inferred_type: 'introduction' },
      { title: 'Architecture', description: 'Description technique', inferred_type: 'methodology' },
    ],
  };

  it('POST /v1/plan-templates — crée un template', async () => {
    const res = await api('POST', '/v1/plan-templates', FIXTURE);
    expect(res.statusCode).toBe(201);
    const { data } = JSON.parse(res.body);
    expect(data.name).toBe(FIXTURE.name);
    expect(data.sections).toHaveLength(2);
    expect(data.status).toBe('active');
  });

  it('GET /v1/plan-templates — liste les templates', async () => {
    const res = await api('GET', '/v1/plan-templates');
    expect(res.statusCode).toBe(200);
    const { data } = JSON.parse(res.body);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /v1/plan-templates/:id — retourne le template', async () => {
    const created = await api('POST', '/v1/plan-templates', { ...FIXTURE, name: 'Template GET test' });
    const id = JSON.parse(created.body).data.id;

    const res = await api('GET', `/v1/plan-templates/${id}`);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.id).toBe(id);
  });

  it('GET /v1/plan-templates/:id — 404 si absent', async () => {
    const res = await api('GET', '/v1/plan-templates/unknown-id');
    expect(res.statusCode).toBe(404);
  });

  it('POST /v1/plans avec template_id — crée un plan avec sections initialisées', async () => {
    const tpl = await api('POST', '/v1/plan-templates', FIXTURE);
    const templateId = JSON.parse(tpl.body).data.id;

    const res = await api('POST', '/v1/plans', { title: 'Plan from template', template_id: templateId });
    expect(res.statusCode).toBe(201);
    const { data } = JSON.parse(res.body);
    expect(data.status).toBe('plan_validated');
    expect(data.state.sections).toHaveLength(2);
    expect(data.state.sections[0].title).toBe('Introduction');
    expect(data.state.from_template_id).toBe(templateId);
    expect(data.state.from_template_version).toBe('1.0.0');
  });

  it('POST /v1/plans avec template_id inexistant — 404', async () => {
    const res = await api('POST', '/v1/plans', { template_id: 'nonexistent' });
    expect(res.statusCode).toBe(404);
  });

  it('POST /v1/plans sans template_id — workflow inchangé (status: draft)', async () => {
    const res = await api('POST', '/v1/plans', { title: 'Plan normal', spec_prompt: 'test' });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.status).toBe('draft');
  });
});
