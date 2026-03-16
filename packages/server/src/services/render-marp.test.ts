import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { renderMarp } from './render-marp.js';

describe('renderMarp (HTML)', () => {
  const tmpFiles: string[] = [];

  function writeTempMd(content: string): string {
    const path = join(tmpdir(), `marp-test-${randomUUID()}.md`);
    writeFileSync(path, content);
    tmpFiles.push(path);
    return path;
  }

  afterAll(() => {
    for (const f of tmpFiles) {
      try { unlinkSync(f); } catch { /* ignore */ }
    }
  });

  it('renders a simple slide deck to HTML', async () => {
    const md = '# Hello World\n---\n# Slide 2';
    const path = writeTempMd(md);
    const result = await renderMarp(path, {}, 'html');

    const html = result.buffer.toString('utf-8');
    expect(result.format).toBe('slides');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html>');
    expect(html).toContain('Hello World');
    expect(html).toContain('Slide 2');
    expect(html).toContain('<style>');
  });

  it('resolves placeholders before rendering', async () => {
    const md = '# +++INS title+++\n\nPrepared for +++INS client+++';
    const path = writeTempMd(md);
    const result = await renderMarp(path, { title: 'My Deck', client: 'LINAGORA' }, 'html');

    const html = result.buffer.toString('utf-8');
    expect(html).toContain('My Deck');
    expect(html).toContain('LINAGORA');
    expect(html).not.toContain('+++INS');
  });

  it('resolves FOR loops in slide templates', async () => {
    const md = [
      '# Topics',
      '+++FOR item IN items+++',
      '- +++INS $item.name+++',
      '+++END-FOR item+++',
    ].join('\n');
    const path = writeTempMd(md);
    const result = await renderMarp(path, {
      items: [{ name: 'Alpha' }, { name: 'Beta' }],
    }, 'html');

    const html = result.buffer.toString('utf-8');
    expect(html).toContain('Alpha');
    expect(html).toContain('Beta');
  });

  it('throws on unsupported output type', async () => {
    const path = writeTempMd('# test');
    await expect(
      renderMarp(path, {}, 'pdf' as any),
    ).rejects.toThrow('Unsupported Marp output type: pdf');
  });
});
