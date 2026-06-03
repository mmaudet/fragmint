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

function fakeSearchService(results: SearchResult[] = [], keywordResults: SearchResult[] = []): SearchService {
  return {
    search: vi.fn(async () => results),
    keywordSearch: vi.fn(async () => keywordResults),
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
  payload: null,
  payload_schema: null,
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

  it('passes lang, type, collectionSlug as hard filters; injects domain+tags into query text', async () => {
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
    // domain and tags are soft hints — injected into query text, NOT hard filters
    expect(vi.mocked(svc.search).mock.calls[0]![1]).toMatchObject({
      lang: 'fr',
      type: ['argument'],
      collectionSlug: 'my-col',
      quality_min: 'approved',
    });
    expect(vi.mocked(svc.search).mock.calls[0]![1]).not.toHaveProperty('domain');
    expect(vi.mocked(svc.search).mock.calls[0]![1]).not.toHaveProperty('tags');
    // query text enriched with domain/tag context
    const enrichedQuery = vi.mocked(svc.search).mock.calls[0]![0] as string;
    expect(enrichedQuery).toContain('cloud');
    expect(enrichedQuery).toContain('sla');
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

  it('passes through null-score SQLite results without threshold', async () => {
    const sqliteResult: SearchResult = { ...SAMPLE_RESULT, id: 'sqlite-1', score: null as unknown as number };
    const svc = fakeSearchService([sqliteResult]);
    const retriever = new VectorRetriever(svc);
    const results = await retriever.searchForSection({
      text: 'cloud',
      filters: {},
      collectionSlug: null,
    });
    expect(results).toHaveLength(1);
    expect(results[0].score).toBeNull();
    expect(results[0].score_breakdown?.method).toBe('sqlite_like');
  });

  it('includes keyword-only fragments from keywordSearch when vector misses them', async () => {
    const vectorResult: SearchResult = { ...SAMPLE_RESULT, id: 'vec-1', score: 0.8 };
    const kwResult: SearchResult = { ...SAMPLE_RESULT, id: 'kw-1', score: null as unknown as number, domain: 'mirai' };
    const svc = fakeSearchService([vectorResult], [kwResult]);
    const retriever = new VectorRetriever(svc);
    const results = await retriever.searchForSection(
      { text: 'présentation MIRAI', filters: {}, collectionSlug: null },
    );
    const ids = results.map((r) => r.fragment_id);
    expect(ids).toContain('vec-1');
    expect(ids).toContain('kw-1');
    expect(results.find((r) => r.fragment_id === 'kw-1')?.score_breakdown?.method).toBe('sqlite_like');
  });

  it('deduplicates fragments present in both vector and keyword results (VectorRetriever)', async () => {
    const shared: SearchResult = { ...SAMPLE_RESULT, id: 'shared-1', score: 0.8 };
    const svc = fakeSearchService([shared], [shared]);
    const retriever = new VectorRetriever(svc);
    const results = await retriever.searchForSection(
      { text: 'x', filters: {}, collectionSlug: null },
    );
    expect(results.filter((r) => r.fragment_id === 'shared-1')).toHaveLength(1);
  });

  it('calls keywordSearch with the same filters as search', async () => {
    const svc = fakeSearchService([], []);
    const retriever = new VectorRetriever(svc);
    await retriever.searchForSection(
      {
        text: 'security',
        filters: { lang: 'fr', domain: ['cloud'], type: 'argument' },
        collectionSlug: 'my-col',
      },
      3,
    );
    expect(vi.mocked(svc.keywordSearch).mock.calls[0]![1]).toMatchObject({
      lang: 'fr',
      type: ['argument'],
      collectionSlug: 'my-col',
      quality_min: 'approved',
    });
    expect(vi.mocked(svc.keywordSearch).mock.calls[0]![2]).toBe(3);
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
  it('phase2 batch uses no temperature override by default', async () => {
    let callCount = 0;
    const llmSpy = vi.fn(async (_msgs: unknown[], opts?: { temperature?: number }) => {
      callCount++;
      if (callCount === 1) {
        // Phase 1 — return array of IDs
        return '["frag-uuid-1"]';
      } else {
        // Phase 2 — return batch array
        return '[{"id":"frag-uuid-1","score":8,"reason":"default"}]';
      }
    });
    const fakeLlm = { chatMessages: llmSpy } as unknown as LlmClient;

    const retriever = new AgenticRetriever(
      fakeIndexService(),
      fakeLlm,
      fakeFragmentService({ 'frag-uuid-1': 'body' }),
    );

    await retriever.searchForSection({ text: 'test', filters: {}, collectionSlug: null });

    // Phase1 call (returns ID array) + Phase2 batch call (returns score array) = 2 total
    expect(llmSpy.mock.calls).toHaveLength(2);
    // Phase2 batch call has no temperature override
    const phase2Call = llmSpy.mock.calls[1];
    expect(phase2Call?.[1]).toBeUndefined();
  });

  it('phase1 parses the LLM JSON array of UUIDs', async () => {
    const llm = fakeLlmClient([
      '["frag-uuid-1", "frag-uuid-2"]', // phase 1
      // phase 2 batch — scores both fragments in one call
      '[{"id":"frag-uuid-1","score":8,"reason":"relevant"},{"id":"frag-uuid-2","score":4,"reason":"partial"}]',
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
      '[{"id":"frag-low","score":2,"reason":"poor match"}]', // 2/10 = 0.2 < threshold
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
      '[{"id":"frag-uuid-1","score":8,"reason":"relevant"}]', // phase2 batch
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
      '[{"id":"frag-uuid-1","score":7,"reason":"ok"}]', // phase2 batch
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
    const llm = fakeLlmClient(['["LC-arg-001"]', '[{"id":"frag-uuid-1","score":8,"reason":"ok"}]']);
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
    const llm = fakeLlmClient(['["LC-arg-001"]', '[{"id":"frag-uuid-1","score":8,"reason":"ok"}]']);
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
      '[{"id":"frag-uuid-1","score":8,"reason":"ok"}]', // phase2 batch
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
      '[{"id":"frag-uuid-1","score":8,"reason":"ok"}]', // phase2 batch
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
      '[{"id":"frag-uuid-1","score":7,"reason":"ok"}]', // phase2 batch
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

describe('HybridRetriever (RRF)', () => {
  it('returns RRF-fused results with score_breakdown', async () => {
    const candidates: SearchResult[] = [
      { ...SAMPLE_RESULT, id: 'f1', score: 0.9 },
      { ...SAMPLE_RESULT, id: 'f2', score: 0.8 },
      { ...SAMPLE_RESULT, id: 'f3', score: 0.7 },
    ];
    const svc = fakeSearchService(candidates);
    const llmResp = JSON.stringify([
      { id: 'f1', score: 3 },
      { id: 'f2', score: 7 },
      { id: 'f3', score: 9 },
    ]);
    const llm = fakeLlmClient([llmResp]);
    const retriever = new HybridRetriever(svc, llm);
    const results = await retriever.searchForSection(
      { text: 'x', filters: {}, collectionSlug: null },
      3,
    );
    expect(results).toHaveLength(3);
    expect(results[0].score_breakdown?.method).toBe('hybrid_rrf');
    expect(results[0].score_breakdown?.vector_score).toBeDefined();
    expect(results[0].score_breakdown?.llm_score).toBeDefined();
    expect(results[0].score_breakdown?.rrf_score).toBeDefined();
    expect(results[0].score).not.toBeNull();
  });

  it('promotes fragment ranked low in vector but high in LLM', async () => {
    const candidates: SearchResult[] = [
      { ...SAMPLE_RESULT, id: 'f1', score: 0.95 }, // rank 1 vector
      { ...SAMPLE_RESULT, id: 'f2', score: 0.85 }, // rank 2 vector
      { ...SAMPLE_RESULT, id: 'f3', score: 0.60 }, // rank 3 vector
    ];
    const svc = fakeSearchService(candidates);
    // LLM: f3=10 (rank 1), f2=5 (rank 2), f1=1 (rank 3)
    const llmResp = JSON.stringify([
      { id: 'f1', score: 1 },
      { id: 'f2', score: 5 },
      { id: 'f3', score: 10 },
    ]);
    const llm = fakeLlmClient([llmResp]);
    const retriever = new HybridRetriever(svc, llm);
    const results = await retriever.searchForSection(
      { text: 'x', filters: {}, collectionSlug: null },
      2,
    );
    // f3: rank 3 vector + rank 1 LLM → promoted by RRF
    // f1: rank 1 vector + rank 3 LLM, but llm_score=1 < llmFloor=3 → dropped by floor
    // f2: rank 2 vector + rank 2 LLM → survives floor (score=5 >= 3)
    const ids = results.map((r) => r.fragment_id);
    expect(ids).toContain('f3'); // RRF promotion confirmed
    expect(ids).toContain('f2'); // f1 dropped by floor, f2 fills top 2
  });

  it('falls back to neutral LLM score when LLM returns unparseable response', async () => {
    const candidates: SearchResult[] = [
      { ...SAMPLE_RESULT, id: 'fa', score: 0.9 },
      { ...SAMPLE_RESULT, id: 'fb', score: 0.8 },
    ];
    const svc = fakeSearchService(candidates);
    const llm = fakeLlmClient(['This is not JSON at all, sorry.']);
    const retriever = new HybridRetriever(svc, llm);
    const results = await retriever.searchForSection(
      { text: 'x', filters: {}, collectionSlug: null },
      2,
    );
    // Fallback: neutral LLM score 5 for all → both lists rank in same order
    // → RRF preserves vector order
    expect(results[0].fragment_id).toBe('fa');
    expect(results).toHaveLength(2);
  });

  it('returns empty when SearchService returns no results', async () => {
    const retriever = new HybridRetriever(fakeSearchService([]), fakeLlmClient([]));
    expect(
      await retriever.searchForSection({ text: 'x', filters: {}, collectionSlug: null }),
    ).toEqual([]);
  });

  it('score_breakdown.llm_score is the raw 0-10 value', async () => {
    const candidates: SearchResult[] = [{ ...SAMPLE_RESULT, id: 'f1', score: 0.8 }];
    const svc = fakeSearchService(candidates);
    const llm = fakeLlmClient([JSON.stringify([{ id: 'f1', score: 7 }])]);
    const retriever = new HybridRetriever(svc, llm);
    const results = await retriever.searchForSection(
      { text: 'x', filters: {}, collectionSlug: null },
      1,
    );
    expect(results[0].score_breakdown?.llm_score).toBe(7);
    expect(results[0].score_breakdown?.vector_score).toBeCloseTo(0.8);
    expect(results[0].score_breakdown?.vector_rank).toBe(1);
    expect(results[0].score_breakdown?.llm_rank).toBe(1);
  });

  it('includes SQLite-only fragments from keywordSearch when LLM scores them high', async () => {
    const vectorResult: SearchResult = { ...SAMPLE_RESULT, id: 'fragmint-1', score: 0.8 };
    const miraiResult: SearchResult = { ...SAMPLE_RESULT, id: 'mirai-1', score: null as unknown as number, domain: 'mirai' };
    const svc = fakeSearchService([vectorResult], [miraiResult]);
    const llmResp = JSON.stringify([
      { id: 'fragmint-1', score: 2 }, // low — dropped by floor
      { id: 'mirai-1', score: 9 },    // high — should surface
    ]);
    const llm = fakeLlmClient([llmResp]);
    const retriever = new HybridRetriever(svc, llm);
    const results = await retriever.searchForSection(
      { text: 'présentation MIRAI', filters: {}, collectionSlug: null },
      2,
    );
    const ids = results.map((r) => r.fragment_id);
    expect(ids).toContain('mirai-1');
  });

  it('deduplicates fragments present in both vector and keyword results (HybridRetriever)', async () => {
    const shared: SearchResult = { ...SAMPLE_RESULT, id: 'shared-1', score: 0.8 };
    const svc = fakeSearchService([shared], [shared]);
    const llm = fakeLlmClient([JSON.stringify([{ id: 'shared-1', score: 7 }])]);
    const retriever = new HybridRetriever(svc, llm);
    const results = await retriever.searchForSection(
      { text: 'x', filters: {}, collectionSlug: null },
      1,
    );
    expect(results.filter((r) => r.fragment_id === 'shared-1')).toHaveLength(1);
  });

  it('SQLite-only fragment has vector_score:0 and vector_rank:0 in score_breakdown', async () => {
    const kwOnly: SearchResult = { ...SAMPLE_RESULT, id: 'kw-only', score: null as unknown as number };
    const svc = fakeSearchService([], [kwOnly]);
    const llm = fakeLlmClient([JSON.stringify([{ id: 'kw-only', score: 8 }])]);
    const retriever = new HybridRetriever(svc, llm, 60, 'balanced', 0); // floor=0 to not drop it
    const results = await retriever.searchForSection(
      { text: 'x', filters: {}, collectionSlug: null },
      1,
    );
    expect(results).toHaveLength(1);
    expect(results[0].score_breakdown?.vector_score).toBe(0);
    expect(results[0].score_breakdown?.vector_rank).toBe(0);
    expect(results[0].score_breakdown?.llm_score).toBe(8);
  });
});

describe('AgenticRetriever — self-consistency (Phase 2)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('calls batch judge twice with different temperatures (0.2 and 0.4)', async () => {
    const temperatures: number[] = [];
    const llmSpy = vi.fn(async (_msgs: unknown[], opts?: { temperature?: number }) => {
      if (opts?.temperature === 0.1) return '["frag-uuid-1"]'; // phase1
      if (opts?.temperature !== undefined) temperatures.push(opts.temperature);
      return '[{"id":"frag-uuid-1","score":8,"reason":"ok"}]'; // phase2 batch agents
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
      if (opts?.temperature === 0.1) return '["frag-uuid-1"]'; // phase1
      if (opts?.temperature === 0.2) return '[{"id":"frag-uuid-1","score":8,"reason":"agent1"}]'; // 0.8
      return '[{"id":"frag-uuid-1","score":3,"reason":"agent2"}]'; // 0.3
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
      if (opts?.temperature === 0.1) return '["frag-uuid-1"]'; // phase1
      if (opts?.temperature === 0.2) return '[{"id":"frag-uuid-1","score":8,"reason":"agent1"}]'; // 0.8
      return '[{"id":"frag-uuid-1","score":2,"reason":"agent2"}]'; // 0.2 < threshold
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
      if (opts?.temperature === 0.1) return '["frag-uuid-1"]'; // phase1
      if (opts?.temperature === 0.2) return '[{"id":"frag-uuid-1","score":9,"reason":"agent1"}]'; // 0.9
      return '[{"id":"frag-uuid-1","score":4,"reason":"agent2"}]'; // 0.4 → diff=0.5 > 0.3
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
      return '[{"id":"frag-uuid-1","score":7,"reason":"ok"}]'; // single batch call
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

import { rrfFusion, normalizeRrfScore } from './rrf.js';

describe('rrfFusion', () => {
  it('ranks item first in both lists at the top', () => {
    const list1 = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const list2 = [{ id: 'a' }, { id: 'c' }, { id: 'b' }];
    const result = rrfFusion([list1, list2]);
    expect(result[0].item.id).toBe('a');
  });

  it('promotes item ranked low in vector but high in LLM', () => {
    const vectorList = [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }];
    const llmList = [{ id: 'f3' }, { id: 'f1' }, { id: 'f2' }];
    const result = rrfFusion([vectorList, llmList]);
    expect(result[0].item.id).toBe('f1');
    expect(result[1].item.id).toBe('f3');
  });

  it('includes items that appear in only one list', () => {
    const list1 = [{ id: 'a' }, { id: 'b' }];
    const list2 = [{ id: 'c' }, { id: 'a' }];
    const result = rrfFusion([list1, list2]);
    const ids = result.map((r) => r.item.id);
    expect(ids).toContain('b');
    expect(ids).toContain('c');
  });

  it('respects weights — higher weight list dominates', () => {
    const list1 = [{ id: 'f1' }, { id: 'f2' }];
    const list2 = [{ id: 'f2' }, { id: 'f1' }];
    const result = rrfFusion([list1, list2], 60, [1, 2]);
    expect(result[0].item.id).toBe('f2');
  });

  it('returns empty array for empty input', () => {
    expect(rrfFusion([])).toEqual([]);
    expect(rrfFusion([[]])).toEqual([]);
  });
});

describe('normalizeRrfScore', () => {
  it('maps max possible score to 1.0', () => {
    const maxRrf = 1 / 61 + 1 / 61;
    expect(normalizeRrfScore(maxRrf, [1, 1])).toBeCloseTo(1.0);
  });

  it('returns 0 for score 0', () => {
    expect(normalizeRrfScore(0, [1, 1])).toBe(0);
  });

  it('returns 0 when weights sum to 0', () => {
    expect(normalizeRrfScore(0.1, [0, 0])).toBe(0);
  });

  it('clamps to 1.0 on rounding edge', () => {
    expect(normalizeRrfScore(999, [1, 1])).toBe(1.0);
  });

  it('maps midpoint correctly', () => {
    expect(normalizeRrfScore(1 / 61, [1, 1])).toBeCloseTo(0.5);
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
      if (opts?.temperature === 0.1) return '["frag-uuid-1"]'; // phase1
      if (opts?.temperature === 0.2) return '[{"id":"frag-uuid-1","score":8,"reason":"ok"}]'; // agent1
      return '[{"id":"frag-uuid-1","score":7,"reason":"ok"}]'; // agent2
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
