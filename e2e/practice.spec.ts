// A short practice run, end to end. A scripted mouse stands in for the person:
// it misses each lit control by 3 px on its clearest side, then clicks it. The
// run comes out as a log whose marks say each fire went to the lit control.
// The real run is `npm run practice`, with a person at the mouse.
import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { PRACTICE_HOST, run } from '../practice/main';
import { launchWithExtension } from './helpers/extension';
import { startFixtureServer } from './server.mjs';

const TRIALS = 8;

/** A miss this far from the lit control, with no other control within 15 px, is one the decision acts on. */
const MISS_PX = 3;
const CLEAR_PX = 15;

interface Aim {
  center: { x: number; y: number };
  /** The press beside the lit control and where the pointer comes from, or null with no clear side. */
  miss: { at: { x: number; y: number }; from: { x: number; y: number } } | null;
}

/** Looks at the lit control and the controls around it, in the page. */
function aim(page: Page): Promise<Aim> {
  return page.evaluate(
    ([missPx, clearPx]) => {
      const lit = document.querySelector('.lit')!;
      const r = lit.getBoundingClientRect();
      const others = [...document.querySelectorAll('.c')]
        .filter((c) => c !== lit)
        .map((c) => c.getBoundingClientRect());
      const clearance = (x: number, y: number) =>
        Math.min(
          ...others.map((o) =>
            Math.hypot(Math.max(o.left - x, 0, x - o.right), Math.max(o.top - y, 0, y - o.bottom)),
          ),
        );
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const sides = [
        { x: r.left - missPx, y: cy, dx: -1, dy: 0 },
        { x: r.right + missPx, y: cy, dx: 1, dy: 0 },
        { x: cx, y: r.top - missPx, dx: 0, dy: -1 },
        { x: cx, y: r.bottom + missPx, dx: 0, dy: 1 },
      ];
      const best = sides
        .map((side) => ({ ...side, clear: clearance(side.x, side.y) }))
        .sort((a, b) => b.clear - a.clear)[0]!;
      return {
        center: { x: cx, y: cy },
        miss:
          best.clear >= clearPx
            ? {
                at: { x: best.x, y: best.y },
                from: { x: best.x + best.dx * 40, y: best.y + best.dy * 40 },
              }
            : null,
      };
    },
    [MISS_PX, CLEAR_PX] as const,
  );
}

test('a practice run comes out as a log marked from the lit control', async () => {
  test.setTimeout(90_000);
  let misses = 0;
  const player = async (page: Page) => {
    await page.click('#start');
    for (let i = 0; i < TRIALS; i++) {
      // Longer than the 300 ms in which a change to the page counts against a click.
      await page.waitForTimeout(400);
      const { center, miss } = await aim(page);
      if (miss) {
        await page.mouse.move(miss.from.x, miss.from.y);
        await page.mouse.move(miss.at.x, miss.at.y, { steps: 8 });
        await page.mouse.down();
        await page.mouse.up();
        misses++;
        await page.waitForTimeout(300);
      }
      await page.mouse.move(center.x, center.y, { steps: 6 });
      await page.mouse.down();
      await page.mouse.up();
    }
  };
  const root = fileURLToPath(new URL('../practice/page', import.meta.url));
  const result = await run(
    TRIALS,
    {
      launch: (profileDir) => launchWithExtension(profileDir),
      async serve() {
        const { server, port } = await startFixtureServer(0, root);
        return { port, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
      },
    },
    player,
  );

  expect(result).not.toBeNull();
  const { log, tally, finished } = result!;
  expect(finished).toBe(true);
  expect(misses).toBeGreaterThanOrEqual(4);
  expect(tally.hits).toBe(TRIALS);
  expect([tally.onTarget, tally.onOther, tally.onEmpty]).toEqual([TRIALS, 0, misses]);
  // Every miss left one record, the page logged the same press, and the lit control was near it.
  expect(tally.records).toBe(misses);
  expect(tally.matched).toBe(misses);
  expect(tally.beside).toBe(misses);
  // Each was retried on the lit control, and the decision sent each there.
  expect(tally.labeledRight).toBe(misses);
  expect(tally.fires).toBe(misses);
  expect(tally.right).toBe(misses);

  for (const record of log.records) {
    expect(record.site).toBe(PRACTICE_HOST);
    const controls = record.features.candidates.filter((c) => c.kind === 'control');
    const marks = log.reviews.filter((review) => review.recordId === record.id);
    expect(marks.map((mark) => mark.candidate).sort()).toEqual(controls.map((c) => c.id).sort());
    expect(marks.filter((mark) => mark.verdict === 'right')).toHaveLength(1);
  }
});
