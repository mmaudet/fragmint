import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDb } from '../db/connection.js';
import { PlanService } from './plan-service.js';
import type { LlmClient } from './llm-client.js';
import type { SearchService } from '../search/search-service.js';
import type { FragmentService } from './fragment-service.js';

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

function fakeLlm(responses: string[]): LlmClient {
  let i = 0;
  return {
    chatMessages: vi.fn(async () => responses[i++] ?? ''),
  } as unknown as LlmClient;
}

function fakeSearch(results: any[]): SearchService {
  return { search: vi.fn(async () => results) } as unknown as SearchService;
}

function fakeFragments(createdId = 'frag_new'): FragmentService {
  return {
    create: vi.fn(async () => ({ id: createdId })),
    getById: vi.fn(async (id: string) => ({
      id,
      body: `body of ${id}`,
      type: 'introduction',
      domain: 'cloud',
      lang: 'fr',
      tags: '["t1"]',
      collection_slug: 'common',
    })),
  } as unknown as FragmentService;
}

function makeServiceFull(opts: {
  llm?: LlmClient;
  search?: SearchService;
  fragments?: FragmentService;
} = {}) {
  const db = createDb(':memory:');
  return new PlanService(db, {
    fragmentMaxChars: 4000,
    docxReferencePath: undefined,
    llm: opts.llm,
    search: opts.search,
    fragments: opts.fragments,
  });
}

describe('PlanService.generatePlan', () => {
  it('stores the LLM-generated markdown into the plan', async () => {
    const llm = fakeLlm(['## Intro\n\nWelcomes.\n\n## Pricing\n\nCosts.']);
    const svc = makeServiceFull({ llm });
    const p = await svc.create({ owner: 'a', collection_slug: null, spec_prompt: 'cloud doc' });
    const out = await svc.generatePlan(p.id, {});
    expect(out!.state.plan_markdown).toContain('## Intro');
    expect(llm.chatMessages).toHaveBeenCalledTimes(1);
  });
});

describe('PlanService.validatePlan', () => {
  it('parses sections, populates candidates via search, and sets status', async () => {
    const llm = fakeLlm([]);
    const search = fakeSearch([
      { id: 'f1', score: 0.9, title: 'F1', body_excerpt: 'b1', quality: 'reviewed' },
      { id: 'f2', score: 0.8, title: 'F2', body_excerpt: 'b2', quality: 'draft' },
    ]);
    const svc = makeServiceFull({ llm, search });
    const p = await svc.create({ owner: 'a', collection_slug: null, spec_prompt: '' });
    await svc.update(p.id, { plan_markdown: '## A\n\nDescA\n\n## B\n\nDescB' });

    const out = await svc.validatePlan(p.id);
    expect(out!.status).toBe('plan_validated');
    expect(out!.state.sections).toHaveLength(2);
    expect(out!.state.sections[0].candidates).toHaveLength(2);
    expect(out!.state.sections[0].candidates[0].fragment_id).toBe('f1');
  });

  it('preserves existing per-section selections when re-validating with same section titles', async () => {
    const llm = fakeLlm([]);
    const search = fakeSearch([{ id: 'fX', score: 0.9, title: 'X', body_excerpt: 'x', quality: 'draft' }]);
    const svc = makeServiceFull({ llm, search });
    const p = await svc.create({ owner: 'a', collection_slug: null, spec_prompt: '' });
    await svc.update(p.id, { plan_markdown: '## Keep\n\nDesc' });
    const v1 = await svc.validatePlan(p.id);
    await svc.update(p.id, {
      sections: v1!.state.sections.map((s) => ({
        ...s,
        selected: [
          { fragment_id: 'fX', body: 'edited body', edited: true, propose_to_library: false },
        ],
      })),
    });
    const v2 = await svc.validatePlan(p.id);
    expect(v2!.state.sections[0].selected).toHaveLength(1);
    expect(v2!.state.sections[0].selected[0].body).toBe('edited body');
  });
});

describe('PlanService.searchSection', () => {
  it('refreshes candidates for a single section', async () => {
    const search = fakeSearch([{ id: 'fNEW', score: 1, title: 'new', body_excerpt: 'nb', quality: 'approved' }]);
    const svc = makeServiceFull({ search, llm: fakeLlm([]) });
    const p = await svc.create({ owner: 'a', collection_slug: null, spec_prompt: '' });
    await svc.update(p.id, { plan_markdown: '## S\n\nD' });
    const v = await svc.validatePlan(p.id);
    const sid = v!.state.sections[0].id;
    const out = await svc.searchSection(p.id, sid, {});
    expect(out!.state.sections[0].candidates[0].fragment_id).toBe('fNEW');
  });
});

