import { describe, it, expect, afterEach } from 'vitest';
import { vi } from 'vitest';
import type { FragmentRetriever, SectionQuery, RetrievedFragment } from './fragment-retriever.js';
import { VectorRetriever } from './vector-retriever.js';
import type { SearchService, SearchResult } from '../search/search-service.js';
import { AgenticRetriever } from './agentic-retriever.js';
import type { IndexService, IndexData } from '../services/index-service.js';
import { buildReadableIdMap, renderToc } from '../services/index-service.js';
import type { FragmentService } from '../services/fragment-service.js';
import { LlmClient, type LlmClientConfig } from '../services/llm-client.js';
import { HybridRetriever } from './hybrid-retriever.js';

describe('LlmClient.chatMessages temperature override', () => {
  function makeClient(defaultTemp = 0.3): LlmClient {
    const config: LlmClientConfig = {
      endpoint: 'http://fake-llm',
      model: 'test-model',
      temperature: defaultTemp,
      timeout: 5000,
    };
    return new LlmClient(config);
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses config.temperature by default', async () => {
    const client = makeClient(0.3);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    } as Response);

    await client.chatMessages([{ role: 'user', content: 'test' }]);

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
    expect(body.temperature).toBe(0.3);
  });

  it('uses options.temperature when provided, overriding config', async () => {
    const client = makeClient(0.3);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    } as Response);

    await client.chatMessages([{ role: 'user', content: 'test' }], { temperature: 0.7 });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
    expect(body.temperature).toBe(0.7);
  });
});

describe('FragmentRetriever interface', () => {
  it('accepts a conforming implementation', () => {
    const mock: FragmentRetriever = {
      searchForSection: async (
        _query: SectionQuery,
        _limit?: number,
      ): Promise<RetrievedFragment[]> => [],
    };
    expect(typeof mock.searchForSection).toBe('function');
  });
});

function fakeSearchService(results: SearchResult[] = []): SearchService {
  return {
    search: vi.fn(async () => results),
  } as unknown as SearchService;
}

const SAMPLE_RESULT: SearchResult = {
  id: 'frag-1',
  score: 0.85,
  title: 'Fragment 1',
  body_excerpt: 'excerpt',
  type: 'argument',
  domain: 'cloud',
  lang: 'fr',
  quality: 'approved',
  author: 'alice',
  uses: 3,
  updated_at: '2026-01-01',
};

describe('VectorRetriever', () => {
  it('maps SearchService results to RetrievedFragment', async () => {
    const svc = fakeSearchService([SAMPLE_RESULT]);
    const retriever = new VectorRetriever(svc);
    const results = await retriever.searchForSection({
      text: 'cloud introduction',
      filters: { lang: 'fr' },
      collectionSlug: 'common',
    });
    expect(results).toHaveLength(1);
    expect(results[0].fragment_id).toBe('frag-1');
    expect(results[0].score).toBe(0.85);
  });

  it('filters out results below SCORE_THRESHOLD (0.2)', async () => {
    const svc = fakeSearchService([{ ...SAMPLE_RESULT, id: 'low', score: 0.1 }]);
    const retriever = new VectorRetriever(svc);
    const results = await retriever.searchForSection({
      text: 'cloud',
      filters: {},
      collectionSlug: null,
    });
    expect(results).toHaveLength(0);
  });

  it('passes lang, domain, type, tags, collectionSlug to SearchService', async () => {
    const svc = fakeSearchService([]);
    const retriever = new VectorRetriever(svc);
    await retriever.searchForSection(
      {
        text: 'security',
        filters: { lang: 'fr', domain: ['cloud'], type: 'argument', tags: ['sla'] },
        collectionSlug: 'my-col',
      },
      3,
    );
    expect(vi.mocked(svc.search).mock.calls[0]![1]).toMatchObject({
      lang: 'fr',
      domain: ['cloud'],
      type: ['argument'],
      tags: ['sla'],
      collectionSlug: 'my-col',
      quality_min: 'approved',
    });
    expect(vi.mocked(svc.search).mock.calls[0]![2]).toBe(3);
  });

  it('passes undefined domain when filters.domain is empty', async () => {
    const svc = fakeSearchService([]);
    const retriever = new VectorRetriever(svc);
    await retriever.searchForSection({ text: 'x', filters: { domain: [] }, collectionSlug: null });
    expect(vi.mocked(svc.search).mock.calls[0]![1]!.domain).toBeUndefined();
  });

  it('returns results from SearchService even when SearchService is backed by SQLite (Milvus OFF)', async () => {
    const svc = fakeSearchService([SAMPLE_RESULT]);
    const retriever = new VectorRetriever(svc);
    const results = await retriever.searchForSection({
      text: 'cloud',
      filters: {},
      collectionSlug: null,
    });
    expect(results).toHaveLength(1);
    expect(results[0].fragment_id).toBe('frag-1');
  });

  it('propagates SearchService errors (does not swallow them)', async () => {
    const svc = {
      search: vi.fn(async () => {
        throw new Error('Milvus exploded');
      }),
    } as unknown as SearchService;
    const retriever = new VectorRetriever(svc);
    await expect(
      retriever.searchForSection({ text: 'x', filters: {}, collectionSlug: null }),
    ).rejects.toThrow('Milvus exploded');
  });

  it('preserves null title and body_excerpt from SearchResult', async () => {
    const svc = fakeSearchService([{ ...SAMPLE_RESULT, title: null, body_excerpt: null }]);
    const retriever = new VectorRetriever(svc);
    const results = await retriever.searchForSection({
      text: 'x',
      filters: {},
      collectionSlug: null,
    });
    expect(results[0].title).toBeNull();
    expect(results[0].body_excerpt).toBeNull();
  });
});

