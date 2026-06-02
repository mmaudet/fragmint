import { describe, it, expect } from 'vitest';
import { buildGfmTable, buildMarkdownList } from './table-assembler.js';

describe('buildGfmTable', () => {
  it('returns empty string for empty rows', () => {
    expect(buildGfmTable([], ['col1', 'col2'])).toBe('');
  });

  it('returns empty string for empty columns', () => {
    expect(buildGfmTable([{ col1: 'a' }], [])).toBe('');
  });

  it('builds a correct GFM table from rows and columns', () => {
    const rows = [
      { name: 'Alice', age: 30, city: 'Paris' },
      { name: 'Bob', age: 25, city: 'Lyon' },
    ];
    const cols = ['name', 'age', 'city'];
    const result = buildGfmTable(rows, cols);
    const lines = result.split('\n');
    expect(lines[0]).toBe('| name | age | city |');
    expect(lines[1]).toBe('| --- | --- | --- |');
    expect(lines[2]).toBe('| Alice | 30 | Paris |');
    expect(lines[3]).toBe('| Bob | 25 | Lyon |');
  });

  it('stringifies missing fields as empty string', () => {
    const rows = [{ name: 'Alice' }];
    const result = buildGfmTable(rows, ['name', 'missing']);
    expect(result).toContain('| Alice |  |');
  });
});

describe('buildMarkdownList', () => {
  it('builds a bullet list from an array of strings', () => {
    const result = buildMarkdownList(['first item', 'second item']);
    expect(result).toBe('- first item\n- second item');
  });

  it('trims whitespace from each body', () => {
    const result = buildMarkdownList(['  padded  ', '\ttabbed']);
    expect(result).toBe('- padded\n- tabbed');
  });

  it('returns empty string for empty array', () => {
    expect(buildMarkdownList([])).toBe('');
  });
});
