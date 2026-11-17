// What the user has turned on. Kept in chrome.storage.local, which content
// scripts can read. Only the service worker writes it, and it turns
// retargeting on only while the log passes the gates.
import { GATES } from '../core/gates';
import { ALLOWLIST } from './allowlist';

export interface Settings {
  /** Shadow mode logs and changes nothing. Retarget mode also sends clicks on, on allowed sites. */
  mode: 'shadow' | 'retarget';
  /**
   * Wait out the double-click interval before sending a click on, and send
   * nothing if a second press comes first.
   */
  waitForDoubleClick: boolean;
  /**
   * Why heyo turned retargeting off by itself, if it did: the log stopped
   * passing the gates, the user reported wrong clicks, or the user reported one
   * that could not be undone.
   */
  offReason: null | 'gates' | 'wrong-clicks' | 'irreversible';
  /**
   * The wrong clicks the user reported: which click, when, and whether it
   * could not be undone. One entry a click. A report is dropped after a week,
   * except one that could not be undone, which stays until it is taken back.
   */
  wrongReports: { id: string; t: number; irreversible?: boolean }[];
  /**
   * The version of the decision the gates last passed with. Retargeting acts
   * only under that version, so a page that loads a new decision after an
   * update sends nothing until the worker has judged it.
   */
  gatedWith: string | null;
  /**
   * Hostnames where retargeting may act on top of the list in the code. Only
   * tests and verification drives set this, to allow their fixture pages.
   */
  testHosts: string[];
  /**
   * A share of fires to hold back in place of the product's. Only tests set
   * this, to make runs repeatable. The scoring still counts a held miss as
   * ten, the product's share, whatever this says.
   */
  testHeldShare: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'shadow',
  waitForDoubleClick: false,
  offReason: null,
  wrongReports: [],
  gatedWith: null,
  testHosts: [],
  testHeldShare: null,
};

const KEY = 'settings';

/** The sites where retargeting may act: the list in the code, plus any a test added. */
export function sitesOf(settings: Settings): string[] {
  return [...ALLOWLIST.map((site) => site.host), ...settings.testHosts];
}

/** The share of fires held back as a control. */
export function heldShareOf(settings: Settings): number {
  return settings.testHeldShare ?? GATES.heldShare;
}

async function stored(): Promise<Partial<Settings>> {
  return ((await chrome.storage.local.get(KEY))[KEY] as Partial<Settings> | undefined) ?? {};
}

export async function readSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await stored()) };
}

/**
 * Stores a change. Only what was changed is kept, so a default that changes in
 * a later version is not held back by an old copy.
 */
export async function writeSettings(change: Partial<Settings>): Promise<Settings> {
  const next = { ...(await stored()), ...change };
  await chrome.storage.local.set({ [KEY]: next });
  return { ...DEFAULT_SETTINGS, ...next };
}

/** Calls back with the new settings whenever they change. */
export function watchSettings(onChange: (settings: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    const change = area === 'local' ? changes[KEY] : undefined;
    if (change) onChange({ ...DEFAULT_SETTINGS, ...(change.newValue as Partial<Settings>) });
  });
}
