import { describe, expect, it } from 'vitest';
import { candidate, record } from '../core/testing';
import { ALLOWLIST } from './allowlist';
import { mayAct, planFire } from './plan';
import { DEFAULT_SETTINGS, type Settings } from './settings';

const on: Settings = { ...DEFAULT_SETTINGS, mode: 'retarget', testHosts: ['app.example'] };
const fire = record({ candidates: [candidate(0, 3)] }, null, {
  site: 'app.example',
  decision: { action: 'retarget', candidate: 0 },
});

describe('planFire', () => {
  it('sends a would-be fire on when retargeting is on for the site', () => {
    expect(planFire(on, 'app.example', fire, 0.5)).toBe('send');
  });

  it('holds one fire in ten back as a control', () => {
    expect(planFire(on, 'app.example', fire, 0.0999)).toBe('hold');
    expect(planFire(on, 'app.example', fire, 0.1)).toBe('send');
  });

  it('only logs in shadow mode', () => {
    expect(planFire({ ...on, mode: 'shadow' }, 'app.example', fire, 0.5)).toBe('log');
  });

  it('only logs on a site that is not on the allowlist', () => {
    expect(planFire(on, 'other.example', fire, 0.5)).toBe('log');
    expect(planFire({ ...on, testHosts: [] }, 'app.example', fire, 0.5)).toBe('log');
  });

  it('takes the allowlist from the code, whatever an older version stored', () => {
    const [first] = ALLOWLIST;
    const live: Settings = { ...DEFAULT_SETTINGS, mode: 'retarget' };
    expect(planFire(live, first!.host, fire, 0.5)).toBe('send');
    // A list an older version left in storage is not read.
    const stale = { ...live, allowlist: ['retired.example'] } as Settings;
    expect(planFire(stale, 'retired.example', fire, 0.5)).toBe('log');
  });

  it('matches a site by its exact hostname', () => {
    const live: Settings = { ...DEFAULT_SETTINGS, mode: 'retarget' };
    expect(mayAct(live, 'en.wikipedia.org')).toBe(true);
    expect(mayAct(live, 'de.wikipedia.org')).toBe(false);
    expect(mayAct(live, 'wikipedia.org')).toBe(false);
  });

  it('holds back the share a test asks for', () => {
    expect(planFire({ ...on, testHeldShare: 1 }, 'app.example', fire, 0.99)).toBe('hold');
    expect(planFire({ ...on, testHeldShare: 0 }, 'app.example', fire, 0)).toBe('send');
  });

  it('only logs a click the decision refused', () => {
    const refused = { ...fire, decision: { action: 'refuse', reason: 'ambiguous' } as const };
    expect(planFire(on, 'app.example', refused, 0.5)).toBe('log');
  });

  it('only logs a click inside an iframe', () => {
    const framed = { ...fire, features: { ...fire.features, topFrame: false } };
    expect(planFire(on, 'app.example', framed, 0.5)).toBe('log');
  });
});
