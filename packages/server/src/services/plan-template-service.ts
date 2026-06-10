import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { planTemplates } from '../db/schema.js';
import {
  PlanTemplateSchema,
  type PlanTemplate,
  type CreatePlanTemplateInput,
} from '../schema/plan-template.js';

export class PlanTemplateService {
  constructor(private db: FragmintDb) {}

  async list(status?: string): Promise<PlanTemplate[]> {
    const rows = status
      ? await this.db.select().from(planTemplates).where(eq(planTemplates.status, status))
      : await this.db.select().from(planTemplates);
    return rows.map(rowToTemplate);
  }

  async getById(id: string): Promise<PlanTemplate | null> {
    const [row] = await this.db.select().from(planTemplates).where(eq(planTemplates.id, id));
    return row ? rowToTemplate(row) : null;
  }

  async create(input: CreatePlanTemplateInput): Promise<PlanTemplate> {
    const id = input.id ?? `tpl_plan_${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    await this.db.insert(planTemplates).values({
      id,
      name: input.name,
      version: input.version ?? '1.0.0',
      description: input.description ?? null,
      status: input.status ?? 'active',
      tags_json: JSON.stringify(input.tags ?? []),
      sections_json: JSON.stringify(input.sections),
      created_at: now,
      updated_at: now,
    });
    return (await this.getById(id))!;
  }
}

function rowToTemplate(row: typeof planTemplates.$inferSelect): PlanTemplate {
  return PlanTemplateSchema.parse({
    ...row,
    tags: JSON.parse(row.tags_json),
    sections: JSON.parse(row.sections_json),
  });
}
