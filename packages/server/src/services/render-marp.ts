/**
 * Marp-based renderer for Markdown slide decks.
 *
 * Supports two output types:
 *   - html: self-contained HTML presentation via @marp-team/marp-core
 *   - pptx: PowerPoint export via @marp-team/marp-cli (spawned as child process)
 *
 * Placeholders in the Markdown template are resolved before rendering.
 */
import { readFileSync } from 'node:fs';
import { Marp } from '@marp-team/marp-core';
import { resolvePlaceholders } from './render-placeholder.js';
import type { RenderResult } from './render-engine.js';

export async function renderMarp(
  templatePath: string,
  data: Record<string, any>,
  outputType: 'html' | 'pptx',
): Promise<RenderResult> {
  const templateMd = readFileSync(templatePath, 'utf-8');
  const resolvedMd = resolvePlaceholders(templateMd, data);

  if (outputType === 'html') {
    const marp = new Marp();
    const { html, css } = marp.render(resolvedMd);
    const fullHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>${css}</style></head>
<body>${html}</body>
</html>`;
    return { buffer: Buffer.from(fullHtml), format: 'slides' };
  }

  if (outputType === 'pptx') {
    const { writeFileSync, unlinkSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { randomUUID } = await import('node:crypto');
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { createRequire } = await import('node:module');
    const execFileAsync = promisify(execFile);

    // Resolve the CLI binary entry (marp-cli.js), not the library entry point (lib/index.js).
    // require.resolve('@marp-team/marp-cli') returns the library; the argv-driven CLI lives at
    // <pkg-root>/marp-cli.js — get there via the package.json manifest.
    const { dirname, join: pathJoin } = await import('node:path');
    const require = createRequire(import.meta.url);
    const marpPkgDir = dirname(require.resolve('@marp-team/marp-cli/package.json'));
    const marpCliMain = pathJoin(marpPkgDir, 'marp-cli.js');

    const tmpMd = join(tmpdir(), `marp-${randomUUID()}.md`);
    const tmpPptx = tmpMd.replace('.md', '.pptx');
    writeFileSync(tmpMd, resolvedMd);

    try {
      await execFileAsync(process.execPath, [marpCliMain, tmpMd, '--pptx', '-o', tmpPptx], {
        timeout: 60_000,
      });
      const buffer = readFileSync(tmpPptx);
      return { buffer, format: 'pptx' };
    } finally {
      try { unlinkSync(tmpMd); } catch { /* ignore */ }
      try { unlinkSync(tmpPptx); } catch { /* ignore */ }
    }
  }

  throw new Error(`Unsupported Marp output type: ${outputType}`);
}
