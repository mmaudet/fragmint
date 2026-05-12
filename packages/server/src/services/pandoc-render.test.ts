import { describe, it, expect } from 'vitest';
import { renderMarkdownToDocx } from './pandoc-render.js';

describe('renderMarkdownToDocx', () => {
  it('produces a DOCX buffer with a recognizable header', async () => {
    const buf = await renderMarkdownToDocx('# Hello\n\nWorld.');
    // .docx files are ZIP archives, starting with PK\x03\x04
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf.length).toBeGreaterThan(100);
  }, 15000);

  it('throws with a helpful message on invalid reference-doc path', async () => {
    await expect(
      renderMarkdownToDocx('# x', '/nonexistent/path.docx'),
    ).rejects.toThrow(/reference|pandoc/i);
  }, 15000);
});
