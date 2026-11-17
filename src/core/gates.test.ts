import { describe, expect, it } from 'vitest';
import { missRateGate, recoveryGate, retargetGates, wrongTargetGate } from './gates';
import type { Score } from './metrics';
import { upperBound } from './stats';

function scoreOf(overrides: Partial<Score>): Score {
  const base: Score = {
    records: 0,
    misses: 0,
    recovered: 0,
    recovery: null,
    fires: 0,
    proxyWrong: 0,
    reviewed: 0,
    wrong: 0,
    unsure: 0,
    wrongUpper: null,
    doublePress: 0,
    ...overrides,
  };
  if (base.misses > 0) base.recovery = base.recovered / base.misses;
  if (base.reviewed > 0) base.wrongUpper = upperBound(base.wrong, base.reviewed);
  return base;
}

describe('recoveryGate', () => {
  it('passes at 50% recovery and fails below it', () => {
    expect(recoveryGate(scoreOf({ misses: 100, recovered: 50 })).status).toBe('pass');
    expect(recoveryGate(scoreOf({ misses: 100, recovered: 49 })).status).toBe('fail');
  });

  it('is inconclusive on fewer than 30 labeled misses', () => {
    expect(recoveryGate(scoreOf({ misses: 29, recovered: 29 })).status).toBe('inconclusive');
    expect(recoveryGate(scoreOf({})).status).toBe('inconclusive');
  });
});

describe('wrongTargetGate', () => {
  it('passes with zero wrong targets in 299 reviewed fires', () => {
    const gate = wrongTargetGate(scoreOf({ reviewed: 299, wrong: 0 }));
    expect(gate).toMatchObject({ status: 'pass', needed: 299 });
  });

  it('is inconclusive, not a pass, with too few reviewed fires', () => {
    expect(wrongTargetGate(scoreOf({ reviewed: 298, wrong: 0 })).status).toBe('inconclusive');
    expect(wrongTargetGate(scoreOf({})).status).toBe('inconclusive');
  });

  it('needs more reviewed fires after each wrong target', () => {
    const gate = wrongTargetGate(scoreOf({ reviewed: 300, wrong: 1 }));
    expect(gate).toMatchObject({ status: 'inconclusive', needed: 473 });
    expect(wrongTargetGate(scoreOf({ reviewed: 473, wrong: 1 })).status).toBe('pass');
  });

  it('fails once the rate is above the ceiling with 95% confidence', () => {
    expect(wrongTargetGate(scoreOf({ reviewed: 100, wrong: 5 })).status).toBe('fail');
  });
});

describe('retargetGates', () => {
  it('passes only when both gates pass', () => {
    const good = { misses: 100, recovered: 60, reviewed: 300, wrong: 0 };
    expect(retargetGates(scoreOf(good)).pass).toBe(true);
    expect(retargetGates(scoreOf({ ...good, recovered: 40 })).pass).toBe(false);
    expect(retargetGates(scoreOf({ ...good, reviewed: 120 })).pass).toBe(false);
  });
});

describe('missRateGate', () => {
  const rate = {
    elapsedDays: 14,
    activeDays: 14,
    clicks: 10000,
    misses: 70,
    rate: 0.007,
    perDay: 5,
  };

  it('passes after two weeks with enough misses', () => {
    expect(missRateGate(rate).status).toBe('pass');
  });

  it('fails after two weeks when misses are under 0.5% of clicks or under 3 a day', () => {
    expect(missRateGate({ ...rate, rate: 0.004 }).status).toBe('fail');
    expect(missRateGate({ ...rate, perDay: 2.9 }).status).toBe('fail');
  });

  it('is inconclusive before two weeks', () => {
    expect(missRateGate({ ...rate, elapsedDays: 13 }).status).toBe('inconclusive');
  });

  it('judges two calendar weeks even when some days had no clicks', () => {
    const idle = { ...rate, activeDays: 10, misses: 0, rate: 0, perDay: 0 };
    expect(missRateGate(idle).status).toBe('fail');
  });
});
