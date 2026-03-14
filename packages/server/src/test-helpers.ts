import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from './index.js';

export async function createTestServer() {
  const dir = mkdtempSync(join(tmpdir(), 'fragmint-test-'));
  const fragmentsDir = join(dir, 'fragments');
  mkdirSync(fragmentsDir, { recursive: true });

  // Set store_path via env before creating server
  const origStorePath = process.env.FRAGMINT_STORE_PATH;
  process.env.FRAGMINT_STORE_PATH = dir;

  const server = await createServer({ dev: true, dbPath: ':memory:' });

  // Restore env
  if (origStorePath) process.env.FRAGMINT_STORE_PATH = origStorePath;
  else delete process.env.FRAGMINT_STORE_PATH;

  return server;
}

export async function getAuthToken(app: any): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { username: 'mmaudet', password: 'fragmint-dev' },
  });
  const body = JSON.parse(res.body);
  return body.data.token;
}
