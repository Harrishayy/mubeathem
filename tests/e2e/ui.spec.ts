import { expect, test, type Page } from '@playwright/test';

/**
 * The design system across viewports (projects) × directions × themes: no horizontal overflow, the
 * collapsed overbar stays ≤ 56 px and fully on screen, the line truncates instead of wrapping, and
 * nothing in a card overflows with the stress strings. Screenshots land in test-results/ui/.
 */
const THEMES = [
  { dir: 'honey', theme: 'light' },
  { dir: 'honey', theme: 'dark' },
  { dir: 'night', theme: 'dark' },
  { dir: 'signal', theme: 'light' },
  { dir: 'signal', theme: 'dark' },
] as const;

// Fixed clock: timers read the same in every screenshot; animations still run.
const NOW = Date.UTC(2026, 9, 24, 15, 2, 14);

async function open(page: Page, query: string) {
  await page.clock.setFixedTime(NOW);
  await page.goto(`/?${query}`);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(450); // let enter animations settle
}

async function noHorizontalOverflow(page: Page) {
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll, 'page scrolls sideways').toBeLessThanOrEqual(client);
}

/** Elements inside `root` that stick out of their own box or past the viewport, ignoring deliberate truncation. */
async function overflowing(page: Page, root: string) {
  return page.evaluate((sel) => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    for (const r of document.querySelectorAll(sel)) {
      for (const el of [r, ...r.querySelectorAll('*')] as HTMLElement[]) {
        if (el.closest('.cue-bar__line, .cue-vh, .cue-scroll, .cue-sprout, svg')) continue;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0) continue;
        const clips = style.textOverflow === 'ellipsis' || style.webkitLineClamp !== 'none';
        const scroller = style.overflowX === 'auto' || style.overflowX === 'scroll';
        const box = style.display !== 'inline' && el.clientWidth > 0;
        if (box && !clips && !scroller && el.scrollWidth > el.clientWidth + 1) out.push(`${el.className || el.tagName}: content ${el.scrollWidth} > box ${el.clientWidth}`);
        if (rect.right > vw + 1) out.push(`${el.className || el.tagName}: right ${Math.round(rect.right)} > ${vw}`);
        const card = el.closest('.cue-card');
        if (card && card !== el && rect.right > card.getBoundingClientRect().right + 1) out.push(`${el.className || el.tagName}: past its card`);
      }
    }
    return [...new Set(out)].slice(0, 10);
  }, root);
}

