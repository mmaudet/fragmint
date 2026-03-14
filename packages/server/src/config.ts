// packages/server/src/config.ts
import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import yaml from 'js-yaml';

export interface FragmintConfig {
  port: number;
  store_path: string;
  jwt_secret: string;
  jwt_ttl: string;
  log_level: string;
  trust_proxy: boolean;
  dev: boolean;

  // Embedding
  embedding_endpoint: string;
  embedding_model: string;
  embedding_dimensions: number;
  embedding_batch_size: number;
  embedding_max_tokens: number;
  embedding_prefix_document: string;
  embedding_prefix_query: string;
  embedding_prefix_cluster: string;

  // CORS
  cors_origin: string[];

  // Milvus
  milvus_address: string;
  milvus_collection: string;
  milvus_enabled: boolean;
}

export function loadConfig(configPath?: string, dev = false): FragmintConfig {
  let fileConfig: Partial<FragmintConfig> = {};

  if (configPath && existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf-8');
    fileConfig = yaml.load(raw) as Partial<FragmintConfig>;
  }

  return {
    port: toNumber(process.env.FRAGMINT_PORT) ?? fileConfig.port ?? 3210,
    store_path: process.env.FRAGMINT_STORE_PATH ?? fileConfig.store_path ?? './example-vault',
    jwt_secret: process.env.FRAGMINT_JWT_SECRET ?? fileConfig.jwt_secret ?? randomBytes(32).toString('hex'),
    jwt_ttl: process.env.FRAGMINT_JWT_TTL ?? fileConfig.jwt_ttl ?? '8h',
    log_level: process.env.FRAGMINT_LOG_LEVEL ?? fileConfig.log_level ?? 'info',
    trust_proxy: process.env.FRAGMINT_TRUST_PROXY === 'true' || fileConfig.trust_proxy === true,
    dev,
    embedding_endpoint: process.env.FRAGMINT_EMBEDDING_ENDPOINT ?? fileConfig.embedding_endpoint ?? 'http://localhost:11434/v1',
    embedding_model: process.env.FRAGMINT_EMBEDDING_MODEL ?? fileConfig.embedding_model ?? 'nomic-embed-text-v2-moe',
    embedding_dimensions: toNumber(process.env.FRAGMINT_EMBEDDING_DIMENSIONS) ?? fileConfig.embedding_dimensions ?? 768,
    embedding_batch_size: toNumber(process.env.FRAGMINT_EMBEDDING_BATCH_SIZE) ?? fileConfig.embedding_batch_size ?? 32,
    embedding_max_tokens: toNumber(process.env.FRAGMINT_EMBEDDING_MAX_TOKENS) ?? fileConfig.embedding_max_tokens ?? 480,
    embedding_prefix_document: process.env.FRAGMINT_EMBEDDING_PREFIX_DOCUMENT ?? fileConfig.embedding_prefix_document ?? 'search_document: ',
    embedding_prefix_query: process.env.FRAGMINT_EMBEDDING_PREFIX_QUERY ?? fileConfig.embedding_prefix_query ?? 'search_query: ',
    embedding_prefix_cluster: process.env.FRAGMINT_EMBEDDING_PREFIX_CLUSTER ?? fileConfig.embedding_prefix_cluster ?? 'clustering: ',
    cors_origin: process.env.FRAGMINT_CORS_ORIGIN
      ? process.env.FRAGMINT_CORS_ORIGIN.split(',').map(s => s.trim())
      : (fileConfig.cors_origin ?? ['http://localhost:3210', 'http://localhost:5173']),
    milvus_address: process.env.FRAGMINT_MILVUS_ADDRESS ?? fileConfig.milvus_address ?? 'localhost:19530',
    milvus_collection: process.env.FRAGMINT_MILVUS_COLLECTION ?? fileConfig.milvus_collection ?? 'fragmint_fragments',
    milvus_enabled: process.env.FRAGMINT_MILVUS_ENABLED === 'true' || fileConfig.milvus_enabled === true,
  };
}

function toNumber(val?: string): number | undefined {
  if (!val) return undefined;
  const n = parseInt(val, 10);
  return isNaN(n) ? undefined : n;
}
