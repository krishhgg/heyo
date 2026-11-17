import { describe, expect, it } from 'vitest';
import { addDays, dayOf, daysBetween } from './days';

describe('dayOf', () => {
  it('is the local calendar day', () => {
    expect(dayOf(new Date(2026, 10, 3, 0, 0, 1).getTime())).toBe('2026-11-03');
    expect(dayOf(new Date(2026, 10, 3, 23, 59, 59).getTime())).toBe('2026-11-03');
    expect(dayOf(new Date(2026, 0, 9, 12).getTime())).toBe('2026-01-09');
  });
});

describe('daysBetween', () => {
  it('counts whole days, across months and clock changes', () => {
    expect(daysBetween('2026-11-03', '2026-11-03')).toBe(0);
    expect(daysBetween('2026-11-03', '2026-11-16')).toBe(13);
    expect(daysBetween('2026-10-28', '2026-11-03')).toBe(6);
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
  });
});

describe('addDays', () => {
  it('steps across month and year ends', () => {
    expect(addDays('2026-11-03', 0)).toBe('2026-11-03');
    expect(addDays('2026-11-28', 5)).toBe('2026-12-03');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
