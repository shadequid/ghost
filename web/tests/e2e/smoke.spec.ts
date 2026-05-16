import { test, expect, type ConsoleMessage } from '@playwright/test';
import { mockGateway } from './fixtures/mock-api';

/**
 * Console noise we expect and do NOT want to fail on:
 *   - React DevTools recommendation
 *   - Font CORS warnings from Google Fonts (harmless in test env)
 *   - Source-map 404s (Vite sourcemaps aren't emitted in preview builds)
 */
const IGNORED_CONSOLE_PATTERNS = [
  /Download the React DevTools/i,
  /fonts\.googleapis\.com/i,
  /fonts\.gstatic\.com/i,
  /sourcemap/i,
];

function shouldIgnoreConsole(msg: ConsoleMessage): boolean {
  const text = msg.text();
  return IGNORED_CONSOLE_PATTERNS.some((rx) => rx.test(text));
}

/**
 * Every route the SPA declares (see App.tsx). We smoke-test each one to
 * make sure it renders without crashing after the Tailwind migration.
 */
const ROUTES = [
  { path: '/', name: 'AgentChat' },
  { path: '/dashboard', name: 'Dashboard' },
  { path: '/tools', name: 'Tools' },
  { path: '/skills', name: 'Skills' },
  { path: '/memory', name: 'Memory' },
  { path: '/logs', name: 'Logs' },
  { path: '/sessions', name: 'Sessions' },
  { path: '/config', name: 'Config' },
  { path: '/cost', name: 'Cost' },
  { path: '/cron', name: 'Cron' },
] as const;

test.describe('smoke', () => {
  test.beforeEach(async ({ page }) => {
    await mockGateway(page);
  });

  test('home page renders without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !shouldIgnoreConsole(msg)) {
        errors.push(`console.error: ${msg.text()}`);
      }
    });

    await page.goto('/');
    await expect(page).toHaveTitle(/Ghost/);
    // Main app fade-in wrapper appears once <AuthProvider> resolves.
    await expect(page.locator('.app-fade-in')).toBeVisible();
    // The 3-column layout has a stable Settings icon button in the top
    // bar. The previous chat-header title was removed when the layout
    // shifted to match Figma (node 215:1115).
    await expect(page.getByLabel('Open settings')).toBeVisible();

    expect(errors).toEqual([]);
  });

  for (const route of ROUTES) {
    test(`route ${route.path} renders (${route.name})`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() === 'error' && !shouldIgnoreConsole(msg)) {
          errors.push(`console.error: ${msg.text()}`);
        }
      });

      await page.goto(route.path);
      // Any non-loading main content should be present — we don't assert
      // the exact heading per-page (each page has its own look), just
      // that the SPA shell mounted past the <LoadingScreen> gate.
      await expect(page.locator('.app-fade-in')).toBeVisible({ timeout: 10_000 });

      // Reach network-idle within 3s of DOM ready. We've mocked every
      // REST/WS call so this must be quick.
      await page.waitForLoadState('networkidle', { timeout: 3_000 });

      expect(errors, `page errors on ${route.path}`).toEqual([]);
    });
  }

  test('direct navigation between routes preserves app shell', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.app-fade-in')).toBeVisible();

    // Visit a handful of routes in sequence (react-router handles
    // these client-side after the first nav).
    for (const path of ['/dashboard', '/tools', '/skills', '/memory']) {
      await page.goto(path);
      await expect(page.locator('.app-fade-in')).toBeVisible();
    }
  });
});
