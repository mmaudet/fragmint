import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  timeout: 45000,
  workers: 1,
  use: {
    baseURL: 'http://localhost:3210',
    headless: true,
  },
  webServer: {
    command: 'cd ../.. && npx tsx packages/server/src/index.ts',
    port: 3210,
    reuseExistingServer: true,
    timeout: 15000,
  },
});
