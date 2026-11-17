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

  test('opens a native dropdown', async ({ page, worker }) => {
    // A select ignores a synthetic click, so heyo asks Chrome to show its picker.
    const { fire } = await nearMiss(page, worker, 384, 316);
    expect(fire).toEqual(sent);
    await expect(page.locator('#select')).toBeFocused();
  });

  test('leaves a control alone when its label looks irreversible', async ({ page, worker }) => {
    const { actions, fire } = await nearMiss(page, worker, 584, 316);
    expect(actions).toEqual([]);
    expect(fire).toBeNull();
  });

  test('sends nothing when the user is already clicking again', async ({ page, worker }) => {
    await arrive(page, 184, 116);
    // Sent without waiting for each answer, so the retry lands inside the first
    // click's 50 ms settle time.
    await Promise.all([
      page.mouse.down(),
      page.mouse.up(),
      page.mouse.click(140, 116), // the retry, on the button itself
    ]);
    await page.waitForTimeout(SENT_MS);

    const [record] = await fixtureRecords(worker);
    expect(record!.fire).toEqual({ outcome: 'failed', failure: 'second-press' });
    expect(await actionsOf(page)).toEqual(['plain']);
  });

  test('sends nothing more when the control removes itself as it is pressed', async ({
    page,
    worker,
  }) => {
    // A real press on this control gets no click either.
    const { actions, fire } = await nearMiss(page, worker, 384, 416);
    expect(actions).toEqual(['vanished']);
    expect(fire).toEqual(sent);
  });

  test('sends nothing when the control has another name by then', async ({ page, worker }) => {
    // The page renames the control at the user's click, where heyo's watch does not see it.
    await page.goto('/replay.html?rename');
    const { actions, fire } = await nearMiss(page, worker, 184, 416);
    expect(
      await page.evaluate(() => document.querySelector('#renamer')!.shadowRoot!.textContent),
    ).toBe('Delete all');
    expect(actions).toEqual([]);
    expect(fire).toEqual({ outcome: 'failed', failure: 'renamed' });
  });

  test('marks the toolbar button for a moment after sending a click on', async ({
    page,
    worker,
  }) => {
    const { fire } = await nearMiss(page, worker, 184, 116);
    expect(fire?.outcome).toBe('sent');
    // The mark is on the tab that got the click, and on no other.
    const badge = () =>
      worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true });
        return [
          await chrome.action.getBadgeText({ tabId: tab!.id }),
          await chrome.action.getBadgeText({}),
        ];
      });
    expect(await badge()).toEqual(['→', '']);
    await expect.poll(badge).toEqual(['', '']);
  });
});

test.describe('a double-click beside a control', () => {
  test('sends the first click on and never the second', async ({ page, worker }) => {
    await turnOnRetargeting(worker);
    // Where text cannot be selected, the second press changes nothing on the
    // page, so it too looks like a click the page ignored.
    await page.goto('/replay.html?noselect');
    await clickAt(page, 184, 116);
    // A hand moves a little between the two presses. The second one is within 5 px of the first.
    await page.mouse.move(187, 116);
    await page.mouse.move(184, 116);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(SENT_MS);

    expect(await actionsOf(page)).toEqual(['plain']);
    const [first, second] = await fixtureRecords(worker);
    expect(first!.fire?.outcome).toBe('sent');
    expect(second!.decision).toEqual({ action: 'retarget', candidate: 0 });
    expect(second!.fire).toEqual({ outcome: 'failed', failure: 'second-press' });
  });
});

