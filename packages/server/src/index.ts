// packages/server/src/index.ts
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { eq, count } from 'drizzle-orm';
import { loadConfig, type FragmintConfig } from './config.js';
import { createDb, type FragmintDb } from './db/index.js';
import { collections, collectionMemberships, users, toMilvusPartition } from './db/schema.js';
import { buildAuthMiddleware } from './auth/middleware.js';
import { UserService, TokenService, AuditService, FragmentService, TemplateService, ComposerService } from './services/index.js';
import { CollectionService } from './services/collection-service.js';
import { EmbeddingClient, FragmintMilvusClient, SearchService } from './search/index.js';
import { authRoutes } from './routes/auth-routes.js';
import { fragmentRoutes } from './routes/fragment-routes.js';
import { adminRoutes } from './routes/admin-routes.js';
import { templateRoutes } from './routes/template-routes.js';
import { harvestRoutes } from './routes/harvest-routes.js';
import { collectionRoutes } from './routes/collection-routes.js';
import { GitRepository } from './git/git-repository.js';
import { buildCollectionMiddleware } from './auth/middleware.js';
import { LlmClient } from './services/llm-client.js';
import { HarvesterService } from './services/harvester-service.js';

export interface FragmintServer {
  app: ReturnType<typeof Fastify>;
  config: FragmintConfig;
  db: FragmintDb;
}

async function ensureCollections(db: FragmintDb, config: FragmintConfig) {
  const [row] = await db.select({ value: count() }).from(collections);
  if (row.value > 0) return; // Already seeded

  const now = new Date().toISOString();
  const collectionId = randomUUID();
  const slug = 'common';

  await db.insert(collections).values({
    id: collectionId,
    slug,
    name: 'Common',
    type: 'system',
    read_only: 0,
    auto_assign: 1,
    git_path: config.store_path,
    milvus_partition: toMilvusPartition(slug),
    created_at: now,
    created_by: 'system',
  });

  // Assign all existing users to the common collection
  const allUsers = await db.select().from(users);
  for (const user of allUsers) {
    await db.insert(collectionMemberships).values({
      id: randomUUID(),
      collection_id: collectionId,
      user_id: user.id,
      role: user.role === 'admin' ? 'expert' : 'reader',
      granted_by: 'system',
      granted_at: now,
    });
  }

  console.log(`Collections migration: created 'common' collection, assigned ${allUsers.length} user(s)`);
}

