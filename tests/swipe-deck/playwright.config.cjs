const path = require('node:path');
const { defineConfig } = require('@playwright/test');

const port = Number(process.env.SWIPE_TEST_PORT || 8173);
module.exports = defineConfig({
  testDir: __dirname,
  testMatch: '*.spec.cjs',
  timeout: 60_000,
  expect: { timeout: 5_000 },
  workers: 1,
  reporter: [['list']],
  outputDir: path.join(__dirname, '../../.expo/swipe-deck-results'),
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 430, height: 1100 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/serve-swipe-deck.cjs',
    cwd: path.join(__dirname, '../..'),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
