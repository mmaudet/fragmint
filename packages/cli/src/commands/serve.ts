// packages/cli/src/commands/serve.ts
import type { Command } from 'commander';

export function registerServeCommand(program: Command) {
  program
    .command('serve')
    .description('Start the Fragmint server')
    .option('--port <port>', 'Port to listen on')
    .option('--config <path>', 'Path to config file')
    .option('--dev', 'Enable dev mode (in-memory DB, seed user)')
    .action(async (opts) => {
      if (opts.port) {
        process.env.FRAGMINT_PORT = opts.port;
      }

      // Dynamic import to avoid loading server deps when not needed
      const { startServer } = await import('@fragmint/server');
      await startServer({
        configPath: opts.config,
        dev: opts.dev ?? false,
      });
    });
}