function makeIndexData(overrides: Partial<IndexData> = {}): IndexData {
  return {
    generated_at: '2026-01-01T00:00:00.000Z',
    // total: 1 is intentionally below PHASE0_THRESHOLD (200) to keep Phase 0 disabled
    // in default test fixtures. If you need a large index for Phase 0 tests, use fakeIndexServiceLarge().
    total: 1,
    subjects: {
      cloud: {
        label: 'Cloud',
        prefix: 'LC',
        count: 1,
        types: {
          argument: [
            {
              readable_id: 'LC-arg-001',
              id: 'frag-uuid-1',
              title: 'Fragment One',
              lang: 'fr',
              tags: [],
              entities: [],
            },
          ],
        },
      },
    },
    ...overrides,
  };
}

function fakeIndexService(data?: IndexData): IndexService {
  const d = data ?? makeIndexData();
  return {
    getData: vi.fn(async () => d),
  } as unknown as IndexService;
}

function fakeIndexServiceLarge(): IndexService {
  const frags = Array.from({ length: 201 }, (_, i) => ({
    readable_id: `LC-arg-${String(i + 1).padStart(3, '0')}`,
    id: `frag-uuid-${i + 1}`,
    title: `Fragment ${i + 1}`,
    lang: 'fr',
    tags: [] as string[],
    entities: [] as string[],
  }));
  const data = makeIndexData({
    total: 201,
    subjects: {
      cloud: { label: 'Cloud', prefix: 'LC', count: 201, types: { argument: frags } },
    },
  });
  return { getData: vi.fn(async () => data) } as unknown as IndexService;
}

function fakeLlmClient(responses: string[]): LlmClient {
  let i = 0;
  return {
    chatMessages: vi.fn(async () => responses[i++] ?? ''),
  } as unknown as LlmClient;
}

function fakeFragmentService(bodies: Record<string, string> = {}): FragmentService {
  return {
    getById: vi.fn(async (id: string) => {
      if (!(id in bodies)) return null;
      return { id, title: `Title ${id}`, body: bodies[id], quality: 'approved' };
    }),
  } as unknown as FragmentService;
}

