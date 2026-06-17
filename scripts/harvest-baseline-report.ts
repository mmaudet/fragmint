/**
 * harvest-baseline-report.ts
 * Produces a quality baseline report for a harvest job or fragment collection.
 *
 * Usage:
 *   npx tsx scripts/harvest-baseline-report.ts --job <jobId> [--db <path>] [--json <outfile>]
 *   npx tsx scripts/harvest-baseline-report.ts --collection <slug> [--db <path>] [--json <outfile>]
 *   npx tsx scripts/harvest-baseline-report.ts --help
 */

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { junkinessScore } from '../packages/server/src/services/dedupe/junkiness-filter.js';
import {
  generateShingles,
  jaccardSimilarity,
} from '../packages/server/src/services/dedupe/shingles.js';

// Load better-sqlite3 from server package (not hoisted to monorepo root)
const __dirname = dirname(fileURLToPath(import.meta.url));
const serverRequire = createRequire(resolve(__dirname, '../packages/server/package.json'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Database: any = serverRequire('better-sqlite3');

// ── CLI parsing ───────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
harvest-baseline-report — harvest pipeline quality baseline

Usage:
  npx tsx scripts/harvest-baseline-report.ts --job <jobId>        [--db <path>] [--json <out>]
  npx tsx scripts/harvest-baseline-report.ts --collection <slug>  [--db <path>] [--json <out>]
  npx tsx scripts/harvest-baseline-report.ts --help

Options:
  --job <jobId>          Report on a harvest job (reads harvest_candidates)
  --collection <slug>    Report on a collection (reads fragments)
  --db <path>            Path to fragmint.db  [default: ./example-vault/fragmint.db]
  --json <outfile>       Also write metrics as JSON to this file
  --help                 Show this message
`);
}

interface Args {
  mode: 'job' | 'collection';
  id: string;
  dbPath: string;
  jsonOut?: string;
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
  const jsonOut = get('--json');

  if (!job && !collection) {
    console.error('Error: provide --job <jobId> or --collection <slug>');
    process.exit(1);
  }
  if (job && collection) {
    console.error('Error: --job and --collection are mutually exclusive');
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
    jsonOut,
  };
}

// ── Stats helpers ─────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(p * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function pct(count: number, total: number): string {
  if (total === 0) return '0.0%';
  return ((count / total) * 100).toFixed(1) + '%';
}

function pad(s: string | number, width: number): string {
  return String(s).padStart(width);
}

function countBy<T>(arr: T[], key: (item: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const item of arr) {
    const k = key(item);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return new Map([...m.entries()].sort((a, b) => b[1] - a[1]));
}

// ── Row types ─────────────────────────────────────────────────────────────────

interface CandidateRow {
  id: string;
  title: string;
  body: string;
  type: string;
  domain: string;
  confidence: number | null;
  status: string;
  source_section: string | null;
}

interface FragmentRow {
  id: string;
  title: string | null;
  body_excerpt: string | null;
  type: string;
  domain: string;
  quality: string;
}

interface JobRow {
  id: string;
  status: string;
  files: string;
  pipeline: string;
  stats: string | null;
  created_at: string;
  updated_at: string;
  collection_slug: string | null;
}

interface JunkSuspect {
  id: string;
  score: number;
  body: string;
}

interface DupPair {
  a: string;
  b: string;
  jaccard: number;
  titlePreview: string;
}

function checkTable(db: ReturnType<typeof Database>, tableName: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(tableName) as { name: string } | undefined;
  return row !== undefined;
}

function buildReport(args: Args): void {
  const db = new Database(args.dbPath, { readonly: true });

  const now = new Date().toISOString();
  const lines: string[] = [];
  const emit = (s = '') => lines.push(s);
  const metrics: Record<string, unknown> = {};

  emit('=== Harvest Baseline Report ===');

  if (args.mode === 'job') {
    if (!checkTable(db, 'harvest_jobs')) {
      console.error(`Error: harvest_jobs table not found in ${args.dbPath}. Run the server once to initialize.`);
      db.close(); process.exit(1);
    }

    const job = db.prepare('SELECT * FROM harvest_jobs WHERE id = ?').get(args.id) as JobRow | undefined;
    if (!job) {
      console.error(`Error: job "${args.id}" not found`);
      db.close(); process.exit(1);
    }

    const candidates = db
      .prepare('SELECT id, title, body, type, domain, confidence, status, source_section FROM harvest_candidates WHERE job_id = ?')
      .all(args.id) as CandidateRow[];

    emit(`Mode: job ${job.id}`);
    emit(`Generated: ${now}`);
    emit('');

    const total = candidates.length;
    const pending = candidates.filter((c) => c.status === 'pending').length;
    const accepted = candidates.filter((c) => c.status === 'accepted').length;
    const rejected = candidates.filter((c) => c.status === 'rejected').length;

    emit('── Volume ──────────────────────────────────────────');
    emit(`Total candidates         : ${total}`);
    emit(`Pending                  : ${pending}`);
    emit(`Accepted                 : ${accepted}`);
    emit(`Rejected                 : ${rejected}`);
    emit('');
    metrics['volume'] = { total, pending, accepted, rejected };

    if (total === 0) {
      emit('(No candidates — nothing further to report.)');
      output(lines, metrics, args); db.close(); return;
    }

    const lengths = candidates.map((c) => (c.body ?? '').length).sort((a, b) => a - b);
    const shortCount = lengths.filter((l) => l < 80).length;
    const longCount = lengths.filter((l) => l > 3000).length;

    emit('── Body length (chars) ─────────────────────────────');
    emit(`min     : ${pad(lengths[0], 6)}`);
    emit(`p25     : ${pad(percentile(lengths, 0.25), 6)}`);
    emit(`median  : ${pad(percentile(lengths, 0.5), 6)}`);
    emit(`p75     : ${pad(percentile(lengths, 0.75), 6)}`);
    emit(`p95     : ${pad(percentile(lengths, 0.95), 6)}`);
    emit(`max     : ${pad(lengths[lengths.length - 1], 6)}`);
    emit(`< 80 chars  : ${shortCount} (${pct(shortCount, total)})` + (shortCount / total > 0.05 ? '  <- WARN > 5%' : ''));
    emit(`> 3000 chars: ${longCount} (${pct(longCount, total)})`);
    emit('');
    metrics['bodyLength'] = { min: lengths[0], p25: percentile(lengths, 0.25), median: percentile(lengths, 0.5), p75: percentile(lengths, 0.75), p95: percentile(lengths, 0.95), max: lengths[lengths.length - 1], shortCount, longCount };

    emit('── Types ───────────────────────────────────────────');
    const typeCounts = countBy(candidates, (c) => c.type);
    for (const [t, cnt] of typeCounts) emit(`${t.padEnd(20)}: ${cnt} (${pct(cnt, total)})`);
    emit('');
    metrics['types'] = Object.fromEntries(typeCounts);

    emit('── Domains ─────────────────────────────────────────');
    const domainCounts = countBy(candidates, (c) => c.domain);
    for (const [d, cnt] of domainCounts) emit(`${d.padEnd(20)}: ${cnt} (${pct(cnt, total)})`);
    emit('');
    metrics['domains'] = Object.fromEntries(domainCounts);

    const confs = candidates.map((c) => c.confidence).filter((c): c is number => c !== null && c !== undefined).sort((a, b) => a - b);
    emit('── Confidence ──────────────────────────────────────');
    if (confs.length === 0) {
      emit('(no confidence values)');
    } else {
      const lt05 = confs.filter((c) => c < 0.5).length;
      const b0507 = confs.filter((c) => c >= 0.5 && c < 0.7).length;
      const b0709 = confs.filter((c) => c >= 0.7 && c < 0.9).length;
      const gte09 = confs.filter((c) => c >= 0.9).length;
      const confMedian = percentile(confs, 0.5);
      emit(`< 0.5  : ${lt05} (${pct(lt05, confs.length)})` + (lt05 / confs.length > 0.1 ? '  <- WARN > 10%' : ''));
      emit(`0.5-0.7: ${b0507} (${pct(b0507, confs.length)})`);
      emit(`0.7-0.9: ${b0709} (${pct(b0709, confs.length)})`);
      emit(`>= 0.9  : ${gte09} (${pct(gte09, confs.length)})`);
      emit(`median : ${confMedian.toFixed(2)}`);
      metrics['confidence'] = { lt05, b0507, b0709, gte09, median: confMedian };
    }
    emit('');

    const ssFilled = candidates.filter((c) => c.source_section !== null && c.source_section !== '').length;
    emit('── source_section fill rate ────────────────────────');
    emit(`Non-null: ${ssFilled}/${total} (${pct(ssFilled, total)})` + (ssFilled / total < 0.8 ? '  <- WARN < 80%' : ''));
    emit('');
    metrics['sourceSection'] = { filled: ssFilled, total };

    const junkSuspects: JunkSuspect[] = candidates
      .map((c) => ({ id: c.id, score: junkinessScore(c.body ?? ''), body: c.body ?? '' }))
      .filter((c) => c.score >= 0.4)
      .sort((a, b) => b.score - a.score);

    emit('── Junk suspects (score >= 0.4) ─────────────────────');
    emit(`Count: ${junkSuspects.length}`);
    for (const s of junkSuspects) emit(`  [${s.id}] score=${s.score.toFixed(2)}  "${s.body.replace(/\n/g, ' ').slice(0, 40)}"`);
    emit('');
    metrics['junkSuspects'] = junkSuspects.map((s) => ({ id: s.id, score: s.score }));

    const dupPairs: DupPair[] = [];
    const withTitles = candidates.filter((c) => c.title && c.title.trim().length > 0);
    for (let i = 0; i < withTitles.length; i++) {
      for (let j = i + 1; j < withTitles.length; j++) {
        const jaccard = jaccardSimilarity(generateShingles(withTitles[i].title.toLowerCase(), 3), generateShingles(withTitles[j].title.toLowerCase(), 3));
        if (jaccard >= 0.7) dupPairs.push({ a: withTitles[i].id, b: withTitles[j].id, jaccard, titlePreview: withTitles[i].title.slice(0, 40) });
      }
    }

    emit('── Duplicate suspects (title Jaccard >= 0.7) ────────');
    emit(`Count: ${dupPairs.length} pairs`);
    for (const p of dupPairs) emit(`  [${p.a}] <-> [${p.b}]  Jaccard=${p.jaccard.toFixed(2)}  "${p.titlePreview}"`);
    emit('');
    metrics['dupSuspects'] = dupPairs;

    const stats = job.stats ? (() => { try { return JSON.parse(job.stats!); } catch { return {}; } })() : {};
    const durationSec = Math.round((new Date(job.updated_at).getTime() - new Date(job.created_at).getTime()) / 1000);
    let fileCount = 1;
    try { fileCount = JSON.parse(job.files).length; } catch { /* ignore */ }

    emit('── System ──────────────────────────────────────────');
    if (!isNaN(durationSec)) emit(`Job duration : ${durationSec}s`);
    emit(`Files        : ${fileCount}`);
    emit(`Pipeline     : ${job.pipeline}`);
    if (stats['totalBlocks'] !== undefined) emit(`Total blocks : ${stats['totalBlocks']}`);
    metrics['system'] = { pipeline: job.pipeline, fileCount, durationSec };

  } else {
    // ── COLLECTION MODE ───────────────────────────────────────────────────────

    if (!checkTable(db, 'fragments')) {
      console.error(`Error: fragments table not found in ${args.dbPath}. Run the server once to initialize.`);
      db.close(); process.exit(1);
    }

    const rows = db
      .prepare('SELECT id, title, body_excerpt, type, domain, quality FROM fragments WHERE collection_slug = ?')
      .all(args.id) as FragmentRow[];

    emit(`Mode: collection ${args.id}`);
    emit(`Generated: ${now}`);
    emit('');

    const total = rows.length;
    emit('── Volume ──────────────────────────────────────────');
    emit(`Total fragments          : ${total}`);
    emit('');
    metrics['volume'] = { total };

    if (total === 0) {
      emit('(No fragments in this collection — nothing further to report.)');
      output(lines, metrics, args); db.close(); return;
    }

    const lengths = rows.map((r) => (r.body_excerpt ?? '').length).sort((a, b) => a - b);
    const shortCount = lengths.filter((l) => l < 80).length;
    const longCount = lengths.filter((l) => l > 3000).length;

    emit('── Body excerpt length (chars) ─────────────────────');
    emit(`min     : ${pad(lengths[0], 6)}`);
    emit(`p25     : ${pad(percentile(lengths, 0.25), 6)}`);
    emit(`median  : ${pad(percentile(lengths, 0.5), 6)}`);
    emit(`p75     : ${pad(percentile(lengths, 0.75), 6)}`);
    emit(`p95     : ${pad(percentile(lengths, 0.95), 6)}`);
    emit(`max     : ${pad(lengths[lengths.length - 1], 6)}`);
    emit(`< 80 chars  : ${shortCount} (${pct(shortCount, total)})` + (shortCount / total > 0.05 ? '  <- WARN > 5%' : ''));
    emit(`> 3000 chars: ${longCount} (${pct(longCount, total)})`);
    emit('');
    metrics['bodyLength'] = { min: lengths[0], p25: percentile(lengths, 0.25), median: percentile(lengths, 0.5), p75: percentile(lengths, 0.75), p95: percentile(lengths, 0.95), max: lengths[lengths.length - 1], shortCount, longCount };

    emit('── Types ───────────────────────────────────────────');
    const typeCounts = countBy(rows, (r) => r.type);
    for (const [t, cnt] of typeCounts) emit(`${t.padEnd(20)}: ${cnt} (${pct(cnt, total)})`);
    emit('');
    metrics['types'] = Object.fromEntries(typeCounts);

    emit('── Domains ─────────────────────────────────────────');
    const domainCounts = countBy(rows, (r) => r.domain);
    for (const [d, cnt] of domainCounts) emit(`${d.padEnd(20)}: ${cnt} (${pct(cnt, total)})`);
    emit('');
    metrics['domains'] = Object.fromEntries(domainCounts);

    emit('── Quality ─────────────────────────────────────────');
    const qualityCounts = countBy(rows, (r) => r.quality);
    for (const [q, cnt] of qualityCounts) emit(`${q.padEnd(20)}: ${cnt} (${pct(cnt, total)})`);
    emit('');
    metrics['quality'] = Object.fromEntries(qualityCounts);

    const junkSuspects: JunkSuspect[] = rows
      .map((r) => ({ id: r.id, score: junkinessScore(r.body_excerpt ?? ''), body: r.body_excerpt ?? '' }))
      .filter((r) => r.score >= 0.4)
      .sort((a, b) => b.score - a.score);

    emit('── Junk suspects (score >= 0.4) ─────────────────────');
    emit(`Count: ${junkSuspects.length}`);
    for (const s of junkSuspects) emit(`  [${s.id}] score=${s.score.toFixed(2)}  "${s.body.replace(/\n/g, ' ').slice(0, 40)}"`);
    emit('');
    metrics['junkSuspects'] = junkSuspects.map((s) => ({ id: s.id, score: s.score }));

    const dupPairs: DupPair[] = [];
    const withTitles = rows.filter((r) => r.title && r.title.trim().length > 0);
    for (let i = 0; i < withTitles.length; i++) {
      for (let j = i + 1; j < withTitles.length; j++) {
        const tA = withTitles[i].title ?? '';
        const tB = withTitles[j].title ?? '';
        const jaccard = jaccardSimilarity(generateShingles(tA.toLowerCase(), 3), generateShingles(tB.toLowerCase(), 3));
        if (jaccard >= 0.7) dupPairs.push({ a: withTitles[i].id, b: withTitles[j].id, jaccard, titlePreview: tA.slice(0, 40) });
      }
    }

    emit('── Duplicate suspects (title Jaccard >= 0.7) ────────');
    emit(`Count: ${dupPairs.length} pairs`);
    for (const p of dupPairs) emit(`  [${p.a}] <-> [${p.b}]  Jaccard=${p.jaccard.toFixed(2)}  "${p.titlePreview}"`);
    emit('');
    metrics['dupSuspects'] = dupPairs;
  }

  output(lines, metrics, args);
  db.close();
}

function output(lines: string[], metrics: Record<string, unknown>, args: Args): void {
  console.log(lines.join('\n'));
  if (args.jsonOut) {
    writeFileSync(args.jsonOut, JSON.stringify(metrics, null, 2), 'utf-8');
    console.error(`\nJSON written to ${args.jsonOut}`);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

const args = parseArgs();
if (args) buildReport(args);
