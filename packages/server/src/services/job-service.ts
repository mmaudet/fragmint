import { eq } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { jobs } from '../db/schema.js';
import { generateId } from '../git/fragment-file.js';

export class JobService {
  constructor(private db: FragmintDb) {}

  async create(type: string, total: number, createdBy: string) {
    const now = new Date().toISOString();
    const id = generateId();
    await this.db.insert(jobs).values({ id, type, status: 'pending', total, done: 0, error_count: 0, created_by: createdBy, created_at: now, updated_at: now });
    return { id, type, status: 'pending', total, done: 0, error_count: 0 };
  }

  async getById(id: string) {
    const rows = await this.db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async progress(id: string, done: number) {
    await this.db.update(jobs).set({ status: 'running', done, updated_at: new Date().toISOString() }).where(eq(jobs.id, id));
  }

  async complete(id: string, done: number, errorCount: number) {
    await this.db.update(jobs).set({ status: errorCount > 0 && done === 0 ? 'error' : 'done', done, error_count: errorCount, updated_at: new Date().toISOString() }).where(eq(jobs.id, id));
  }

  async fail(id: string) {
    await this.db.update(jobs).set({ status: 'error', updated_at: new Date().toISOString() }).where(eq(jobs.id, id));
  }
}
