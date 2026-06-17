/**
 * Local SQLite cache for the Fragmint MCP server.
 *
 * Eliminates repeated round-trips to the backend API during a demo session.
 * All read tools check the cache first; write tools invalidate affected entries.
 *
 * Database: ~/.fragmint/cache.db
 * Schema: single `cache` table with key, JSON value, expiry timestamp, access counter.
 */
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface CacheStats {
  totalEntries: number;
  expiredEntries: number;
  hits: number;
  misses: number;
  invalidations: number;
  hitRate: string;
}

/** TTL presets in seconds. */
export const TTL = {
  INDEX: 300,       // 5 min — index changes when fragments are approved/edited
  FRAGMENT: 1800,   // 30 min — individual fragments rarely change mid-session
  SEARCH: 300,      // 5 min — search results shift as corpus evolves
  INVENTORY: 300,   // 5 min — inventory stats follow fragment changes
  LINEAGE: 1800,    // 30 min
  REFERENCES: 3600, // 1 hour — subjects/entities/tags change very rarely
  COLLECTIONS: 3600, // 1 hour — collection list changes rarely
} as const;

export class CacheManager {
  private db: Database.Database;
  private hits = 0;
  private misses = 0;
  private invalidations = 0;

  constructor(dbPath?: string) {
    const dir = dbPath ? join(dbPath, '..') : join(homedir(), '.fragmint');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = dbPath ?? join(dir, 'cache.db');
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        key       TEXT PRIMARY KEY,
        value     TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache(expires_at);
    `);
  }

  /** Returns cached value if present and not expired, or null on miss. */
  get(key: string): string | null {
    const now = Date.now();
    const row = this.db
      .prepare('SELECT value FROM cache WHERE key = ? AND expires_at > ?')
      .get(key, now) as { value: string } | undefined;

    if (row) {
      this.db.prepare('UPDATE cache SET access_count = access_count + 1 WHERE key = ?').run(key);
      this.hits++;
      return row.value;
    }
    this.misses++;
    return null;
  }

  /** Stores a value with a TTL (in seconds). */
  set(key: string, value: unknown, ttlSeconds: number): void {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    this.db
      .prepare(
        'INSERT OR REPLACE INTO cache (key, value, expires_at, access_count) VALUES (?, ?, ?, 0)',
      )
      .run(key, serialized, expiresAt);
  }

  /**
   * Invalidates all keys where key LIKE `pattern` (SQLite LIKE syntax, % is wildcard).
   * Returns the number of entries removed.
   */
  invalidate(pattern: string): number {
    const result = this.db.prepare('DELETE FROM cache WHERE key LIKE ?').run(pattern);
    this.invalidations += result.changes;
    return result.changes;
  }

  /** Removes all expired entries. Returns count purged. */
  purgeExpired(): number {
    const result = this.db.prepare('DELETE FROM cache WHERE expires_at <= ?').run(Date.now());
    return result.changes;
  }

  /** Removes all entries (optionally matching pattern). */
  clear(pattern?: string): number {
    const result = pattern
      ? this.db.prepare('DELETE FROM cache WHERE key LIKE ?').run(pattern)
      : this.db.prepare('DELETE FROM cache').run();
    return result.changes;
  }

  stats(): CacheStats {
    const total = (
      this.db.prepare('SELECT COUNT(*) as n FROM cache').get() as { n: number }
    ).n;
    const expired = (
      this.db
        .prepare('SELECT COUNT(*) as n FROM cache WHERE expires_at <= ?')
        .get(Date.now()) as { n: number }
    ).n;
    const total_calls = this.hits + this.misses;
    return {
      totalEntries: total,
      expiredEntries: expired,
      hits: this.hits,
      misses: this.misses,
      invalidations: this.invalidations,
      hitRate: total_calls > 0 ? `${Math.round((this.hits / total_calls) * 100)}%` : 'n/a',
    };
  }

  close(): void {
    this.db.close();
  }
}

/** Stable hash for cache keys derived from arbitrary query parameters. */
export function hashKey(obj: unknown): string {
  return createHash('md5').update(JSON.stringify(obj)).digest('hex').slice(0, 12);
}

/** Singleton cache instance shared across all MCP tools. */
export const cache = new CacheManager();
