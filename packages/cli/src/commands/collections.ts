// packages/cli/src/commands/collections.ts
import type { Command } from 'commander';
import type { FragmintClient } from '../client.js';

export function registerCollectionCommands(program: Command, getClient: () => FragmintClient) {
  const col = program.command('collections').description('Collection operations');

  col
    .command('list')
    .description('List accessible collections')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const client = getClient();
      const results = await client.request<any[]>('GET', '/v1/collections');
      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        if (!Array.isArray(results) || results.length === 0) {
          console.log('No collections found.');
          return;
        }
        for (const c of results) {
          console.log(`[${c.slug}] ${c.name} (${c.type}) — ${c.member_count ?? '?'} members`);
        }
      }
    });

  col
    .command('create <slug>')
    .description('Create a new collection')
    .requiredOption('--name <name>', 'Collection display name')
    .option('--type <type>', 'Collection type (team, project, personal)', 'team')
    .option('--description <desc>', 'Collection description')
    .option('--json', 'Output as JSON')
    .action(async (slug, opts) => {
      const client = getClient();
      const body: Record<string, unknown> = {
        slug,
        name: opts.name,
        type: opts.type,
      };
      if (opts.description) body.description = opts.description;
      const result = await client.request<Record<string, unknown>>('POST', '/v1/collections', body);
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Collection created: ${result.slug}`);
      }
    });

  col
    .command('members <slug>')
    .description('List members of a collection')
    .option('--json', 'Output as JSON')
    .action(async (slug, opts) => {
      const client = getClient();
      const results = await client.request<any[]>('GET', `/v1/collections/${slug}/members`);
      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        if (!Array.isArray(results) || results.length === 0) {
          console.log('No members found.');
          return;
        }
        for (const m of results) {
          console.log(`[${m.user_id}] ${m.display_name ?? m.email ?? m.user_id} — ${m.role}`);
        }
      }
    });

  col
    .command('add-member <slug> <userId>')
    .description('Add a member to a collection')
    .option('--role <role>', 'Member role (admin, editor, reader)', 'reader')
    .option('--json', 'Output as JSON')
    .action(async (slug, userId, opts) => {
      const client = getClient();
      const result = await client.request<Record<string, unknown>>(
        'POST',
        `/v1/collections/${slug}/members`,
        { user_id: userId, role: opts.role },
      );
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Member ${userId} added to ${slug} with role ${opts.role}.`);
      }
    });

  col
    .command('remove-member <slug> <userId>')
    .description('Remove a member from a collection')
    .action(async (slug, userId) => {
      const client = getClient();
      await client.request('DELETE', `/v1/collections/${slug}/members/${userId}`);
      console.log(`Member ${userId} removed from ${slug}.`);
    });
}
