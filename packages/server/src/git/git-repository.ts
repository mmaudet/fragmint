import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface GitLogEntry {
  commit: string;
  author: string;
  date: string;
  message: string;
}

export class GitRepository {
  constructor(private readonly repoPath: string) {}

  async init(): Promise<void> {
    await this.exec('init');
    await this.exec('config', 'user.email', 'fragmint@localhost');
    await this.exec('config', 'user.name', 'Fragmint');
  }

  async commit(filePath: string, message: string): Promise<string> {
    await this.exec('add', filePath);
    const { stdout } = await this.exec('commit', '-m', message);
    const match = stdout.match(/\[[\w/.()\- ]+ ([a-f0-9]+)\]/);
    return match ? match[1] : '';
  }

  async log(filePath?: string, limit = 20): Promise<GitLogEntry[]> {
    // Use NUL byte as record separator to avoid delimiter collisions
    const SEP = '%x00';
    const args = ['log', `--max-count=${limit}`, `--format=%H%n%an%n%ai%n%s${SEP}`];
    if (filePath) args.push('--follow', '--', filePath);
    const { stdout } = await this.exec(...args);
    if (!stdout.trim()) return [];

    return stdout.trim().split('\0').filter(Boolean).map((block) => {
      const [commit, author, date, ...messageParts] = block.trim().split('\n');
      return { commit, author, date, message: messageParts.join('\n') };
    });
  }

  async diff(commit1: string, commit2: string, filePath?: string): Promise<string> {
    const args = ['diff', commit1, commit2];
    if (filePath) args.push('--', filePath);
    const { stdout } = await this.exec(...args);
    return stdout;
  }

  async show(commit: string, filePath: string): Promise<string> {
    const { stdout } = await this.exec('show', `${commit}:${filePath}`);
    return stdout;
  }

  async restore(commit: string, filePath: string): Promise<void> {
    await this.exec('checkout', commit, '--', filePath);
  }

  async getHead(): Promise<string> {
    const { stdout } = await this.exec('rev-parse', 'HEAD');
    return stdout.trim();
  }

  async getModifiedFiles(sinceCommit?: string): Promise<string[]> {
    const ref = sinceCommit || 'HEAD~1';
    try {
      const { stdout } = await this.exec('diff', '--name-only', ref, 'HEAD');
      return stdout.trim().split('\n').filter(Boolean);
    } catch {
      const { stdout } = await this.exec('ls-files');
      return stdout.trim().split('\n').filter(Boolean);
    }
  }

  private async exec(...args: string[]) {
    return execFileAsync('git', args, { cwd: this.repoPath });
  }
}
