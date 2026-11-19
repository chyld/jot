import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  // The flows share two users on one server, so they run one at a time.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://jot-app:9003',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
  },
});
