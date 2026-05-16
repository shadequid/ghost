import { test, expect } from '@playwright/test';
import { mockGateway } from './fixtures/mock-api';

/**
 * Regression guards for the Tailwind-migration UI fixes:
 *
 *   A. Form inputs (`<input>`, `<textarea>`, `<select>`) NEVER show a
 *      focus outline — product decision (DESIGN.md §7). Buttons and
 *      other interactive elements still get the global cyan ring.
 *
 *   B. `.settings-manage-btn` hover: no background fill, just a 1px
 *      translateX nudge (the old green tint doubled up with the green
 *      label and muddied the row).
 */
test.describe('focus states', () => {
  test.beforeEach(async ({ page }) => {
    await mockGateway(page);
    await page.goto('/');
    await expect(page.locator('.app-fade-in')).toBeVisible();
  });

  test('A. form inputs have NO outline on focus (input / textarea / select)', async ({ page }) => {
    // All three form-input tags are covered by the global override in
    // `index.css` that strips outline regardless of Tailwind utility
    // state. Probe each and assert no outline is painted.
    const results = await page.evaluate(() => {
      const tags: Array<'input' | 'textarea' | 'select'> = ['input', 'textarea', 'select'];
      return tags.map((tag) => {
        const el = document.createElement(tag);
        el.id = `e2e-focus-probe-${tag}`;
        if (tag === 'select') {
          const opt = document.createElement('option');
          opt.text = 'x';
          el.appendChild(opt);
        }
        document.body.appendChild(el);
        el.focus();
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        const cs = getComputedStyle(el);
        return {
          tag,
          outlineStyle: cs.outlineStyle,
          outlineWidth: cs.outlineWidth,
        };
      });
    });

    for (const r of results) {
      expect(
        r.outlineStyle === 'none' || r.outlineWidth === '0px',
        `${r.tag} unexpectedly has an outline (style=${r.outlineStyle}, width=${r.outlineWidth})`,
      ).toBe(true);
    }
  });

  test('A2. buttons still get the global focus ring (color follows --color-border-focus)', async ({ page }) => {
    // Guard against accidentally stripping the ring from every element
    // — only form inputs are muted. Asserts that the rendered outline
    // color matches whatever --color-border-focus resolves to, so the
    // test follows the design token rather than a frozen hex literal.
    const result = await page.evaluate(() => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'probe';
      document.body.appendChild(btn);
      btn.focus();
      btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      const cs = getComputedStyle(btn);
      // Snapshot computed values BEFORE removing the element from the
      // DOM — getComputedStyle returns a live CSSStyleDeclaration that
      // reads `''` once the element is detached.
      const snapshot = {
        outlineStyle: cs.outlineStyle,
        outlineWidth: cs.outlineWidth,
        outlineColor: cs.outlineColor,
      };
      // Resolve the token via a probe element — getPropertyValue from
      // :root would give the raw declaration, but a probe lets the
      // browser do hex/rgb/percent normalization for us.
      const probe = document.createElement('div');
      probe.style.color = 'var(--color-border-focus)';
      document.body.appendChild(probe);
      const tokenColor = getComputedStyle(probe).color;
      probe.remove();
      btn.remove();
      return { ...snapshot, tokenColor };
    });

    expect(result.outlineStyle).toBe('solid');
    expect(result.outlineWidth).toBe('2px');
    expect(result.outlineColor).toBe(result.tokenColor);
  });

  test('B. .settings-manage-btn hover: no background fill, 1px nudge only', async ({ page }) => {
    // Inject a minimal fixture so this test doesn't require driving the
    // real Settings modal open (mocking that end-to-end is out of scope
    // for a CSS-rule regression test).
    await page.evaluate(() => {
      const btn = document.createElement('button');
      btn.id = 'e2e-manage-probe';
      btn.className = 'settings-manage-btn';
      btn.style.padding = '10px 20px';
      btn.textContent = 'probe';
      document.body.appendChild(btn);
    });

    const btn = page.locator('#e2e-manage-probe');
    await btn.hover();

    await expect
      .poll(
        async () =>
          btn.evaluate((el) => {
            const cs = getComputedStyle(el);
            return { bg: cs.backgroundColor, transform: cs.transform };
          }),
        { timeout: 2_000, intervals: [50, 100, 200] },
      )
      .toMatchObject({
        // No fill — UA default (transparent) or `rgba(0, 0, 0, 0)`.
        bg: expect.stringMatching(/^(transparent|rgba?\(0,\s*0,\s*0,?\s*\/?\s*0\)?)$/),
        transform: 'matrix(1, 0, 0, 1, 1, 0)',
      });

    // Regression guard: neither the old green tint nor the interim white
    // tint should reappear.
    const bg = await btn.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toMatch(/0,\s*255,\s*136/);
    expect(bg).not.toMatch(/255,\s*255,\s*255,\s*0\.03/);
  });
});
