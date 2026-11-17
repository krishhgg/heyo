import { describe, expect, it } from 'vitest';
import { distanceToRect } from '../src/core/geometry';
import { DEFAULT_OPTIONS, generate } from '../synth/generate';
import { DEFAULT_SCRIPTED, schedule } from './main';

const options = { ...DEFAULT_SCRIPTED, days: 7 };
const { days, tally } = schedule(options);
const episodes = days.flatMap((day) => day.episodes);

describe('schedule', () => {
  it('plans the same clicks as the synthetic log of that seed', () => {
    const log = generate({ ...DEFAULT_OPTIONS, days: 7 });
    expect(tally.planned).toBe(7 * DEFAULT_OPTIONS.clicksPerDay);
    // Every simulated record comes from a click beside a control, and all of those are played
    // except the few made into a window without focus.
    const played = new Set(episodes.map((e) => e.click.record?.id).filter(Boolean));
    const missing = log.records.filter((r) => !played.has(r.id));
    expect(missing.length).toBe(tally.skippedUnfocused);
    expect(missing.every((r) => !r.features.focused)).toBe(true);
  });

  it('plays every click that lands on empty space within 30 px of a control', () => {
    for (const { click, kind } of episodes) {
      const { plan } = click;
      const nearest = Math.min(...plan.scene.map((c) => distanceToRect(plan.p, c.rect)));
      expect(kind).toBe(!plan.hit && nearest <= 30 ? 'near' : 'plain');
      expect(plan.focused).toBe(true);
    }
    expect(episodes.filter((e) => e.kind === 'near').length).toBeGreaterThan(200);
  });

  it('plays a small sample of the clicks that cannot leave a record, and counts the rest', () => {
    const plain = episodes.filter((e) => e.kind === 'plain').length;
    const leftOut = days.flatMap((day) => [...day.leftOut.values()]);
    const counted = leftOut.reduce((sum, count) => sum + count.clicks, 0);
    expect(counted).toBe(tally.skippedPlain + tally.skippedUnfocused);
    expect(counted + episodes.length).toBe(tally.planned);
    expect(plain / (plain + tally.skippedPlain)).toBeCloseTo(options.plainShare, 1);
    for (const count of leftOut) {
      expect(count.hits + count.emptyReacted + count.emptyIgnored).toBe(count.clicks);
      expect(count.site).toMatch(/^site-\d+\.heyo\.test$/);
    }
  });

  it('gives the same schedule for the same seed', () => {
    const again = schedule(options);
    expect(again.tally).toEqual(tally);
    expect(again.days.map((day) => day.episodes.length)).toEqual(
      days.map((day) => day.episodes.length),
    );
    expect(schedule({ ...options, seed: 2 }).tally).not.toEqual(tally);
  });
});
