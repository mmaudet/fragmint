import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer, getAuthToken } from '../test-helpers.js';

describe('Template routes', () => {
  let server: any;
  let token: string;
  let createdId: string;

  beforeAll(async () => {
    server = await createTestServer();
    token = await getAuthToken(server.app);
  });

  afterAll(async () => {
    await server.app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('GET /v1/templates returns empty list initially', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: '/v1/templates',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toEqual([]);
    expect(body.meta.count).toBe(0);
  });

  it('POST /v1/templates creates a template via multipart', async () => {
    const boundary = '----TestBoundary';
    const yamlContent = `id: tpl-integ-test-001
name: Integration test template
output_format: docx
carbone_template: test-template.docx
version: "1.0"
fragments:
  - key: introduction
    type: introduction
    domain: test
    lang: fr`;

    const docxContent = Buffer.from('PK mock docx content');

    const parts: string[] = [];
    parts.push(`--${boundary}`);
    parts.push('Content-Disposition: form-data; name="docx"; filename="test-template.docx"');
    parts.push('Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    parts.push('');
    parts.push(docxContent.toString('binary'));
    parts.push(`--${boundary}`);
    parts.push('Content-Disposition: form-data; name="yaml"; filename="test-template.fragmint.yaml"');
    parts.push('Content-Type: text/yaml');
    parts.push('');
    parts.push(yamlContent);
    parts.push(`--${boundary}--`);

    const payload = parts.join('\r\n');

    const res = await server.app.inject({
      method: 'POST',
      url: '/v1/templates',
      headers: {
        ...auth(),
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.id).toBe('tpl-integ-test-001');
    expect(body.data.template_path).toContain('test-template.docx');
    createdId = body.data.id;
  });

  it('GET /v1/templates lists the created template', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: '/v1/templates',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.length).toBe(1);
    expect(body.data[0].id).toBe(createdId);
    expect(body.data[0].name).toBe('Integration test template');
  });

  it('GET /v1/templates/:id returns template detail with fragment slots', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: `/v1/templates/${createdId}`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.id).toBe(createdId);
    expect(body.data.name).toBe('Integration test template');
    expect(body.data.yaml).toBeDefined();
    expect(body.data.yaml.fragments).toHaveLength(1);
    expect(body.data.yaml.fragments[0].key).toBe('introduction');
    expect(body.data.yaml.fragments[0].type).toBe('introduction');
  });

  it('GET /v1/templates/:id returns 404 for unknown id', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: '/v1/templates/tpl-does-not-exist',
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Template not found');
  });

  it('DELETE /v1/templates/:id removes the template', async () => {
    const res = await server.app.inject({
      method: 'DELETE',
      url: `/v1/templates/${createdId}`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.id).toBe(createdId);

    // Verify GET now returns 404
    const getRes = await server.app.inject({
      method: 'GET',
      url: `/v1/templates/${createdId}`,
      headers: auth(),
    });
    expect(getRes.statusCode).toBe(404);
  });
});
