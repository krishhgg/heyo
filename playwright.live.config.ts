// The per-site replay tests. They load real sites, so they are not part of the
// required checks. Run them with `npm run e2e:live`.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e/live',
  workers: 1,
  retries: 1,
  timeout: 60_000,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
});
