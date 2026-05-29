/**
 * harvest-diff.ts
 * Compares two harvest jobs on the same document (before/after a pipeline change).
 * Shows deltas and a heuristic verdict.
 *
 * Usage:
 *   npx tsx scripts/harvest-diff.ts --before <jobId1> --after <jobId2> [--db <path>]
 *   npx tsx scripts/harvest-diff.ts --help
 */

import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load better-sqlite3 from server package (not hoisted to monorepo root)
const __dirname = dirname(fileURLToPath(import.meta.url));
const serverRequire = createRequire(resolve(__dirname, '../packages/server/package.json'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Database: any = serverRequire('better-sqlite3');

// ── CLI parsing ───────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
harvest-diff — compare two harvest jobs (before/after a pipeline change)

Usage:
  npx tsx scripts/harvest-diff.ts --before <jobId1> --after <jobId2> [--db <path>]
  npx tsx scripts/harvest-diff.ts --help

Options:
  --before <jobId>   Job ID for the baseline run
  --after  <jobId>   Job ID for the new run
  --db <path>        Path to fragmint.db  [default: ./example-vault/fragmint.db]
  --help             Show this message
`);
}

interface Args {
  beforeId: string;
  afterId: string;
  dbPath: string;
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

  const beforeId = get('--before');
  const afterId = get('--after');
  const dbArg = get('--db');

  if (!beforeId) {
    console.error('Error: --before <jobId> is required');
    process.exit(1);
  }
  if (!afterId) {
    console.error('Error: --after <jobId> is required');
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

  return { beforeId, afterId, dbPath };
}

// ── Row types ─────────────────────────────────────────────────────────────────

interface CandidateRow {
  id: string;
  body: string;
  confidence: number | null;
  status: string;
  source_section: string | null;
}

// ── Junkiness scoring (inlined — 4-signal formula from junkiness-filter.ts) ──

const MIN_CHARS = 30;
const SEP_CHAR_RATIO_THRESHOLD = 0.30;
const TOC_PATTERN = /table\s+des\s+mati[eè]res|table\s+of\s+contents|annexe\s+[a-z0-9]/i;
const SEPARATOR_LINE_PATTERN = /^[\s\-=_.+*#~^…]+$/;

function junkinessScore(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 1;
  const lengthScore = trimmed.length < MIN_CHARS ? 1 - trimmed.length / MIN_CHARS : 0;
  const sepChars = (trimmed.match(/[-=_.+*#~^.…]/g) ?? []).length;
  const sepRatio = sepChars / trimmed.length;
  const sepScore = Math.min(1, sepRatio / SEP_CHAR_RATIO_THRESHOLD);
  const isSepLine = SEPARATOR_LINE_PATTERN.test(trimmed) ? 1 : 0;
  const isToc = TOC_PATTERN.test(trimmed) ? 1 : 0;
  const strongSignal = Math.max(isSepLine * 0.9, isToc * 0.7);
  if (strongSignal > 0) {
    return Math.min(1, strongSignal * 0.7 + sepScore * 0.3 + lengthScore * 0.1);
  }
  const composite = lengthScore * 0.65 + sepScore * 0.45;
  return Math.min(1, composite);
}

// ── Stats helpers ─────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(p * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

// ── Shingles + Jaccard (inlined to avoid import) ──────────────────────────────

function generateShingles(text: string, k: number): Set<string> {
  const shingles = new Set<string>();
  for (let i = 0; i <= text.length - k; i++) {
    shingles.add(text.slice(i, i + k));
  }
  return shingles;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const s of a) { if (b.has(s)) intersection++; }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ── Job metrics ───────────────────────────────────────────────────────────────

interface JobMetrics {
  jobId: string;
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
  avgConfidence: number;
  medianBodyLength: number;
  shortFragmentsCount: number;  // < 80 chars
  junkSuspects: number;          // score >= 0.4
  sourceSectionFillPct: number;  // 0-100
  dupSuspectPairs: number;       // title Jaccard >= 0.7
}

function computeMetrics(db: ReturnType<typeof Database>, jobId: string): JobMetrics | null {
  // Verify job exists
  const job = db.prepare('SELECT id FROM harvest_jobs WHERE id = ?').get(jobId) as { id: string } | undefined;
  if (!job) return null;

  const candidates = db
    .prepare('SELECT id, body, confidence, status, source_section FROM harvest_candidates WHERE job_id = ?')
    .all(jobId) as CandidateRow[];

  const total = candidates.length;
  const pending = candidates.filter((c) => c.status === 'pending').length;
  const accepted = candidates.filter((c) => c.status === 'accepted').length;
  const rejected = candidates.filter((c) => c.status === 'rejected').length;

  const confs = candidates
    .map((c) => c.confidence)
    .filter((c): c is number => c !== null && c !== undefined);
  const avgConfidence = avg(confs);

  const lengths = candidates.map((c) => (c.body ?? '').length).sort((a, b) => a - b);
  const medianBodyLength = percentile(lengths, 0.5);
  const shortFragmentsCount = lengths.filter((l) => l < 80).length;

  const junkSuspects = candidates.filter((c) => junkinessScore(c.body ?? '') >= 0.4).length;

  const ssFilled = candidates.filter((c) => c.source_section !== null && c.source_section !== '').length;
  const sourceSectionFillPct = total > 0 ? (ssFilled / total) * 100 : 0;

  // Dup pairs via title shingles (Jaccard >= 0.7) — need title from DB
  interface WithTitle { id: string; title: string; }
  const withTitles = (db
    .prepare('SELECT id, title FROM harvest_candidates WHERE job_id = ? AND title IS NOT NULL AND title != ""')
    .all(jobId) as WithTitle[]);

  let dupSuspectPairs = 0;
  for (let i = 0; i < withTitles.length; i++) {
    for (let j = i + 1; j < withTitles.length; j++) {
      const jaccard = jaccardSimilarity(
        generateShingles(withTitles[i].title.toLowerCase(), 3),
        generateShingles(withTitles[j].title.toLowerCase(), 3),
      );
      if (jaccard >= 0.7) dupSuspectPairs++;
    }
  }

  return {
    jobId,
    total,
    pending,
    accepted,
    rejected,
    avgConfidence,
    medianBodyLength,
    shortFragmentsCount,
    junkSuspects,
    sourceSectionFillPct,
    dupSuspectPairs,
  };
}

// ── Formatting helpers ────────────────────────────────────────────────────────

const COL_LABEL = 28;
const COL_VAL = 10;

function col(s: string | number, width: number): string {
  return String(s).padEnd(width);
}

function colR(s: string | number, width: number): string {
  return String(s).padStart(width);
}

function deltaStr(before: number, after: number, isPercent = false): string {
  const d = after - before;
  const sign = d > 0 ? '+' : '';
  const suffix = isPercent ? '%' : '';
  return `${sign}${isPercent ? d.toFixed(1) : d}${suffix}`;
}

function trendArrow(before: number, after: number, higherIsBetter: boolean): string {
  if (after > before) return higherIsBetter ? '▲' : '▼ (regression)';
  if (after < before) return higherIsBetter ? '▼ (regression)' : '▲';
  return '→';
}

function fmtPct(n: number): string {
  return n.toFixed(1) + '%';
}

// ── Verdict heuristic ─────────────────────────────────────────────────────────

interface VerdictDetail {
  score: number;
  improved: string[];
  regressed: string[];
  neutral: string[];
}

function computeVerdict(b: JobMetrics, a: JobMetrics): VerdictDetail {
  let score = 0;
  const improved: string[] = [];
  const regressed: string[] = [];
  const neutral: string[] = [];

  // junk_suspects decreased → +1
  if (a.junkSuspects < b.junkSuspects) {
    score += 1;
    improved.push(`fewer junk suspects: ${b.junkSuspects} → ${a.junkSuspects}`);
  } else if (a.junkSuspects > b.junkSuspects) {
    score -= 1;
    regressed.push(`more junk suspects: ${b.junkSuspects} → ${a.junkSuspects}`);
  } else {
    neutral.push(`junk suspects unchanged: ${a.junkSuspects}`);
  }

  // avg_confidence increased >= 0.02 → +1
  const confDelta = a.avgConfidence - b.avgConfidence;
  if (confDelta >= 0.02) {
    score += 1;
    improved.push(`higher avg confidence: ${b.avgConfidence.toFixed(2)} → ${a.avgConfidence.toFixed(2)}`);
  } else if (confDelta <= -0.02) {
    score -= 1;
    regressed.push(`lower avg confidence: ${b.avgConfidence.toFixed(2)} → ${a.avgConfidence.toFixed(2)}`);
  } else {
    neutral.push(`avg confidence roughly stable: ${b.avgConfidence.toFixed(2)} → ${a.avgConfidence.toFixed(2)}`);
  }

  // source_section fill rate increased → +1
  if (a.sourceSectionFillPct > b.sourceSectionFillPct) {
    score += 1;
    improved.push(`source_section fill rate: ${fmtPct(b.sourceSectionFillPct)} → ${fmtPct(a.sourceSectionFillPct)}`);
  } else if (a.sourceSectionFillPct < b.sourceSectionFillPct) {
    score -= 1;
    regressed.push(`source_section fill rate dropped: ${fmtPct(b.sourceSectionFillPct)} → ${fmtPct(a.sourceSectionFillPct)}`);
  } else {
    neutral.push(`source_section fill rate unchanged: ${fmtPct(a.sourceSectionFillPct)}`);
  }

  // short_fragments_count decreased → +1
  if (a.shortFragmentsCount < b.shortFragmentsCount) {
    score += 1;
    improved.push(`fewer short fragments: ${b.shortFragmentsCount} → ${a.shortFragmentsCount}`);
  } else if (a.shortFragmentsCount > b.shortFragmentsCount) {
    score -= 1;
    regressed.push(`more short fragments: ${b.shortFragmentsCount} → ${a.shortFragmentsCount}`);
  } else {
    neutral.push(`short fragment count unchanged: ${a.shortFragmentsCount}`);
  }

  // dup_suspect_pairs decreased → +1
  if (a.dupSuspectPairs < b.dupSuspectPairs) {
    score += 1;
    improved.push(`fewer duplicate suspects: ${b.dupSuspectPairs} → ${a.dupSuspectPairs}`);
  } else if (a.dupSuspectPairs > b.dupSuspectPairs) {
    score -= 1;
    regressed.push(`more duplicate suspects: ${b.dupSuspectPairs} → ${a.dupSuspectPairs}`);
  } else {
    neutral.push(`duplicate suspect pairs unchanged: ${a.dupSuspectPairs}`);
  }

  // total_candidates in range [80, 160] and was outside before, OR total didn't regress much → +1
  const afterInRange = a.total >= 80 && a.total <= 160;
  const beforeInRange = b.total >= 80 && b.total <= 160;
  const totalDropPct = b.total > 0 ? (b.total - a.total) / b.total : 0;

  if (totalDropPct > 0.30) {
    // dropped > 30% → -2 (potential over-filtering)
    score -= 2;
    regressed.push(`total candidates dropped > 30%: ${b.total} → ${a.total} (${(totalDropPct * 100).toFixed(1)}%)`);
  } else if (afterInRange && !beforeInRange) {
    score += 1;
    improved.push(`total candidates moved into expected range [80-160]: ${b.total} → ${a.total}`);
  } else if (afterInRange) {
    score += 1;
    neutral.push(`Candidates count within expected range (80-160)`);
    // Promote to improved line in output
    improved.push(`fewer total candidates (reduced noise): ${b.total} → ${a.total}`);
  } else if (a.total > b.total && !afterInRange && b.total > 160) {
    score -= 1;
    regressed.push(`total candidates increased further outside range: ${b.total} → ${a.total}`);
  }

  return { score, improved, regressed, neutral };
}

// ── Main report ───────────────────────────────────────────────────────────────

function checkTable(db: ReturnType<typeof Database>, tableName: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(tableName) as { name: string } | undefined;
  return row !== undefined;
}

function runDiff(args: Args): void {
  const db = new Database(args.dbPath, { readonly: true });

  if (!checkTable(db, 'harvest_jobs')) {
    console.error(`Error: harvest_jobs table not found in ${args.dbPath}. Run the server once to initialize.`);
    db.close(); process.exit(1);
  }
  if (!checkTable(db, 'harvest_candidates')) {
    console.error(`Error: harvest_candidates table not found in ${args.dbPath}. Run the server once to initialize.`);
    db.close(); process.exit(1);
  }

  const before = computeMetrics(db, args.beforeId);
  if (!before) {
    console.error(`Error: job "${args.beforeId}" not found`);
    db.close(); process.exit(1);
  }

  const after = computeMetrics(db, args.afterId);
  if (!after) {
    console.error(`Error: job "${args.afterId}" not found`);
    db.close(); process.exit(1);
  }

  db.close();

  const now = new Date().toISOString();
  const sep = '─'.repeat(76);

  console.log(`=== Harvest Diff: ${args.beforeId} → ${args.afterId} ===`);
  console.log(`Generated: ${now}`);
  console.log('');

  console.log(`─── Global metrics ───────────────────────────────────────────────────────────`);
  const hdr = col('Metric', COL_LABEL) + col('Before', COL_VAL) + col('After', COL_VAL) + col('Delta', COL_VAL + 16);
  console.log(hdr);
  console.log('─'.repeat(hdr.length));

  function row(label: string, bVal: number, aVal: number, opts: { isFloat?: boolean; isPercent?: boolean; higherIsBetter?: boolean } = {}): void {
    const { isFloat = false, isPercent = false, higherIsBetter = false } = opts;
    const fmt = (n: number): string => isFloat ? n.toFixed(2) : isPercent ? n.toFixed(1) + '%' : String(n);
    const delta = isPercent
      ? deltaStr(bVal, aVal, true)
      : isFloat
        ? (aVal > bVal ? '+' : aVal < bVal ? '' : '') + (aVal - bVal).toFixed(2)
        : deltaStr(bVal, aVal);
    const trend = trendArrow(bVal, aVal, higherIsBetter);
    const trendShort = trend.startsWith('▲') ? '▲' : trend.startsWith('▼') ? '▼' : '→';
    console.log(col(label, COL_LABEL) + colR(fmt(bVal), COL_VAL) + colR(fmt(aVal), COL_VAL) + `  ${delta}  ${trendShort}`);
  }

  row('Total candidates', before.total, after.total);
  row('Pending', before.pending, after.pending);
  row('Accepted', before.accepted, after.accepted);
  row('Rejected', before.rejected, after.rejected);
  row('Avg confidence', before.avgConfidence, after.avgConfidence, { isFloat: true, higherIsBetter: true });
  row('Median body length', before.medianBodyLength, after.medianBodyLength, { higherIsBetter: true });
  row('< 80 chars', before.shortFragmentsCount, after.shortFragmentsCount);
  row('Junk suspects (≥0.4)', before.junkSuspects, after.junkSuspects);
  row('source_section fill %', before.sourceSectionFillPct, after.sourceSectionFillPct, { isPercent: true, higherIsBetter: true });
  row('Dup suspects (pairs)', before.dupSuspectPairs, after.dupSuspectPairs);

  console.log('');
  console.log(`─── Verdict ──────────────────────────────────────────────────────────────────`);

  const verdict = computeVerdict(before, after);
  const totalSignals = verdict.improved.length + verdict.regressed.length + (verdict.neutral.length > 0 ? 0 : 0);
  const improvedCount = verdict.improved.length;
  const allSignals = improvedCount + verdict.regressed.length;

  let label: string;
  if (verdict.score >= 3) {
    label = `✅ IMPROVED — ${improvedCount}/${allSignals} quality signals improved`;
  } else if (verdict.score <= -1) {
    label = `❌ DEGRADED — ${verdict.regressed.length}/${allSignals} quality signals regressed`;
  } else {
    label = `➡️  NEUTRAL — mixed signals (score: ${verdict.score > 0 ? '+' : ''}${verdict.score})`;
  }

  console.log(label);
  for (const s of verdict.improved) console.log(`   ↗ ${s}`);
  for (const s of verdict.regressed) console.log(`   ↘ ${s}`);
  for (const s of verdict.neutral) {
    // only print neutral items that are informative
    if (s.startsWith('Candidates count within expected range')) {
      console.log(`   → ${s}`);
    }
  }
  console.log('');
}

// ── Entry point ───────────────────────────────────────────────────────────────

const args = parseArgs();
if (args) runDiff(args);
