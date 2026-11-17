import { expect, test } from './helpers/fixtures';
import { arrive, clickAt } from './helpers/log';
import {
  actionsOf,
  fixtureRecords,
  passingLog,
  SENT_MS,
  turnOnRetargeting,
} from './helpers/retarget';

/** A near miss 4 px right of a control whose box starts at x, then a wait for heyo to act. */
async function miss(page: import('@playwright/test').Page, x: number, y: number) {
  await clickAt(page, x, y);
  await page.waitForTimeout(SENT_MS);
}

test.describe('the retargeting switch', () => {
  test('stays off until the log passes the gates', async ({ page, worker }) => {
    const refused = await worker.evaluate(() => heyo.setMode('retarget'));
    expect(refused).toMatchObject({ ok: false, settings: { mode: 'shadow' } });

    await page.goto('/replay.html');
    await miss(page, 184, 116);
    expect(await actionsOf(page)).toEqual([]);
  });

  test('turns on once the log passes, and off again on request', async ({ worker }) => {
    await worker.evaluate((log) => heyo.importLog(log), passingLog());
    const on = await worker.evaluate(() => heyo.setMode('retarget'));
    expect(on).toMatchObject({ ok: true, settings: { mode: 'retarget' } });
    const off = await worker.evaluate(() => heyo.setMode('shadow'));
    expect(off).toMatchObject({ ok: true, settings: { mode: 'shadow' } });
  });

  test('does nothing on a site that is not on the allowlist', async ({ page, worker }) => {
    await turnOnRetargeting(worker, { hosts: ['other.example'] });
    await page.goto('/replay.html');
    await miss(page, 184, 116);
    expect(await actionsOf(page)).toEqual([]);
    expect((await fixtureRecords(worker))[0]!.fire ?? null).toBeNull();
  });
});

