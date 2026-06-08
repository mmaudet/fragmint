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
  rrfK?: number;
  rrfWeightsPreset?: string;
  hybridLlmFloor?: number;
  agenticMinScore?: number;
}

let _mode: RetrievalMode = 'vector-only';
let _deps: RetrieverDeps | null = null;
let _retriever: FragmentRetriever | null = null;
let _weightsPreset: string = 'literature';
let _sectionTopK: number = 5;

export function createRetriever(
  mode: RetrievalMode,
  deps: RetrieverDeps,
  initialTopK?: number,
): FragmentRetriever {
  _mode = mode;
  _deps = deps;
  _weightsPreset = deps.rrfWeightsPreset ?? 'literature';
  if (initialTopK !== undefined) _sectionTopK = initialTopK;
  _retriever = build(mode, deps);
  console.log(`[retrieval] mode=${mode} top_k=${_sectionTopK}`);
  return _retriever;
}

export function getSectionTopK(): number {
  return _sectionTopK;
}

export function setSectionTopK(n: number): void {
  _sectionTopK = Math.max(1, Math.min(20, n));
  console.log(`[retrieval] section_top_k set to ${_sectionTopK}`);
}

export function setRetrievalMode(mode: RetrievalMode, weightsPreset?: string): FragmentRetriever {
  if (!_deps) throw new Error('Call createRetriever before setRetrievalMode');
  _mode = mode;
  if (weightsPreset !== undefined) _weightsPreset = weightsPreset;
  _retriever = build(mode, { ..._deps, rrfWeightsPreset: _weightsPreset });
  console.log(`[retrieval] mode switched to ${mode} (weights=${_weightsPreset})`);
  return _retriever;
}

export function getCurrentMode(): RetrievalMode {
  return _mode;
}

export function getCurrentWeightsPreset(): string {
  return _weightsPreset;
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
        minScore: deps.agenticMinScore ?? 0.5,
      });
    case 'hybrid':
      return new HybridRetriever(
        deps.searchService,
        deps.llm,
        deps.rrfK ?? 60,
        deps.rrfWeightsPreset ?? 'literature',
        deps.hybridLlmFloor ?? 4,
      );
  }
}
