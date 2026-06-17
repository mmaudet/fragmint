// packages/mcp/src/tools/retrieval-mode.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';

export const retrievalModeGetDefinition: ToolDefinition = {
  name: 'retrieval_mode_get',
  description:
    'Get the current retrieval mode used by Fragmint search. ' +
    'Modes: "vector-only" (fast, cosine similarity only), ' +
    '"agentic-only" (LLM candidate selection + self-consistency scoring, slower but smarter), ' +
    '"hybrid" (RRF fusion of vector + agentic, best quality).',
  inputSchema: { type: 'object', properties: {}, required: [] },
};

export function retrievalModeGetHandler(client: FragmintApiClient): ToolHandler {
  return async () => {
    try {
      const result = await client.get<{ mode: string; weights_preset: string | null }>(
        '/v1/admin/retrieval/mode',
      );
      return toolSuccess(result);
    } catch (err) {
      return toolError(
        `Failed to get retrieval mode: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
}

export const retrievalModeSetDefinition: ToolDefinition = {
  name: 'retrieval_mode_set',
  description:
    'Change the global retrieval mode for all Fragmint searches. ' +
    'Use "vector-only" for fast cosine similarity. ' +
    'Use "agentic-only" for LLM-driven candidate selection (slower, ~10s per query). ' +
    'Use "hybrid" for RRF fusion of both approaches (best quality). ' +
    'For hybrid mode, optionally set weights_preset: ' +
    '"balanced" (default), "vector-heavy" (trust embeddings more), "llm-heavy" (trust LLM more).',
  inputSchema: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['vector-only', 'agentic-only', 'hybrid'],
        description: 'The retrieval mode to activate',
      },
      weights_preset: {
        type: 'string',
        enum: ['balanced', 'vector-heavy', 'llm-heavy'],
        description: 'Hybrid mode weight preset (only used when mode is "hybrid")',
      },
    },
    required: ['mode'],
  },
};

export function retrievalModeSetHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const { mode, weights_preset } = args as {
        mode: 'vector-only' | 'agentic-only' | 'hybrid';
        weights_preset?: 'balanced' | 'vector-heavy' | 'llm-heavy';
      };

      const body: Record<string, string> = { mode };
      if (weights_preset) body.weights_preset = weights_preset;

      const result = await client.post<{
        mode: string;
        weights_preset: string | null;
        retriever_type: string;
      }>('/v1/admin/retrieval/mode', body);

      return toolSuccess(result);
    } catch (err) {
      return toolError(
        `Failed to set retrieval mode: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
}
