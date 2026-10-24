import { expect, test, type Page } from '@playwright/test';

/**
 * apps/web end to end against a real @cue/server on the rules engine: start a call, prospect turns,
 * a card, use it, end, debrief, the playbook changes. Every viewport × theme; no horizontal overflow;
 * screenshots in test-results/web/.
 */

const SHOTS = 'test-results/web';

async function noOverflow(page: Page, where: string) {
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(sw, `horizontal overflow on ${where}`).toBeLessThanOrEqual(cw);
}

async function shot(page: Page, name: string, fullPage = true) {
  await page.waitForTimeout(350); // let enter animations settle
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-${name}.png`, fullPage });
}

type CallState = { view: { status: string; current: { id: string; say: string; kind: string } | null; history: { suggestion: { id: string }; action: string | null }[]; turns: unknown[]; feedback: unknown; review: unknown } | null };
const callState = (page: Page) => page.evaluate(() => (window as unknown as { __cue: { call: { get(): unknown } } }).__cue.call.get() as CallState);

async function addProspect(page: Page, text: string) {
  const input = page.locator('#say-input');
  await input.fill(text);
  await input.press('Enter');
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Typed turns only (no mic prompts in CI); everything else default.
    localStorage.setItem('cue.settings.v1', JSON.stringify({ transcriber: 'typed' }));
  });
});

test('live call: card, use it, end, debrief, playbook learns', async ({ page, request }) => {
  const before = await (await request.get('/api/playbook')).json();
  const totals = (pb: { lines: { id: string; stats: Record<string, { shown: number }> }[] }) =>
    Object.fromEntries(pb.lines.map((l) => [l.id, l.stats['*']?.shown ?? 0]));
  const shownBefore = totals(before);

  await page.goto('/#/live');
  await expect(page.getByRole('heading', { name: 'Know exactly what to say next.' })).toBeVisible();
  await noOverflow(page, 'start');
  await shot(page, '01-start');

  // Someone new (the saved-contact path has its own spec): type them in, don't save.
  const typeNew = page.getByRole('button', { name: 'Or type someone new' });
  if (await typeNew.isVisible()) await typeNew.click();
  const form = page.getByRole('form', { name: 'Someone new' });
  await form.getByLabel('Name').fill('Maya Chen');
  await form.getByLabel('Title').fill('CEO');
  await form.getByLabel('Company').fill('Lumen Labs');
  await form.getByLabel(/Save to contacts/).uncheck();
  await page.getByRole('button', { name: 'Start call' }).click();
  await expect(page.locator('#say-input')).toBeVisible();

  // The gatekeeper answers: a card should arrive.
  await addProspect(page, "Hi, Maya's in a meeting right now. Can I ask what it's regarding?");
  await expect.poll(async () => (await callState(page)).view?.current?.say ?? null, { timeout: 15_000 }).not.toBeNull();
  const card = (await callState(page)).view!.current!;

  // The Live dashboard shows the cue in its own pane, with the line in full.
  const stage = page.getByRole('region', { name: 'Cue', exact: true });
  await expect(stage.locator('.cue-stage .cue-card').first()).toBeVisible();
  await expect(stage.getByText(card.say)).toBeVisible();
  await noOverflow(page, 'live');
  await shot(page, '02-live-dashboard', false);

  // U marks it used (the shortcut reaches the card on the dashboard).
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('u');
  await expect.poll(async () => (await callState(page)).view?.history.find((h) => h.suggestion.id === card.id)?.action ?? null).toBe('used');

  // On any other screen the overbar floats over it during the call: one strip, ≤ 56 px, on screen.
  await page.goto('/#/history');
  const bar = page.locator('.cue-overbar .cue-bar').first();
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.height).toBeLessThanOrEqual(56);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 0.5);
  await expect(bar.locator('.cue-bar__text', { hasText: card.say.slice(0, 20) })).toBeVisible();
  await noOverflow(page, 'history with overbar');
  await shot(page, '03-overbar-over-history', false);
  // Expand (⌘/Ctrl+.), see the card, collapse with Esc.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('ControlOrMeta+.');
  await expect(page.locator('.cue-overbar .cue-card').first()).toBeVisible();
  await noOverflow(page, 'overbar expanded');
  await page.keyboard.press('Escape');
  await page.goto('/#/live');
  await expect(stage).toBeVisible();

  // Rep says the line, the prospect objects: a second card.
  await page.getByRole('radio', { name: 'You' }).click();
  await page.locator('#say-input').fill(card.say);
  await page.locator('#say-input').press('Enter');
  await page.getByRole('radio', { name: 'Maya' }).click();
  await addProspect(page, 'We already have a broker, they set all that up when we raised the seed.');
  await expect.poll(async () => (await callState(page)).view?.current?.id ?? card.id, { timeout: 15_000 }).not.toBe(card.id);
  await shot(page, '04-live-console');

  // B books the meeting and opens the debrief as a modal over the console (no page change).
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const urlBefore = page.url();
  await page.keyboard.press('b');
  const debrief = page.getByRole('dialog', { name: 'How did it go?' });
  await expect(debrief).toBeVisible();
  expect(page.url()).toBe(urlBefore);
  await noOverflow(page, 'debrief');
  await shot(page, '05-debrief');

  await page.getByRole('radio', { name: /Meeting booked/ }).click();
  await page.getByRole('button', { name: 'Save debrief' }).click();
  await expect(page.getByRole('button', { name: 'See the playbook' })).toBeVisible({ timeout: 20_000 });
  await noOverflow(page, 'review');
  await shot(page, '06-review');

  await page.getByRole('button', { name: 'See the playbook' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'What books meetings' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Just learned' })).toBeVisible();
  await noOverflow(page, 'playbook');
  await shot(page, '07-playbook');

  const after = await (await request.get('/api/playbook')).json();
  const shownAfter = totals(after);
  const grew = Object.keys(shownAfter).filter((id) => shownAfter[id]! > (shownBefore[id] ?? 0));
  expect(grew.length, 'the review credited at least one line').toBeGreaterThan(0);
});

for (const [route, heading] of [
  ['contacts', 'Contacts'],
  ['team', 'How you and the team are doing'],
  ['model', 'Every call trains it'],
  ['history', 'Past calls'],
  ['settings', 'Make Cue yours'],
] as const) {
  test(`${route} screen renders without overflow`, async ({ page }) => {
    await page.goto(`/#/${route}`);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    if (route === 'model') await expect(page.locator('.cue-task, .cue-growth, [class*="cue-model"]').first()).toBeVisible({ timeout: 10_000 }).catch(() => {});
    await noOverflow(page, route);
    await shot(page, `screen-${route}`);
  });
}

test('no demo or practice wording anywhere a rep can see', async ({ page }) => {
  for (const route of ['live', 'contacts', 'history', 'team', 'playbook', 'model', 'insights', 'settings']) {
    await page.goto(`/#/${route}`);
    await page.waitForTimeout(400);
    const text = (await page.locator('body').innerText()).toLowerCase();
    expect(text, route).not.toMatch(/\bdemo\b|\bpractice\b/);
  }
});
