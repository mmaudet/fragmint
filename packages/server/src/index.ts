// packages/server/src/index.ts
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type FragmintConfig } from './config.js';
import { createDb, type FragmintDb } from './db/index.js';
import { buildAuthMiddleware } from './auth/middleware.js';
import { UserService, TokenService, AuditService, FragmentService, TemplateService, ComposerService } from './services/index.js';
import { EmbeddingClient, FragmintMilvusClient, SearchService } from './search/index.js';
import { authRoutes } from './routes/auth-routes.js';
import { fragmentRoutes } from './routes/fragment-routes.js';
import { adminRoutes } from './routes/admin-routes.js';
import { templateRoutes } from './routes/template-routes.js';
import { GitRepository } from './git/git-repository.js';

export interface FragmintServer {
  app: ReturnType<typeof Fastify>;
  config: FragmintConfig;
  db: FragmintDb;
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

  // Git init if needed
  const git = new GitRepository(storePath);
  if (!existsSync(resolve(storePath, '.git'))) {
    await git.init();
  }

  // Fastify
  const app = Fastify({ logger: { level: config.log_level }, trustProxy: config.trust_proxy });

  await app.register(fastifyJwt, { secret: config.jwt_secret, sign: { expiresIn: config.jwt_ttl } });
  await app.register(fastifyCors);
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

  // Routes
  authRoutes(app, userService);
  fragmentRoutes(app, fragmentService, authenticate);
  adminRoutes(app, userService, tokenService, auditService, fragmentService, authenticate);
  templateRoutes(app, templateService, composerService, authenticate);

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
