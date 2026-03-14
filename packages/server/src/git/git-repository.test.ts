import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GitRepository } from './git-repository.js';

describe('GitRepository', () => {
  let dir: string;
  let repo: GitRepository;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fragmint-git-'));
    repo = new GitRepository(dir);
    await repo.init();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true });
  });

  it('commits a file and returns hash', async () => {
    const file = join(dir, 'test.md');
    writeFileSync(file, '# Hello\n');
    const hash = await repo.commit(file, 'initial commit');
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });

  it('returns log entries', async () => {
    const file = join(dir, 'test.md');
    writeFileSync(file, '# v1\n');
    await repo.commit(file, 'first');
    writeFileSync(file, '# v2\n');
    await repo.commit(file, 'second');

    const log = await repo.log(file);
    expect(log.length).toBe(2);
    expect(log[0].message).toBe('second');
  });

  it('diffs between commits', async () => {
    const file = join(dir, 'test.md');
    writeFileSync(file, '# v1\n');
    await repo.commit(file, 'first');
    const hash1 = await repo.getHead();
    writeFileSync(file, '# v2\n');
    await repo.commit(file, 'second');
    const hash2 = await repo.getHead();

    const diff = await repo.diff(hash1, hash2, file);
    expect(diff).toContain('-# v1');
    expect(diff).toContain('+# v2');
  });
});
