// packages/server/src/services/user-service.ts
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import type { FragmintDb } from '../db/connection.js';
import { users } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../auth/hash.js';

export class UserService {
  constructor(private db: FragmintDb) {}

  async create(login: string, password: string, displayName: string, role: string) {
    const id = uuidv4();
    const password_hash = await hashPassword(password);
    const now = new Date().toISOString();

    await this.db.insert(users).values({
      id, login, display_name: displayName, role,
      password_hash, created_at: now,
    });

    return { id, login, display_name: displayName, role, created_at: now };
  }

  async authenticate(login: string, password: string) {
    const rows = await this.db.select().from(users)
      .where(eq(users.login, login)).limit(1);

    if (rows.length === 0 || !rows[0].active) return null;

    const valid = await verifyPassword(password, rows[0].password_hash);
    if (!valid) return null;

    await this.db.update(users)
      .set({ last_login: new Date().toISOString() })
      .where(eq(users.id, rows[0].id));

    return {
      id: rows[0].id,
      login: rows[0].login,
      role: rows[0].role,
      display_name: rows[0].display_name,
    };
  }

  async list() {
    const rows = await this.db.select({
      id: users.id, login: users.login,
      display_name: users.display_name, role: users.role,
      created_at: users.created_at, last_login: users.last_login,
      active: users.active,
    }).from(users);
    return rows;
  }

  async exists(login: string): Promise<boolean> {
    const rows = await this.db.select({ id: users.id })
      .from(users).where(eq(users.login, login)).limit(1);
    return rows.length > 0;
  }
}
