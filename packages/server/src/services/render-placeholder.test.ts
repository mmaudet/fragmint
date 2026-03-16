import { describe, it, expect } from 'vitest';
import { resolvePlaceholders } from './render-placeholder.js';

describe('resolvePlaceholders', () => {
  it('replaces +++INS name+++ with value', () => {
    const result = resolvePlaceholders('Hello +++INS name+++!', { name: 'World' });
    expect(result).toBe('Hello World!');
  });

  it('resolves nested path like +++INS metadata.client+++', () => {
    const result = resolvePlaceholders('Client: +++INS metadata.client+++', {
      metadata: { client: 'LINAGORA' },
    });
    expect(result).toBe('Client: LINAGORA');
  });

  it('replaces missing values with empty string', () => {
    const result = resolvePlaceholders('Hello +++INS missing+++!', {});
    expect(result).toBe('Hello !');
  });

  it('repeats body for each array item in FOR loop', () => {
    const template = '+++FOR item IN items+++- +++INS $item.name+++\n+++END-FOR item+++';
    const data = {
      items: [{ name: 'Alpha' }, { name: 'Beta' }, { name: 'Gamma' }],
    };
    const result = resolvePlaceholders(template, data);
    expect(result).toBe('- Alpha\n- Beta\n- Gamma\n');
  });

  it('accesses item properties via $var.field in FOR loop', () => {
    const template = '+++FOR row IN rows++++++INS $row.x+++ / +++INS $row.y+++\n+++END-FOR row+++';
    const data = {
      rows: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
    };
    const result = resolvePlaceholders(template, data);
    expect(result).toBe('1 / 2\n3 / 4\n');
  });

  it('returns plain text unchanged when no placeholders', () => {
    const text = 'No placeholders here.';
    expect(resolvePlaceholders(text, { name: 'test' })).toBe(text);
  });
});