describe('AgenticRetriever', () => {
  it('judgeFragmentWithTemp passes no temperature override by default (options=undefined)', async () => {
    let callCount = 0;
    const llmSpy = vi.fn(async (_msgs: unknown[], opts?: { temperature?: number }) => {
      callCount++;
      if (callCount === 1) {
        // Phase 1 — return array
        return '["frag-uuid-1"]';
      } else {
        // Phase 2 — return object
        return opts?.temperature === 0.4
          ? '{"score": 6, "reason": "temp-0.4"}'
          : '{"score": 8, "reason": "default"}';
      }
    });
    const fakeLlm = { chatMessages: llmSpy } as unknown as LlmClient;

    const retriever = new AgenticRetriever(
      fakeIndexService(),
      fakeLlm,
      fakeFragmentService({ 'frag-uuid-1': 'body' }),
    );

    await retriever.searchForSection({ text: 'test', filters: {}, collectionSlug: null });

    // Phase1 call (returns array) + Phase2 call (returns object) = 2 total
    expect(llmSpy.mock.calls).toHaveLength(2);
    // Phase2 call has no temperature override
    const phase2Call = llmSpy.mock.calls[1];
    expect(phase2Call?.[1]).toBeUndefined();
  });

  it('phase1 parses the LLM JSON array of UUIDs', async () => {
    const llm = fakeLlmClient([
      '["frag-uuid-1", "frag-uuid-2"]', // phase 1
      '{"score": 8, "reason": "relevant"}', // phase 2 — frag-uuid-1
      '{"score": 4, "reason": "partial"}', // phase 2 — frag-uuid-2
    ]);
    const retriever = new AgenticRetriever(
      fakeIndexService(),
      llm,
      fakeFragmentService({ 'frag-uuid-1': 'body one', 'frag-uuid-2': 'body two' }),
    );
    const results = await retriever.searchForSection(
      {
        text: 'cloud introduction',
        filters: {},
        collectionSlug: null,
      },
      5,
    );
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].fragment_id).toBe('frag-uuid-1');
    expect(results[0].score).toBeCloseTo(0.8);
    expect(results[0].justification).toBe('relevant');
  });

  it('returns empty when phase1 LLM returns non-JSON', async () => {
    const llm = fakeLlmClient(['No IDs found for this query.']);
    const retriever = new AgenticRetriever(fakeIndexService(), llm, fakeFragmentService());
    const results = await retriever.searchForSection({
      text: 'test',
      filters: {},
      collectionSlug: null,
    });
    expect(results).toEqual([]);
  });

  it('skips fragments not found by FragmentService', async () => {
    const llm = fakeLlmClient([
      '["frag-missing"]',
      // phase 2 won't fire because getById returns null
    ]);
    const retriever = new AgenticRetriever(fakeIndexService(), llm, fakeFragmentService({}));
    const results = await retriever.searchForSection({
      text: 'x',
      filters: {},
      collectionSlug: null,
    });
    expect(results).toEqual([]);
  });

  it('filters out fragments with score below 0.3 after normalization', async () => {
    const llm = fakeLlmClient([
      '["frag-low"]',
      '{"score": 2, "reason": "poor match"}', // 2/10 = 0.2 < threshold
    ]);
    const retriever = new AgenticRetriever(
      fakeIndexService(),
      llm,
      fakeFragmentService({ 'frag-low': 'body' }),
    );
    const results = await retriever.searchForSection({
      text: 'x',
      filters: {},
      collectionSlug: null,
    });
    expect(results).toEqual([]);
  });
});

describe('buildReadableIdMap', () => {
  it('maps readable_id to uuid', () => {
    const map = buildReadableIdMap(makeIndexData());
    expect(map.get('LC-arg-001')).toBe('frag-uuid-1');
  });

  it('returns empty map for empty IndexData', () => {
    const map = buildReadableIdMap({ generated_at: '', total: 0, subjects: {} });
    expect(map.size).toBe(0);
  });
});

describe('renderToc', () => {
  it('renders a compact table with domain+type counts', () => {
    const toc = renderToc(makeIndexData());
    expect(toc).toContain('Table des matières');
    expect(toc).toContain('Cloud');
    expect(toc).toContain('1'); // total
  });

  it('mentions total fragment count', () => {
    const toc = renderToc(makeIndexData({ total: 42 }));
    expect(toc).toContain('42');
  });
});

