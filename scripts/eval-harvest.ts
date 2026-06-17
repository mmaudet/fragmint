// scripts/eval-harvest.ts
// Usage: npx tsx scripts/eval-harvest.ts
// Runs structural golden set checks (no LLM required).
// For LLM-dependent checks, see scripts/eval-harvest-llm.md
//
// Chantiers implemented (Tasks 0-9):
//   0 — golden-set + eval scaffold
//   1 — semantic chunker (source_section propagation)
//   2 — junkiness filter (isJunky)
//   3 — L1 hash dedup
//   4 — L2 shingle dedup
//   5 — L3 cosine dedup (Milvus-based)
//   6 — harvest-chunker refactor (semanticChunk)
//   7 — threshold calibration
//   8 — hints fix (domain override guard)
//   9 — harvester-pipeline integration (all stages wired)

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface GoldenCase {
  id: string;
  description?: string;
  name?: string;
  markdown?: string;
  input?: string;
  expected?: Array<{ domain?: string; type?: string; lang?: string }> | {
    source_section_non_null_count_min?: number;
    source_section_values_include?: string[];
    min_blocks_kept?: number;
    separator_removed?: boolean;
  };
  expected_junky?: Array<{ body_starts_with?: string }>;
  expected_count?: number;
  expected_dedup?: boolean;
  hint_domain?: string;
  checks?: string[];
}

const goldenPath = resolve(new URL('.', import.meta.url).pathname, '../scripts/golden-set.json');
const golden = JSON.parse(readFileSync(goldenPath, 'utf-8'));

// Pipeline file to inspect for structural checks
const pipelinePath = resolve(
  new URL('.', import.meta.url).pathname,
  '../packages/server/src/services/harvester-pipeline.ts',
);
const pipelineSource = readFileSync(pipelinePath, 'utf-8');

let total = 0;
let passed = 0;

function assert(cond: boolean, msg: string) {
  total++;
  if (cond) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.log(`  ❌ ${msg}`);
  }
}

console.log('=== Harvest Pipeline — Structural Eval ===');
console.log('NOTE: LLM-based checks (domain accuracy, classification) require a running server.');
console.log('      See scripts/eval-harvest-llm.md for the manual procedure.\n');

for (const c of golden.cases as GoldenCase[]) {
  const label = c.description ?? c.name ?? c.id;
  console.log(`[${c.id}] ${label}`);

  // Determine the markdown body (old cases use "markdown", new cases use "input")
  const body: string = c.markdown ?? c.input ?? '';

  // Basic: content is non-empty
  assert(body.length > 0, `content is non-empty`);

  // Per-case specific checks array (gs-006, gs-007 etc.)
  const checks: string[] = c.checks ?? [];

  // --- source_section_populated ---
  if (checks.includes('source_section_populated')) {
    // Structural: verify that semanticChunk is imported (propagates source_section)
    assert(
      pipelineSource.includes('semanticChunk'),
      `harvester-pipeline.ts imports semanticChunk (source_section propagation)`,
    );
    // Structural: verify source_section is assigned in the pipeline
    assert(
      pipelineSource.includes('source_section'),
      `harvester-pipeline.ts references source_section field`,
    );
    console.log(`  📋 runtime check: upload a multi-section doc and verify source_section is non-null — see eval-harvest-llm.md`);
  }

  // --- junkiness_filter_active ---
  if (checks.includes('junkiness_filter_active')) {
    // Structural: verify isJunky is imported in the pipeline
    assert(
      pipelineSource.includes('isJunky'),
      `harvester-pipeline.ts imports isJunky (junkiness filter active)`,
    );
    console.log(`  📋 runtime check: separator-only input produces 0 candidates — verify manually`);
  }

  // Legacy: junkiness check (structural — bodies that SHOULD be filtered)
  if (c.expected_junky) {
    for (const ej of c.expected_junky) {
      if (ej.body_starts_with) {
        console.log(`  📋 expected junky: "${ej.body_starts_with.slice(0, 40)}" — verify manually after Task 5`);
      }
    }
  }

  // Legacy: dedup check (structural — same body appears twice)
  if (c.expected_dedup) {
    const bodyCount = (body.match(/LinShare est une solution/g) ?? []).length;
    assert(bodyCount >= 2, `markdown contains duplicate content (found ${bodyCount} occurrences)`);
    console.log(`  📋 dedup: this case tests that L1+L2 reduces 2 identical blocks to 1 — verify after Task 6`);
  }

  // Legacy: expected block count (LLM-dependent)
  if (Array.isArray(c.expected) && c.expected.length > 0) {
    console.log(`  📋 LLM expected: ${c.expected.length} block(s) — verify via manual harvest after all tasks`);
  }
}

console.log(`\n=== Structural checks: ${passed}/${total} passed ===`);
console.log('\nBaseline captured. Re-run after each chantier to track progress.');
