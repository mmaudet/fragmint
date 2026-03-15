// packages/mcp/src/tools/fragment-harvest.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';
import { fragmentUrl } from '../url-helpers.js';

export const harvestDefinition: ToolDefinition = {
  name: 'fragment_harvest',
  description:
    'Harvest fragments from a DOCX file. Uploads the file, runs the LLM pipeline, and returns candidate fragments for human review.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute path to the .docx file to harvest' },
      min_confidence: {
        type: 'number',
        description: 'Minimum confidence threshold (0.0-1.0, default 0.65)',
      },
      collection_slug: { type: 'string', description: 'Target collection slug (default: "common"). Use collection_list to discover available collections.' },
    },
    required: ['file_path'],
  },
};

export function harvestHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const { file_path, min_confidence = 0.65, collection_slug } = args as {
        file_path: string;
        min_confidence?: number;
        collection_slug?: string;
      };

      const { readFileSync } = await import('node:fs');
      const { basename } = await import('node:path');

      // Upload file
      const form = new FormData();
      form.append('files', new Blob([readFileSync(file_path)]), basename(file_path));
      form.append('options', JSON.stringify({ min_confidence }));

      const uploadResult = await client.postMultipart<{ job_id: string; status: string }>(
        fragmentUrl(collection_slug, '/harvest'),
        form,
      );
      const jobId = uploadResult.job_id;

      // Poll until done (max 5 minutes)
      const maxWait = 300_000;
      const start = Date.now();
      let job: any;
      while (Date.now() - start < maxWait) {
        job = await client.get<any>(fragmentUrl(collection_slug, `/harvest/${jobId}`));
        if (job.status === 'done' || job.status === 'error') break;
        await new Promise((r) => setTimeout(r, 3000));
      }

      if (!job || (job.status !== 'done' && job.status !== 'error')) {
        return toolError(`Harvest timed out after ${maxWait / 1000}s for job ${jobId}`);
      }

      if (job.status === 'error') {
        return toolError(`Harvest failed: ${job.error}`);
      }

      return toolSuccess({
        job_id: jobId,
        stats: job.stats,
        candidates_count: job.candidates?.length ?? 0,
        candidates: job.candidates,
      });
    } catch (err) {
      return toolError(`Harvest failed: ${(err as Error).message}`);
    }
  };
}
