import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const TIMEOUT_MS = 30_000;

async function renderMarkdownToOffice(
  markdown: string,
  format: 'docx' | 'pptx',
  referenceDocPath?: string,
): Promise<Buffer> {
  let effectiveRef = referenceDocPath;
  if (effectiveRef && !existsSync(effectiveRef)) {
    console.warn(`[pandoc] Reference doc not found, exporting without style: ${effectiveRef}`);
    effectiveRef = undefined;
  }

  const id = randomUUID();
  const mdPath = join(tmpdir(), `fragmint-plan-${id}.md`);
  const outPath = join(tmpdir(), `fragmint-plan-${id}.${format}`);
  writeFileSync(mdPath, markdown, 'utf-8');

  const args = ['-f', 'markdown', '-t', format, '-o', outPath];
  if (effectiveRef) args.push(`--reference-doc=${effectiveRef}`);
  args.push(mdPath);

  try {
    await runPandoc(args);
    return readFileSync(outPath);
  } finally {
    for (const f of [mdPath, outPath]) {
      if (existsSync(f)) try { unlinkSync(f); } catch (_) {}
    }
  }
}

export function renderMarkdownToDocx(markdown: string, referenceDocPath?: string): Promise<Buffer> {
  return renderMarkdownToOffice(markdown, 'docx', referenceDocPath);
}

export function renderMarkdownToPptx(markdown: string, referenceDocPath?: string): Promise<Buffer> {
  return renderMarkdownToOffice(markdown, 'pptx', referenceDocPath);
}

function runPandoc(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('pandoc', args);
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Pandoc timed out after 30s'));
    }, TIMEOUT_MS);
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (child as unknown as NodeJS.EventEmitter).on('error', (err: Error) => {
      clearTimeout(timer);
      reject(new Error(`Pandoc spawn error: ${err.message}`));
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (child as unknown as NodeJS.EventEmitter).on('close', (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      const truncated = stderr.length > 500 ? stderr.slice(0, 500) + '\n[truncated]' : stderr;
      reject(new Error(`Pandoc exited with code ${code}: ${truncated}`));
    });
  });
}
