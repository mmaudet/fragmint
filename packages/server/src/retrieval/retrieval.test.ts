import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';
import type { FragmentRetriever, SectionQuery, RetrievedFragment } from './fragment-retriever.js';
import { VectorRetriever } from './vector-retriever.js';
import type { SearchService, SearchResult } from '../search/search-service.js';
import { AgenticRetriever } from './agentic-retriever.js';
import type { IndexService } from '../services/index-service.js';
import type { FragmentService } from '../services/fragment-service.js';
import type { LlmClient } from '../services/llm-client.js';
import { HybridRetriever } from './hybrid-retriever.js';

describe('FragmentRetriever interface', () => {
  it('accepts a conforming implementation', () => {
    const mock: FragmentRetriever = {
      searchForSection: async (_query: SectionQuery, _limit?: number): Promise<RetrievedFragment[]> => [],
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
    await retriever.searchForSection({
      text: 'security',
      filters: { lang: 'fr', domain: ['cloud'], type: 'argument', tags: ['sla'] },
      collectionSlug: 'my-col',
    }, 3);
    expect(vi.mocked(svc.search).mock.calls[0]![1]).toMatchObject({
      lang: 'fr',
      domain: ['cloud'],
      type: ['argument'],
      tags: ['sla'],
      collectionSlug: 'my-col',
      quality_min: 'reviewed',
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
    const results = await retriever.searchForSection({ text: 'cloud', filters: {}, collectionSlug: null });
    expect(results).toHaveLength(1);
    expect(results[0].fragment_id).toBe('frag-1');
  });

  it('propagates SearchService errors (does not swallow them)', async () => {
    const svc = {
      search: vi.fn(async () => { throw new Error('Milvus exploded'); }),
    } as unknown as SearchService;
    const retriever = new VectorRetriever(svc);
    await expect(retriever.searchForSection({ text: 'x', filters: {}, collectionSlug: null }))
      .rejects.toThrow('Milvus exploded');
  });

  it('preserves null title and body_excerpt from SearchResult', async () => {
    const svc = fakeSearchService([{ ...SAMPLE_RESULT, title: null, body_excerpt: null }]);
    const retriever = new VectorRetriever(svc);
    const results = await retriever.searchForSection({ text: 'x', filters: {}, collectionSlug: null });
    expect(results[0].title).toBeNull();
    expect(results[0].body_excerpt).toBeNull();
  });
});

function fakeIndexService(md = '# Index\n\n- **[TM-arg-001]** Fragment One\n  id: frag-uuid-1'): IndexService {
  return {
    getIndex: vi.fn(async () => md),
  } as unknown as IndexService;
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
  it('phase1 parses the LLM JSON array of UUIDs', async () => {
    const llm = fakeLlmClient([
      '["frag-uuid-1", "frag-uuid-2"]',           // phase 1
      '{"score": 8, "reason": "relevant"}',        // phase 2 — frag-uuid-1
      '{"score": 4, "reason": "partial"}',          // phase 2 — frag-uuid-2
    ]);
    const retriever = new AgenticRetriever(
      fakeIndexService(),
      llm,
      fakeFragmentService({ 'frag-uuid-1': 'body one', 'frag-uuid-2': 'body two' }),
    );
    const results = await retriever.searchForSection({
      text: 'cloud introduction',
      filters: {},
      collectionSlug: null,
    }, 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].fragment_id).toBe('frag-uuid-1');
    expect(results[0].score).toBeCloseTo(0.8);
    expect(results[0].justification).toBe('relevant');
  });

  it('returns empty when phase1 LLM returns non-JSON', async () => {
    const llm = fakeLlmClient(['No IDs found for this query.']);
    const retriever = new AgenticRetriever(fakeIndexService(), llm, fakeFragmentService());
    const results = await retriever.searchForSection({ text: 'test', filters: {}, collectionSlug: null });
    expect(results).toEqual([]);
  });

  it('skips fragments not found by FragmentService', async () => {
    const llm = fakeLlmClient([
      '["frag-missing"]',
      // phase 2 won't fire because getById returns null
    ]);
    const retriever = new AgenticRetriever(fakeIndexService(), llm, fakeFragmentService({}));
    const results = await retriever.searchForSection({ text: 'x', filters: {}, collectionSlug: null });
    expect(results).toEqual([]);
  });

  it('filters out fragments with score below 0.3 after normalization', async () => {
    const llm = fakeLlmClient([
      '["frag-low"]',
      '{"score": 2, "reason": "poor match"}',   // 2/10 = 0.2 < threshold
    ]);
    const retriever = new AgenticRetriever(
      fakeIndexService(),
      llm,
      fakeFragmentService({ 'frag-low': 'body' }),
    );
    const results = await retriever.searchForSection({ text: 'x', filters: {}, collectionSlug: null });
    expect(results).toEqual([]);
  });
});

describe('HybridRetriever', () => {
  it('returns vector results directly when count <= limit (no LLM needed)', async () => {
    const svc = fakeSearchService([SAMPLE_RESULT]);
    const llm = fakeLlmClient([]);
    const retriever = new HybridRetriever(svc, llm);
    const results = await retriever.searchForSection({ text: 'x', filters: {}, collectionSlug: null }, 5);
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
    const llmResp = JSON.stringify([{ id: 'f1', score: 5 }, { id: 'f2', score: 9 }, { id: 'f3', score: 3 }]);
    const llm = fakeLlmClient([llmResp]);
    const retriever = new HybridRetriever(svc, llm);
    const results = await retriever.searchForSection({ text: 'x', filters: {}, collectionSlug: null }, 2);
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
    const results = await retriever.searchForSection({ text: 'x', filters: {}, collectionSlug: null }, 2);
    // Neutral fallback score = 5 → combined 0.4*score + 0.6*0.5, so vector order preserved
    expect(results).toHaveLength(2);
    expect(results[0].fragment_id).toBe('fa');
  });

  it('returns empty when SearchService returns no results', async () => {
    const retriever = new HybridRetriever(fakeSearchService([]), fakeLlmClient([]));
    const results = await retriever.searchForSection({ text: 'x', filters: {}, collectionSlug: null });
    expect(results).toEqual([]);
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
  it('createRetriever("vector-only") returns a VectorRetriever-like object', async () => {
    const retriever = createRetriever('vector-only', fakeDeps());
    expect(retriever).toBeDefined();
    expect(typeof retriever.searchForSection).toBe('function');
    expect(getCurrentMode()).toBe('vector-only');
  });

  it('createRetriever("agentic-only") returns AgenticRetriever', async () => {
    const retriever = createRetriever('agentic-only', fakeDeps());
    expect(retriever).toBeDefined();
    expect(getCurrentMode()).toBe('agentic-only');
  });

  it('createRetriever("hybrid") returns HybridRetriever', async () => {
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
});
