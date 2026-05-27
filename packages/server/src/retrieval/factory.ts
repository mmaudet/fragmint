import type { SearchService } from '../search/search-service.js';
import type { LlmClient } from '../services/llm-client.js';
import type { IndexService } from '../services/index-service.js';
import type { FragmentService } from '../services/fragment-service.js';
import type { FragmentRetriever } from './fragment-retriever.js';
import { VectorRetriever } from './vector-retriever.js';
import { AgenticRetriever } from './agentic-retriever.js';
import { HybridRetriever } from './hybrid-retriever.js';

export type RetrievalMode = 'vector-only' | 'agentic-only' | 'hybrid';

export interface RetrieverDeps {
  searchService: SearchService;
  llm: LlmClient;
  indexService: IndexService;
  fragmentService: FragmentService;
}

let _mode: RetrievalMode = 'vector-only';
let _deps: RetrieverDeps | null = null;
let _retriever: FragmentRetriever | null = null;

export function createRetriever(mode: RetrievalMode, deps: RetrieverDeps): FragmentRetriever {
  _mode = mode;
  _deps = deps;
  _retriever = build(mode, deps);
  console.log(`[retrieval] mode=${mode}`);
  return _retriever;
}

export function setRetrievalMode(mode: RetrievalMode): FragmentRetriever {
  if (!_deps) throw new Error('Call createRetriever before setRetrievalMode');
  _mode = mode;
  _retriever = build(mode, _deps);
  console.log(`[retrieval] mode switched to ${mode}`);
  return _retriever;
}

export function getCurrentMode(): RetrievalMode {
  return _mode;
}

export function getCurrentRetriever(): FragmentRetriever | null {
  return _retriever;
}

function build(mode: RetrievalMode, deps: RetrieverDeps): FragmentRetriever {
  switch (mode) {
    case 'vector-only':
      return new VectorRetriever(deps.searchService);
    case 'agentic-only':
      // selfConsistency is intrinsic to agentic-only: 2 parallel agents with min-score consensus
      // defines the mode's conservative precision strategy. Not env-configurable by design.
      return new AgenticRetriever(deps.indexService, deps.llm, deps.fragmentService, {
        selfConsistency: true,
      });
    case 'hybrid':
      return new HybridRetriever(deps.searchService, deps.llm);
  }
}