for (const { dir, theme } of THEMES) {
  test.describe(`${dir} ${theme}`, () => {
    const q = `dir=${dir}&theme=${theme}`;

    test('collapsed overbar: ≤ 56 px, on screen, one truncated line', async ({ page }, info) => {
      await open(page, `scene=overbar&view=cold&${q}`);
      await noHorizontalOverflow(page);
      const bar = page.locator('.cue-bar').first();
      const box = (await bar.boundingBox())!;
      const vp = page.viewportSize()!;
      expect(box.height).toBeLessThanOrEqual(56);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
      const text = bar.locator('.cue-bar__text');
      const t = await text.evaluate((el) => ({ ws: getComputedStyle(el).whiteSpace, h: el.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(el).lineHeight) }));
      expect(t.ws).toBe('nowrap');
      expect(t.h).toBeLessThanOrEqual(t.lh * 1.5);
      await page.screenshot({ path: `test-results/ui/${info.project.name}-${dir}-${theme}-collapsed.png` });
    });

    test('expanded overbar with stress strings: nothing overflows', async ({ page }, info) => {
      const scene = (page.viewportSize()?.width ?? 0) < 560 ? 'sheet' : 'overbar';
      await open(page, `scene=${scene}&view=cold&mode=expanded&stress=1&${q}`);
      await noHorizontalOverflow(page);
      await expect(page.locator('.cue-card').first()).toBeVisible();
      expect(await overflowing(page, '.cue-panel')).toEqual([]);
      const line = page.locator('.cue-panel .cue-line').first();
      const lb = (await line.boundingBox())!;
      const card = (await page.locator('.cue-panel .cue-card').first().boundingBox())!;
      expect(lb.x + lb.width).toBeLessThanOrEqual(card.x + card.width + 1);
      await page.screenshot({ path: `test-results/ui/${info.project.name}-${dir}-${theme}-expanded-stress.png` });
    });

    test('expanded overbar, regular call', async ({ page }, info) => {
      const scene = (page.viewportSize()?.width ?? 0) < 560 ? 'sheet' : 'overbar';
      await open(page, `scene=${scene}&view=compliance&mode=expanded&${q}`);
      await noHorizontalOverflow(page);
      expect(await overflowing(page, '.cue-panel')).toEqual([]);
      await page.screenshot({ path: `test-results/ui/${info.project.name}-${dir}-${theme}-expanded.png` });
    });

    test('phone dock and side panel', async ({ page }, info) => {
      await open(page, `scene=sheet&view=objection&${q}`);
      const bar = page.locator('.cue-overbar__dock .cue-bar');
      const box = (await bar.boundingBox())!;
      const vp = page.viewportSize()!;
      expect(box.height).toBeLessThanOrEqual(56);
      expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
      await page.screenshot({ path: `test-results/ui/${info.project.name}-${dir}-${theme}-phone.png` });
      await open(page, `scene=panel&view=objection&mode=expanded&${q}`);
      await noHorizontalOverflow(page);
      expect(await overflowing(page, '.cue-panel')).toEqual([]);
      await page.screenshot({ path: `test-results/ui/${info.project.name}-${dir}-${theme}-panel.png` });
    });

    test('gallery catalogue with stress strings', async ({ page }, info) => {
      await open(page, `stress=1&${q}`);
      await noHorizontalOverflow(page);
      expect(await overflowing(page, '[data-testid="cards"]')).toEqual([]);
      expect(await overflowing(page, '[data-testid="bar-states"]')).toEqual([]);
      if (dir === 'honey' && theme === 'light') await page.screenshot({ path: `test-results/ui/${info.project.name}-gallery-stress.png`, fullPage: true });
    });
  });
}

test('the collapsed bar expands and Escape collapses it', async ({ page }) => {
  await open(page, 'scene=overbar&view=cold');
  await page.getByRole('button', { name: 'Expand' }).click();
  await expect(page.locator('.cue-overbar__panel--float')).toBeVisible();
  await page.getByRole('button', { name: 'Used it' }).focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.cue-overbar__panel--float')).toHaveCount(0);
});

test('phone: the sheet opens at half height and the handle takes it to full', async ({ page }) => {
  await open(page, 'scene=sheet&view=cold');
  await page.getByRole('button', { name: 'Expand' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toHaveAttribute('data-snap', 'half');
  await page.waitForTimeout(450);
  const vh = page.viewportSize()!.height;
  const half = (await sheet.boundingBox())!;
  expect(half.y).toBeGreaterThan(vh * 0.3);
  await page.getByRole('button', { name: 'Show more' }).click();
  await expect(sheet).toHaveAttribute('data-snap', 'full');
  await page.waitForTimeout(450);
  expect((await sheet.boundingBox())!.y).toBeLessThan(half.y);
});

test('an accessory rides with the bar', async ({ page }, info) => {
  await open(page, 'scene=overbar&view=ringing&accessory=1');
  const bar = (await page.locator('.cue-bar').first().boundingBox())!;
  const acc = (await page.locator('.cue-overbar__accessory').boundingBox())!;
  expect(acc.y).toBeGreaterThanOrEqual(bar.y + bar.height);
  expect(acc.x + acc.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: `test-results/ui/${info.project.name}-accessory.png` });
});

test('reduced motion keeps everything visible', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, 'scene=sprout');
  await expect(page.locator('[data-testid="sprouts"] .cue-sprout')).toHaveCount(24);
  await page.screenshot({ path: `test-results/ui/${info.project.name}-sprout-reduced.png`, fullPage: true });
});
