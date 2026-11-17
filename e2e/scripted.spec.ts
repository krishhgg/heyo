// A short scripted run, end to end: the synthetic generator's clicks, played
// with a real mouse through the built extension, come out as a log the scorer
// can judge. The full run is `npm run scripted`.
import { expect, test } from '@playwright/test';
import { score } from '../src/core/metrics';
import { decide } from '../src/decision';
import { DEFAULT_SCRIPTED, run } from '../scripted/main';
import { launchWithExtension } from './helpers/extension';

test('a scripted day is played through the extension and scored', async ({ baseURL }) => {
  test.setTimeout(180_000);
  const options = { ...DEFAULT_SCRIPTED, days: 1, clicksPerDay: 300, workers: 1 };
  const { log, tally } = await run(options, {
    launch: (profileDir) => launchWithExtension(profileDir),
    // The fixture server the other tests use is already running.
    serve: () => Promise.resolve({ port: Number(new URL(baseURL!).port), close: async () => {} }),
  });

  // Every click planned beside a control left a record, and no other click did.
  expect(tally.played).toBeGreaterThan(15);
  expect(tally.records).toBeGreaterThan(8);
  expect(tally.unplanned).toBe(0);
  expect(tally.silent).toEqual([]);
  // The extension saw the same nearest control the generator simulated, and
  // attached every retry to its miss.
  expect(tally.compared).toBeGreaterThan(8);
  expect(tally.sameNearest).toBe(tally.compared);
  expect(tally.retries).toBeGreaterThan(3);
  expect(tally.retriesLogged).toBe(tally.retries);

  for (const record of log.records) {
    expect(record.site).toMatch(/^site-\d+\.heyo\.test$/);
    const controls = record.features.candidates.filter((c) => c.kind === 'control');
    const marks = log.reviews.filter((review) => review.recordId === record.id);
    expect(marks.map((mark) => mark.candidate).sort()).toEqual(controls.map((c) => c.id).sort());
  }
  // Clicks that were not played are still in the counts.
  const clicks = log.counts.reduce((sum, count) => sum + count.clicks, 0);
  expect(clicks).toBeGreaterThanOrEqual(options.clicksPerDay);

  const scored = score(log.records, log.reviews, decide);
  expect(scored.misses).toBeGreaterThan(3);
  expect(scored.fires).toBeGreaterThan(0);
  expect(scored.reviewed).toBe(scored.fires);
});
