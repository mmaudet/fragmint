// packages/server/src/services/audit-service.ts
import { desc, and, gte, lte } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { auditLog } from '../db/schema.js';

export class AuditService {
  constructor(private db: FragmintDb) {}

  async log(params: {
    user_id: string;
    role: string;
    action: string;
    fragment_id?: string;
    diff_summary?: string;
    ip_source?: string;
  }) {
    await this.db.insert(auditLog).values({
      timestamp: new Date().toISOString(),
      user_id: params.user_id,
      role: params.role,
      action: params.action,
      fragment_id: params.fragment_id ?? null,
      diff_summary: params.diff_summary ?? null,
      ip_source: params.ip_source ?? null,
    });
  }

  async query(options?: { from?: string; to?: string; limit?: number }) {
    const limit = options?.limit ?? 100;
    const conditions = [];

    if (options?.from) conditions.push(gte(auditLog.timestamp, options.from));
    if (options?.to) conditions.push(lte(auditLog.timestamp, options.to));

    const rows = await this.db.select().from(auditLog)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditLog.id))
      .limit(limit);

    return rows;
  }
}
