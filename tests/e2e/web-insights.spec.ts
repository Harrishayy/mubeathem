import { expect, test } from '@playwright/test';

/**
 * Insights against a real @cue/server on the rules engine (no Mubit key, so no traces): the screen
 * renders its KPIs and empty states, the range filter refetches, exports are real downloads, and
 * nothing overflows at any viewport.
 */

test('insights: KPIs, outcomes, empty traces, range filter, exports', async ({ page, request }) => {
  // One finished call so "What books meetings" has data.
  const view = await (await request.post('/api/calls', { data: { source: 'cue', prospect: { name: 'Maya Chen', title: 'CEO', company: 'Lumen Labs', facts: {} }, rep: { id: 'rep_e2e', name: 'Alex' } } })).json();
  await request.post(`/api/calls/${view.id}/turns`, { data: { speaker: 'prospect', text: "We already have a broker, they set all that up.", final: true } });
  await request.post(`/api/calls/${view.id}/end`, { data: { outcome: 'meeting_booked' } });

  await page.goto('/#/insights');
  await expect(page.getByRole('region', { name: 'What books meetings' })).toBeVisible();
  await expect(page.getByText('Mubit calls', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Traces' }).getByText('No traces yet')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Trace', exact: true }).getByText('Pick a trace')).toBeVisible();

  const all = page.getByRole('group', { name: 'Range' }).getByRole('button', { name: 'All' });
  const insights = page.waitForResponse((r) => r.url().includes('/api/insights?range=all') && r.ok());
  await all.click();
  await insights;
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'What books meetings' }).getByText(/booked/).first()).toBeVisible();

  for (const [name, format] of [['JSONL', 'jsonl'], ['OpenAI fine-tune', 'openai'], ['Langfuse', 'langfuse']] as const) {
    const link = page.getByRole('link', { name });
    await expect(link).toHaveAttribute('href', new RegExp(`/api/traces/export\\?format=${format}&range=all$`));
    const res = await request.get((await link.getAttribute('href'))!.replace(/^https?:\/\/[^/]+/, ''));
    expect(res.status(), `${format} export`).toBe(200);
  }

  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(sw, 'horizontal overflow on insights').toBeLessThanOrEqual(cw);
  await page.screenshot({ path: `test-results/web/${test.info().project.name}-insights.png`, fullPage: true });
});