describe('AgenticRetriever — readable_id → UUID mapping', () => {
  it('translates readable_id returned by LLM to UUID before judging', async () => {
    const llm = fakeLlmClient([
      '["LC-arg-001"]', // phase1 — readable_id
      '{"score": 8, "reason": "relevant"}', // phase2
    ]);
    const retriever = new AgenticRetriever(
      fakeIndexService(),
      llm,
      fakeFragmentService({ 'frag-uuid-1': 'body one' }),
    );
    const results = await retriever.searchForSection(
      {
        text: 'cloud intro',
        filters: {},
        collectionSlug: null,
      },
      5,
    );
    expect(results).toHaveLength(1);
    expect(results[0].fragment_id).toBe('frag-uuid-1'); // UUID, not readable_id
  });

  it('passthroughs UUID strings not in the idMap', async () => {
    const llm = fakeLlmClient([
      '["frag-uuid-1"]', // phase1 — raw UUID
      '{"score": 7, "reason": "ok"}',
    ]);
    const retriever = new AgenticRetriever(
      fakeIndexService(),
      llm,
      fakeFragmentService({ 'frag-uuid-1': 'body' }),
    );
    const results = await retriever.searchForSection(
      { text: 'x', filters: {}, collectionSlug: null },
      5,
    );
    expect(results).toHaveLength(1);
    expect(results[0].fragment_id).toBe('frag-uuid-1');
  });
});

describe('AgenticRetriever — Phase 0 TOC filtering', () => {
  it('skips phase0 when domain filter is set (regardless of index size)', async () => {
    const llm = fakeLlmClient(['["LC-arg-001"]', '{"score": 8, "reason": "ok"}']);
    const retriever = new AgenticRetriever(
      fakeIndexServiceLarge(),
      llm,
      fakeFragmentService({ 'frag-uuid-1': 'body' }),
    );
    await retriever.searchForSection({
      text: 'test',
      filters: { domain: ['cloud'] },
      collectionSlug: null,
    });
    // 2 calls only: phase1 + phase2 (no phase0)
    expect(vi.mocked(llm.chatMessages).mock.calls).toHaveLength(2);
  });

  it('skips phase0 when index is small (total <= 200)', async () => {
    const llm = fakeLlmClient(['["LC-arg-001"]', '{"score": 8, "reason": "ok"}']);
    const retriever = new AgenticRetriever(
      fakeIndexService(), // total=1
      llm,
      fakeFragmentService({ 'frag-uuid-1': 'body' }),
    );
    await retriever.searchForSection({ text: 'test', filters: {}, collectionSlug: null });
    expect(vi.mocked(llm.chatMessages).mock.calls).toHaveLength(2); // no phase0
  });

  it('triggers phase0 when index is large (>200) and no domain filter', async () => {
    const llm = fakeLlmClient([
      '["cloud:argument"]', // phase0
      '["LC-arg-001"]', // phase1
      '{"score": 8, "reason": "ok"}', // phase2
    ]);
    const retriever = new AgenticRetriever(
      fakeIndexServiceLarge(),
      llm,
      fakeFragmentService({ 'frag-uuid-1': 'body' }),
    );
    await retriever.searchForSection({ text: 'test', filters: {}, collectionSlug: null });
    expect(vi.mocked(llm.chatMessages).mock.calls).toHaveLength(3);
  });

  it('falls back to full index when phase0 returns invalid JSON', async () => {
    const llm = fakeLlmClient([
      'not json at all', // phase0 → fallback
      '["LC-arg-001"]', // phase1 on full index
      '{"score": 8, "reason": "ok"}',
    ]);
    const retriever = new AgenticRetriever(
      fakeIndexServiceLarge(),
      llm,
      fakeFragmentService({ 'frag-uuid-1': 'body' }),
    );
    const results = await retriever.searchForSection({
      text: 'test',
      filters: {},
      collectionSlug: null,
    });
    expect(results).toHaveLength(1); // fallback works, fragment found
  });

  it('falls back to full index when phase0 returns no valid combinations', async () => {
    const llm = fakeLlmClient([
      '["nonexistent:argument"]', // phase0 → invalid combination → null → fallback
      '["LC-arg-001"]',
      '{"score": 7, "reason": "ok"}',
    ]);
    const retriever = new AgenticRetriever(
      fakeIndexServiceLarge(),
      llm,
      fakeFragmentService({ 'frag-uuid-1': 'body' }),
    );
    const results = await retriever.searchForSection({
      text: 'test',
      filters: {},
      collectionSlug: null,
    });
    expect(results).toHaveLength(1);
  });
});

