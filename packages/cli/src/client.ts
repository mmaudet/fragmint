// packages/cli/src/client.ts
export class FragmintClient {
  constructor(
    private baseUrl: string,
    private token?: string,
  ) {}

  async uploadTemplate(docxPath: string, yamlPath: string, collectionSlug?: string): Promise<unknown> {
    const { readFileSync } = await import('node:fs');
    const { basename } = await import('node:path');

    const form = new FormData();
    const docxBuf = readFileSync(docxPath);
    const yamlBuf = readFileSync(yamlPath);

    form.append('docx', new Blob([docxBuf]), basename(docxPath));
    form.append('yaml', new Blob([yamlBuf]), basename(yamlPath));

    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const prefix = collectionSlug ? `/v1/collections/${collectionSlug}` : '/v1';
    const res = await fetch(`${this.baseUrl}${prefix}/templates`, {
      method: 'POST',
      headers,
      body: form,
    });

    const json = await res.json() as { data: unknown; error: string | null };
    if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json.data;
  }

  async download(path: string): Promise<Buffer> {
    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const res = await fetch(`${this.baseUrl}${path}`, { headers });
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async uploadHarvest(filePath: string, minConfidence: number, collectionSlug?: string): Promise<{ job_id: string; status: string }> {
    const { readFileSync } = await import('node:fs');
    const { basename } = await import('node:path');
    const form = new FormData();
    form.append('files', new Blob([readFileSync(filePath)]), basename(filePath));
    form.append('options', JSON.stringify({ min_confidence: minConfidence }));

    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const prefix = collectionSlug ? `/v1/collections/${collectionSlug}` : '/v1';
    const res = await fetch(`${this.baseUrl}${prefix}/harvest`, { method: 'POST', headers, body: form });
    const json = await res.json() as { data: any; error: string | null };
    if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json.data;
  }

  collectionRequest<T>(method: string, path: string, collectionSlug?: string, body?: unknown): Promise<T> {
    const prefix = collectionSlug ? `/v1/collections/${collectionSlug}` : '/v1';
    return this.request<T>(method, `${prefix}${path}`, body);
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = await res.json() as { data: T; error: string | null };
    if (!res.ok || json.error) {
      throw new Error(json.error ?? `HTTP ${res.status}`);
    }
    return json.data;
  }
}
