import { expect, test } from './helpers/fixtures';
import { clickAt, readLog, recordOf } from './helpers/log';

test.describe('an empty-space click near a control', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/capture.html');
  });

  test('is logged with the nearby control and the target heyo would pick', async ({
    page,
    worker,
  }) => {
    // Save spans x 100 to 180. This click lands 4 px to its right.
    const record = await recordOf(page, worker, 184, 116);

    expect(record.site).toBe('127.0.0.1');
    expect(record.features.candidates).toHaveLength(1);
    expect(record.features.candidates[0]).toMatchObject({
      id: 0,
      kind: 'control',
      dist: 4,
      rect: { x: -84, y: -16, w: 80, h: 32 },
      tag: 'button',
      signals: ['native'],
      label: 'Save',
      disabled: false,
    });
    expect(record.features).toMatchObject({
      reacted: false,
      focused: true,
      topFrame: true,
      point: { x: 184, y: 116 },
      viewport: { w: 1280, h: 800 },
      under: { tag: 'body' },
    });
    expect(record.decision).toEqual({ action: 'retarget', candidate: 0 });
    expect(record.decisionVersion).toMatch(/^[0-9a-f]{12}$/);
    expect(record.followUp).toBeNull();
  });

  test('records the cursor path over the 300 ms before the press', async ({ page, worker }) => {
    const { path } = (await recordOf(page, worker, 184, 116)).features;
    expect(path.length).toBeGreaterThan(3);
    expect(path.at(-1)).toMatchObject({ x: 0, y: 0 });
    // The mouse came from the lower left.
    expect(path[0]!.x).toBeLessThan(-20);
    expect(path[0]!.y).toBeGreaterThan(10);
    for (const sample of path) {
      expect(sample.t).toBeLessThanOrEqual(0);
      expect(sample.t).toBeGreaterThanOrEqual(-300);
    }
  });

  test('gets the next click attached, which makes it a labeled miss', async ({ page, worker }) => {
    const record = await recordOf(page, worker, 184, 116);
    await clickAt(page, 140, 116);

    const after = (await readLog(worker)).records.find((r) => r.id === record.id);
    expect(after?.followUp).toMatchObject({
      kind: 'control',
      candidate: 0,
      dist: 4,
      dx: -44,
      dy: 0,
    });
    expect(after!.followUp!.dt).toBeGreaterThan(0);
    expect(after!.followUp!.dt).toBeLessThanOrEqual(1500);
  });

  test('gets the second press of a double-click attached', async ({ page, worker }) => {
    await page.mouse.move(184, 116);
    await page.mouse.click(184, 116, { clickCount: 2, delay: 20 });
    await page.waitForTimeout(120);

    const [first, second] = (await readLog(worker)).records;
    expect(first!.followUp).toMatchObject({ kind: 'empty', dx: 0, dy: 0, candidate: null });
    expect(first!.followUp!.dt).toBeLessThan(500);
    expect(second!.followUp).toBeNull();
  });

  test('gets no follow-up from a click that comes after 1.5 seconds', async ({ page, worker }) => {
    const record = await recordOf(page, worker, 184, 116);
    await page.waitForTimeout(1500);
    await clickAt(page, 140, 116);

    const after = (await readLog(worker)).records.find((r) => r.id === record.id);
    expect(after?.followUp).toBeNull();
  });

  test('is refused between two controls that are equally near', async ({ page, worker }) => {
    // Bold ends at x 180 and Italic starts at x 186.
    const record = await recordOf(page, worker, 183, 216);
    expect(record.features.candidates.map((c) => [c.label, c.dist])).toEqual([
      ['Bold', 3],
      ['Italic', 3],
    ]);
    expect(record.decision).toEqual({ action: 'refuse', reason: 'ambiguous' });
  });

  test('finds a control marked only by a pointer cursor', async ({ page, worker }) => {
    const record = await recordOf(page, worker, 184, 416);
    expect(record.features.candidates[0]).toMatchObject({
      tag: 'div',
      signals: ['cursor'],
      label: 'Card',
      dist: 4,
    });
  });

  test('finds a control marked only by a click listener', async ({ page, worker }) => {
    const record = await recordOf(page, worker, 384, 416);
    expect(record.features.candidates[0]).toMatchObject({
      tag: 'div',
      signals: ['listener'],
      label: 'Listens',
      dist: 4,
    });
  });

  test('finds a control inside a shadow root', async ({ page, worker }) => {
    const record = await recordOf(page, worker, 384, 616);
    expect(record.features.candidates[0]).toMatchObject({ tag: 'button', label: 'Inner', dist: 4 });
  });

  test('is refused next to a disabled control', async ({ page, worker }) => {
    const record = await recordOf(page, worker, 584, 416);
    expect(record.features.candidates[0]).toMatchObject({ label: 'Disabled', disabled: true });
    expect(record.decision).toEqual({ action: 'refuse', reason: 'disabled' });
  });

  test('is refused next to a canvas, which heyo cannot see into', async ({ page, worker }) => {
    const record = await recordOf(page, worker, 696, 416);
    expect(record.features.candidates[0]).toMatchObject({ kind: 'opaque', tag: 'canvas', dist: 4 });
    expect(record.decision).toEqual({ action: 'refuse', reason: 'ambiguous' });
  });

  test('is refused next to a control that looks irreversible', async ({ page, worker }) => {
    const record = await recordOf(page, worker, 184, 616);
    expect(record.features.candidates[0]).toMatchObject({ label: 'Delete' });
    expect(record.decision).toEqual({ action: 'refuse', reason: 'irreversible' });
  });

  test('is refused when the press was a drag', async ({ page, worker }) => {
    await page.mouse.move(184, 116);
    await page.mouse.down();
    await page.mouse.move(204, 116, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(120);

    const [record] = (await readLog(worker)).records;
    expect(record!.features.press.move).toBe(20);
    expect(record!.decision).toEqual({ action: 'refuse', reason: 'drag' });
  });

  test('is refused when the press was held', async ({ page, worker }) => {
    await page.mouse.move(184, 116);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.up();
    await page.waitForTimeout(120);

    const [record] = (await readLog(worker)).records;
    expect(record!.features.press.ms).toBeGreaterThanOrEqual(600);
    expect(record!.decision).toEqual({ action: 'refuse', reason: 'long-press' });
  });
});

