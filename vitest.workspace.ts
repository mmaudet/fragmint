import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'server',
      root: './packages/server',
      include: ['src/**/*.test.ts'],
      exclude: ['src/**/*.integration.test.ts'],
    },
  },
  {
    test: {
      name: 'server-integration',
      root: './packages/server',
      include: ['src/**/*.integration.test.ts'],
    },
  },
  {
    test: {
      name: 'cli',
      root: './packages/cli',
      include: ['src/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'mcp',
      root: './packages/mcp',
      include: ['src/**/*.test.ts'],
    },
  },
]);
