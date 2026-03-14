import type { ApiResponse } from './types';

let authToken: string | null = null;

export function setToken(token: string | null) {
  authToken = token;
}

export function getToken(): string | null {
  return authToken;
}

export async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  // Always send Content-Type + body for POST/PUT/PATCH to avoid Fastify empty body errors
  const hasBody = method !== 'GET' && method !== 'DELETE';
  if (hasBody) headers['Content-Type'] = 'application/json';

  const res = await fetch(path, {
    method,
    headers,
    body: hasBody ? JSON.stringify(body ?? {}) : undefined,
  });

  if (res.status === 401) {
    setToken(null);
    window.location.href = '/ui/login';
    throw new Error('Session expired');
  }

  const json = (await res.json()) as ApiResponse<T>;
  if (!res.ok || json.error) {
    throw new Error(json.error ?? `HTTP ${res.status}`);
  }

  return json.data as T;
}

export async function downloadBlob(path: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const res = await fetch(path, { headers });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return res.blob();
}
