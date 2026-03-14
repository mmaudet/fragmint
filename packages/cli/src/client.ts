// packages/cli/src/client.ts
export class FragmintClient {
  constructor(
    private baseUrl: string,
    private token?: string,
  ) {}

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
