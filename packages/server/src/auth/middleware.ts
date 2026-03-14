// packages/server/src/auth/middleware.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { apiTokens, users } from '../db/schema.js';
import { hashTokenSha256, verifyTokenScrypt } from './hash.js';
import { ROLE_HIERARCHY } from '../schema/fragment.js';
import type { FragmintDb } from '../db/connection.js';

export interface AuthUser {
  id: string;
  login: string;
  role: string;
  display_name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser;
  }
}

export function hasRole(userRole: string, requiredRole: string): boolean {
  return (ROLE_HIERARCHY[userRole] ?? -1) >= (ROLE_HIERARCHY[requiredRole] ?? 999);
}

export function buildAuthMiddleware(db: FragmintDb) {
  return async function authenticate(request: FastifyRequest, reply: FastifyReply) {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ data: null, meta: null, error: 'Missing authorization header' });
    }

    const token = authHeader.slice(7);

    // API token path
    if (token.startsWith('frag_tok_')) {
      const lookup = hashTokenSha256(token);
      const rows = await db.select().from(apiTokens).where(eq(apiTokens.token_lookup, lookup)).limit(1);
      if (rows.length === 0 || !rows[0].active) {
        return reply.status(401).send({ data: null, meta: null, error: 'Invalid API token' });
      }

      const row = rows[0];
      const valid = await verifyTokenScrypt(token, row.token_hash);
      if (!valid) {
        return reply.status(401).send({ data: null, meta: null, error: 'Invalid API token' });
      }

      // Update last_used
      await db.update(apiTokens)
        .set({ last_used: new Date().toISOString() })
        .where(eq(apiTokens.id, row.id));

      request.user = {
        id: row.owner,
        login: row.name,
        role: row.role,
        display_name: row.name,
      };
      return;
    }

    // JWT path
    try {
      const decoded = await request.jwtVerify<{ sub: string; role: string; display_name: string }>();
      request.user = {
        id: decoded.sub,
        login: decoded.sub,
        role: decoded.role,
        display_name: decoded.display_name,
      };
    } catch {
      return reply.status(401).send({ data: null, meta: null, error: 'Invalid or expired JWT' });
    }
  };
}

export function requireRole(role: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!hasRole(request.user.role, role)) {
      return reply.status(403).send({ data: null, meta: null, error: `Role '${role}' or higher required` });
    }
  };
}
