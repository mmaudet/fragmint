import { describe, it, expect, beforeAll } from 'vitest';
import { createTestServer, getAuthToken } from '../test-helpers.js';

describe('Template routes - marp upload', () => {
  let server: any;
  let token: string;

  beforeAll(async () => {
    server = await createTestServer();
    token = await getAuthToken(server.app);
  });

  it('POST /v1/templates/marp crée un template marp', async () => {
    const boundary = '----TestBoundaryMarp';
    const mdContent = '---\nmarp: true\n---\n# Slide 1\n\n---\n# Slide 2\n';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="presentation.md"',
      'Content-Type: text/markdown',
      '',
      mdContent,
      `--${boundary}`,
      'Content-Disposition: form-data; name="name"',
      '',
      'Présentation Test',
      `--${boundary}`,
      'Content-Disposition: form-data; name="description"',
      '',
      'Un deck de test',
      `--${boundary}--`,
    ].join('\r\n');

    const res = await server.app.inject({
      method: 'POST',
      url: '/v1/templates/marp',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.from(body),
    });

    expect(res.statusCode).toBe(201);
    const parsed = JSON.parse(res.body);
    expect(parsed.data.id).toMatch(/^tpl_marp_/);
    expect(parsed.data.template_path).toMatch(/\.md$/);
  });

  it('POST /v1/templates/marp rejette un fichier non-.md', async () => {
    const boundary = '----TestBoundaryMarpBad';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="presentation.docx"',
      'Content-Type: application/octet-stream',
      '',
      'fake docx content',
      `--${boundary}`,
      'Content-Disposition: form-data; name="name"',
      '',
      'Mauvais template',
      `--${boundary}--`,
    ].join('\r\n');

    const res = await server.app.inject({
      method: 'POST',
      url: '/v1/templates/marp',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.from(body),
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/\.md/);
  });

  it('GET /v1/templates?kind=marp liste les templates marp', async () => {
    // D'abord, uploader un template marp
    const boundary = '----TestBoundaryMarpList';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="list-test.md"',
      'Content-Type: text/markdown',
      '',
      '---\nmarp: true\n---\n# Test',
      `--${boundary}`,
      'Content-Disposition: form-data; name="name"',
      '',
      'List Test Deck',
      `--${boundary}--`,
    ].join('\r\n');

    const uploadRes = await server.app.inject({
      method: 'POST',
      url: '/v1/templates/marp',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.from(body),
    });
    expect(uploadRes.statusCode).toBe(201);

    const res = await server.app.inject({
      method: 'GET',
      url: '/v1/templates?kind=marp',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.data.length).toBeGreaterThanOrEqual(1);
    expect(parsed.data.every((t: any) => t.kind === 'marp')).toBe(true);
  });
});
