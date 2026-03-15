import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const fragments = sqliteTable('fragments', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  domain: text('domain').notNull(),
  lang: text('lang').notNull(),
  quality: text('quality').notNull().default('draft'),
  author: text('author').notNull(),
  title: text('title'),
  body_excerpt: text('body_excerpt'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
  uses: integer('uses').notNull().default(0),
  parent_id: text('parent_id'),
  translation_of: text('translation_of'),
  tags: text('tags'),
  file_path: text('file_path').notNull(),
  git_hash: text('git_hash'),
  origin: text('origin').notNull().default('manual'),
  origin_source: text('origin_source'),
  origin_page: integer('origin_page'),
  harvest_confidence: real('harvest_confidence'),
});

export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timestamp: text('timestamp').notNull(),
  user_id: text('user_id').notNull(),
  role: text('role').notNull(),
  action: text('action').notNull(),
  fragment_id: text('fragment_id'),
  diff_summary: text('diff_summary'),
  ip_source: text('ip_source'),
});

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  login: text('login').notNull().unique(),
  display_name: text('display_name').notNull(),
  role: text('role').notNull(),
  password_hash: text('password_hash').notNull(),
  created_at: text('created_at').notNull(),
  last_login: text('last_login'),
  active: integer('active').notNull().default(1),
});

export const templates = sqliteTable('templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  output_format: text('output_format').notNull(),
  version: text('version').notNull(),
  template_path: text('template_path').notNull(),
  yaml_path: text('yaml_path').notNull(),
  author: text('author').notNull(),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
  git_hash: text('git_hash'),
});

export const apiTokens = sqliteTable('api_tokens', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  token_hash: text('token_hash').notNull(),
  token_lookup: text('token_lookup').notNull(),
  role: text('role').notNull(),
  owner: text('owner').notNull(),
  created_at: text('created_at').notNull(),
  last_used: text('last_used'),
  active: integer('active').notNull().default(1),
  collection_slug: text('collection_slug'),
});

export const collections = sqliteTable('collections', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  type: text('type').notNull(),              // 'system' | 'team' | 'personal'
  read_only: integer('read_only').notNull().default(0),
  auto_assign: integer('auto_assign').notNull().default(0),
  git_path: text('git_path').notNull(),
  milvus_partition: text('milvus_partition').notNull(),
  owner_id: text('owner_id'),
  description: text('description'),
  tags: text('tags'),
  created_at: text('created_at').notNull(),
  created_by: text('created_by').notNull(),
});

export const collectionMemberships = sqliteTable('collection_memberships', {
  id: text('id').primaryKey(),
  collection_id: text('collection_id').notNull(),
  user_id: text('user_id'),
  token_id: text('token_id'),
  role: text('role').notNull(),
  granted_by: text('granted_by').notNull(),
  granted_at: text('granted_at').notNull(),
  expires_at: text('expires_at'),
});

export function toMilvusPartition(slug: string): string {
  return 'col_' + slug.replace(/-/g, '_');
}

export const harvestJobs = sqliteTable('harvest_jobs', {
  id: text('id').primaryKey(),
  status: text('status').notNull(),
  files: text('files').notNull(),
  pipeline: text('pipeline').notNull(),
  min_confidence: real('min_confidence').notNull(),
  stats: text('stats'),
  error: text('error'),
  created_by: text('created_by').notNull(),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});

export const harvestCandidates = sqliteTable('harvest_candidates', {
  id: text('id').primaryKey(),
  job_id: text('job_id').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  type: text('type').notNull(),
  domain: text('domain').notNull(),
  lang: text('lang').notNull(),
  tags: text('tags'),
  confidence: real('confidence').notNull(),
  origin_source: text('origin_source').notNull(),
  origin_page: integer('origin_page'),
  duplicate_of: text('duplicate_of'),
  duplicate_score: real('duplicate_score'),
  status: text('status').notNull().default('pending'),
  fragment_id: text('fragment_id'),
});
