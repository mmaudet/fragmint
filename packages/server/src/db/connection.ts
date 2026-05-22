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
    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL, type TEXT NOT NULL,
      read_only INTEGER NOT NULL DEFAULT 0,
      auto_assign INTEGER NOT NULL DEFAULT 0,
      git_path TEXT NOT NULL, milvus_partition TEXT NOT NULL,
      owner_id TEXT, description TEXT, tags TEXT,
      created_at TEXT NOT NULL, created_by TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS collection_memberships (
      id TEXT PRIMARY KEY, collection_id TEXT NOT NULL,
      user_id TEXT, token_id TEXT, role TEXT NOT NULL,
      granted_by TEXT NOT NULL, granted_at TEXT NOT NULL,
      expires_at TEXT
    );
    CREATE TABLE IF NOT EXISTS harvest_candidates (
      id TEXT PRIMARY KEY, job_id TEXT NOT NULL, title TEXT NOT NULL,
      body TEXT NOT NULL, type TEXT NOT NULL, domain TEXT NOT NULL,
      lang TEXT NOT NULL, tags TEXT, confidence REAL NOT NULL,
      origin_source TEXT NOT NULL, origin_page INTEGER,
      duplicate_of TEXT, duplicate_score REAL,
      status TEXT NOT NULL DEFAULT 'pending', fragment_id TEXT
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      total INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      owner TEXT NOT NULL,
      collection_slug TEXT,
      status TEXT NOT NULL,
      state_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS plans_owner_idx ON plans(owner);
    CREATE INDEX IF NOT EXISTS plans_collection_idx ON plans(collection_slug);
    CREATE TABLE IF NOT EXISTS plan_fragment_usages (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      section_id TEXT NOT NULL,
      fragment_id TEXT NOT NULL,
      used_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS pfu_plan_idx ON plan_fragment_usages(plan_id);
    CREATE INDEX IF NOT EXISTS pfu_fragment_idx ON plan_fragment_usages(fragment_id);
    CREATE TABLE IF NOT EXISTS fragment_types (
      slug TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fragment_domains (
      slug TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fragment_tags (
      slug TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      category TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fragment_functions (
      slug TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      description TEXT,
      validated INTEGER NOT NULL DEFAULT 1,
      usage_count INTEGER NOT NULL DEFAULT 0,
      proposed_by TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('client','product','technology','partner','certification','regulation','metric')),
      name TEXT NOT NULL,
      canonical_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      aliases TEXT,
      validated INTEGER NOT NULL DEFAULT 0,
      usage_count INTEGER NOT NULL DEFAULT 0,
      proposed_by TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL,
      UNIQUE(type, normalized_name)
    );
    CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type, validated);
    CREATE TABLE IF NOT EXISTS fragment_entities (
      fragment_id TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      PRIMARY KEY (fragment_id, entity_id),
      FOREIGN KEY (fragment_id) REFERENCES fragments(id) ON DELETE CASCADE,
      FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
    );
  `);

  // Add collection_slug to api_tokens if not already present
  try {
    sqlite.exec('ALTER TABLE api_tokens ADD COLUMN collection_slug TEXT');
  } catch (_) {
    // Column already exists — ignore
  }

  // Add collection_slug to fragments if not already present
  try {
    sqlite.exec('ALTER TABLE fragments ADD COLUMN collection_slug TEXT');
  } catch (_) {
    // Column already exists — ignore
  }

  // Add valid_from / valid_until to fragments if not already present
  try {
    sqlite.exec('ALTER TABLE fragments ADD COLUMN valid_from TEXT');
  } catch (_) {
    // Column already exists — ignore
  }
  try {
    sqlite.exec('ALTER TABLE fragments ADD COLUMN valid_until TEXT');
  } catch (_) {
    // Column already exists — ignore
  }

  try {
    sqlite.exec("ALTER TABLE templates ADD COLUMN kind TEXT NOT NULL DEFAULT 'composer'");
  } catch (_) {
    // Column already exists — ignore
  }
  try {
    sqlite.exec('CREATE INDEX IF NOT EXISTS templates_kind_idx ON templates(kind)');
  } catch (_) {
    // Index already exists — ignore
  }

  // Enrich fragment_types with validation columns
  try {
    sqlite.exec('ALTER TABLE fragment_types ADD COLUMN validated INTEGER NOT NULL DEFAULT 1');
  } catch (_) {}
  try {
    sqlite.exec('ALTER TABLE fragment_types ADD COLUMN usage_count INTEGER NOT NULL DEFAULT 0');
  } catch (_) {}
  try {
    sqlite.exec("ALTER TABLE fragment_types ADD COLUMN proposed_by TEXT NOT NULL DEFAULT 'admin'");
  } catch (_) {}

  // Enrich fragment_domains
  try {
    sqlite.exec('ALTER TABLE fragment_domains ADD COLUMN validated INTEGER NOT NULL DEFAULT 1');
  } catch (_) {}
  try {
    sqlite.exec('ALTER TABLE fragment_domains ADD COLUMN usage_count INTEGER NOT NULL DEFAULT 0');
  } catch (_) {}
  try {
    sqlite.exec(
      "ALTER TABLE fragment_domains ADD COLUMN proposed_by TEXT NOT NULL DEFAULT 'admin'",
    );
  } catch (_) {}

  // Enrich fragment_tags
  try {
    sqlite.exec('ALTER TABLE fragment_tags ADD COLUMN validated INTEGER NOT NULL DEFAULT 1');
  } catch (_) {}
  try {
    sqlite.exec('ALTER TABLE fragment_tags ADD COLUMN usage_count INTEGER NOT NULL DEFAULT 0');
  } catch (_) {}
  try {
    sqlite.exec("ALTER TABLE fragment_tags ADD COLUMN proposed_by TEXT NOT NULL DEFAULT 'admin'");
  } catch (_) {}

  // New columns on fragments
  try {
    sqlite.exec('ALTER TABLE fragments ADD COLUMN function_type TEXT');
  } catch (_) {}
  try {
    sqlite.exec('ALTER TABLE fragments ADD COLUMN audience TEXT');
  } catch (_) {}
  try {
    sqlite.exec('ALTER TABLE fragments ADD COLUMN maturity TEXT');
  } catch (_) {}

  // New columns on harvest_candidates
  try {
    sqlite.exec('ALTER TABLE harvest_candidates ADD COLUMN function_type TEXT');
  } catch (_) {}
  try {
    sqlite.exec('ALTER TABLE harvest_candidates ADD COLUMN audience TEXT');
  } catch (_) {}
  try {
    sqlite.exec('ALTER TABLE harvest_candidates ADD COLUMN maturity TEXT');
  } catch (_) {}
  try {
    sqlite.exec('ALTER TABLE harvest_candidates ADD COLUMN entities_json TEXT');
  } catch (_) {}
  try {
    sqlite.exec('ALTER TABLE harvest_candidates ADD COLUMN new_proposals TEXT');
  } catch (_) {}
  try {
    sqlite.exec('ALTER TABLE harvest_candidates ADD COLUMN metadata_status TEXT');
  } catch (_) {}

  // Trust by Source — referential tables
  try {
    sqlite.exec(
      "ALTER TABLE fragment_types ADD COLUMN trust_source TEXT NOT NULL DEFAULT 'human-direct'",
    );
  } catch (_) {}
  try {
    sqlite.exec(
      "ALTER TABLE fragment_domains ADD COLUMN trust_source TEXT NOT NULL DEFAULT 'human-direct'",
    );
  } catch (_) {}
  try {
    sqlite.exec(
      "ALTER TABLE fragment_tags ADD COLUMN trust_source TEXT NOT NULL DEFAULT 'human-direct'",
    );
  } catch (_) {}
  try {
    sqlite.exec(
      "ALTER TABLE fragment_functions ADD COLUMN trust_source TEXT NOT NULL DEFAULT 'human-direct'",
    );
  } catch (_) {}
  try {
    sqlite.exec(
      "ALTER TABLE entities ADD COLUMN trust_source TEXT NOT NULL DEFAULT 'human-direct'",
    );
  } catch (_) {}

  // Trust by Source — harvest_candidates
  try {
    sqlite.exec('ALTER TABLE harvest_candidates ADD COLUMN trust_sources_json TEXT');
  } catch (_) {}

  // Quality signals — harvest_candidates
  try {
    sqlite.exec('ALTER TABLE harvest_candidates ADD COLUMN quality_signals TEXT');
  } catch (_) {}

  // LLM-as-judge result — harvest_candidates
  try {
    sqlite.exec('ALTER TABLE harvest_candidates ADD COLUMN judge_result TEXT');
  } catch (_) {}

  // Trust by Source — harvest_jobs (upload hints)
  try {
    sqlite.exec('ALTER TABLE harvest_jobs ADD COLUMN upload_hints TEXT');
  } catch (_) {}

  // Audit log enrichment
  try {
    sqlite.exec('ALTER TABLE audit_log ADD COLUMN entity_type TEXT');
  } catch (_) {}
  try {
    sqlite.exec('ALTER TABLE audit_log ADD COLUMN entity_id TEXT');
  } catch (_) {}

  // Supersedure links on fragments
  try {
    sqlite.exec('ALTER TABLE fragments ADD COLUMN superseded_by TEXT');
  } catch (_) {}
  try {
    sqlite.exec('ALTER TABLE fragments ADD COLUMN supersedes TEXT');
  } catch (_) {}

  // Supersedure proposals table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS supersedure_proposals (
      id TEXT PRIMARY KEY,
      new_fragment_id TEXT NOT NULL,
      old_fragment_id TEXT NOT NULL,
      similarity_score REAL NOT NULL,
      llm_judgment TEXT NOT NULL,
      llm_confidence REAL NOT NULL,
      llm_reasoning TEXT,
      elements_lost_in_new TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      resolved_by TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sp_new_fragment_idx ON supersedure_proposals(new_fragment_id);
    CREATE INDEX IF NOT EXISTS sp_status_idx ON supersedure_proposals(status);
  `);

  const db = drizzle(sqlite, { schema });
  return db;
}
