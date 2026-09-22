import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_TEST_PORT ?? 23221);
const apiPort = Number(process.env.PLAYWRIGHT_API_PORT ?? 23222);
const graphInteractionSpec = /graph-interactions\.spec\.ts/;
const narrowViewportSmoke = /supports narrow desktop viewport behavior/;
const portableBrowserSmoke = /supports portable browser graph editing and review flows/;

export default defineConfig({
  testDir: './src/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium-desktop',
      testMatch: graphInteractionSpec,
      grepInvert: narrowViewportSmoke,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox-desktop',
      testMatch: graphInteractionSpec,
      grep: portableBrowserSmoke,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'chromium-narrow',
      testMatch: graphInteractionSpec,
      grep: narrowViewportSmoke,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 900, height: 800 },
      },
    },
  ],
  webServer: [
    {
      command: `PPR_MODEL_DATA_PATH=/tmp/ppr-modeler-playwright-${apiPort}.json PORT=${apiPort} pnpm --filter @workspace/api-server run dev`,
      url: `http://127.0.0.1:${apiPort}/api/healthz`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `PORT=${port} API_PORT=${apiPort} BASE_PATH=/ pnpm --filter @workspace/ppr-modeler run dev`,
      url: `http://127.0.0.1:${port}/`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});