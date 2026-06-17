// packages/mcp/src/cache/cache-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { CacheManager, hashKey } from './cache-manager.js';

let tmpDir: string;
let cache: CacheManager;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'fragmint-cache-test-'));
  cache = new CacheManager(join(tmpDir, 'cache.db'));
});

afterEach(() => {
  cache.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('CacheManager.get / set', () => {
  it('returns null on cache miss', () => {
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('returns stored value on hit', () => {
    cache.set('k1', { foo: 'bar' }, 60);
    const result = cache.get('k1');
    expect(result).not.toBeNull();
    expect(JSON.parse(result!)).toEqual({ foo: 'bar' });
  });

  it('stores raw string without double-encoding', () => {
    cache.set('k2', 'hello world', 60);
    expect(cache.get('k2')).toBe('hello world');
  });

  it('returns null for expired entry', async () => {
    cache.set('k3', 'value', 0.001); // 1ms TTL
    await new Promise((r) => setTimeout(r, 10));
    expect(cache.get('k3')).toBeNull();
  });
});

describe('CacheManager.invalidate', () => {
  it('removes entries matching LIKE pattern', () => {
    cache.set('search:common:abc', 'r1', 60);
    cache.set('search:common:def', 'r2', 60);
    cache.set('frag:common:xyz', 'r3', 60);

    const removed = cache.invalidate('search:common:%');
    expect(removed).toBe(2);
    expect(cache.get('search:common:abc')).toBeNull();
    expect(cache.get('search:common:def')).toBeNull();
    // frag entry should be untouched
    expect(cache.get('frag:common:xyz')).toBe('r3');
  });

  it('returns 0 when no keys match', () => {
    expect(cache.invalidate('nope:%')).toBe(0);
  });
});

describe('CacheManager.purgeExpired', () => {
  it('removes only expired entries', async () => {
    cache.set('live', 'ok', 60);
    cache.set('dead', 'stale', 0.001);
    await new Promise((r) => setTimeout(r, 10));

    const purged = cache.purgeExpired();
    expect(purged).toBe(1);
    expect(cache.get('live')).not.toBeNull();
  });
});

describe('CacheManager.clear', () => {
  it('removes all entries when called without pattern', () => {
    cache.set('a', '1', 60);
    cache.set('b', '2', 60);
    const removed = cache.clear();
    expect(removed).toBe(2);
    expect(cache.get('a')).toBeNull();
  });

  it('removes only matching entries when pattern provided', () => {
    cache.set('ref:subjects', 's', 60);
    cache.set('ref:tags', 't', 60);
    cache.set('collections', 'c', 60);

    const removed = cache.clear('ref:%');
    expect(removed).toBe(2);
    expect(cache.get('collections')).not.toBeNull();
  });
});

describe('CacheManager.stats', () => {
  it('tracks hits and misses', () => {
    cache.set('x', 'val', 60);
    cache.get('x');       // hit
    cache.get('missing'); // miss

    const s = cache.stats();
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(1);
    expect(s.hitRate).toBe('50%');
  });

  it('returns n/a hit rate before any accesses', () => {
    expect(cache.stats().hitRate).toBe('n/a');
  });

  it('counts expired entries correctly', async () => {
    cache.set('expired', 'v', 0.001);
    await new Promise((r) => setTimeout(r, 10));
    cache.set('live', 'v', 60);

    const s = cache.stats();
    expect(s.expiredEntries).toBe(1);
    expect(s.totalEntries).toBe(2);
  });
});

describe('hashKey', () => {
  it('produces a 12-char hex string', () => {
    const h = hashKey({ query: 'test', lang: 'fr' });
    expect(h).toMatch(/^[0-9a-f]{12}$/);
  });

  it('is stable for the same input', () => {
    const a = hashKey({ a: 1, b: 2 });
    const b = hashKey({ a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it('differs for different inputs', () => {
    expect(hashKey({ a: 1 })).not.toBe(hashKey({ a: 2 }));
  });
});