test.describe('doing something else right after the miss', () => {
  // Each of these lands inside the first click's 50 ms settle time, before heyo
  // has decided anything. They are sent without waiting for the click's answer.
  for (const wait of [false, true]) {
    const mode = wait ? 'with the double-click wait' : 'without the wait';

    test(`a key press stops the click, ${mode}`, async ({ page, worker }) => {
      await turnOnRetargeting(worker);
      await worker.evaluate((value) => heyo.setWaitForDoubleClick(value), wait);
      await page.goto('/replay.html');
      await arrive(page, 184, 116);
      await Promise.all([page.mouse.down(), page.mouse.up(), page.keyboard.press('Escape')]);
      await page.waitForTimeout(1100);
      expect(await actionsOf(page)).toEqual([]);
      const [record] = await fixtureRecords(worker);
      expect(record!.fire).toEqual({ outcome: 'failed', failure: 'second-press' });
    });

    test(`a press of the right button stops the click, ${mode}`, async ({ page, worker }) => {
      await turnOnRetargeting(worker);
      await worker.evaluate((value) => heyo.setWaitForDoubleClick(value), wait);
      await page.goto('/replay.html');
      await arrive(page, 184, 116);
      await Promise.all([page.mouse.down(), page.mouse.up(), page.mouse.down({ button: 'right' })]);
      await page.waitForTimeout(1100);
      await page.mouse.up({ button: 'right' });
      expect(await actionsOf(page)).toEqual([]);
      const [record] = await fixtureRecords(worker);
      expect(record!.fire).toEqual({ outcome: 'failed', failure: 'second-press' });
    });
  }
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
    await page.waitForTimeout(1100);
    const [record] = await fixtureRecords(worker);
    expect(record!.fire?.outcome).toBe('sent');
    expect(early).toEqual([]);
    expect(await actionsOf(page)).toEqual(['plain']);
  });

  test('still opens a popup and a file picker after the interval', async ({
    page,
    worker,
    context,
  }) => {
    // Chrome allows these only for a short time after a real press. Half a second later it still does.
    const popup = context.waitForEvent('page', { timeout: 4000 }).catch(() => null);
    await clickAt(page, 784, 216);
    await page.waitForTimeout(1100);
    expect(await actionsOf(page)).toEqual(['popup']);
    expect(await popup).not.toBeNull();

    const chooser = page.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null);
    await clickAt(page, 184, 310);
    await page.waitForTimeout(1100);
    expect(await chooser).not.toBeNull();
    expect((await fixtureRecords(worker)).map((r) => r.fire?.outcome)).toEqual(['sent', 'sent']);
  });

  test('sends nothing when a second press comes first', async ({ page, worker }) => {
    await arrive(page, 184, 116);
    await page.mouse.click(184, 116, { clickCount: 2, delay: 80 });
    await page.waitForTimeout(1200);
    expect(await actionsOf(page)).toEqual([]);
    const records = await fixtureRecords(worker);
    expect(records[0]!.fire).toEqual({ outcome: 'failed', failure: 'second-press' });
  });

  /** A miss that is logged and now waits to be sent on. */
  async function waitingMiss(
    page: import('@playwright/test').Page,
    worker: import('@playwright/test').Worker,
    x: number,
    y: number,
  ) {
    // A fixed short wait and no trip to the log, so the test acts well inside
    // the interval. `outcome` checks the record afterwards.
    await clickAt(page, x, y);
  }

  /** What became of that miss, once the interval is over. */
  async function outcome(
    page: import('@playwright/test').Page,
    worker: import('@playwright/test').Worker,
  ) {
    await page.waitForTimeout(1100);
    const [record] = await fixtureRecords(worker);
    return { actions: await actionsOf(page), fire: record!.fire };
  }

  for (const change of ['move', 'shrink']) {
    test(`sends nothing when the control had to ${change} in the meantime`, async ({
      page,
      worker,
    }) => {
      await page.goto(`/replay.html?${change}`);
      await waitingMiss(page, worker, 984, 316); // 4 px right of Mover
      // Pointing at the zone moves Mover away, or halves its width, by a style rule alone.
      await page.mouse.move(940, 496);
      expect(await outcome(page, worker)).toEqual({
        actions: [],
        fire: { outcome: 'failed', failure: 'moved' },
      });
    });
  }

  test('sends nothing when the page handles the click late', async ({ page, worker }) => {
    await page.goto('/replay.html?late');
    await waitingMiss(page, worker, 184, 116);
    expect(await outcome(page, worker)).toEqual({
      actions: [],
      fire: { outcome: 'failed', failure: 'reacted' },
    });
    await expect(page.locator('#status')).toHaveText('handled');
  });

  test('sends nothing when retargeting is turned off in the meantime', async ({ page, worker }) => {
    await waitingMiss(page, worker, 184, 116);
    await worker.evaluate(() => heyo.setMode('shadow'));
    expect(await outcome(page, worker)).toEqual({
      actions: [],
      fire: { outcome: 'failed', failure: 'off' },
    });
  });

  test('sends nothing when the user presses inside an iframe in the meantime', async ({
    page,
    worker,
  }) => {
    await waitingMiss(page, worker, 184, 116);
    // The page's own listeners never see this press. The window losing focus to the frame is the sign.
    await page.mouse.click(560, 500);
    expect(await outcome(page, worker)).toEqual({
      actions: [],
      fire: { outcome: 'failed', failure: 'second-press' },
    });
  });

  test('sends nothing while an embedded frame holds focus', async ({ page, worker }) => {
    // The page cancels a press on empty space, so focus stays in the frame the
    // user was in. A press in that frame then shows nowhere on the page, not
    // even as the window losing focus.
    await page.goto('/replay.html?nodown');
    await page.mouse.click(560, 500);
    await waitingMiss(page, worker, 184, 116);
    await page.mouse.click(560, 500);
    expect(await outcome(page, worker)).toEqual({
      actions: [],
      fire: { outcome: 'failed', failure: 'away' },
    });
  });

  test('sends nothing when a key is pressed in the meantime', async ({ page, worker }) => {
    await waitingMiss(page, worker, 184, 116);
    await page.keyboard.press('Escape');
    expect(await outcome(page, worker)).toEqual({
      actions: [],
      fire: { outcome: 'failed', failure: 'second-press' },
    });
  });

  test('sends nothing when the page has started to leave', async ({ page, worker }) => {
    // The next page takes its time, so the old one stays up past the interval.
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/basic.html', async (route) => {
      await held;
      await route.continue();
    });
    await waitingMiss(page, worker, 184, 116);
    await page.evaluate(() => void (location.href = '/basic.html'));
    await page.waitForTimeout(1100);
    release();
    await page.waitForURL('**/basic.html');
    // Had the click gone out, it would be logged as sent.
    const [record] = await fixtureRecords(worker);
    expect(record!.fire).toEqual({ outcome: 'failed', failure: 'reacted' });
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

  test('turns retargeting off when the marks no longer pass the gate', async ({ page, worker }) => {
    await worker.evaluate(() => heyo.clearLog());
    await turnOnRetargeting(worker, { reviewed: 320 });
    await miss(page, 184, 116);
    const [sent] = await fixtureRecords(worker);
    const reply = await worker.evaluate((id) => heyo.reportWrong(id, false), sent!.id);
    // One wrong fire needs 473 reviewed. This log has 320.
    expect(reply).toMatchObject({
      ok: true,
      settings: { mode: 'shadow', offReason: 'wrong-clicks' },
    });
  });

  test('is refused for a click heyo did not send on', async ({ worker }) => {
    const log = await worker.evaluate(() => heyo.exportLog());
    const reply = await worker.evaluate((id) => heyo.reportWrong(id, false), log.records[0]!.id);
    expect(reply).toMatchObject({ ok: false, settings: { mode: 'retarget', wrongReports: [] } });
    expect(
      (await worker.evaluate(() => heyo.exportLog())).reviews.some((r) => r.verdict === 'wrong'),
    ).toBe(false);
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

test.describe('retargeting stays on only while the log passes the gates', () => {
  const settingsOf = (worker: import('@playwright/test').Worker) =>
    worker.evaluate(() => heyo.readSettings());

  /** A near miss beside Plain on the fixture page must do nothing. */
  async function expectShadow(page: import('@playwright/test').Page) {
    await page.goto('/replay.html');
    await miss(page, 184, 116);
    expect(await actionsOf(page)).toEqual([]);
  }

  test('a wrong mark on the Review tab turns it off', async ({ page, worker, extensionId }) => {
    // 320 fires marked right and one still to mark. One wrong mark needs 473 reviewed.
    await turnOnRetargeting(worker, { unmarked: 1 });
    await page.goto(`chrome-extension://${extensionId}/review.html`);
    await expect(page.locator('.plate')).toBeVisible();
    await expect(page.locator('.verdicts[aria-busy="false"]')).toBeAttached();
    await page.keyboard.press('n');
    await expect
      .poll(() => settingsOf(worker))
      .toMatchObject({ mode: 'shadow', offReason: 'gates' });

    await page.getByRole('button', { name: 'Retargeting' }).click();
    await expect(page.getByRole('heading', { name: 'Retargeting is off' })).toBeVisible();
    await expect(page.locator('.warning')).toContainText('no longer passes both gates');
    await expect(page.getByRole('button', { name: 'Turn retargeting on' })).toBeDisabled();
    await expectShadow(page);
  });

  test('deleting the log turns it off', async ({ page, worker, extensionId }) => {
    await turnOnRetargeting(worker, { reviewed: 700 });
    await page.goto('/replay.html');
    await miss(page, 184, 116);
    const [sent] = await fixtureRecords(worker);
    await worker.evaluate((id) => heyo.reportWrong(id, false), sent!.id);
    expect(await settingsOf(worker)).toMatchObject({ mode: 'retarget' });

    await page.goto(`chrome-extension://${extensionId}/review.html`);
    await page.getByRole('button', { name: 'Numbers' }).click();
    await page.getByRole('button', { name: 'Delete the log' }).click();
    await page.getByRole('button', { name: /Delete 701 clicks/ }).click();
    await expect(page.locator('.log-size')).toContainText('0 logged clicks');
    // The report times go with the log they were about.
    expect(await settingsOf(worker)).toMatchObject({
      mode: 'shadow',
      offReason: 'gates',
      wrongReports: [],
    });
    await expect(page.locator('.mode')).toContainText('Shadow mode');
    await expectShadow(page);
  });

  test('a record that takes the log below a gate turns it off', async ({ worker }) => {
    await turnOnRetargeting(worker);
    // 330 more misses the decision does not recover take recovery under 50%.
    const lost = passingLog(330).records.map((r) => ({
      ...r,
      features: { ...r.features, candidates: [] },
      decision: { action: 'refuse' as const, reason: 'too-far' as const },
    }));
    await worker.evaluate((records) => heyo.importLog({ records, reviews: [], counts: [] }), lost);
    expect(await settingsOf(worker)).toMatchObject({ mode: 'shadow', offReason: 'gates' });
  });

  test('waits for the worker before it acts under a new decision', async ({ page, worker }) => {
    await turnOnRetargeting(worker);
    // What a page finds right after an update: retargeting on, and gates that
    // last passed with another decision.
    await worker.evaluate(async () => {
      const settings = (await chrome.storage.local.get('settings')).settings as object;
      await chrome.storage.local.set({ settings: { ...settings, gatedWith: 'an older decision' } });
    });
    await page.goto('/replay.html');
    await miss(page, 184, 116);
    expect(await actionsOf(page)).toEqual([]);
    // Logging that click made the worker judge the log again, with the decision it carries.
    await expect
      .poll(async () => (await settingsOf(worker)).gatedWith)
      .not.toBe('an older decision');
    await miss(page, 384, 216);
    expect(await actionsOf(page)).toEqual(['pressed']);
  });

  test('counts a wrong mark on the Review tab as a report, once a click', async ({
    page,
    worker,
    extensionId,
    context,
  }) => {
    await turnOnRetargeting(worker, { reviewed: 700 });
    await page.goto('/replay.html');
    await miss(page, 184, 116);
    await miss(page, 384, 216);
    const [first, second] = await fixtureRecords(worker);
    const review = await context.newPage();
    await review.goto(`chrome-extension://${extensionId}/review.html`);
    const markOnReviewTab = (recordId: string, verdict: string) =>
      review.evaluate((mark) => chrome.runtime.sendMessage({ type: 'review', review: mark }), {
        recordId,
        candidate: 0,
        verdict,
        t: Date.now(),
      });

    // The same click reported twice, once on each tab, is one report.
    await worker.evaluate((id) => heyo.reportWrong(id, false), first!.id);
    await markOnReviewTab(first!.id, 'wrong');
    expect(await settingsOf(worker)).toMatchObject({ mode: 'retarget' });
    expect((await settingsOf(worker)).wrongReports).toHaveLength(1);

    // A mark changed to right takes the report back.
    await markOnReviewTab(first!.id, 'right');
    expect((await settingsOf(worker)).wrongReports).toHaveLength(0);

    // Two different clicks marked wrong on the Review tab are two reports in a week.
    await markOnReviewTab(first!.id, 'wrong');
    await markOnReviewTab(second!.id, 'wrong');
    const settings = await settingsOf(worker);
    expect(settings.wrongReports).toHaveLength(2);
    expect(settings).toMatchObject({ mode: 'shadow', offReason: 'wrong-clicks' });
  });

  test('turns off when the log cannot be read after a mark was stored', async ({
    page,
    worker,
    extensionId,
    context,
  }) => {
    await turnOnRetargeting(worker);
    await page.goto('/replay.html');
    await miss(page, 184, 116);
    const [sent] = await fixtureRecords(worker);
    const review = await context.newPage();
    await review.goto(`chrome-extension://${extensionId}/review.html`);

    // Writes still work and every read of the store fails, as when the store is damaged.
    await worker.evaluate(() => {
      // The method is put back on the same prototype, so it keeps its receiver.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const getAll = IDBObjectStore.prototype.getAll;
      (globalThis as { mendStore?: () => void }).mendStore = () => {
        IDBObjectStore.prototype.getAll = getAll;
      };
      IDBObjectStore.prototype.getAll = () => {
        throw new DOMException('The store is not available.', 'UnknownError');
      };
    });
    const reply = await review.evaluate(
      (mark) =>
        chrome.runtime.sendMessage<unknown, { ok: boolean }>({ type: 'review', review: mark }),
      { recordId: sent!.id, candidate: 0, verdict: 'wrong', t: Date.now() },
    );
    expect(reply.ok).toBe(false);
    // The wrong mark is in the log, so retargeting may not stay on unjudged.
    expect(await settingsOf(worker)).toMatchObject({ mode: 'shadow', offReason: 'error' });
    await worker.evaluate(() => (globalThis as { mendStore?: () => void }).mendStore?.());
    await expectShadow(page);
  });

  test('keeps a report that could not be undone, made while retargeting was off', async ({
    page,
    worker,
    extensionId,
    context,
  }) => {
    await turnOnRetargeting(worker, { reviewed: 700 });
    await page.goto('/replay.html');
    await miss(page, 184, 116);
    const [sent] = await fixtureRecords(worker);
    await worker.evaluate(() => heyo.setMode('shadow'));
    await worker.evaluate((id) => heyo.reportWrong(id, true), sent!.id);
    // heyo did not turn retargeting off, so it gives no reason for that.
    const settings = await settingsOf(worker);
    expect(settings).toMatchObject({ mode: 'shadow', offReason: null });
    expect(settings.wrongReports).toMatchObject([{ id: sent!.id, irreversible: true }]);

    // The tab still warns before the user turns it on again, until the report is taken back.
    const review = await context.newPage();
    await review.goto(`chrome-extension://${extensionId}/review.html`);
    await review.getByRole('button', { name: /Retargeting/ }).click();
    await expect(review.locator('.warning')).toContainText('could not be undone');
    await expect(review.locator('.warning')).toContainText('Think twice');
    // Turning it on with the warning in view settles it. It is not shown again.
    await review.getByRole('button', { name: 'Turn retargeting on' }).click();
    await review.getByRole('button', { name: 'Turn retargeting off' }).click();
    await expect(review.getByRole('heading', { name: 'Retargeting is off' })).toBeVisible();
    await expect(review.locator('.warning')).toHaveCount(0);
    const [report] = (await settingsOf(worker)).wrongReports;
    expect(report).toMatchObject({ id: sent!.id });
    expect(report).not.toHaveProperty('irreversible');
  });

  test('keeps both of two wrong reports sent at once', async ({
    page,
    worker,
    extensionId,
    context,
  }) => {
    await turnOnRetargeting(worker, { reviewed: 700 });
    await page.goto('/replay.html');
    await miss(page, 184, 116);
    await miss(page, 384, 216);
    const ids = (await fixtureRecords(worker)).map((r) => r.id);
    expect(ids).toHaveLength(2);

    const review = await context.newPage();
    await review.goto(`chrome-extension://${extensionId}/review.html`);
    await review.evaluate(
      (recordIds) =>
        Promise.all(
          recordIds.map((recordId) =>
            chrome.runtime.sendMessage({ type: 'reportWrong', recordId, irreversible: false }),
          ),
        ),
      ids,
    );
    const settings = await settingsOf(worker);
    expect(settings.wrongReports).toHaveLength(2);
    expect(settings).toMatchObject({ mode: 'shadow', offReason: 'wrong-clicks' });
  });

  test('takes its site list from the code and keeps no copy of it', async ({ page, worker }) => {
    await turnOnRetargeting(worker, { hosts: [] });
    const stored = await worker.evaluate(() => chrome.storage.local.get('settings'));
    expect(JSON.stringify(stored)).not.toContain('wikipedia');
    // A list left in storage by an older version is not read.
    await worker.evaluate(async () => {
      const settings = (await chrome.storage.local.get('settings')).settings as object;
      await chrome.storage.local.set({ settings: { ...settings, allowlist: ['127.0.0.1'] } });
    });
    expect(await settingsOf(worker)).toMatchObject({ mode: 'retarget' });
    await expectShadow(page);
  });

  test('checks the gates again when the worker starts', async ({ page, worker, extensionId }) => {
    // What an update with a stricter decision would find: retargeting on, over a log that does not pass.
    await worker.evaluate(() => chrome.storage.local.set({ settings: { mode: 'retarget' } }));
    await page.goto(`chrome-extension://${extensionId}/review.html`);
    const session = await page.context().newCDPSession(page);
    await session.send('ServiceWorker.enable');
    await session.send('ServiceWorker.stopAllWorkers');
    // Any message starts the worker again.
    const reply = await page.evaluate(() =>
      chrome.runtime.sendMessage<unknown, { settings: { mode: string; offReason: string } }>({
        type: 'setWaitForDoubleClick',
        value: false,
      }),
    );
    expect(reply.settings).toMatchObject({ mode: 'shadow', offReason: 'gates' });
  });
});

test.describe('the retargeting tab', () => {
  test('keeps the switch locked until the gates pass', async ({ page, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/review.html`);
    await page.getByRole('button', { name: 'Retargeting' }).click();
    await expect(page.getByRole('heading', { name: 'Retargeting is off' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn retargeting on' })).toBeDisabled();
    await expect(page.getByRole('row', { name: /^Recovery/ })).toContainText('Not enough data yet');
    await expect(page.locator('.mode')).toContainText('Shadow mode');
  });

  test('turns retargeting on and off once the gates pass', async ({
    page,
    worker,
    extensionId,
  }) => {
    await worker.evaluate((log) => heyo.importLog(log), passingLog());
    await worker.evaluate(() => heyo.allowTestHosts(['127.0.0.1']));
    await page.goto(`chrome-extension://${extensionId}/review.html`);
    await page.getByRole('button', { name: 'Retargeting' }).click();
    await expect(page.getByRole('row', { name: /^Wrong-target rate/ })).toContainText('Pass');

    await page.getByRole('button', { name: 'Turn retargeting on' }).click();
    await expect(page.getByRole('heading', { name: 'Retargeting is on' })).toBeVisible();
    // The three sites in the code and the fixture host.
    await expect(page.locator('.mode')).toContainText('Retargeting is on for 4 sites');
    expect(await worker.evaluate(() => heyo.readSettings())).toMatchObject({ mode: 'retarget' });

    await page.getByRole('button', { name: 'Turn retargeting off' }).click();
    await expect(page.getByRole('heading', { name: 'Retargeting is off' })).toBeVisible();
    expect(await worker.evaluate(() => heyo.readSettings())).toMatchObject({ mode: 'shadow' });
  });

  test('lists sent clicks and takes a wrong-click report', async ({
    page,
    worker,
    extensionId,
    context,
  }) => {
    await turnOnRetargeting(worker, { reviewed: 700 });
    await page.goto('/replay.html');
    await miss(page, 384, 110); // the hash link

    const review = await context.newPage();
    await review.goto(`chrome-extension://${extensionId}/review.html`);
    await review.getByRole('button', { name: /Retargeting/ }).click();
    await expect(review.getByRole('row', { name: /^Sent on/ })).toContainText('1');
    const fire = review.locator('.fires li');
    await expect(fire).toContainText('Hash link');
    await expect(review.locator('.shares li')).toContainText('127.0.0.1');
    await expect(review.locator('.shares li')).toContainText('0 of 1 changed nothing');

    await fire.getByRole('button', { name: 'Wrong', exact: true }).click();
    await expect(fire).toContainText('Marked wrong');
    await expect(review.getByRole('row', { name: /^Wrong-target rate/ })).toContainText('1 wrong');
    const log = await worker.evaluate(() => heyo.exportLog());
    expect(log.reviews.filter((r) => r.verdict === 'wrong')).toHaveLength(1);
    expect((await worker.evaluate(() => heyo.readSettings())).wrongReports).toHaveLength(1);

    // A slip can be taken back on the same row, the report with it.
    await fire.getByRole('button', { name: 'Not wrong' }).click();
    await expect(fire.getByRole('button', { name: 'Wrong', exact: true })).toBeVisible();
    await expect(review.getByRole('row', { name: /^Wrong-target rate/ })).toContainText('0 wrong');
    expect((await worker.evaluate(() => heyo.readSettings())).wrongReports).toHaveLength(0);
  });

  test('takes back what a report did when the report is taken back', async ({
    page,
    worker,
    extensionId,
    context,
  }) => {
    // A log just past the gates, where one wrong mark is enough to fail them.
    await turnOnRetargeting(worker);
    await page.goto('/replay.html');
    await miss(page, 384, 110);

    const review = await context.newPage();
    await review.goto(`chrome-extension://${extensionId}/review.html`);
    await review.getByRole('button', { name: /Retargeting/ }).click();
    const fire = review.locator('.fires li');
    await fire.getByRole('button', { name: 'Wrong', exact: true }).click();
    await expect(review.getByRole('heading', { name: 'Retargeting is off' })).toBeVisible();
    await expect(review.locator('.warning')).toContainText('wrong clicks you reported');

    await fire.getByRole('button', { name: 'Not wrong' }).click();
    await expect(review.locator('.warning')).toHaveCount(0);
    await expect(review.getByRole('button', { name: 'Turn retargeting on' })).toBeEnabled();
    expect(await worker.evaluate(() => heyo.readSettings())).toMatchObject({
      mode: 'shadow',
      offReason: null,
      wrongReports: [],
    });
  });

  test('marks a site over the line only once it has 20 sent clicks', async ({
    page,
    worker,
    extensionId,
  }) => {
    const sentOn = (site: string, count: number) =>
      passingLog(count).records.map((r) => ({
        ...r,
        site,
        followUp: null,
        fire: { outcome: 'sent' as const, reacted: false },
      }));
    const records = [...sentOn('few.example', 19), ...sentOn('many.example', 20)];
    await worker.evaluate((log) => heyo.importLog(log), { records, reviews: [], counts: [] });
    await page.goto(`chrome-extension://${extensionId}/review.html`);
    await page.getByRole('button', { name: 'Retargeting' }).click();
    const few = page.locator('.shares li', { hasText: 'few.example' });
    const many = page.locator('.shares li', { hasText: 'many.example' });
    await expect(few).toContainText('19 of 19 changed nothing');
    await expect(few.locator('.status')).toHaveCount(0);
    await expect(many.locator('.status')).toHaveText('over 10%');
  });

  test('says why when heyo turned retargeting off by itself', async ({
    page,
    worker,
    extensionId,
    context,
  }) => {
    await turnOnRetargeting(worker, { reviewed: 700 });
    await page.goto('/replay.html');
    await miss(page, 384, 110);

    const review = await context.newPage();
    await review.goto(`chrome-extension://${extensionId}/review.html`);
    await review.getByRole('button', { name: /Retargeting/ }).click();
    await review.getByRole('button', { name: 'Wrong, and it could not be undone' }).click();
    await expect(review.getByRole('heading', { name: 'Retargeting is off' })).toBeVisible();
    await expect(review.locator('.warning')).toContainText('could not be undone');
  });

  test('sets the double-click wait', async ({ page, worker, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/review.html`);
    await page.getByRole('button', { name: 'Retargeting' }).click();
    await page.getByRole('checkbox').check();
    await expect
      .poll(() => worker.evaluate(() => heyo.readSettings()))
      .toMatchObject({ waitForDoubleClick: true });
  });
});
