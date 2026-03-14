// packages/server/src/auth/hash.test.ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, hashTokenScrypt, verifyTokenScrypt, hashTokenSha256 } from './hash.js';

describe('password hashing', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('my-secret');
    expect(hash).not.toBe('my-secret');
    expect(await verifyPassword('my-secret', hash)).toBe(true);
  });

  it('rejects wrong password', async () => {
    const hash = await hashPassword('my-secret');
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
});

describe('token hashing', () => {
  it('SHA-256 is deterministic', () => {
    const h1 = hashTokenSha256('frag_tok_abc123');
    const h2 = hashTokenSha256('frag_tok_abc123');
    expect(h1).toBe(h2);
  });

  it('scrypt hashes and verifies a token', async () => {
    const hash = await hashTokenScrypt('frag_tok_abc123');
    expect(await verifyTokenScrypt('frag_tok_abc123', hash)).toBe(true);
  });

  it('rejects wrong token with scrypt', async () => {
    const hash = await hashTokenScrypt('frag_tok_abc123');
    expect(await verifyTokenScrypt('frag_tok_wrong', hash)).toBe(false);
  });
});
