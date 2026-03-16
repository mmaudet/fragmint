// packages/server/src/auth/middleware.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { apiTokens, users, collections, collectionMemberships } from '../db/schema.js';
import { hashTokenSha256, verifyTokenScrypt } from './hash.js';
import { ROLE_HIERARCHY } from '../schema/fragment.js';
import type { FragmintDb } from '../db/connection.js';

export interface AuthUser {
  id: string;
  login: string;
  role: string;
  display_name: string;
  tokenCollectionSlug?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser;
    collection?: any;
    collectionRole?: string;
  }
}

const COLLECTION_ROLE_HIERARCHY: Record<string, number> = {
  reader: 0,
  contributor: 1,
  expert: 2,
  manager: 3,
  owner: 4,
};

export function hasCollectionRole(userRole: string, requiredRole: string): boolean {
  return (COLLECTION_ROLE_HIERARCHY[userRole] ?? -1) >= (COLLECTION_ROLE_HIERARCHY[requiredRole] ?? 999);
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

      if (row.collection_slug) {
        request.user.tokenCollectionSlug = row.collection_slug;
      }
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

export function buildCollectionMiddleware(db: FragmintDb) {
  return function requireCollectionRole(minRole: string) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const { slug } = request.params as { slug?: string };
      if (!slug) {
        return reply.status(400).send({ data: null, meta: null, error: 'Collection slug required' });
      }

      // Load collection
      const collectionRows = await db.select().from(collections).where(eq(collections.slug, slug)).limit(1);
      if (collectionRows.length === 0) {
        return reply.status(404).send({ data: null, meta: null, error: 'Collection not found' });
      }
      const collection = collectionRows[0];

      // Determine role
      let role: string | null = null;

      // Global admin has full access
      if (request.user.role === 'admin') {
        role = 'owner';
      } else {
        // DB lookup for membership — try by user ID first, then by login
        // (JWT sets id=login=sub, but memberships may store the UUID)
        let membershipRows = await db.select()
          .from(collectionMemberships)
          .where(and(
            eq(collectionMemberships.user_id, request.user.id),
            eq(collectionMemberships.collection_id, collection.id),
          ))
          .limit(1);

        // If not found by id, try looking up the actual user UUID from users table
        if (membershipRows.length === 0) {
          const userRows = await db.select().from(users).where(eq(users.login, request.user.login)).limit(1);
          if (userRows.length > 0) {
            membershipRows = await db.select()
              .from(collectionMemberships)
              .where(and(
                eq(collectionMemberships.user_id, userRows[0].id),
                eq(collectionMemberships.collection_id, collection.id),
              ))
              .limit(1);
          }
        }

        if (membershipRows.length > 0) {
          role = membershipRows[0].role;
        }
      }

      if (!role || !hasCollectionRole(role, minRole)) {
        return reply.status(403).send({ data: null, meta: null, error: 'Collection access denied' });
      }

      // Attach to request for downstream use
      request.collection = collection;
      request.collectionRole = role;
    };
  };
}
