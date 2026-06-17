/**
 * Marp-based renderer for Markdown slide decks.
 *
 * Supports two output types:
 *   - html: self-contained HTML presentation via @marp-team/marp-core
 *   - pptx: PowerPoint export via @marp-team/marp-cli (spawned as child process)
 *
 * Placeholders in the Markdown template are resolved before rendering.
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { Marp } from '@marp-team/marp-core';
import { resolvePlaceholders } from './render-placeholder.js';
import type { RenderResult } from './render-engine.js';

const execFileAsync = promisify(execFile);

/**
 * Invoke Marp CLI to convert a Markdown file to PPTX.
 * Throws with a human-readable message on timeout or non-zero exit.
 */
async function runMarpCli(marpCliMain: string, inputMd: string, outputPptx: string): Promise<void> {
  let result: { stderr: string };
  try {
    result = await execFileAsync(
      process.execPath,
      [marpCliMain, '--no-stdin', inputMd, '--pptx', '-o', outputPptx],
      { timeout: 60_000 },
    );
  } catch (err) {
    const execErr = err as NodeJS.ErrnoException & { killed?: boolean };
    if (execErr.killed) {
      throw new Error('PPTX export timed out after 60s — slide deck may be too large.');
    }
    throw new Error(`PPTX export failed (Marp CLI error): ${execErr.message}`);
  }
  if (result.stderr) console.warn('render-marp pptx stderr:', result.stderr);
}

export async function renderMarp(
  templatePath: string,
  data: Record<string, any>,
  outputType: 'html' | 'pptx',
): Promise<RenderResult> {
  let templateMd: string;
  try {
    templateMd = readFileSync(templatePath, 'utf-8');
  } catch {
    throw new Error(`Marp template not found or unreadable: ${templatePath}`);
  }
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
    const require = createRequire(import.meta.url);
    let marpCliMain: string;
    try {
      const marpPkgDir = dirname(require.resolve('@marp-team/marp-cli/package.json'));
      marpCliMain = join(marpPkgDir, 'marp-cli.js');
    } catch {
      throw new Error('PPTX export unavailable: @marp-team/marp-cli not installed. Rebuild the Docker image with: docker compose -f docker/docker-compose.dev.yml build --no-cache');
    }

    const tmpMd = join(tmpdir(), `marp-${randomUUID()}.md`);
    const tmpPptx = tmpMd.replace('.md', '.pptx');
    writeFileSync(tmpMd, resolvedMd);

    try {
      await runMarpCli(marpCliMain, tmpMd, tmpPptx);
      if (!existsSync(tmpPptx)) {
        throw new Error('PPTX export failed: Marp CLI produced no output file.');
      }
      const buffer = readFileSync(tmpPptx);
      return { buffer, format: 'pptx' };
    } finally {
      for (const f of [tmpMd, tmpPptx]) {
        try {
          unlinkSync(f);
        } catch (cleanupErr) {
          console.warn(`render-marp: failed to clean up temp file ${f}:`, cleanupErr);
        }
      }
    }
  }

  throw new Error(`Unsupported Marp output type: ${outputType}`);
}

/**
 * Render an in-memory Markdown string via Marp, without a template file on disk.
 * Used by plan export (draft_markdown has no Marp template file to reference).
 */
export async function renderMarpFromString(
  mdContent: string,
  outputType: 'html' | 'pptx',
): Promise<RenderResult> {
  if (outputType === 'html') {
    const marp = new Marp();
    const { html, css } = marp.render(mdContent);
    const fullHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>${css}</style></head>
<body>${html}</body>
</html>`;
    return { buffer: Buffer.from(fullHtml), format: 'slides' };
  }

  if (outputType === 'pptx') {
    const require = createRequire(import.meta.url);
    let marpCliMain: string;
    try {
      const marpPkgDir = dirname(require.resolve('@marp-team/marp-cli/package.json'));
      marpCliMain = join(marpPkgDir, 'marp-cli.js');
    } catch {
      throw new Error('PPTX export unavailable: @marp-team/marp-cli not installed. Rebuild the Docker image with: docker compose -f docker/docker-compose.dev.yml build --no-cache');
    }

    const tmpMd = join(tmpdir(), `marp-plan-${randomUUID()}.md`);
    const tmpPptx = tmpMd.replace('.md', '.pptx');
    writeFileSync(tmpMd, mdContent);

    try {
      await runMarpCli(marpCliMain, tmpMd, tmpPptx);
      if (!existsSync(tmpPptx)) {
        throw new Error('PPTX export failed: Marp CLI produced no output file.');
      }
      const buffer = readFileSync(tmpPptx);
      return { buffer, format: 'pptx' };
    } finally {
      for (const f of [tmpMd, tmpPptx]) {
        try { unlinkSync(f); } catch { /* ignore */ }
      }
    }
  }

  throw new Error(`Unsupported Marp output type: ${outputType}`);
}