test.describe('a near miss with retargeting on', () => {
  test.beforeEach(async ({ page, worker }) => {
    await turnOnRetargeting(worker);
    await page.goto('/replay.html');
  });

  /** Runs one near miss and returns what the page did and what heyo logged. */
  async function nearMiss(
    page: import('@playwright/test').Page,
    worker: import('@playwright/test').Worker,
    x: number,
    y: number,
  ) {
    await miss(page, x, y);
    const records = await fixtureRecords(worker);
    return { actions: await actionsOf(page), fire: records.at(-1)!.fire ?? null };
  }

  const sent = { outcome: 'sent', reacted: true };

  test('clicks a button once', async ({ page, worker }) => {
    const { actions, fire } = await nearMiss(page, worker, 184, 116);
    expect(actions).toEqual(['plain']);
    expect(fire).toEqual({ outcome: 'sent', reacted: false });
  });

  test('follows a link once', async ({ page, worker }) => {
    const { actions, fire } = await nearMiss(page, worker, 384, 110);
    expect(actions).toEqual(['#linked']);
    expect(fire).toEqual(sent);
  });

  test('ticks a checkbox through its label once', async ({ page, worker }) => {
    const { actions, fire } = await nearMiss(page, worker, 584, 110);
    expect(actions).toEqual(['check']);
    expect(fire?.outcome).toBe('sent');
    await expect(page.locator('#check')).toBeChecked();
  });

  test('puts the cursor in a text field', async ({ page, worker }) => {
    const { actions, fire } = await nearMiss(page, worker, 784, 116);
    expect(actions).toEqual(['field']);
    await expect(page.locator('#field')).toBeFocused();
    expect(fire).toEqual(sent);
  });

  test('opens a details element once', async ({ page, worker }) => {
    const { actions, fire } = await nearMiss(page, worker, 984, 110);
    expect(actions).toEqual(['details']);
    expect(fire).toEqual(sent);
  });

  test('reaches a handler on a wrapper, as on a React page, once', async ({ page, worker }) => {
    const { actions, fire } = await nearMiss(page, worker, 184, 216);
    expect(actions).toEqual(['delegated']);
    expect(fire?.outcome).toBe('sent');
  });

  test('reaches a control that acts on pointerdown', async ({ page, worker }) => {
    const { actions, fire } = await nearMiss(page, worker, 384, 216);
    expect(actions).toEqual(['pressed']);
    expect(fire?.outcome).toBe('sent');
  });

  test('is ignored by a page that only trusts real input, and the log says so', async ({
    page,
    worker,
  }) => {
    const { actions, fire } = await nearMiss(page, worker, 584, 216);
    expect(actions).toEqual([]);
    expect(fire).toEqual({ outcome: 'sent', reacted: false });
  });

  test('opens a popup the control asks for', async ({ page, worker, context }) => {
    const opened = context.waitForEvent('page', { timeout: 3000 }).catch(() => null);
    const { actions, fire } = await nearMiss(page, worker, 784, 216);
    expect(actions).toEqual(['popup']);
    // A real window loses focus to the popup, which heyo counts as a reaction. A test window does not.
    expect(fire?.outcome).toBe('sent');
    expect(await opened).not.toBeNull();
  });

  test('opens a link in a new tab', async ({ page, worker, context }) => {
    const opened = context.waitForEvent('page', { timeout: 3000 }).catch(() => null);
    const { fire } = await nearMiss(page, worker, 984, 210);
    expect(fire?.outcome).toBe('sent');
    const tab = await opened;
    expect(tab).not.toBeNull();
    await tab!.waitForURL('**/basic.html');
  });

  test('opens a file picker', async ({ page, worker }) => {
    const chooser = page.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null);
    const { actions, fire } = await nearMiss(page, worker, 184, 310);
    expect(actions).toEqual(['file']);
    expect(fire?.outcome).toBe('sent');
    expect(await chooser).not.toBeNull();
  });

  test('submits a form once', async ({ page, worker }) => {
    const { actions, fire } = await nearMiss(page, worker, 784, 316);
    expect(actions).toEqual(['submitted']);
    expect(fire?.outcome).toBe('sent');
  });

  test('opens or declines a native dropdown without breaking', async ({ page, worker }) => {
    const { fire } = await nearMiss(page, worker, 384, 316);
    expect(['sent', 'failed']).toContain(fire?.outcome);
  });

  test('leaves a control alone when its label looks irreversible', async ({ page, worker }) => {
    const { actions, fire } = await nearMiss(page, worker, 584, 316);
    expect(actions).toEqual([]);
    expect(fire).toBeNull();
  });

  test('sends nothing when the user is already clicking again', async ({ page, worker }) => {
    await arrive(page, 184, 116);
    await page.mouse.down();
    await page.mouse.up();
    await page.mouse.click(140, 116); // the retry, on the button itself
    await page.waitForTimeout(SENT_MS);

    const [record] = await fixtureRecords(worker);
    // The retry has to land within the first click's 50 ms settle time for this case.
    test.skip(record!.fire?.outcome === 'sent', 'the retry came after the settle time on this run');
    expect(record!.fire).toEqual({ outcome: 'failed', failure: 'second-press' });
    expect(await actionsOf(page)).toEqual(['plain']);
  });

  test('marks the toolbar button for a moment after sending a click on', async ({
    page,
    worker,
  }) => {
    const { fire } = await nearMiss(page, worker, 184, 116);
    expect(fire?.outcome).toBe('sent');
    expect(await worker.evaluate(() => chrome.action.getBadgeText({}))).toBe('→');
    await expect.poll(() => worker.evaluate(() => chrome.action.getBadgeText({}))).toBe('');
  });
});

