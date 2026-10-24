import { expect, test, type Page } from '@playwright/test';

/**
 * Contacts, History filters and Team against a real @cue/server (rules engine, throwaway db). Every
 * project shares the server, so names and rep ids carry the project name.
 */

const tag = () => test.info().project.name.replace(/[^a-z0-9]/gi, '');

async function noOverflow(page: Page, where: string) {
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(sw, `horizontal overflow on ${where}`).toBeLessThanOrEqual(cw);
}

const settings = (page: Page, s: Record<string, unknown>) =>
  page.addInitScript((v) => localStorage.setItem('cue.settings.v1', v), JSON.stringify({ transcriber: 'typed', seenLiveHint: true, ...s }));

type CallState = { callId: string | null; view: { status: string; prospect: { name: string } } | null };
const callState = (page: Page) => page.evaluate(() => (window as unknown as { __cue: { call: { get(): unknown } } }).__cue.call.get() as CallState);

test('contacts: add, search, start a call from a contact', async ({ page, request }) => {
  const name = `Rosa Quill ${tag()}`;
  await settings(page, { repId: `rep_c_${tag()}`, repName: 'Casey' });
  await page.goto('/#/contacts');
  await expect(page.getByRole('region', { name: 'Contacts', exact: true })).toBeVisible();

  // Add (validation first: a name is required)
  await page.getByRole('button', { name: /^Add (a )?contact$/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add a contact' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Save contact' }).click();
  await expect(dialog.getByText('Add a name so you can find them later.')).toBeVisible();
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel(/^Title/).fill('Head of Finance');
  await dialog.getByLabel(/^Company/).fill('Quill & Co');
  await dialog.getByLabel(/^What you know/).fill('Funding: Seed, $3M');
  await dialog.getByRole('button', { name: 'Save contact' }).click();
  await expect(dialog).toBeHidden();
  await noOverflow(page, 'contacts');

  // Search finds them; the detail pane shows the facts and the call button.
  await page.getByRole('searchbox', { name: 'Search contacts' }).fill(`Quill ${tag()}`);
  const table = page.getByRole('region', { name: 'Saved contacts' });
  await expect(table.getByText(name)).toBeVisible();
  await table.getByText(name).click();
  const detail = page.getByRole('complementary', { name: 'Contact' });
  await expect(detail.getByRole('heading', { name })).toBeVisible();
  await expect(detail.getByText('Seed, $3M')).toBeVisible();

  await detail.getByRole('button', { name: 'Call Rosa' }).click();
  await expect(page).toHaveURL(/#\/live$/);
  await expect(page.locator('#say-input')).toBeVisible();
  await expect.poll(async () => (await callState(page)).view?.prospect.name).toBe(name);
  const id = (await callState(page)).callId!;
  await request.post(`/api/calls/${id}/end`, { data: { outcome: 'follow_up' } });
});

test('history: filters by rep from the URL and shows what went well', async ({ page, request }) => {
  const rep = `rep_h_${tag()}`;
  const prospect = `Ines Vale ${tag()}`;
  const v = await (await request.post('/api/calls', { data: { source: 'cue', prospect: { name: prospect, title: 'CFO', company: 'Vale Freight', facts: {} }, rep: { id: rep, name: `Hana ${tag()}` } } })).json();
  await request.post(`/api/calls/${v.id}/end`, { data: { outcome: 'meeting_booked' } });
  await request.post(`/api/calls/${v.id}/feedback`, { data: { outcome: 'meeting_booked', rating: 4, attitude: 'curious', whatWorked: 'Asked about their freight costs early', whatDidnt: 'Rushed the close', helpful: [], unhelpful: [] } });

  await settings(page, {});
  await page.goto(`/#/history?rep=${rep}&outcome=meeting_booked`);
  await expect(page.getByRole('combobox', { name: 'Rep' })).toHaveValue(rep);
  await expect(page.getByRole('combobox', { name: 'Outcome' })).toHaveValue('meeting_booked');
  const table = page.getByRole('region', { name: 'Past calls' });
  await expect(table.getByText(prospect)).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(1);
  const detail = page.getByRole('complementary', { name: 'Call' });
  await expect(detail.getByRole('region', { name: 'Went well' }).getByText('Asked about their freight costs early')).toBeVisible({ timeout: 10_000 });
  await expect(detail.getByRole('region', { name: "Didn't go well" }).getByText('Rushed the close')).toBeVisible();
  await noOverflow(page, 'history filtered');

  // A filter that matches nothing says so and can be cleared back to the URL without filters.
  await page.getByRole('combobox', { name: 'Outcome' }).selectOption('no_answer');
  await expect(page).toHaveURL(/outcome=no_answer/);
  await expect(page.getByText('No calls match these filters')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).first().click();
  await expect(page).toHaveURL(/#\/history$/);
});

test('team: You and Team views, empty state and leaderboard', async ({ page, request }) => {
  const rep = `rep_t_${tag()}`;
  const me = `Tess ${tag()}`;
  await settings(page, { repId: rep, repName: me });
  await page.goto('/#/team');
  await expect(page.getByText('No calls from you in this period')).toBeVisible();
  await noOverflow(page, 'team you empty');

  // One booked call for this rep: the You view fills in.
  const v = await (await request.post('/api/calls', { data: { source: 'cue', prospect: { name: 'Ola Berg', title: 'CEO', company: 'Berg AB', facts: {} }, rep: { id: rep, name: me } } })).json();
  await request.post(`/api/calls/${v.id}/end`, { data: { outcome: 'meeting_booked' } });
  await page.reload();
  await expect(page.getByText('Your booking rate')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Your weekly trend' })).toBeVisible();
  await noOverflow(page, 'team you');

  await page.getByRole('radio', { name: 'Team' }).click();
  await expect(page).toHaveURL(/view=team/);
  const board = page.getByRole('region', { name: 'Team leaderboard' });
  await expect(board.getByText(me).first()).toBeVisible();
  await noOverflow(page, 'team board');
  await board.getByText(me).first().click();
  await expect(page).toHaveURL(new RegExp(`#/history\\?rep=${rep}`));
});

test('team: asks for your name when Settings has none', async ({ page }) => {
  await settings(page, { repId: '', repName: '' });
  await page.goto('/#/team');
  await expect(page.getByText('Tell Cue who you are')).toBeVisible();
  await page.getByRole('button', { name: 'Set your name in Settings' }).click();
  await expect(page).toHaveURL(/#\/settings$/);
});
