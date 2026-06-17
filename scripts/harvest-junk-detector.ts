/**
 * harvest-junk-detector.ts
 * Lists all suspect fragments / harvest candidates above a junkiness threshold.
 *
 * Usage:
 *   npx tsx scripts/harvest-junk-detector.ts --collection <slug> [--db <path>] [--threshold 0.4]
 *   npx tsx scripts/harvest-junk-detector.ts --job <jobId>       [--db <path>] [--threshold 0.4]
 *   npx tsx scripts/harvest-junk-detector.ts --help
 */

import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { junkinessScore } from '../packages/server/src/services/dedupe/junkiness-filter.js';

// Load better-sqlite3 from server package (not hoisted to monorepo root)
const __dirname = dirname(fileURLToPath(import.meta.url));
const serverRequire = createRequire(resolve(__dirname, '../packages/server/package.json'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Database: any = serverRequire('better-sqlite3');

// ── CLI parsing ───────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
harvest-junk-detector — list suspect junk fragments above a score threshold

Usage:
  npx tsx scripts/harvest-junk-detector.ts --collection <slug> [--db <path>] [--threshold 0.4]
  npx tsx scripts/harvest-junk-detector.ts --job <jobId>       [--db <path>] [--threshold 0.4]
  npx tsx scripts/harvest-junk-detector.ts --help

Options:
  --collection <slug>    Inspect fragments in this collection
  --job <jobId>          Inspect harvest candidates for this job
  --db <path>            Path to fragmint.db  [default: ./example-vault/fragmint.db]
  --threshold <n>        Junkiness score threshold (default: 0.4)
  --help                 Show this message
`);
}

interface Args {
  mode: 'job' | 'collection';
  id: string;
  dbPath: string;
  threshold: number;
}

function parseArgs(): Args | null {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.length === 0) {
    printHelp();
    process.exit(0);
  }

  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };

  const job = get('--job');
  const collection = get('--collection');
  const dbArg = get('--db');
  const thresholdStr = get('--threshold');

  if (!job && !collection) {
    console.error('Error: provide --job <jobId> or --collection <slug>');
    process.exit(1);
  }
  if (job && collection) {
    console.error('Error: --job and --collection are mutually exclusive');
    process.exit(1);
  }

  const threshold = thresholdStr !== undefined ? parseFloat(thresholdStr) : 0.4;
  if (isNaN(threshold) || threshold < 0 || threshold > 1) {
    console.error('Error: --threshold must be a number between 0 and 1');
    process.exit(1);
  }

  let dbPath: string;
  if (dbArg) {
    dbPath = resolve(dbArg);
  } else {
    const vaultPath = process.env['FRAGMINT_STORE_PATH'];
    dbPath = vaultPath
      ? resolve(vaultPath, 'fragmint.db')
      : resolve('./example-vault/fragmint.db');
  }

  return {
    mode: job ? 'job' : 'collection',
    id: (job ?? collection)!,
    dbPath,
    threshold,
  };
}

// ── Signal helpers ────────────────────────────────────────────────────────────

const TOC_PATTERN = /table\s+des\s+mati[eè]res|table\s+of\s+contents|annexe\s+[a-z0-9]/i;

function computeSignals(body: string): { len: number; sepRatio: number; isToc: boolean } {
  const trimmed = body.trim();
  const len = trimmed.length;
  const sepRatio = len > 0 ? (trimmed.match(/[-=_.+*#~^]/g)?.length ?? 0) / len : 0;
  const isToc = TOC_PATTERN.test(trimmed);
  return { len, sepRatio, isToc };
}

// ── Table rendering ───────────────────────────────────────────────────────────

interface SuspectRow {
  id: string;
  score: number;
  len: number;
  sepRatio: number;
  isToc: boolean;
  bodyPreview: string;
}

function renderTable(rows: SuspectRow[]): void {
  const W = [22, 7, 6, 10, 8, 40];
  const headers = ['ID', 'Score', 'Len', 'Sep ratio', 'Is TOC?', 'Body (first 40 chars)'];

  const cell = (s: string, w: number) => ` ${s.padEnd(w).slice(0, w)} `;
  const hBorder = () => '┌' + W.map((w) => '─'.repeat(w + 2)).join('┬') + '┐';
  const mBorder = () => '├' + W.map((w) => '─'.repeat(w + 2)).join('┼') + '┤';
  const fBorder = () => '└' + W.map((w) => '─'.repeat(w + 2)).join('┴') + '┘';

  console.log(hBorder());
  console.log('│' + headers.map((h, i) => cell(h, W[i])).join('│') + '│');
  console.log(mBorder());

  for (const row of rows) {
    console.log('│' + [
      cell(row.id.slice(0, W[0]), W[0]),
      cell(row.score.toFixed(2), W[1]),
      cell(String(row.len), W[2]),
      cell(row.sepRatio.toFixed(2), W[3]),
      cell(row.isToc ? 'yes' : 'no', W[4]),
      cell(row.bodyPreview, W[5]),
    ].join('│') + '│');
  }

  console.log(fBorder());
}

// ── Row types ─────────────────────────────────────────────────────────────────

interface CandidateRow { id: string; body: string; }
interface FragmentRow { id: string; body_excerpt: string | null; }

// ── Main ──────────────────────────────────────────────────────────────────────

function checkTable(db: ReturnType<typeof Database>, tableName: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(tableName) as { name: string } | undefined;
  return row !== undefined;
}

function run(args: Args): void {
  const db = new Database(args.dbPath, { readonly: true });

  console.log('=== Junk Detector ===');
  console.log(`Mode: ${args.mode} ${args.id} | Threshold: ${args.threshold.toFixed(2)}`);
  console.log('');

  let suspects: SuspectRow[] = [];

  if (args.mode === 'job') {
    if (!checkTable(db, 'harvest_candidates')) {
      console.error(`Error: harvest_candidates table not found in ${args.dbPath}. Run the server once to initialize.`);
      db.close(); process.exit(1);
    }

    const candidates = db
      .prepare('SELECT id, body FROM harvest_candidates WHERE job_id = ?')
      .all(args.id) as CandidateRow[];

    if (candidates.length === 0) {
      console.log(`No candidates found for job "${args.id}".`);
      db.close(); return;
    }

    suspects = candidates
      .map((c) => {
        const body = c.body ?? '';
        const signals = computeSignals(body);
        return { id: c.id, score: junkinessScore(body), ...signals, bodyPreview: body.replace(/\n/g, ' ').slice(0, 40) };
      })
      .filter((r) => r.score >= args.threshold)
      .sort((a, b) => b.score - a.score);

  } else {
    if (!checkTable(db, 'fragments')) {
      console.error(`Error: fragments table not found in ${args.dbPath}. Run the server once to initialize.`);
      db.close(); process.exit(1);
    }

    const fragments = db
      .prepare('SELECT id, body_excerpt FROM fragments WHERE collection_slug = ?')
      .all(args.id) as FragmentRow[];

    if (fragments.length === 0) {
      console.log(`No fragments found for collection "${args.id}".`);
      db.close(); return;
    }

    suspects = fragments
      .map((f) => {
        const body = f.body_excerpt ?? '';
        const signals = computeSignals(body);
        return { id: f.id, score: junkinessScore(body), ...signals, bodyPreview: body.replace(/\n/g, ' ').slice(0, 40) };
      })
      .filter((r) => r.score >= args.threshold)
      .sort((a, b) => b.score - a.score);
  }

  const noun = args.mode === 'job' ? 'candidates' : 'fragments';
  console.log(`Found ${suspects.length} suspect ${noun} (score >= ${args.threshold.toFixed(2)})`);
  console.log('');

  if (suspects.length === 0) {
    console.log('No suspects — pipeline output looks clean.');
    db.close(); return;
  }

  renderTable(suspects);

  console.log('');
  const highCount = suspects.filter((s) => s.score >= 0.7).length;
  const rec = highCount > 0
    ? `Review these ${suspects.length} ${noun}. Consider deleting ${highCount} with score >= 0.7.`
    : `Review these ${suspects.length} ${noun}.`;
  console.log(`Recommendation: ${rec}`);

  db.close();
}

// ── Entry point ───────────────────────────────────────────────────────────────

const args = parseArgs();
if (args) run(args);