test.describe('waiting out the double-click interval', () => {
  test.beforeEach(async ({ page, worker }) => {
    await turnOnRetargeting(worker);
    await worker.evaluate(() => heyo.setWaitForDoubleClick(true));
    await page.goto('/replay.html?move');
  });

  test('sends the click on only after the interval', async ({ page, worker }) => {
    await clickAt(page, 184, 116);
    const early = await actionsOf(page);
    await page.waitForTimeout(700);
    const [record] = await fixtureRecords(worker);
    expect(record!.fire?.outcome).toBe('sent');
    expect(early).toEqual([]);
    expect(await actionsOf(page)).toEqual(['plain']);
  });

  test('sends nothing when a second press comes first', async ({ page, worker }) => {
    await arrive(page, 184, 116);
    await page.mouse.click(184, 116, { clickCount: 2, delay: 80 });
    await page.waitForTimeout(800);
    expect(await actionsOf(page)).toEqual([]);
    const records = await fixtureRecords(worker);
    expect(records[0]!.fire).toEqual({ outcome: 'failed', failure: 'second-press' });
  });

  test('sends nothing when the control moved in the meantime', async ({ page, worker }) => {
    await clickAt(page, 984, 316); // 4 px right of Mover, which jumps away 200 ms later
    await page.waitForTimeout(800);
    const [record] = await fixtureRecords(worker);
    expect(await actionsOf(page)).toEqual([]);
    expect(record!.fire).toEqual({ outcome: 'failed', failure: 'moved' });
  });
});

test.describe('a fire held back as a control', () => {
  test('is logged as held and sends nothing', async ({ page, worker }) => {
    await turnOnRetargeting(worker, { held: true });
    await page.goto('/replay.html');
    await miss(page, 184, 116);
    expect(await actionsOf(page)).toEqual([]);
    const [record] = await fixtureRecords(worker);
    expect(record!.decision).toEqual({ action: 'retarget', candidate: 0 });
    expect(record!.fire).toEqual({ outcome: 'held' });
  });
});

test.describe('a wrong click report', () => {
  test.beforeEach(async ({ page, worker }) => {
    // With 700 reviewed fires, one or two wrong ones still pass the 1% gate.
    await turnOnRetargeting(worker, { reviewed: 700 });
    await page.goto('/replay.html');
  });

  test('turns retargeting off when the marks no longer pass the gate', async ({ worker }) => {
    await worker.evaluate(() => heyo.clearLog());
    await turnOnRetargeting(worker, { reviewed: 320 });
    const log = await worker.evaluate(() => heyo.exportLog());
    const reply = await worker.evaluate((id) => heyo.reportWrong(id, false), log.records[0]!.id);
    // One wrong fire needs 473 reviewed. This log has 320.
    expect(reply).toMatchObject({
      ok: true,
      settings: { mode: 'shadow', offReason: 'wrong-clicks' },
    });
  });

  test('counts as a wrong review, and a second one in a week turns retargeting off', async ({
    page,
    worker,
  }) => {
    await miss(page, 184, 116);
    await miss(page, 384, 216);
    const [first, second] = await fixtureRecords(worker);

    const one = await worker.evaluate((id) => heyo.reportWrong(id, false), first!.id);
    expect(one).toMatchObject({ ok: true, settings: { mode: 'retarget' } });
    const two = await worker.evaluate((id) => heyo.reportWrong(id, false), second!.id);
    expect(two).toMatchObject({
      ok: true,
      settings: { mode: 'shadow', offReason: 'wrong-clicks' },
    });

    const log = await worker.evaluate(() => heyo.exportLog());
    const wrong = log.reviews.filter((r) => r.verdict === 'wrong').map((r) => r.recordId);
    expect(wrong.sort()).toEqual([first!.id, second!.id].sort());

    // With retargeting off again, a near miss only gets logged.
    await page.reload();
    await miss(page, 184, 116);
    expect(await actionsOf(page)).toEqual([]);
  });

  test('that could not be undone turns retargeting off at once', async ({ page, worker }) => {
    await miss(page, 184, 116);
    const [record] = await fixtureRecords(worker);
    const reply = await worker.evaluate((id) => heyo.reportWrong(id, true), record!.id);
    expect(reply).toMatchObject({
      ok: true,
      settings: { mode: 'shadow', offReason: 'irreversible' },
    });
  });
});
