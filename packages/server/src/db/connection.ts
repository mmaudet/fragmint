import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export type FragmintDb = ReturnType<typeof createDb>;

export function createDb(path: string | ':memory:') {
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // Create tables on the same connection (critical for :memory: mode)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS fragments (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, domain TEXT NOT NULL,
      lang TEXT NOT NULL, quality TEXT NOT NULL DEFAULT 'draft',
      author TEXT NOT NULL, title TEXT, body_excerpt TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      uses INTEGER NOT NULL DEFAULT 0, parent_id TEXT,
      translation_of TEXT, tags TEXT, file_path TEXT NOT NULL,
      git_hash TEXT, origin TEXT NOT NULL DEFAULT 'manual',
      origin_source TEXT, origin_page INTEGER, harvest_confidence REAL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL,
      user_id TEXT NOT NULL, role TEXT NOT NULL, action TEXT NOT NULL,
      fragment_id TEXT, diff_summary TEXT, ip_source TEXT
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, login TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL, role TEXT NOT NULL,
      password_hash TEXT NOT NULL, created_at TEXT NOT NULL,
      last_login TEXT, active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL,
      token_lookup TEXT NOT NULL, role TEXT NOT NULL, owner TEXT NOT NULL,
      created_at TEXT NOT NULL, last_used TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
      output_format TEXT NOT NULL, version TEXT NOT NULL,
      template_path TEXT NOT NULL, yaml_path TEXT NOT NULL,
      author TEXT NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, git_hash TEXT
    );
    CREATE TABLE IF NOT EXISTS harvest_jobs (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, files TEXT NOT NULL,
      pipeline TEXT NOT NULL, min_confidence REAL NOT NULL,
      stats TEXT, error TEXT, created_by TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS harvest_candidates (
      id TEXT PRIMARY KEY, job_id TEXT NOT NULL, title TEXT NOT NULL,
      body TEXT NOT NULL, type TEXT NOT NULL, domain TEXT NOT NULL,
      lang TEXT NOT NULL, tags TEXT, confidence REAL NOT NULL,
      origin_source TEXT NOT NULL, origin_page INTEGER,
      duplicate_of TEXT, duplicate_score REAL,
      status TEXT NOT NULL DEFAULT 'pending', fragment_id TEXT
    );
  `);

  const db = drizzle(sqlite, { schema });
  return db;
}
