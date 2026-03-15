// packages/cli/src/commands/templates.ts
import type { Command } from 'commander';
import type { FragmintClient } from '../client.js';

export function registerTemplateCommands(program: Command, getClient: () => FragmintClient) {
  const tpl = program.command('templates').description('Template operations')
    .option('--collection <slug>', 'Collection slug', 'common');

  tpl
    .command('list')
    .description('List all templates')
    .option('--format <format>', 'Filter by output format')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const client = getClient();
      const collection = tpl.opts().collection;
      const params = new URLSearchParams();
      if (opts.format) params.set('output_format', opts.format);
      const suffix = `/templates${params.toString() ? '?' + params : ''}`;
      const results = await client.collectionRequest<any[]>('GET', suffix, collection);
      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        if (results.length === 0) {
          console.log('No templates found.');
          return;
        }
        for (const t of results) {
          console.log(`[${t.id}] ${t.name} (${t.output_format} v${t.version})`);
        }
      }
    });

  tpl
    .command('get <id>')
    .description('Get template detail')
    .action(async (id) => {
      const client = getClient();
      const collection = tpl.opts().collection;
      const result = await client.collectionRequest<any>('GET', `/templates/${id}`, collection);
      console.log(JSON.stringify(result, null, 2));
    });

  tpl
    .command('add <docx> <yaml>')
    .description('Create a template from .docx and .yaml files')
    .action(async (docxPath, yamlPath) => {
      const client = getClient();
      const collection = tpl.opts().collection;
      const result = await client.uploadTemplate(docxPath, yamlPath, collection);
      console.log(`Template created: ${(result as any).id}`);
    });
}
