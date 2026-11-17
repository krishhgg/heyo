// Proves retargeting end to end: the switch is locked without a passing log,
// the review page turns it on once the log passes, a near miss on an allowed
// site makes the control act exactly once, and a wrong-click report turns it off.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

async function miss(page, x, y) {
  await page.mouse.move(x - 140, y + 80);
  await page.mouse.move(x, y, { steps: 9 });
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(700);
}

/** 320 labeled misses the decision recovers, each reviewed right. Enough to pass both gates. */
function passingLog() {
  const reaction = {
    mutation: false,
    focus: false,
    selection: false,
    scroll: false,
    navigation: false,
  };
  const records = Array.from({ length: 320 }, (_, i) => ({
    v: 1,
    id: `seed-${i}`,
    t: Date.now() - i * 60_000,
    site: 'seeded.example',
    features: {
      candidates: [
        {
          id: 0,
          kind: 'control',
          dist: 3,
          rect: { x: 3, y: -15, w: 80, h: 30 },
          tag: 'button',
          role: null,
          type: null,
          signals: ['native'],
          label: 'Save',
          redacted: false,
          disabled: false,
        },
      ],
      path: [-120, -70, -30, -8, 0].map((x, n) => ({ t: -300 + n * 50, x, y: -x / 2 })),
      press: { ms: 80, move: 0 },
      focused: true,
      reacted: false,
      reaction,
      blurred: false,
      leftField: false,
      mutations: { total: 0, near: 0 },
      churn: false,
      under: { tag: 'div', role: null, label: '' },
      point: { x: 400, y: 300 },
      viewport: { w: 1280, h: 800 },
      scale: 2,
      topFrame: true,
      listenersOnPath: 0,
    },
    decision: { action: 'retarget', candidate: 0 },
    decisionVersion: 'seed',
    followUp: { dt: 600, dx: 13, dy: 0, kind: 'control', candidate: 0, dist: 3 },
  }));
  const reviews = records.map((r) => ({ recordId: r.id, candidate: 0, verdict: 'right', t: r.t }));
  return { records, reviews, counts: [] };
}

export async function drive({ page, context, worker, baseUrl, evidence, log }) {
  const host = new URL(baseUrl).hostname;

  // 1. With an empty log the service worker refuses to turn retargeting on.
  const refused = await worker.evaluate(() => heyo.setMode('retarget'));
  log(
    `with an empty log, turning retargeting on is refused: ok=${refused.ok}, mode=${refused.settings.mode}`,
  );
  assert.equal(refused.ok, false);

  await page.goto(`${baseUrl}/replay.html`);
  await miss(page, 184, 116);
  assert.deepEqual(await page.evaluate('actions'), [], 'shadow mode must not click anything');
  log('shadow mode: a near miss beside Plain did nothing on the page');

  // 2. Seed a log that passes both gates and allow the fixture host.
  await worker.evaluate(
    async ({ seed, allow }) => {
      await heyo.importLog(seed);
      await heyo.allowTestHosts([allow]);
      await heyo.holdTestShare(0);
    },
    { seed: passingLog(), allow: host },
  );
  log(`seeded 320 reviewed fires and let retargeting act on ${host}`);

  // 3. Turn it on through the review page, as a user would.
  const [review] = await Promise.all([
    context.waitForEvent('page'),
    worker.evaluate(() => heyo.openReview()),
  ]);
  await review.setViewportSize({ width: 1280, height: 900 });
  await review.getByRole('button', { name: 'Retargeting' }).click();
  await review.screenshot({ path: join(evidence, '1-unlocked.png'), fullPage: true });
  await review.getByRole('button', { name: 'Turn retargeting on' }).click();
  await review.getByRole('heading', { name: 'Retargeting is on' }).waitFor();
  log('the review page turned retargeting on');

  // 4. Near misses on the fixture page. Each control must act exactly once.
  await page.bringToFront();
  await page.reload();
  const cases = [
    ['Plain button', 184, 116, 'plain'],
    ['Hash link', 384, 110, '#linked'],
    ['Delegated item', 184, 216, 'delegated'],
    ['Form submit', 784, 316, 'submitted'],
  ];
  for (const [name, x, y] of cases) {
    await miss(page, x, y);
    log(`near miss beside the ${name}`);
  }
  const actions = await page.evaluate('actions');
  log(`actions on the page after four near misses: ${JSON.stringify(actions)}`);
  assert.deepEqual(
    actions,
    cases.map(([, , , action]) => action),
  );
  await page.screenshot({ path: join(evidence, '2-page-after.png'), caret: 'initial' });

  await miss(page, 584, 316);
  assert.deepEqual(await page.evaluate('actions'), actions, 'a Delete button must not be clicked');
  log('a near miss beside Delete was left alone');

  // 5. The log has each fire, and the review page lists them.
  const exported = await worker.evaluate(() => heyo.exportLog());
  const fires = exported.records.filter((r) => r.site === host && r.fire);
  log(`logged fires: ${JSON.stringify(fires.map((r) => r.fire))}`);
  assert.equal(fires.filter((r) => r.fire.outcome === 'sent').length, cases.length);

  await review.bringToFront();
  await review.reload();
  await review.getByRole('button', { name: /Retargeting/ }).click();
  await review.locator('.fires li').first().waitFor();
  await review.screenshot({ path: join(evidence, '3-sent.png'), fullPage: true });

  // 6. A wrong click that could not be undone turns retargeting off.
  await review.getByRole('button', { name: 'Wrong, and it could not be undone' }).first().click();
  await review.getByRole('heading', { name: 'Retargeting is off' }).waitFor();
  await review.screenshot({ path: join(evidence, '4-off.png'), fullPage: true });
  const settings = await worker.evaluate(() => heyo.readSettings());
  log(`after the report: mode=${settings.mode}, offReason=${settings.offReason}`);
  assert.equal(settings.mode, 'shadow');
  assert.equal(settings.offReason, 'irreversible');

  await writeFile(
    join(evidence, 'result.json'),
    `${JSON.stringify({ actions, fires: fires.map((r) => ({ id: r.id, fire: r.fire })), settings }, null, 2)}\n`,
  );
}
