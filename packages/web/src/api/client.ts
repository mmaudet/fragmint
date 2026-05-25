import type { ApiResponse } from './types';

const TOKEN_STORAGE_KEY = 'fragmint.auth.token';

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

let authToken: string | null = readStoredToken();

export function setToken(token: string | null) {
  authToken = token;
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // localStorage unavailable (private mode, SSR) — token stays in memory only
  }
}

export function getToken(): string | null {
  return authToken;
}

export async function apiRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
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

  // 204 No Content or empty body → return null without parsing
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return null as T;
  }

  let json: ApiResponse<T>;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new Error(`HTTP ${res.status}: réponse invalide du serveur`);
  }
  if (!res.ok || json.error) {
    throw new Error(json.error ?? `HTTP ${res.status}`);
  }

  return json.data as T;
}

export async function apiRequestFull<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ data: T; meta: Record<string, unknown> }> {
  const headers: Record<string, string> = {};
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
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
  if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
  return { data: json.data as T, meta: (json.meta ?? {}) as Record<string, unknown> };
}

export function collectionApiUrl(slug: string, path: string): string {
  return `/v1/collections/${slug}${path}`;
}

export async function downloadBlob(path: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const res = await fetch(path, { headers });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return res.blob();
}
