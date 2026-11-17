// Splits a log into a tuning part and a held-out part, by site and by week.
// A decision is tuned on train and judged on test, so a rule that memorizes
// one site or one week gains nothing.
import type { ClickRecord } from '../src/core/types';

export type Split = 'train' | 'test';

const WEEK_MS = 7 * 86_400_000;

/** This share of sites is held out. */
const TEST_SITE_SHARE = 0.25;

/** This share of the weeks, the latest ones, is held out. */
const TEST_WEEK_SHARE = 0.3;

/** A stable hash of a site name to [0, 1). */
function siteHash(site: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < site.length; i++) {
    h ^= site.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // FNV-1a mixes its low bits poorly for short strings. One more round spreads them.
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

export interface Splitter {
  of(record: ClickRecord): Split;
  /** How many weeks the log spans, and how many of them are held out. */
  weeks: number;
  testWeeks: number;
}

/**
 * A record is held out when its site is a held-out site or its week is a
 * held-out week. Train is everything else: the other sites in the earlier weeks.
 */
export function splitter(records: ClickRecord[]): Splitter {
  // A loop, not Math.min over a spread: a log can hold more records than a call takes arguments.
  let first = Infinity;
  let last = -Infinity;
  for (const record of records) {
    if (record.t < first) first = record.t;
    if (record.t > last) last = record.t;
  }
  const weeks = records.length > 0 ? Math.floor((last - first) / WEEK_MS) + 1 : 0;
  // With a single week there is no later week to hold out, so only sites split.
  const testWeeks = weeks >= 2 ? Math.max(1, Math.round(weeks * TEST_WEEK_SHARE)) : 0;
  return {
    weeks,
    testWeeks,
    of(record) {
      const week = Math.floor((record.t - first) / WEEK_MS);
      const lateWeek = week >= weeks - testWeeks;
      return lateWeek || siteHash(record.site) < TEST_SITE_SHARE ? 'test' : 'train';
    },
  };
}
