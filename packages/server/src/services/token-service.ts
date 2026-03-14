// packages/server/src/services/token-service.ts
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type { FragmintDb } from '../db/connection.js';
import { apiTokens } from '../db/schema.js';
import { hashTokenSha256, hashTokenScrypt } from '../auth/hash.js';

export class TokenService {
  constructor(private db: FragmintDb) {}

  async create(name: string, role: string, owner: string) {
    const id = uuidv4();
    const rawToken = `frag_tok_${randomBytes(24).toString('hex')}`;
    const token_lookup = hashTokenSha256(rawToken);
    const token_hash = await hashTokenScrypt(rawToken);
    const now = new Date().toISOString();

    await this.db.insert(apiTokens).values({
      id, name, token_hash, token_lookup, role, owner, created_at: now,
    });

    // Return raw token only once — never stored in plain text
    return { id, name, role, token: rawToken, created_at: now };
  }

  async list() {
    const rows = await this.db.select({
      id: apiTokens.id, name: apiTokens.name, role: apiTokens.role,
      owner: apiTokens.owner, created_at: apiTokens.created_at,
      last_used: apiTokens.last_used, active: apiTokens.active,
    }).from(apiTokens);
    return rows;
  }

  async revoke(id: string): Promise<boolean> {
    const existing = await this.db.select({ id: apiTokens.id })
      .from(apiTokens).where(eq(apiTokens.id, id)).limit(1);
    if (existing.length === 0) return false;
    await this.db.update(apiTokens)
      .set({ active: 0 })
      .where(eq(apiTokens.id, id));
    return true;
  }
}
