// packages/mcp/src/client.ts

export class FragmintApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  async postMultipart<T>(path: string, form: FormData): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.token}` },
      body: form,
    });

    const json = await res.json() as { data: T; meta: unknown; error: string | null };
    if (!res.ok || json.error) {
      throw new Error(json.error ?? `HTTP ${res.status}`);
    }
    return json.data;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.token}`,
    };

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = await res.json() as { data: T; meta: unknown; error: string | null };
    if (!res.ok || json.error) {
      throw new Error(json.error ?? `HTTP ${res.status}`);
    }
    return json.data;
  }
}
