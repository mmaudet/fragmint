import { describe, it, expect } from 'vitest';
import { renderReveal } from './render-reveal.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('renderReveal', () => {
  it('renders HTML template to full reveal.js document', async () => {
    const html = `<section>
  <h1>+++INS title+++</h1>
  <p>+++INS body+++</p>
</section>
<section>
  +++FOR slide IN slides+++
  <section><h2>+++INS $slide.heading+++</h2></section>
  +++END-FOR slide+++
</section>`;

    const tmpDir = mkdtempSync(join(tmpdir(), 'reveal-test-'));
    const tplPath = join(tmpDir, 'test.html');
    writeFileSync(tplPath, html);

    const result = await renderReveal(tplPath, {
      title: 'My Talk',
      body: 'Introduction text',
      slides: [{ heading: 'Part 1' }, { heading: 'Part 2' }],
    });

    expect(result.format).toBe('reveal');
    const output = result.buffer.toString();
    expect(output).toContain('My Talk');
    expect(output).toContain('Introduction text');
    expect(output).toContain('Part 1');
    expect(output).toContain('Part 2');
    expect(output).toContain('reveal.js');
    expect(output).toContain('Reveal.initialize');
    expect(output).toContain('<!DOCTYPE html>');
  });

  it('handles template without placeholders', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'reveal-test-'));
    const tplPath = join(tmpDir, 'static.html');
    writeFileSync(tplPath, '<section><h1>Static Slide</h1></section>');

    const result = await renderReveal(tplPath, {});
    expect(result.buffer.toString()).toContain('Static Slide');
  });
});