test.describe('clicks heyo leaves alone', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/capture.html');
  });

  test('a click that hits a control, text or a canvas logs no record', async ({ page, worker }) => {
    await clickAt(page, 140, 116); // the Save button
    await clickAt(page, 120, 310); // paragraph text
    await clickAt(page, 140, 416); // the span inside the pointer-cursor div
    await clickAt(page, 340, 416); // the div with a click listener
    await clickAt(page, 740, 416); // the canvas

    const log = await readLog(worker);
    expect(log.records).toEqual([]);
    expect(log.counts).toEqual([
      expect.objectContaining({
        site: '127.0.0.1',
        clicks: 5,
        hits: 5,
        emptyReacted: 0,
        emptyIgnored: 0,
      }),
    ]);
  });

  test('an empty-space click with nothing within 30 px is counted but not logged', async ({
    page,
    worker,
  }) => {
    await clickAt(page, 900, 150);

    const log = await readLog(worker);
    expect(log.records).toEqual([]);
    expect(log.counts[0]).toMatchObject({ clicks: 1, hits: 0, emptyIgnored: 1 });
  });

  test('a right click or a click with a modifier key is not counted', async ({ page, worker }) => {
    await page.mouse.click(184, 116, { button: 'right' });
    await page.keyboard.down('Shift');
    await page.mouse.click(184, 116);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(120);

    const log = await readLog(worker);
    expect(log.records).toEqual([]);
    expect(log.counts).toEqual([]);
  });
});

test.describe('privacy', () => {
  test('a password or typed text never reaches the log', async ({ page, worker }) => {
    await page.goto('/capture.html');
    await page.locator('#password').fill('hunter2-secret');
    await page.locator('#email').fill('someone@example.com');

    // 4 px right of the password field, then 4 px right of the email field.
    const nearPassword = await recordOf(page, worker, 264, 510);
    const nearEmail = await recordOf(page, worker, 564, 510);

    expect(nearPassword.features.candidates[0]).toMatchObject({
      tag: 'input',
      type: 'password',
      label: 'password field',
    });
    expect(nearEmail.features.candidates[0]).toMatchObject({
      tag: 'input',
      label: 'Email address',
    });

    const exported = JSON.stringify(await readLog(worker));
    expect(exported).not.toContain('hunter2');
    expect(exported).not.toContain('someone@example.com');
  });
});

