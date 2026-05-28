import { sqliteTable, text, integer, real, primaryKey, index } from 'drizzle-orm/sqlite-core';

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
  collection_slug: text('collection_slug'),
  git_hash: text('git_hash'),
  origin: text('origin').notNull().default('manual'),
  origin_source: text('origin_source'),
  origin_page: integer('origin_page'),
  harvest_confidence: real('harvest_confidence'),
  valid_from: text('valid_from'),
  valid_until: text('valid_until'),
  function_type: text('function_type'),
  audience: text('audience'),
  maturity: text('maturity'),
  superseded_by: text('superseded_by'),
  supersedes: text('supersedes'),
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
  entity_type: text('entity_type'),
  entity_id: text('entity_id'),
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
  yaml_path: text('yaml_path').notNull().default(''),
  author: text('author').notNull(),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
  git_hash: text('git_hash'),
  kind: text('kind').notNull().default('composer'),
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
  type: text('type').notNull(), // 'system' | 'team' | 'personal'
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
  collection_slug: text('collection_slug'),
  stats: text('stats'),
  error: text('error'),
  created_by: text('created_by').notNull(),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
  upload_hints: text('upload_hints'),
  // Set when all candidates have been processed (accepted/rejected/merged).
  // Allows safe cleanup: DELETE FROM harvest_jobs WHERE validated_at IS NOT NULL
  validated_at: text('validated_at'),
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
  duplicate_method: text('duplicate_method'),     // 'hash' | 'shingles' | 'cosine'
  status: text('status').notNull().default('pending'),
  fragment_id: text('fragment_id'),
  function_type: text('function_type'),
  audience: text('audience'),
  maturity: text('maturity'),
  entities_json: text('entities_json'),
  new_proposals: text('new_proposals'),
  metadata_status: text('metadata_status'),
  trust_sources_json: text('trust_sources_json'),
  quality_signals: text('quality_signals'), // JSON: CoherenceFlag[]
  judge_result: text('judge_result'), // JSON: JudgeResult | null
});

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  status: text('status').notNull().default('pending'),
  total: integer('total').notNull(),
  done: integer('done').notNull().default(0),
  error_count: integer('error_count').notNull().default(0),
  created_by: text('created_by').notNull(),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});

export const plans = sqliteTable('plans', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  owner: text('owner').notNull(),
  collection_slug: text('collection_slug'),
  status: text('status').notNull(),
  state_json: text('state_json').notNull(),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});

export const planFragmentUsages = sqliteTable('plan_fragment_usages', {
  id: text('id').primaryKey(),
  plan_id: text('plan_id').notNull(),
  section_id: text('section_id').notNull(),
  fragment_id: text('fragment_id').notNull(),
  used_at: text('used_at').notNull(),
});

export const fragmentTypes = sqliteTable('fragment_types', {
  slug: text('slug').primaryKey(),
  label: text('label').notNull(),
  description: text('description'),
  created_at: text('created_at').notNull(),
  validated: integer('validated').notNull().default(1),
  usageCount: integer('usage_count').notNull().default(0),
  proposedBy: text('proposed_by').notNull().default('admin'),
  trustSource: text('trust_source').notNull().default('human-direct'),
  status: text('status')
    .notNull()
    .default('active')
    .$type<'pending' | 'active' | 'rejected' | 'archived'>(),
});

export const fragmentDomains = sqliteTable('fragment_domains', {
  slug: text('slug').primaryKey(),
  label: text('label').notNull(),
  description: text('description'),
  created_at: text('created_at').notNull(),
  validated: integer('validated').notNull().default(1),
  usageCount: integer('usage_count').notNull().default(0),
  proposedBy: text('proposed_by').notNull().default('admin'),
  trustSource: text('trust_source').notNull().default('human-direct'),
  status: text('status')
    .notNull()
    .default('active')
    .$type<'pending' | 'active' | 'rejected' | 'archived'>(),
});

export const fragmentTags = sqliteTable('fragment_tags', {
  slug: text('slug').primaryKey(),
  label: text('label').notNull(),
  category: text('category'),
  created_at: text('created_at').notNull(),
  validated: integer('validated').notNull().default(1),
  proposedBy: text('proposed_by').notNull().default('admin'),
  trustSource: text('trust_source').notNull().default('human-direct'),
  status: text('status')
    .notNull()
    .default('active')
    .$type<'pending' | 'active' | 'rejected' | 'archived'>(),
});

export const fragmentTagLinks = sqliteTable(
  'fragment_tag_links',
  {
    fragment_id: text('fragment_id').notNull(),
    tag_slug: text('tag_slug').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.fragment_id, t.tag_slug] }),
    index('idx_ftl_tag_slug').on(t.tag_slug),
  ],
);

export const fragmentFunctions = sqliteTable('fragment_functions', {
  slug: text('slug').primaryKey(),
  label: text('label').notNull(),
  description: text('description'),
  validated: integer('validated').notNull().default(1),
  usageCount: integer('usage_count').notNull().default(0),
  proposedBy: text('proposed_by').notNull().default('admin'),
  createdAt: text('created_at').notNull(),
  trustSource: text('trust_source').notNull().default('human-direct'),
  status: text('status')
    .notNull()
    .default('active')
    .$type<'pending' | 'active' | 'rejected' | 'archived'>(),
});

export const entities = sqliteTable('entities', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  name: text('name').notNull(),
  canonicalName: text('canonical_name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  aliases: text('aliases'),
  validated: integer('validated').notNull().default(0),
  usageCount: integer('usage_count').notNull().default(0),
  proposedBy: text('proposed_by').notNull().default('admin'),
  createdAt: text('created_at').notNull(),
  trustSource: text('trust_source').notNull().default('human-direct'),
  status: text('status')
    .notNull()
    .default('active')
    .$type<'pending' | 'active' | 'rejected' | 'archived'>(),
});

export const referentialRenames = sqliteTable('referential_renames', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  table_name: text('table_name').notNull(),
  old_value: text('old_value').notNull(),
  new_value: text('new_value').notNull(),
  affected_fragments: integer('affected_fragments').notNull().default(0),
  renamed_by: text('renamed_by').notNull(),
  renamed_at: text('renamed_at').notNull(),
  recalculation_job_id: text('recalculation_job_id'),
});

export const fragmentEntities = sqliteTable(
  'fragment_entities',
  {
    fragment_id: text('fragment_id').notNull(),
    entity_id: integer('entity_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.fragment_id, t.entity_id] })],
);

export const supersedureProposals = sqliteTable('supersedure_proposals', {
  id: text('id').primaryKey(),
  newFragmentId: text('new_fragment_id').notNull(),
  oldFragmentId: text('old_fragment_id').notNull(),
  similarityScore: real('similarity_score').notNull(),
  llmJudgment: text('llm_judgment').notNull(),
  llmConfidence: real('llm_confidence').notNull(),
  llmReasoning: text('llm_reasoning'),
  elementsLostInNew: text('elements_lost_in_new'),
  status: text('status').notNull().default('pending'),
  resolvedBy: text('resolved_by'),
  resolvedAt: text('resolved_at'),
  createdAt: text('created_at').notNull(),
});
