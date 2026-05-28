#!/usr/bin/env node
// eval-shingles.mjs — evaluate Jaccard shingles thresholds on labeled fragment pairs
// Usage: node scripts/eval-shingles.mjs [PAIRS_CSV] [VAULT_PATH]
// Default PAIRS_CSV: docs/scoring-eval-pairs.csv
// Default VAULT_PATH: example-vault
//
// Output: precision-recall table for thresholds 0.10 to 0.90 (step 0.10)

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const pairsPath = process.argv[2] ?? join(root, 'docs/scoring-eval-pairs.csv');
const vaultPath = process.argv[3] ?? join(root, 'example-vault');

// ── Shingles implementation (mirrors shingles.ts) ────────────────────────────

function generateShingles(text, k = 3) {
  if (k < 1) return new Set();
  const normalized = text.toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = normalized.split(' ').filter((w) => w.length > 0);
  const shingles = new Set();
  for (let i = 0; i <= words.length - k; i++) {
    shingles.add(words.slice(i, i + k).join(' '));
  }
  return shingles;
}

function jaccardSimilarity(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const s of a) if (b.has(s)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

// ── Fragment loader (reads .md files from vault) ─────────────────────────────

function buildFragmentIndex(vaultPath) {
  const index = new Map(); // id → body
  const fragmentsDir = join(vaultPath, 'fragments');

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith('.md')) {
        const content = readFileSync(fullPath, 'utf8');
        // Extract id from frontmatter
        const idMatch = content.match(/^id:\s*(.+)$/m);
        if (!idMatch) continue;
        const id = idMatch[1].trim();
        // Extract body (after second ---)
        const parts = content.split(/^---\s*$/m);
        const body = parts.slice(2).join('---').trim();
        index.set(id, body);
      }
    }
  }

  walk(fragmentsDir);
  return index;
}

// ── Main ─────────────────────────────────────────────────────────────────────

// Load fragment bodies
console.log(`Loading fragments from ${vaultPath}...`);
const fragments = buildFragmentIndex(vaultPath);
console.log(`Loaded ${fragments.size} fragments.\n`);

// Load labeled pairs
let pairsContent;
try {
  pairsContent = readFileSync(pairsPath, 'utf8');
} catch {
  console.error(`ERROR: Cannot read pairs file at ${pairsPath}`);
  console.error('Run this script after creating docs/scoring-eval-pairs.csv');
  console.error('\nExpected format:');
  console.error('id_a,id_b,ground_truth');
  console.error('<fragment-id>,<fragment-id>,duplicate');
  console.error('<fragment-id>,<fragment-id>,near-dup');
  console.error('<fragment-id>,<fragment-id>,unrelated');
  process.exit(1);
}

const pairs = pairsContent
  .split('\n')
  .slice(1) // skip header
  .filter(Boolean)
  .map((line) => {
    const [id_a, id_b, ground_truth] = line.trim().split(',');
    return { id_a, id_b, ground_truth: ground_truth?.trim() };
  })
  .filter((p) => p.id_a && p.id_b && p.ground_truth);

console.log(`Loaded ${pairs.length} labeled pairs.\n`);

// Compute Jaccard for each pair
const results = [];
for (const pair of pairs) {
  const bodyA = fragments.get(pair.id_a);
  const bodyB = fragments.get(pair.id_b);

  if (!bodyA) {
    console.warn(`WARNING: fragment not found: ${pair.id_a}`);
    continue;
  }
  if (!bodyB) {
    console.warn(`WARNING: fragment not found: ${pair.id_b}`);
    continue;
  }

  const shinglesA = generateShingles(bodyA, 3);
  const shinglesB = generateShingles(bodyB, 3);
  const jaccard = jaccardSimilarity(shinglesA, shinglesB);

  results.push({ ...pair, jaccard });
}

// ── Print per-pair results ────────────────────────────────────────────────────
console.log('Per-pair Jaccard scores:');
console.log('  id_a (short)  | id_b (short)  | ground_truth | jaccard');
console.log('  ' + '-'.repeat(60));
for (const r of results) {
  const aShort = r.id_a.slice(-8);
  const bShort = r.id_b.slice(-8);
  const label = r.ground_truth.padEnd(12);
  console.log(`  ...${aShort} | ...${bShort} | ${label} | ${r.jaccard.toFixed(4)}`);
}

// ── Precision-recall table ────────────────────────────────────────────────────
console.log('\nPrecision-Recall table (positive class = "duplicate"):');
console.log('  threshold | TP  | FP  | FN  | precision | recall | F1');
console.log('  ' + '-'.repeat(65));

const duplicatePairs = results.filter((r) => r.ground_truth === 'duplicate');
const nonDuplicates = results.filter((r) => r.ground_truth !== 'duplicate');

for (let t = 10; t <= 90; t += 10) {
  const threshold = t / 100;
  const tp = duplicatePairs.filter((r) => r.jaccard >= threshold).length;
  const fp = nonDuplicates.filter((r) => r.jaccard >= threshold).length;
  const fn = duplicatePairs.filter((r) => r.jaccard < threshold).length;

  const precision = tp + fp > 0 ? tp / (tp + fp) : 1.0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0.0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

  const marker = Math.abs(threshold - 0.70) < 0.001 ? ' ← default' : '';
  console.log(
    `  ${threshold.toFixed(2)}      | ${String(tp).padStart(3)} | ${String(fp).padStart(3)} | ${String(fn).padStart(3)} | ` +
    `${precision.toFixed(3)}     | ${recall.toFixed(3)}  | ${f1.toFixed(3)}${marker}`
  );
}

// ── Summary ────────────────────────────────────────────────────────────────────
const bestF1 = Math.max(...Array.from({ length: 9 }, (_, i) => {
  const threshold = (i + 1) / 10;
  const tp = duplicatePairs.filter((r) => r.jaccard >= threshold).length;
  const fp = nonDuplicates.filter((r) => r.jaccard >= threshold).length;
  const fn = duplicatePairs.filter((r) => r.jaccard < threshold).length;
  const p = tp + fp > 0 ? tp / (tp + fp) : 1;
  const rec = tp + fn > 0 ? tp / (tp + fn) : 0;
  return p + rec > 0 ? 2 * p * rec / (p + rec) : 0;
}));

console.log(`\nBest F1: ${bestF1.toFixed(3)}`);
console.log('Review the F1 column to find the optimal threshold.');
console.log('If threshold 0.70 is close to the elbow, the default is well calibrated.');
console.log('\nNote: "near-dup" pairs are treated as negatives in this analysis.');
console.log('If you want to treat them as positives too, edit ground_truth to "duplicate".');