describe('HybridRetriever', () => {
  it('returns vector results directly when count <= limit (no LLM needed)', async () => {
    const svc = fakeSearchService([SAMPLE_RESULT]);
    const llm = fakeLlmClient([]);
    const retriever = new HybridRetriever(svc, llm);
    const results = await retriever.searchForSection(
      { text: 'x', filters: {}, collectionSlug: null },
      5,
    );
    expect(results).toHaveLength(1);
    expect(results[0].fragment_id).toBe('frag-1');
    expect(vi.mocked(llm.chatMessages).mock.calls).toHaveLength(0);
  });

  it('applies combined score when LLM re-ranks multiple candidates', async () => {
    const candidates: SearchResult[] = [
      { ...SAMPLE_RESULT, id: 'f1', score: 0.9 },
      { ...SAMPLE_RESULT, id: 'f2', score: 0.8 },
      { ...SAMPLE_RESULT, id: 'f3', score: 0.7 },
    ];
    const svc = fakeSearchService(candidates);
    // LLM scores: f1=5, f2=9, f3=3 → normalized: 0.5, 0.9, 0.3
    // combined: f1=0.4*0.9+0.6*0.5=0.36+0.3=0.66, f2=0.4*0.8+0.6*0.9=0.32+0.54=0.86, f3=...
    const llmResp = JSON.stringify([
      { id: 'f1', score: 5 },
      { id: 'f2', score: 9 },
      { id: 'f3', score: 3 },
    ]);
    const llm = fakeLlmClient([llmResp]);
    const retriever = new HybridRetriever(svc, llm);
    const results = await retriever.searchForSection(
      { text: 'x', filters: {}, collectionSlug: null },
      2,
    );
    expect(results).toHaveLength(2);
    expect(results[0].fragment_id).toBe('f2'); // highest combined
  });

  it('falls back to top-K by vector score when LLM returns unparseable response', async () => {
    const candidates: SearchResult[] = [
      { ...SAMPLE_RESULT, id: 'fa', score: 0.9 },
      { ...SAMPLE_RESULT, id: 'fb', score: 0.8 },
      { ...SAMPLE_RESULT, id: 'fc', score: 0.7 },
    ];
    const svc = fakeSearchService(candidates);
    const llm = fakeLlmClient(['This is not JSON at all, sorry.']);
    const retriever = new HybridRetriever(svc, llm);
    const results = await retriever.searchForSection(
      { text: 'x', filters: {}, collectionSlug: null },
      2,
    );
    // Neutral fallback score = 5 → combined 0.4*score + 0.6*0.5, so vector order preserved
    expect(results).toHaveLength(2);
    expect(results[0].fragment_id).toBe('fa');
  });

  it('returns empty when SearchService returns no results', async () => {
    const retriever = new HybridRetriever(fakeSearchService([]), fakeLlmClient([]));
    const results = await retriever.searchForSection({
      text: 'x',
      filters: {},
      collectionSlug: null,
    });
    expect(results).toEqual([]);
  });
});

