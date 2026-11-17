import { defineConfig } from '@playwright/test';

const port = Number(process.env.HEYO_FIXTURE_PORT ?? 41730);

export default defineConfig({
  testDir: 'e2e',
  // The per-site replay tests load real sites. playwright.live.config.ts runs them.
  testIgnore: 'live/**',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node e2e/server.mjs ${port}`,
    url: `http://127.0.0.1:${port}/basic.html`,
    reuseExistingServer: !process.env.CI,
  },
});
