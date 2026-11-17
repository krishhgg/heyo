// The local log, in IndexedDB under the extension's own origin. The service
// worker writes it. The extension's pages read it and add reviews.
import { dayOf } from '../core/days';
import type { ClickRecord, DayCount, FollowUp, Review } from '../core/types';

const NAME = 'heyo';
const VERSION = 1;

type CountField = 'hits' | 'emptyReacted' | 'emptyIgnored';

let opening: Promise<IDBDatabase> | null = null;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('records', { keyPath: 'id' });
      db.createObjectStore('reviews', { keyPath: ['recordId', 'candidate'] });
      db.createObjectStore('counts', { keyPath: ['day', 'site'] });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  return opening;
}

export async function putRecord(record: ClickRecord): Promise<void> {
  const tx = (await open()).transaction('records', 'readwrite');
  tx.objectStore('records').put(record);
  await done(tx);
}

/** Attaches the follow-up press to a stored record. Does nothing if the record is gone. */
export async function setFollowUp(id: string, followUp: FollowUp): Promise<void> {
  const tx = (await open()).transaction('records', 'readwrite');
  const store = tx.objectStore('records');
  const record = (await request(store.get(id))) as ClickRecord | undefined;
  if (record) store.put({ ...record, followUp });
  await done(tx);
}

/** Counts one click for a site on the day of `epoch`. */
export async function addCount(site: string, field: CountField, epoch: number): Promise<void> {
  const day = dayOf(epoch);
  const tx = (await open()).transaction('counts', 'readwrite');
  const store = tx.objectStore('counts');
  const count = ((await request(store.get([day, site]))) as DayCount | undefined) ?? {
    day,
    site,
    clicks: 0,
    hits: 0,
    emptyReacted: 0,
    emptyIgnored: 0,
  };
  count.clicks++;
  count[field]++;
  store.put(count);
  await done(tx);
}

export async function putReview(review: Review): Promise<void> {
  const tx = (await open()).transaction('reviews', 'readwrite');
  tx.objectStore('reviews').put(review);
  await done(tx);
}

async function all<T>(store: string): Promise<T[]> {
  const tx = (await open()).transaction(store, 'readonly');
  return request(tx.objectStore(store).getAll() as IDBRequest<T[]>);
}

export interface Log {
  records: ClickRecord[];
  reviews: Review[];
  counts: DayCount[];
}

export async function readLog(): Promise<Log> {
  const [records, reviews, counts] = await Promise.all([
    all<ClickRecord>('records'),
    all<Review>('reviews'),
    all<DayCount>('counts'),
  ]);
  records.sort((a, b) => a.t - b.t);
  return { records, reviews, counts };
}

export async function clearLog(): Promise<void> {
  const tx = (await open()).transaction(['records', 'reviews', 'counts'], 'readwrite');
  for (const store of ['records', 'reviews', 'counts']) tx.objectStore(store).clear();
  await done(tx);
}
