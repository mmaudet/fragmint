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
  };
}

function toNumber(val?: string): number | undefined {
  if (!val) return undefined;
  const n = parseInt(val, 10);
  return isNaN(n) ? undefined : n;
}
