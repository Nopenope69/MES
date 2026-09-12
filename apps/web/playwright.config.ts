import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PLAYWRIGHT_PORT || '4000';
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60 * 1000,
  expect: {
    timeout: 10 * 1000,
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npx tsx ../api/src/server.ts',
    url: `${BASE_URL}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 30 * 1000,
    cwd: path.resolve(__dirname, '../api'),
    env: {
      ...process.env,
      PORT,
      NODE_ENV: 'test',
      PUBLIC_DIR: path.resolve(__dirname, 'dist'),
    },
  },
});
