// packages/cli/src/commands/compose.ts
import type { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import type { FragmintClient } from '../client.js';

export function registerComposeCommand(program: Command, getClient: () => FragmintClient) {
  program
    .command('compose <template-id>')
    .description('Compose a document from a template')
    .requiredOption('--context <json>', 'Context as JSON string')
    .option('--overrides <json>', 'Fragment overrides as JSON')
    .option('--structured-data <json>', 'Structured data as JSON')
    .option('--output <path>', 'Output file path')
    .action(async (templateId, opts) => {
      const client = getClient();
      const body: Record<string, any> = {
        context: JSON.parse(opts.context),
      };
      if (opts.overrides) body.overrides = JSON.parse(opts.overrides);
      if (opts.structuredData) body.structured_data = JSON.parse(opts.structuredData);

      const result = await client.request<any>('POST', `/v1/templates/${templateId}/compose`, body);

      console.log(`Document generated: ${result.document_url}`);
      console.log(`Resolved: ${result.resolved.length} fragments`);
      if (result.skipped?.length) console.log(`Skipped: ${result.skipped.join(', ')}`);
      if (result.warnings?.length) console.log(`Warnings: ${result.warnings.join(', ')}`);
      console.log(`Render time: ${result.render_ms}ms`);

      if (opts.output) {
        const buffer = await client.download(result.document_url);
        writeFileSync(opts.output, buffer);
        console.log(`Saved to: ${opts.output}`);
      }
    });
}
