// packages/cli/src/commands/admin.ts
import type { Command } from 'commander';
import { FragmintClient } from '../client.js';

export function registerAdminCommands(program: Command, getClient: () => FragmintClient) {
  const admin = program.command('admin').description('Admin operations');

  // Token subcommands
  const token = admin.command('token').description('Manage API tokens');

  token
    .command('create <name>')
    .description('Create an API token')
    .requiredOption('--role <role>', 'Token role (reader|contributor|expert|admin)')
    .option('--json', 'Output as JSON')
    .action(async (name, opts) => {
      const client = getClient();
      const result = await client.request<Record<string, unknown>>('POST', '/v1/tokens', {
        name,
        role: opts.role,
      });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Token created: ${result.id}`);
        console.log(`Secret (save this, it will not be shown again): ${result.token}`);
      }
    });

  token
    .command('list')
    .description('List API tokens')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const client = getClient();
      const results = await client.request<Array<Record<string, unknown>>>('GET', '/v1/tokens');
      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        if (!results || results.length === 0) {
          console.log('No tokens found.');
          return;
        }
        for (const t of results) {
          console.log(`[${t.id}] ${t.name} — role: ${t.role} — active: ${t.active} — last used: ${t.last_used ?? 'never'}`);
        }
      }
    });

  token
    .command('revoke <id>')
    .description('Revoke an API token')
    .option('--json', 'Output as JSON')
    .action(async (id, opts) => {
      const client = getClient();
      const result = await client.request<Record<string, unknown>>('DELETE', `/v1/tokens/${id}`);
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Token ${id} revoked.`);
      }
    });

  // Users subcommand
  const users = admin.command('users').description('Manage users');

  users
    .command('list')
    .description('List all users')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const client = getClient();
      const results = await client.request<Array<Record<string, unknown>>>('GET', '/v1/users');
      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        if (!results || results.length === 0) {
          console.log('No users found.');
          return;
        }
        for (const u of results) {
          console.log(`[${u.login}] ${u.display_name} — role: ${u.role}`);
        }
      }
    });

  // Audit subcommand
  admin
    .command('audit')
    .description('Query audit logs')
    .option('--from <date>', 'Start date (ISO)')
    .option('--to <date>', 'End date (ISO)')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const client = getClient();
      const params = new URLSearchParams();
      if (opts.from) params.set('from', opts.from);
      if (opts.to) params.set('to', opts.to);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const results = await client.request<Array<Record<string, unknown>>>('GET', `/v1/audit${qs}`);
      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        if (!results || results.length === 0) {
          console.log('No audit logs found.');
          return;
        }
        for (const log of results) {
          console.log(`[${log.created_at}] ${log.actor} — ${log.action} on ${log.target_id} (${log.ip})`);
        }
      }
    });

  // Index subcommands
  const index = admin.command('index').description('Manage search index');

  index
    .command('status')
    .description('Get index status')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const client = getClient();
      const result = await client.request<Record<string, unknown>>('GET', '/v1/index/status');
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Index status: ${result.status} — last run: ${result.last_run}`);
      }
    });

  index
    .command('trigger')
    .description('Trigger a full reindex')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const client = getClient();
      const result = await client.request<Record<string, unknown>>('POST', '/v1/index/trigger');
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Reindex complete. Indexed: ${result.indexed}`);
      }
    });
}
