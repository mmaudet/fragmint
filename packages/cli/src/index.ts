#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import yaml from 'js-yaml';
import { FragmintClient } from './client.js';
import { registerServeCommand } from './commands/serve.js';
import { registerFragmentCommands } from './commands/fragments.js';
import { registerAdminCommands } from './commands/admin.js';
import { registerTemplateCommands } from './commands/templates.js';
import { registerComposeCommand } from './commands/compose.js';
import { registerHarvestCommand } from './commands/harvest.js';

const program = new Command();
program.name('fragmint').version('0.1.0').description('Fragmint CLI');

// Config resolution: CLI args > env vars > ~/.fragmintrc.yaml
let url = process.env.FRAGMINT_URL ?? 'http://localhost:3210';
let token = process.env.FRAGMINT_TOKEN;

const rcPath = join(homedir(), '.fragmintrc.yaml');
if (existsSync(rcPath)) {
  const rc = yaml.load(readFileSync(rcPath, 'utf-8')) as Record<string, string>;
  url = rc.url ?? url;
  token = rc.token ?? token;
}

program.option('--url <url>', 'Server URL').option('--token <token>', 'Auth token');

const getClient = () => {
  const opts = program.opts();
  return new FragmintClient(opts.url ?? url, opts.token ?? token);
};

registerServeCommand(program);
registerFragmentCommands(program, getClient);
registerAdminCommands(program, getClient);
registerTemplateCommands(program, getClient);
registerComposeCommand(program, getClient);
registerHarvestCommand(program, getClient);

program.parse();
