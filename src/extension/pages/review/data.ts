// What the review page shows, derived from the stored log and the bundled decision.
import type {
  Candidate,
  ClickRecord,
  Decide,
  LogExport,
  Review,
  Verdict,
} from '../../../core/types';
import type { Log } from '../../db';

/** A click the decision would retarget, with the control it picked. */
export interface Fire {
  record: ClickRecord;
  picked: Candidate;
}

/** A stable 32-bit hash of a record id (FNV-1a). */
function hash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Every would-be fire, in review order. The order is the hash of the record id,
 * so it is random with respect to time and site, and it stays the same between
 * visits. Reviewing from the front is reviewing a random sample of all fires.
 */
export function firesOf(records: ClickRecord[], decide: Decide): Fire[] {
  const fires: Fire[] = [];
  for (const record of records) {
    const decision = decide(record.features);
    if (decision.action !== 'retarget') continue;
    const picked = record.features.candidates.find((c) => c.id === decision.candidate);
    if (picked) fires.push({ record, picked });
  }
  return fires.sort((a, b) => hash(a.record.id) - hash(b.record.id));
}

export function reviewKey(fire: Fire): string {
  return `${fire.record.id}:${fire.picked.id}`;
}

/** The latest verdict for each reviewed pair of click and control. */
export function verdictsOf(reviews: Review[]): Map<string, Verdict> {
  const latest = new Map<string, Review>();
  for (const review of reviews) {
    const key = `${review.recordId}:${review.candidate}`;
    const seen = latest.get(key);
    if (!seen || review.t >= seen.t) latest.set(key, review);
  }
  return new Map([...latest].map(([key, review]) => [key, review.verdict]));
}

export function toExport(log: Log, extensionVersion: string, decisionVersion: string): LogExport {
  return {
    format: 'heyo-log',
    v: 1,
    exportedAt: Date.now(),
    extensionVersion,
    decisionVersion,
    records: log.records,
    reviews: log.reviews,
    counts: log.counts,
  };
}

/** A plain-words name for the kind of control a candidate is. */
export function kindOf(candidate: Candidate): string {
  const { tag, role, type, signals } = candidate;
  if (role) return role;
  if (tag === 'a') return 'link';
  if (tag === 'input') return type && type !== 'text' ? `${type} field` : 'text field';
  if (tag === 'textarea') return 'text field';
  if (tag === 'select') return 'dropdown';
  if (tag === 'button' || tag === 'summary' || tag === 'label') return tag;
  if (signals.includes('listener')) return `${tag} with a click handler`;
  if (signals.includes('cursor')) return `${tag} with a pointer cursor`;
  return tag;
}

export function nameOf(candidate: Candidate): string {
  return candidate.label || `unnamed ${kindOf(candidate)}`;
}