describe('PlanService.validateFragments', () => {
  it('creates library drafts for selections with propose_to_library=true', async () => {
    const search = fakeSearch([{ id: 'fSrc', score: 1, title: 't', body_excerpt: 'b', quality: 'draft' }]);
    const fragments = fakeFragments('frag_proposed');
    const svc = makeServiceFull({ llm: fakeLlm([]), search, fragments });
    const p = await svc.create({ owner: 'alice', collection_slug: 'common', spec_prompt: '' });
    await svc.update(p.id, { plan_markdown: '## S\n\nD' });
    const v = await svc.validatePlan(p.id);
    const sid = v!.state.sections[0].id;
    await svc.update(p.id, {
      sections: v!.state.sections.map((s) =>
        s.id === sid
          ? {
              ...s,
              selected: [
                { fragment_id: 'fSrc', body: 'edited', edited: true, propose_to_library: true },
              ],
            }
          : s,
      ),
    });
    const out = await svc.validateFragments(p.id);
    expect(out!.status).toBe('fragments_validated');
    expect(out!.state.sections[0].selected[0].proposed_fragment_id).toBe('frag_proposed');
    expect((fragments.create as any).mock.calls.length).toBe(1);
  });

  it('does not re-create a library draft if proposed_fragment_id is already set', async () => {
    const fragments = fakeFragments('frag_should_not_create');
    const svc = makeServiceFull({ llm: fakeLlm([]), search: fakeSearch([]), fragments });
    const p = await svc.create({ owner: 'alice', collection_slug: 'common', spec_prompt: '' });
    await svc.update(p.id, {
      plan_markdown: '## S\n\nD',
      sections: [
        {
          id: 'sec_aaa',
          title: 'S',
          description: 'D',
          candidates: [],
          selected: [
            {
              fragment_id: 'fSrc',
              body: 'b',
              edited: true,
              propose_to_library: true,
              proposed_fragment_id: 'frag_existing',
            },
          ],
        },
      ],
      status: 'plan_validated',
    });
    await svc.validateFragments(p.id);
    expect((fragments.create as any).mock.calls.length).toBe(0);
  });
});

describe('PlanService.generateSection', () => {
  it('calls the LLM with title/description/fragments and stores generated_markdown', async () => {
    const llm = fakeLlm(['Generated body of the section.']);
    const svc = makeServiceFull({ llm, search: fakeSearch([]) });
    const p = await svc.create({ owner: 'a', collection_slug: null, spec_prompt: '' });
    await svc.update(p.id, {
      plan_markdown: '## A\n\nD',
      sections: [
        {
          id: 'sec_aaa',
          title: 'A',
          description: 'D',
          candidates: [],
          selected: [
            { fragment_id: 'f1', body: 'frag body', edited: false, propose_to_library: false },
          ],
        },
      ],
      status: 'fragments_validated',
    });
    const out = await svc.generateSection(p.id, 'sec_aaa');
    expect(out!.state.sections[0].generated_markdown).toContain('Generated body');
    expect(llm.chatMessages).toHaveBeenCalledTimes(1);
  });
});

describe('PlanService.assemble', () => {
  it('concatenates section bodies into draft_markdown', async () => {
    const svc = makeServiceFull({ llm: fakeLlm([]), search: fakeSearch([]) });
    const p = await svc.create({ owner: 'a', collection_slug: null, spec_prompt: '', title: 'Doc' });
    await svc.update(p.id, {
      sections: [
        { id: 's1', title: 'A', description: 'D', candidates: [], selected: [], generated_markdown: 'Body A.' },
        { id: 's2', title: 'B', description: 'D', candidates: [], selected: [], generated_markdown: 'Body B.' },
      ],
      status: 'fragments_validated',
    });
    const out = await svc.assemble(p.id);
    expect(out!.state.draft_markdown).toContain('# Doc');
    expect(out!.state.draft_markdown).toContain('## A');
    expect(out!.state.draft_markdown).toContain('Body A.');
    expect(out!.state.draft_markdown).toContain('## B');
  });
});

describe('PlanService.exportMarkdown / exportDocx', () => {
  it('exportMarkdown returns the draft and bumps status to completed', async () => {
    const svc = makeServiceFull({ llm: fakeLlm([]), search: fakeSearch([]) });
    const p = await svc.create({ owner: 'a', collection_slug: null, spec_prompt: '' });
    await svc.update(p.id, { draft_markdown: '# X', status: 'fragments_validated' });
    const md = await svc.exportMarkdown(p.id);
    expect(md.content).toBe('# X');
    expect(md.filename).toMatch(/\.md$/);
    const after = await svc.get(p.id);
    expect(after!.status).toBe('completed');
  });
});