describe('AgenticRetriever — self-consistency (Phase 2)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('calls judgeFragmentWithTemp twice with different temperatures (0.2 and 0.4)', async () => {
    const temperatures: number[] = [];
    const llmSpy = vi.fn(async (_msgs: unknown[], opts?: { temperature?: number }) => {
      if (opts?.temperature !== undefined) temperatures.push(opts.temperature);
      if (temperatures.length === 0) return '["frag-uuid-1"]'; // phase1
      return '{"score": 8, "reason": "ok"}'; // phase2 agents
    });
    const fakeLlm = { chatMessages: llmSpy } as unknown as LlmClient;

    const retriever = new AgenticRetriever(
      fakeIndexService(),
      fakeLlm,
      fakeFragmentService({ 'frag-uuid-1': 'body' }),
      { selfConsistency: true },
    );

    await retriever.searchForSection({ text: 'test', filters: {}, collectionSlug: null });

    expect(temperatures).toHaveLength(2);
    expect(temperatures).toContain(0.2);
    expect(temperatures).toContain(0.4);
  });

  it('uses minimum of 2 agent scores as final score', async () => {
    const llmSpy = vi.fn(async (_msgs: unknown[], opts?: { temperature?: number }) => {
      if (opts?.temperature === undefined) return '["frag-uuid-1"]'; // phase1 (no temp override)
      if (opts.temperature === 0.2) return '{"score": 8, "reason": "agent1"}'; // SELF_CONSISTENCY_AGENT1_TEMP → 0.8
      return '{"score": 3, "reason": "agent2"}'; // SELF_CONSISTENCY_AGENT2_TEMP (0.4) → 0.3
    });
    const fakeLlm = { chatMessages: llmSpy } as unknown as LlmClient;

    const retriever = new AgenticRetriever(
      fakeIndexService(),
      fakeLlm,
      fakeFragmentService({ 'frag-uuid-1': 'body' }),
      { selfConsistency: true },
    );

    const results = await retriever.searchForSection({ text: 'test', filters: {}, collectionSlug: null });

    // min(0.8, 0.3) = 0.3
    expect(results).toHaveLength(1);
    expect(results[0].score).toBeCloseTo(0.3);
  });

  it('drops fragment when min score is below threshold (0.3)', async () => {
    const llmSpy = vi.fn(async (_msgs: unknown[], opts?: { temperature?: number }) => {
      if (opts?.temperature === undefined) return '["frag-uuid-1"]'; // phase1
      if (opts.temperature === 0.2) return '{"score": 8, "reason": "agent1"}'; // 0.8
      return '{"score": 2, "reason": "agent2"}'; // 0.2 < threshold
    });
    const fakeLlm = { chatMessages: llmSpy } as unknown as LlmClient;

    const retriever = new AgenticRetriever(
      fakeIndexService(),
      fakeLlm,
      fakeFragmentService({ 'frag-uuid-1': 'body' }),
      { selfConsistency: true },
    );

    const results = await retriever.searchForSection({ text: 'test', filters: {}, collectionSlug: null });

    // min(0.8, 0.2) = 0.2 < 0.3 → dropped
    expect(results).toHaveLength(0);
  });

  it('logs STRONG_DISAGREEMENT when agents differ by > 0.3', async () => {
    const llmSpy = vi.fn(async (_msgs: unknown[], opts?: { temperature?: number }) => {
      if (opts?.temperature === undefined) return '["frag-uuid-1"]';
      if (opts.temperature === 0.2) return '{"score": 9, "reason": "agent1"}'; // 0.9
      return '{"score": 4, "reason": "agent2"}'; // 0.4 → diff = 0.5 > 0.3
    });
    const fakeLlm = { chatMessages: llmSpy } as unknown as LlmClient;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const retriever = new AgenticRetriever(
      fakeIndexService(),
      fakeLlm,
      fakeFragmentService({ 'frag-uuid-1': 'body' }),
      { selfConsistency: true },
    );

    await retriever.searchForSection({ text: 'test', filters: {}, collectionSlug: null });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('STRONG_DISAGREEMENT'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('diff='),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('threshold='),
    );
  });

  it('does NOT use self-consistency when selfConsistency=false (default)', async () => {
    let callCount = 0;
    const llmSpy = vi.fn(async () => {
      callCount++;
      if (callCount === 1) return '["frag-uuid-1"]';
      return '{"score": 7, "reason": "ok"}';
    });
    const fakeLlm = { chatMessages: llmSpy } as unknown as LlmClient;

    const retriever = new AgenticRetriever(
      fakeIndexService(),
      fakeLlm,
      fakeFragmentService({ 'frag-uuid-1': 'body' }),
      // selfConsistency absent → false
    );

    await retriever.searchForSection({ text: 'test', filters: {}, collectionSlug: null });

    // Phase1 (1 call) + Phase2 single agent (1 call) = 2 total
    expect(llmSpy.mock.calls).toHaveLength(2);
  });
});

import { createRetriever, setRetrievalMode, getCurrentMode } from './factory.js';
import type { RetrieverDeps } from './factory.js';

