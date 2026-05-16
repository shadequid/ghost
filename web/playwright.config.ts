import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config — smoke suite for the Ghost web dashboard.
 *
 * The web app is a Vite SPA served under base path `/_app/` (see vite.config.ts).
 * For tests we build once and serve via `vite preview` on port 4173. The gateway
 * (ElysiaJS on :15401 in production) is NOT required — tests mock all network
 * traffic via route interception in `tests/e2e/fixtures/mock-api.ts`.
 *
 * Keep this suite tight: ~10-20 tests across a few specs, focused on render
 * correctness and the Tailwind-migration regressions we just fixed.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Build once, then serve with a tiny Bun static server that mimics the
  // production gateway's SPA layout (see tests/e2e/fixtures/static-server.ts).
  // `vite preview` can't do this because it only serves under the Vite base
  // path `/_app/`, but react-router owns the root `/`, `/dashboard`, etc.
  webServer: {
    command: 'bun run build && bun run tests/e2e/fixtures/static-server.ts 4173',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
