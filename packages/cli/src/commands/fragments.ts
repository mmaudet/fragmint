// packages/cli/src/commands/fragments.ts
import type { Command } from 'commander';
import { FragmintClient } from '../client.js';

export function registerFragmentCommands(program: Command, getClient: () => FragmintClient) {
  const frag = program.command('fragment').description('Fragment operations');

  frag
    .command('search <query>')
    .description('Search fragments')
    .option('--type <type>', 'Filter by type')
    .option('--lang <lang>', 'Filter by language')
    .option('--json', 'Output as JSON')
    .action(async (query, opts) => {
      const client = getClient();
      const results = await client.request<unknown[]>('POST', '/v1/fragments/search', {
        query,
        filters: {
          type: opts.type ? [opts.type] : undefined,
          lang: opts.lang,
        },
      });
      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        if (!Array.isArray(results) || results.length === 0) {
          console.log('No results found.');
          return;
        }
        for (const r of results as Array<Record<string, unknown>>) {
          console.log(`[${r.id}] ${r.type} / ${r.domain} (${r.lang}) — ${r.quality}`);
        }
      }
    });

  frag
    .command('get <id>')
    .description('Get a fragment by ID')
    .option('--json', 'Output as JSON')
    .action(async (id, opts) => {
      const client = getClient();
      const result = await client.request<Record<string, unknown>>('GET', `/v1/fragments/${id}`);
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`ID:      ${result.id}`);
        console.log(`Type:    ${result.type}`);
        console.log(`Domain:  ${result.domain}`);
        console.log(`Lang:    ${result.lang}`);
        console.log(`Quality: ${result.quality}`);
        console.log(`Author:  ${result.author}`);
        console.log('---');
        console.log(result.body);
      }
    });

  frag
    .command('add')
    .description('Create a new fragment')
    .requiredOption('--type <type>', 'Fragment type')
    .requiredOption('--domain <domain>', 'Fragment domain')
    .requiredOption('--lang <lang>', 'Fragment language')
    .requiredOption('--body <body>', 'Fragment body content')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const client = getClient();
      const result = await client.request<Record<string, unknown>>('POST', '/v1/fragments', {
        type: opts.type,
        domain: opts.domain,
        lang: opts.lang,
        body: opts.body,
        tags: opts.tags ? opts.tags.split(',').map((t: string) => t.trim()) : [],
      });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Fragment created: ${result.id}`);
      }
    });

  frag
    .command('approve <id>')
    .description('Approve a fragment')
    .option('--json', 'Output as JSON')
    .action(async (id, opts) => {
      const client = getClient();
      const result = await client.request<Record<string, unknown>>('POST', `/v1/fragments/${id}/approve`);
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Fragment ${id} approved.`);
      }
    });

  frag
    .command('deprecate <id>')
    .description('Deprecate a fragment')
    .option('--json', 'Output as JSON')
    .action(async (id, opts) => {
      const client = getClient();
      const result = await client.request<Record<string, unknown>>('POST', `/v1/fragments/${id}/deprecate`);
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Fragment ${id} deprecated.`);
      }
    });

  frag
    .command('inventory')
    .description('Get fragment inventory')
    .option('--topic <topic>', 'Filter by topic')
    .option('--lang <lang>', 'Filter by language')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const client = getClient();
      const result = await client.request<unknown>('POST', '/v1/fragments/inventory', {
        topic: opts.topic,
        lang: opts.lang,
      });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
    });

  frag
    .command('gaps')
    .description('Show coverage gaps in the fragment inventory')
    .option('--lang <lang>', 'Filter by language')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const client = getClient();
      const result = await client.request<Record<string, unknown>>('POST', '/v1/fragments/inventory', {
        lang: opts.lang,
      });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        const inv = result as { gaps?: unknown[] };
        if (inv.gaps && inv.gaps.length > 0) {
          console.log('Coverage gaps:');
          for (const gap of inv.gaps as Array<Record<string, unknown>>) {
            console.log(`  - ${gap.type} / ${gap.domain} (${gap.lang})`);
          }
        } else {
          console.log('No coverage gaps detected.');
        }
      }
    });
}