export async function createServer(options?: {
  configPath?: string;
  dev?: boolean;
  dbPath?: string;
}): Promise<FragmintServer> {
  const config = loadConfig(options?.configPath, options?.dev ?? false);
  const storePath = resolve(config.store_path);

  // Database
  // createDb handles table creation on the same connection (critical for :memory:)
  const dbPath = options?.dbPath ?? (config.dev ? ':memory:' : resolve(storePath, '.fragmint.db'));
  const db = createDb(dbPath);

  // Auto-migrate collections
  await ensureCollections(db, config);

  // Git init if needed
  const git = new GitRepository(storePath);
  if (!existsSync(resolve(storePath, '.git'))) {
    await git.init();
  }

  // Fastify
  const app = Fastify({ logger: { level: config.log_level }, trustProxy: config.trust_proxy });

  await app.register(fastifyJwt, { secret: config.jwt_secret, sign: { expiresIn: config.jwt_ttl } });
  await app.register(fastifyCors, {
    origin: config.cors_origin,
    credentials: true,
  });
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
      },
    },
  });
  await app.register(fastifyRateLimit, { max: 100, timeWindow: '1 minute' });
  await app.register(multipart);

  // Search infrastructure
  const embeddingClient = new EmbeddingClient(
    config.embedding_endpoint, config.embedding_model, config.embedding_dimensions
  );

  let milvusClient: FragmintMilvusClient | null = null;
  if (config.milvus_enabled) {
    try {
      milvusClient = new FragmintMilvusClient(
        config.milvus_address, config.milvus_collection, config.embedding_dimensions
      );
      await milvusClient.ensureCollection();
      console.log('Milvus connected and collection ready');
    } catch (err) {
      console.warn('Milvus connection failed, using SQLite fallback:', err);
      milvusClient = null;
    }
  }

  const searchService = new SearchService(db, embeddingClient, milvusClient, {
    prefixes: {
      document: config.embedding_prefix_document,
      query: config.embedding_prefix_query,
      cluster: config.embedding_prefix_cluster,
    },
    maxTokens: config.embedding_max_tokens,
  });

  // Services
  const auditService = new AuditService(db);
  const userService = new UserService(db);
  const tokenService = new TokenService(db);
  const fragmentService = new FragmentService(db, storePath, auditService, searchService);
  const templateService = new TemplateService(db, storePath, auditService);
  const composerService = new ComposerService(fragmentService, templateService, storePath);

  // Auth middleware
  const authenticate = buildAuthMiddleware(db);

  // Collection service and middleware
  const collectionService = new CollectionService(db, { collections_path: config.collections_path });
  const requireCollRole = buildCollectionMiddleware(db);

  // Harvester
  const llmClient = new LlmClient({
    endpoint: config.llm_endpoint,
    model: config.llm_model,
    temperature: config.llm_temperature,
    timeout: config.llm_timeout,
  });
  const harvesterService = new HarvesterService(db, llmClient, searchService, fragmentService, storePath);

  // Routes
  authRoutes(app, userService);
  fragmentRoutes(app, fragmentService, authenticate);
  adminRoutes(app, userService, tokenService, auditService, fragmentService, authenticate);
  templateRoutes(app, templateService, composerService, authenticate);
  harvestRoutes(app, harvesterService, authenticate);

  // Collection CRUD routes
  collectionRoutes(app, collectionService, authenticate, requireCollRole);

  // Collection-prefixed routes (same handlers under /v1/collections/:slug/*)
  const collPrefix = '/v1/collections/:slug';
  fragmentRoutes(app, fragmentService, authenticate, {
    prefix: collPrefix,
    collectionMiddleware: requireCollRole('reader'),
  });
  templateRoutes(app, templateService, composerService, authenticate, {
    prefix: collPrefix,
    collectionMiddleware: requireCollRole('reader'),
  });
  harvestRoutes(app, harvesterService, authenticate, {
    prefix: collPrefix,
    collectionMiddleware: requireCollRole('reader'),
  });

  // Serve frontend static files
  const __dirname = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
  const frontendPath = resolve(__dirname, '../../web/dist');
  if (existsSync(frontendPath)) {
    await app.register(fastifyStatic, {
      root: frontendPath,
      prefix: '/ui/',
      decorateReply: false,
    });
  }

  // SPA fallback + 404 handler
  const indexHtmlPath = resolve(frontendPath, 'index.html');
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/ui') && existsSync(indexHtmlPath)) {
      const html = readFileSync(indexHtmlPath, 'utf-8');
      return reply.type('text/html').send(html);
    }
    reply.status(404).send({ data: null, meta: null, error: 'Not found' });
  });

  // Error handler
  app.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    reply.status(statusCode).send({
      data: null,
      meta: null,
      error: error.message,
    });
  });

  // Seed dev data
  if (config.dev) {
    const exists = await userService.exists('mmaudet');
    if (!exists) {
      await userService.create('mmaudet', 'fragmint-dev', 'Michel-Marie Maudet', 'admin');
      console.log('Dev user created: mmaudet / fragmint-dev');
    }
  }

  // Reindex on startup if empty
  const result = await fragmentService.reindex();
  if (result.indexed > 0) {
    console.log(`Indexed ${result.indexed} fragments on startup`);
  }

  // Start periodic cleanup of expired composed outputs
  app.addHook('onReady', () => {
    const timer = composerService.startCleanupTimer();
    app.addHook('onClose', () => clearInterval(timer));
  });

  return { app, config, db };
}

export async function startServer(options?: {
  configPath?: string;
  dev?: boolean;
}) {
  const { app, config } = await createServer(options);
  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`Fragmint server listening on http://localhost:${config.port}`);
  return app;
}

// Re-export for CLI and tests
export { loadConfig } from './config.js';
export type { FragmintConfig } from './config.js';

// Auto-start when run directly (not imported as a module)
const isMain = process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js');
if (isMain) {
  startServer({ dev: process.env.NODE_ENV !== 'production' }).catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
