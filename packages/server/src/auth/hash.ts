// packages/server/src/auth/hash.ts
import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const SCRYPT_KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, key] = hash.split(':');
  const derived = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return timingSafeEqual(Buffer.from(key, 'hex'), derived);
}

export function hashTokenSha256(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function hashTokenScrypt(token: string): Promise<string> {
  return hashPassword(token);
}

export async function verifyTokenScrypt(token: string, hash: string): Promise<boolean> {
  return verifyPassword(token, hash);
}
