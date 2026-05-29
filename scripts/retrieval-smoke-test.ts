/**
 * retrieval-smoke-test.ts
 * Runs golden queries against the Fragmint search API and reports recall.
 *
 * Usage:
 *   npx tsx scripts/retrieval-smoke-test.ts \
 *     --collection <slug> \
 *     --golden scripts/golden-retrieval.json \
 *     --url http://localhost:3210 \
 *     --token <apiToken>
 *   npx tsx scripts/retrieval-smoke-test.ts --help
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── CLI parsing ───────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
retrieval-smoke-test — run golden queries against the Fragmint search API

Usage:
  npx tsx scripts/retrieval-smoke-test.ts \\
    --collection <slug> \\
    --golden <path>     \\
    --url <serverUrl>   \\
    --token <apiToken>

Options:
  --collection <slug>   Collection slug to search in (required)
  --golden <path>       Path to the golden JSON file  [default: scripts/golden-retrieval.json]
  --url <url>           Fragmint server URL           [required]
  --token <token>       API token (Bearer)             [required]
  --help                Show this message
`);
}

interface Args {
  collection: string;
  goldenPath: string;
  url: string;
  token: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.length === 0) {
    printHelp();
    process.exit(0);
  }

  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };

  const collection = get('--collection');
  const url = get('--url');
  const token = get('--token');
  const goldenArg = get('--golden');

  if (!collection) {
    console.error('Error: --collection <slug> is required');
    process.exit(1);
  }
  if (!url) {
    console.error('Error: --url <serverUrl> is required');
    process.exit(1);
  }
  if (!token) {
    console.error('Missing --token. Get a token from the Fragmint admin UI or API.');
    process.exit(1);
  }

  const goldenPath = goldenArg
    ? resolve(goldenArg)
    : resolve('./scripts/golden-retrieval.json');

  return { collection, goldenPath, url, token };
}

// ── Golden file schema ────────────────────────────────────────────────────────

interface GoldenCase {
  id: string;
  query: string;
  min_recall: number;
  notes?: string;
}

interface GoldenFile {
  version: string;
  description?: string;
  cases: GoldenCase[];
}

function loadGolden(path: string): GoldenFile {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    console.error(`Error: golden file not found at ${path}`);
    process.exit(1);
  }
  try {
    return JSON.parse(raw) as GoldenFile;
  } catch {
    console.error(`Error: golden file at ${path} is not valid JSON`);
    process.exit(1);
  }
}

// ── Search result types ───────────────────────────────────────────────────────

interface SearchHit {
  id: string;
  score: number;
  domain?: string;
  [key: string]: unknown;
}

interface SearchResponse {
  results?: SearchHit[];
  hits?: SearchHit[];
  data?: SearchHit[];
  [key: string]: unknown;
}

function extractHits(body: SearchResponse): SearchHit[] {
  // Try common response shapes
  if (Array.isArray(body.results)) return body.results as SearchHit[];
  if (Array.isArray(body.hits)) return body.hits as SearchHit[];
  if (Array.isArray(body.data)) return body.data as SearchHit[];
  if (Array.isArray(body)) return body as unknown as SearchHit[];
  return [];
}

// ── Run one case ──────────────────────────────────────────────────────────────

interface CaseResult {
  id: string;
  query: string;
  passed: boolean;
  resultCount: number;
  topScore: number | null;
  topDomain: string | null;
  error?: string;
}

async function runCase(
  goldenCase: GoldenCase,
  url: string,
  token: string,
  collection: string,
): Promise<CaseResult> {
  let resp: Response;
  try {
    resp = await fetch(`${url}/v1/fragments/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-Collection': collection,
      },
      body: JSON.stringify({ query: goldenCase.query, limit: 5, filters: {} }),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      id: goldenCase.id,
      query: goldenCase.query,
      passed: false,
      resultCount: 0,
      topScore: null,
      topDomain: null,
      error: `fetch error: ${msg}`,
    };
  }

  if (!resp.ok) {
    return {
      id: goldenCase.id,
      query: goldenCase.query,
      passed: false,
      resultCount: 0,
      topScore: null,
      topDomain: null,
      error: `HTTP ${resp.status} ${resp.statusText}`,
    };
  }

  let body: SearchResponse;
  try {
    body = (await resp.json()) as SearchResponse;
  } catch {
    return {
      id: goldenCase.id,
      query: goldenCase.query,
      passed: false,
      resultCount: 0,
      topScore: null,
      topDomain: null,
      error: 'invalid JSON response',
    };
  }

  const hits = extractHits(body);
  const resultCount = hits.length;
  const topHit = resultCount > 0 ? hits[0] : null;
  const topScore = topHit?.score ?? null;
  const topDomain = (topHit?.domain as string | undefined) ?? null;

  // Pass = at least 1 result with score > 0
  const passed = resultCount > 0 && topScore !== null && topScore > 0;

  return { id: goldenCase.id, query: goldenCase.query, passed, resultCount, topScore, topDomain };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run(args: Args): Promise<void> {
  const golden = loadGolden(args.goldenPath);

  console.log('=== Retrieval Smoke Test ===');
  console.log(`Collection: ${args.collection}`);
  console.log(`Server:     ${args.url}`);
  console.log(`Golden file: ${args.goldenPath}`);
  console.log('');

  // Quick connectivity check
  try {
    const probe = await fetch(`${args.url}/v1/fragments/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${args.token}`,
        'X-Collection': args.collection,
      },
      body: JSON.stringify({ query: 'ping', limit: 1, filters: {} }),
      signal: AbortSignal.timeout(5000),
    });
    // Any HTTP response (even 401/404) means server is reachable — only catch network errors
    void probe;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('timeout')) {
      console.error(`Server not available at ${args.url} — is the server running?`);
      process.exit(1);
    }
    // Other errors (e.g. AbortError from timeout) — still treat as unreachable
    console.error(`Server not available at ${args.url} — is the server running?`);
    process.exit(1);
  }

  const results: CaseResult[] = [];

  for (const c of golden.cases) {
    const result = await runCase(c, args.url, args.token, args.collection);
    results.push(result);

    const queryPreview = c.query.length > 50 ? c.query.slice(0, 47) + '...' : c.query;
    console.log(`[${result.id}] "${queryPreview}"`);

    if (result.error) {
      console.log(`  → Error: ${result.error}`);
      console.log(`  ❌ FAIL`);
    } else {
      const domainStr = result.topDomain ? `, top domain: ${result.topDomain}` : '';
      const scoreStr = result.topScore !== null ? result.topScore.toFixed(2) : 'n/a';
      console.log(`  → ${result.resultCount} results, top score: ${scoreStr}${domainStr}`);
      if (result.passed) {
        console.log(`  ✅ PASS (results returned, score > 0)`);
      } else {
        const reason = result.resultCount === 0 ? 'no results returned' : 'top score is 0 or null';
        console.log(`  ❌ FAIL (${reason})`);
      }
    }
    console.log('');
  }

  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;
  const recallPct = total > 0 ? (passed / total) * 100 : 0;

  // Compute the per-case min_recall (use overall threshold = max of all min_recall values)
  const minRecallTarget = golden.cases.reduce((max, c) => Math.max(max, c.min_recall), 0);
  const minRecallPct = minRecallTarget * 100;

  const overallPass = recallPct >= minRecallPct;

  console.log(`─── Summary ───────────────────────────────────────────────`);
  console.log(`Passed: ${passed}/${total} (${recallPct.toFixed(1)}%)`);
  console.log(`Failed: ${failed}/${total}`);
  console.log(`Overall recall: ${recallPct.toFixed(1)}%  [min_recall target: ${minRecallPct.toFixed(1)}%]`);
  if (overallPass) {
    console.log(`Verdict: ✅ PASS — recall above threshold`);
  } else {
    console.log(`Verdict: ❌ FAIL — recall below threshold (${recallPct.toFixed(1)}% < ${minRecallPct.toFixed(1)}%)`);
    process.exit(1);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

const args = parseArgs();
run(args).catch((err: unknown) => {
  console.error('Unexpected error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