test.describe('a page that reacts to an empty-space click', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/reacting.html');
  });

  test('by changing the DOM', async ({ page, worker }) => {
    const record = await recordOf(page, worker, 204, 130);
    expect(record.features.candidates[0]).toMatchObject({ label: 'Menu', dist: 6 });
    expect(record.features).toMatchObject({
      reacted: true,
      reaction: { mutation: true },
      // The page changed the very element that was clicked.
      mutations: { total: 1, near: 1 },
    });
    expect(record.decision).toEqual({ action: 'refuse', reason: 'reacted' });
  });

  test('by navigating with pushState', async ({ page, worker }) => {
    const record = await recordOf(page, worker, 204, 230);
    expect(record.features).toMatchObject({ reacted: true, reaction: { navigation: true } });
  });

  test('by scrolling', async ({ page, worker }) => {
    const record = await recordOf(page, worker, 204, 330);
    expect(record.features).toMatchObject({ reacted: true, reaction: { scroll: true } });
  });

  test('by moving focus out of a field', async ({ page, worker }) => {
    await page.locator('#field').click();
    const record = await recordOf(page, worker, 296, 476);
    expect(record.features.candidates[0]).toMatchObject({ label: 'Apply' });
    expect(record.features).toMatchObject({
      reacted: true,
      reaction: { focus: true },
      leftField: true,
    });
  });

  test('but not by taking focus off the button the user clicked before', async ({
    page,
    worker,
  }) => {
    await clickAt(page, 340, 476); // the Apply button, which takes focus
    await expect(page.locator('#near-field')).toBeFocused();

    const record = await recordOf(page, worker, 296, 596);
    expect(record.features.candidates[0]).toMatchObject({ label: 'Copy' });
    expect(record.features).toMatchObject({ reacted: false, blurred: true });
    expect(record.decision).toEqual({ action: 'retarget', candidate: 0 });
  });

  test('by clearing a text selection', async ({ page, worker }) => {
    await page.locator('#words').click({ clickCount: 3 });
    const record = await recordOf(page, worker, 296, 596);
    expect(record.features.candidates[0]).toMatchObject({ label: 'Copy' });
    expect(record.features).toMatchObject({ reacted: true, reaction: { selection: true } });
  });

  test('is counted as reacted, and a page that does nothing is counted as ignored', async ({
    page,
    worker,
  }) => {
    await clickAt(page, 204, 130); // changes the DOM
    await clickAt(page, 296, 596); // nothing selected, nothing happens

    const log = await readLog(worker);
    expect(log.counts[0]).toMatchObject({ clicks: 2, hits: 0, emptyReacted: 1, emptyIgnored: 1 });
    expect(log.records.map((r) => r.features.reacted)).toEqual([true, false]);
  });
});

test.describe('a page that handles every click on its root, like React', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/delegated.html');
  });

  test('still has empty space, and its controls are found by their cursor', async ({
    page,
    worker,
  }) => {
    const record = await recordOf(page, worker, 184, 116);
    expect(record.features.under).toMatchObject({ tag: 'div' });
    expect(record.features.listenersOnPath).toBe(1);
    expect(record.features.candidates[0]).toMatchObject({
      label: 'Open',
      signals: ['cursor'],
      dist: 4,
    });
    expect(record.decision).toEqual({ action: 'retarget', candidate: 0 });
  });

  test('a click on one of its controls is a hit', async ({ page, worker }) => {
    await clickAt(page, 140, 116);
    await expect(page.locator('#log')).toHaveText('open');
    const log = await readLog(worker);
    expect(log.records).toEqual([]);
    expect(log.counts[0]).toMatchObject({ clicks: 1, hits: 1 });
  });
});

test('a click inside an iframe is logged under the site the user is on', async ({
  page,
  worker,
}) => {
  await page.goto('/framed.html');
  await page.frameLocator('#frame').locator('#save').waitFor();

  // Focus starts in the page around the frame, as it does when the user was just working there.
  await page.mouse.click(900, 600);

  // The frame sits at 50, 50 and its Save button spans x 60 to 140 inside it.
  const record = await recordOf(page, worker, 194, 126);
  expect(record.site).toBe('127.0.0.1');
  expect(record.features.topFrame).toBe(false);
  expect(record.features.candidates[0]).toMatchObject({ label: 'Save', dist: 4 });
  // The frame only gains focus from this press. The tab had focus all along.
  expect(record.features.focused).toBe(true);
  expect(record.decision).toEqual({ action: 'retarget', candidate: 0 });
});

test('heyo adds nothing to the page that its scripts or styles could trip over', async ({
  page,
}) => {
  await page.goto('/capture.html');
  await clickAt(page, 184, 116);

  const trace = await page.evaluate(() => ({
    native: EventTarget.prototype.addEventListener.toString(),
    name: EventTarget.prototype.addEventListener.name,
    length: EventTarget.prototype.addEventListener.length,
    attributes: [...document.querySelectorAll('*')].flatMap((e) =>
      e.getAttributeNames().filter((n) => n.includes('heyo')),
    ),
    globals: Object.keys(window).filter((k) => k.toLowerCase().includes('heyo')),
  }));
  expect(trace.native).toContain('[native code]');
  expect(trace.name).toBe('addEventListener');
  expect(trace.length).toBe(2);
  expect(trace.attributes).toEqual([]);
  expect(trace.globals).toEqual([]);
});
