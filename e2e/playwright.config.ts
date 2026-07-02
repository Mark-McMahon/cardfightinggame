import { defineConfig, devices } from '@playwright/test';

// E2E config for the drag-and-drop verification. The dev servers (Vite :5173 + Colyseus :2567)
// are expected to already be running (`pnpm dev:client` / `pnpm dev:server`); reuseExistingServer
// keeps this from double-starting them, but will boot them if absent.
export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @cardgame/server dev',
      url: 'http://localhost:2567',
      reuseExistingServer: true,
      timeout: 30_000,
      cwd: '..',
    },
    {
      command: 'pnpm --filter @cardgame/client dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 30_000,
      cwd: '..',
    },
  ],
});
