import { test, expect } from '@playwright/test';
import { mockGateway } from './fixtures/mock-api';

/**
 * Spot-checks that hover color changes come from CSS `:hover` / `hover:`
 * variants rather than the old imperative `onMouseEnter`/`onMouseLeave`
 * handlers the migration removed.
 *
 * Strategy: read computed `color` (or `borderColor`) before and after a
 * Playwright hover. If the value changes, the CSS path is working.
 */
test.describe('hover variants', () => {
  test.beforeEach(async ({ page }) => {
    await mockGateway(page);
    await page.goto('/');
    await expect(page.locator('.app-fade-in')).toBeVisible();
  });

  test('.sidebar-icon-btn goes to white on hover', async ({ page }) => {
    const btn = page.locator('.sidebar-icon-btn').first();
    await btn.scrollIntoViewIfNeeded();
    await btn.hover({ force: true });

    await expect
      .poll(async () => btn.evaluate((el) => getComputedStyle(el).color), {
        timeout: 1_500,
        intervals: [50, 100, 150],
      })
      .toBe('rgb(255, 255, 255)');
  });

  test('chat header Settings button flips border + text color on hover', async ({ page }) => {
    const btn = page.getByTitle('Settings').first();
    await btn.scrollIntoViewIfNeeded();

    const before = await btn.evaluate((el) => ({
      color: getComputedStyle(el).color,
      borderColor: getComputedStyle(el).borderColor,
    }));

    await btn.hover({ force: true });

    await expect
      .poll(
        async () =>
          btn.evaluate((el) => ({
            color: getComputedStyle(el).color,
            borderColor: getComputedStyle(el).borderColor,
          })),
        { timeout: 1_500, intervals: [50, 100, 150] },
      )
      .not.toEqual(before);
  });
});
