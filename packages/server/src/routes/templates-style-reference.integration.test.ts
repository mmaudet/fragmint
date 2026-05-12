import { describe, it, expect, beforeAll } from 'vitest';
import FormData from 'form-data';
import { createTestServer, getAuthToken } from '../test-helpers.js';

describe('Style-reference template routes', () => {
  let server: any;
  let token: string;

  beforeAll(async () => {
    server = await createTestServer();
    token = await getAuthToken(server.app);
  });

  it('uploads a style-reference and lists it via ?kind=style_reference', async () => {
    const form = new FormData();
    form.append('name', 'Corporate Style');
    form.append('description', 'Std proposal layout');
    form.append('file', Buffer.from('PK\x03\x04 fake'), {
      filename: 'corporate.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    const upload = await server.app.inject({
      method: 'POST',
      url: '/v1/templates/style-reference',
      headers: { authorization: `Bearer ${token}`, ...form.getHeaders() },
      payload: form.getBuffer(),
    });
    expect(upload.statusCode).toBe(201);
    const uploaded = JSON.parse(upload.body);
    expect(uploaded.data.id).toMatch(/^tpl_style_/);

    const list = await server.app.inject({
      method: 'GET',
      url: '/v1/templates?kind=style_reference',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.statusCode).toBe(200);
    const listed = JSON.parse(list.body);
    expect(listed.data.some((t: any) => t.id === uploaded.data.id)).toBe(true);
  });

  it('rejects upload missing the file part', async () => {
    const form = new FormData();
    form.append('name', 'NoFile');

    const res = await server.app.inject({
      method: 'POST',
      url: '/v1/templates/style-reference',
      headers: { authorization: `Bearer ${token}`, ...form.getHeaders() },
      payload: form.getBuffer(),
    });
    expect(res.statusCode).toBe(400);
  });
});
