import { describe, it, expect } from 'vitest';
import { buildPlanMessages, buildSectionMessages } from './plan-prompts.js';

describe('buildPlanMessages', () => {
  it('builds a system + user message pair from a spec prompt', () => {
    const msgs = buildPlanMessages({
      spec_prompt: 'A doc about cloud security',
      filters: { lang: 'fr', domain: 'cloud', tags: ['twake'] },
    });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('## ');
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toContain('A doc about cloud security');
    expect(msgs[1].content).toContain('Language: fr');
    expect(msgs[1].content).toContain('Domain: cloud');
    expect(msgs[1].content).toContain('Tags: twake');
  });

  it('falls back to defaults when filters are missing', () => {
    const msgs = buildPlanMessages({ spec_prompt: 'x', filters: {} });
    expect(msgs[1].content).toContain('Language: fr');
    expect(msgs[1].content).toContain('Domain: any');
    expect(msgs[1].content).toContain('Tags: none');
  });

  it('includes a revision block when a current plan and instructions are provided', () => {
    const msgs = buildPlanMessages({
      spec_prompt: 's',
      filters: {},
      current_plan: '## Old\n\nOld desc',
      extra_instructions: 'Add a section on pricing',
    });
    expect(msgs[1].content).toContain('Current plan to revise:');
    expect(msgs[1].content).toContain('## Old');
    expect(msgs[1].content).toContain('Revision instructions: Add a section on pricing');
  });
});

describe('buildSectionMessages', () => {
  it('embeds title, description, and fragment bodies', () => {
    const msgs = buildSectionMessages({
      section: { title: 'Intro', description: 'Welcomes the reader' },
      fragments: [{ body: 'Fragment one body' }, { body: 'Fragment two body' }],
      lang: 'fr',
      max_chars: 4000,
    });
    const user = msgs.find((m) => m.role === 'user')!;
    expect(user.content).toContain('Section title: Intro');
    expect(user.content).toContain('Section description: Welcomes the reader');
    expect(user.content).toContain('--- Fragment 1 ---');
    expect(user.content).toContain('Fragment one body');
    expect(user.content).toContain('--- Fragment 2 ---');
    expect(user.content).toContain('Fragment two body');
  });

  it('truncates fragment bodies that exceed max_chars', () => {
    const long = 'x'.repeat(5000);
    const msgs = buildSectionMessages({
      section: { title: 'T', description: 'D' },
      fragments: [{ body: long }],
      lang: 'fr',
      max_chars: 100,
    });
    const user = msgs.find((m) => m.role === 'user')!;
    expect(user.content).toContain('…[truncated]');
    expect(user.content.length).toBeLessThan(long.length);
  });

  it('adds the no-fragments hint when no fragments are provided', () => {
    const msgs = buildSectionMessages({
      section: { title: 'T', description: 'D' },
      fragments: [],
      lang: 'fr',
      max_chars: 4000,
    });
    const user = msgs.find((m) => m.role === 'user')!;
    expect(user.content).toContain('no source fragments');
  });

  it('embeds writer_prompt_override in the system message when present', () => {
    const msgs = buildSectionMessages({
      section: { title: 'T', description: 'D' },
      fragments: [],
      lang: 'fr',
      max_chars: 4000,
      writer_prompt_override: 'Use bullet points.',
    });
    expect(msgs[0].content).toContain('Use bullet points.');
  });

  it('forbids quotation/attribution in the system message', () => {
    const msgs = buildSectionMessages({
      section: { title: 'T', description: 'D' },
      fragments: [],
      lang: 'fr',
      max_chars: 4000,
    });
    expect(msgs[0].content).toContain('NOT external sources');
    expect(msgs[0].content).toContain('quote them verbatim');
  });
});
