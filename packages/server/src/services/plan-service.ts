import { randomUUID } from 'node:crypto';
import { eq, and, desc } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { plans } from '../db/schema.js';
import {
  PlanStateSchema,
  type PlanState,
  type PlanStatus,
  type PlanFilters,
} from '../schema/plan.js';

export interface PlanServiceConfig {
  fragmentMaxChars: number;
  docxReferencePath?: string;
}

export interface PlanRecord {
  id: string;
  title: string;
  owner: string;
  collection_slug: string | null;
  status: PlanStatus;
  state: PlanState;
  created_at: string;
  updated_at: string;
}

export interface CreatePlanInput {
  title?: string;
  owner: string;
  collection_slug: string | null;
  spec_prompt: string;
  filters?: PlanFilters;
}

export interface ListPlansInput {
  owner: string;
  collection_slug?: string | null;
}

export interface UpdatePlanInput {
  title?: string;
  spec_prompt?: string;
  filters?: PlanFilters;
  plan_markdown?: string;
  draft_markdown?: string;
  draft_dirty?: boolean;
  writer_prompt_override?: string;
  sections?: PlanState['sections'];
  export_style_template_id?: string | null;
  status?: PlanStatus;
}

function rowToRecord(row: typeof plans.$inferSelect): PlanRecord {
  return {
    id: row.id,
    title: row.title,
    owner: row.owner,
    collection_slug: row.collection_slug,
    status: row.status as PlanStatus,
    state: PlanStateSchema.parse(JSON.parse(row.state_json)),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class PlanService {
  constructor(private db: FragmintDb, private config: PlanServiceConfig) {}

  async create(input: CreatePlanInput): Promise<PlanRecord> {
    const id = `plan_${randomUUID()}`;
    const now = new Date().toISOString();
    const state: PlanState = PlanStateSchema.parse({
      spec_prompt: input.spec_prompt,
      filters: input.filters ?? {},
      plan_markdown: '',
      sections: [],
    });
    await this.db.insert(plans).values({
      id,
      title: input.title?.trim() && input.title.trim() !== '' ? input.title.trim() : 'Untitled plan',
      owner: input.owner,
      collection_slug: input.collection_slug,
      status: 'draft',
      state_json: JSON.stringify(state),
      created_at: now,
      updated_at: now,
    });
    return (await this.get(id))!;
  }

  async list(input: ListPlansInput): Promise<PlanRecord[]> {
    const conds = [eq(plans.owner, input.owner)];
    if (input.collection_slug !== undefined && input.collection_slug !== null) {
      conds.push(eq(plans.collection_slug, input.collection_slug));
    }
    const rows = await this.db
      .select()
      .from(plans)
      .where(and(...conds))
      .orderBy(desc(plans.updated_at));
    return rows.map(rowToRecord);
  }

  async get(id: string): Promise<PlanRecord | null> {
    const rows = await this.db.select().from(plans).where(eq(plans.id, id)).limit(1);
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async update(id: string, input: UpdatePlanInput): Promise<PlanRecord | null> {
    const existing = await this.get(id);
    if (!existing) return null;

    const newState: PlanState = { ...existing.state };
    if (input.spec_prompt !== undefined) newState.spec_prompt = input.spec_prompt;
    if (input.filters !== undefined) newState.filters = input.filters;
    if (input.plan_markdown !== undefined) newState.plan_markdown = input.plan_markdown;
    if (input.draft_markdown !== undefined) newState.draft_markdown = input.draft_markdown;
    if (input.draft_dirty !== undefined) newState.draft_dirty = input.draft_dirty;
    if (input.writer_prompt_override !== undefined)
      newState.writer_prompt_override = input.writer_prompt_override;
    if (input.sections !== undefined) newState.sections = input.sections;
    if (input.export_style_template_id === null) {
      delete newState.export_style_template_id;
    } else if (input.export_style_template_id !== undefined) {
      newState.export_style_template_id = input.export_style_template_id;
    }

    const now = new Date().toISOString();
    await this.db
      .update(plans)
      .set({
        title: input.title?.trim() && input.title.trim() !== '' ? input.title.trim() : existing.title,
        status: input.status ?? existing.status,
        state_json: JSON.stringify(newState),
        updated_at: now,
      })
      .where(eq(plans.id, id));
    return await this.get(id);
  }

  async remove(id: string): Promise<boolean> {
    await this.db.delete(plans).where(eq(plans.id, id));
    return true;
  }
}
