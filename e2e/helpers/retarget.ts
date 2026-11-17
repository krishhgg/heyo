import type { Page, Worker } from '@playwright/test';
import { candidate, hit, record } from '../../src/core/testing';
import type { ClickRecord, LogExport, Review } from '../../src/core/types';

/** Longer than the settle time of the user's click plus the settle time of the click heyo sends. */
export const SENT_MS = 250;

/**
 * A log that passes both gates in front of retargeting: 320 labeled misses the
 * decision recovers, each reviewed right.
 */
export function passingLog(size = 320): Pick<LogExport, 'records' | 'reviews' | 'counts'> {
  const records: ClickRecord[] = Array.from({ length: size }, () =>
    record({ candidates: [candidate(0, 3)] }, hit(0, 3), {
      site: 'seeded.example',
      decision: { action: 'retarget', candidate: 0 },
    }),
  );
  const reviews: Review[] = records.map((r) => ({
    recordId: r.id,
    candidate: 0,
    verdict: 'right',
    t: r.t,
  }));
  return { records, reviews, counts: [] };
}

/**
 * Seeds a passing log, allows the fixture host, and turns retargeting on.
 * Every fire is sent unless `held` says to hold them all back as controls.
 */
export async function turnOnRetargeting(
  worker: Worker,
  { hosts = ['127.0.0.1'], held = false, reviewed = 320 } = {},
) {
  const reply = await worker.evaluate(
    async ({ log, allow, share }) => {
      await heyo.importLog(log);
      await heyo.setAllowlist(allow);
      await heyo.setHeldShare(share);
      return heyo.setMode('retarget');
    },
    { log: passingLog(reviewed), allow: hosts, share: held ? 1 : 0 },
  );
  if (!reply.ok) throw new Error('The seeded log did not pass the gates.');
}

/** What the fixture page's controls did, in order. */
export function actionsOf(page: Page): Promise<string[]> {
  return page.evaluate('actions');
}

/** The records logged on the fixture host, leaving out the seeded ones. */
export async function fixtureRecords(worker: Worker): Promise<ClickRecord[]> {
  const log = await worker.evaluate(() => heyo.exportLog());
  return log.records.filter((r) => r.site !== 'seeded.example');
}