function fakeDeps(): RetrieverDeps {
  return {
    searchService: fakeSearchService(),
    llm: fakeLlmClient([]),
    indexService: fakeIndexService(),
    fragmentService: fakeFragmentService(),
  };
}

describe('factory', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('createRetriever("vector-only") returns a VectorRetriever-like object', () => {
    const retriever = createRetriever('vector-only', fakeDeps());
    expect(retriever).toBeDefined();
    expect(typeof retriever.searchForSection).toBe('function');
    expect(getCurrentMode()).toBe('vector-only');
  });

  it('createRetriever("agentic-only") returns AgenticRetriever', () => {
    const retriever = createRetriever('agentic-only', fakeDeps());
    expect(retriever).toBeDefined();
    expect(getCurrentMode()).toBe('agentic-only');
  });

  it('createRetriever("hybrid") returns HybridRetriever', () => {
    const retriever = createRetriever('hybrid', fakeDeps());
    expect(retriever).toBeDefined();
    expect(getCurrentMode()).toBe('hybrid');
  });

  it('setRetrievalMode switches the active mode', () => {
    createRetriever('vector-only', fakeDeps());
    setRetrievalMode('hybrid');
    expect(getCurrentMode()).toBe('hybrid');
  });

  it('setRetrievalMode does not throw when deps are initialized', () => {
    createRetriever('vector-only', fakeDeps());
    expect(() => setRetrievalMode('vector-only')).not.toThrow();
  });

  it('agentic-only retriever has selfConsistency enabled (3 LLM calls: phase1 + 2x phase2)', async () => {
    const llmSpy = vi.fn(async (_msgs: unknown[], opts?: { temperature?: number }) => {
      if (opts?.temperature === undefined) return '["frag-uuid-1"]'; // phase1
      if (opts.temperature === 0.2) return '{"score": 8, "reason": "ok"}'; // agent1
      return '{"score": 7, "reason": "ok"}'; // agent2
    });

    const deps: RetrieverDeps = {
      searchService: fakeSearchService(),
      llm: { chatMessages: llmSpy } as unknown as LlmClient,
      indexService: fakeIndexService(),
      fragmentService: fakeFragmentService({ 'frag-uuid-1': 'body' }),
    };

    const retriever = createRetriever('agentic-only', deps);
    await retriever.searchForSection({ text: 'test', filters: {}, collectionSlug: null });

    // Phase1 (1 call) + Phase2 dual-agent (2 calls) = 3 total
    expect(llmSpy.mock.calls).toHaveLength(3);
  });

  it('hybrid retriever does NOT use selfConsistency (1 LLM call for reranking)', async () => {
    const candidates = [
      { ...SAMPLE_RESULT, id: 'f1' },
      { ...SAMPLE_RESULT, id: 'f2' },
      { ...SAMPLE_RESULT, id: 'f3' },
    ];
    const llmSpy = vi.fn(async () =>
      JSON.stringify([
        { id: 'f1', score: 9 },
        { id: 'f2', score: 5 },
        { id: 'f3', score: 6 },
      ]),
    );
    const deps: RetrieverDeps = {
      searchService: fakeSearchService(candidates),
      llm: { chatMessages: llmSpy } as unknown as LlmClient,
      indexService: fakeIndexService(),
      fragmentService: fakeFragmentService(),
    };
    const retriever = createRetriever('hybrid', deps);
    // limit=2 < 3 candidates → triggers LLM rerank
    await retriever.searchForSection({ text: 'x', filters: {}, collectionSlug: null }, 2);
    // hybrid: 1 LLM call (rerank), no dual-agent
    expect(llmSpy.mock.calls).toHaveLength(1);
  });

  it('vector-only retriever makes no LLM calls', async () => {
    const llmSpy = vi.fn();
    const deps: RetrieverDeps = {
      searchService: fakeSearchService([SAMPLE_RESULT]),
      llm: { chatMessages: llmSpy } as unknown as LlmClient,
      indexService: fakeIndexService(),
      fragmentService: fakeFragmentService(),
    };
    const retriever = createRetriever('vector-only', deps);
    await retriever.searchForSection({ text: 'x', filters: {}, collectionSlug: null });
    expect(llmSpy).not.toHaveBeenCalled();
  });
});
