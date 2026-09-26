import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  timeout: 30000,
  use: { browserName: 'chromium', headless: true, viewport: { width: 1400, height: 900 }, trace: 'retain-on-failure' },
});
