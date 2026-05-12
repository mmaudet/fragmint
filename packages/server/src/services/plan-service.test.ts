import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../db/connection.js';
import { PlanService } from './plan-service.js';

function makeService() {
  const db = createDb(':memory:');
  return new PlanService(db, {
    fragmentMaxChars: 4000,
    docxReferencePath: undefined,
  });
}

describe('PlanService CRUD', () => {
  let svc: ReturnType<typeof makeService>;
  beforeEach(() => { svc = makeService(); });

  it('creates a plan with default state and status="draft"', async () => {
    const p = await svc.create({
      title: 'My plan',
      owner: 'alice',
      collection_slug: 'common',
      spec_prompt: 'hello',
      filters: { lang: 'fr' },
    });
    expect(p.id).toMatch(/^plan_/);
    expect(p.status).toBe('draft');
    expect(p.state.spec_prompt).toBe('hello');
    expect(p.state.filters.lang).toBe('fr');
    expect(p.state.sections).toEqual([]);
  });

  it('defaults the title to "Untitled plan" when not provided', async () => {
    const p = await svc.create({ owner: 'alice', collection_slug: null, spec_prompt: '' });
    expect(p.title).toBe('Untitled plan');
  });

  it('lists plans scoped to owner and collection', async () => {
    await svc.create({ title: 'A', owner: 'alice', collection_slug: 'common', spec_prompt: '' });
    await svc.create({ title: 'B', owner: 'alice', collection_slug: 'other', spec_prompt: '' });
    await svc.create({ title: 'C', owner: 'bob', collection_slug: 'common', spec_prompt: '' });

    const aliceCommon = await svc.list({ owner: 'alice', collection_slug: 'common' });
    expect(aliceCommon.map((p) => p.title).sort()).toEqual(['A']);
  });

  it('returns null when get is called with a missing id', async () => {
    expect(await svc.get('plan_missing')).toBeNull();
  });

  it('updates mutable fields and bumps updated_at', async () => {
    const p = await svc.create({ owner: 'a', collection_slug: 'c', spec_prompt: 'x' });
    const before = p.updated_at;
    await new Promise((r) => setTimeout(r, 10));
    const updated = await svc.update(p.id, { title: 'Renamed', plan_markdown: '## Intro' });
    expect(updated!.title).toBe('Renamed');
    expect(updated!.state.plan_markdown).toBe('## Intro');
    expect(updated!.updated_at).not.toBe(before);
  });

  it('deletes a plan', async () => {
    const p = await svc.create({ owner: 'a', collection_slug: null, spec_prompt: '' });
    const ok = await svc.remove(p.id);
    expect(ok).toBe(true);
    expect(await svc.get(p.id)).toBeNull();
  });

  it('returns null when updating a missing plan', async () => {
    expect(await svc.update('plan_missing', { title: 'X' })).toBeNull();
  });
});
