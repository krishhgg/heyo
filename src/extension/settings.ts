// What the user has turned on. Kept in chrome.storage.local, which content
// scripts can read. Only the service worker writes the mode, after checking the gates.
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
  /** Hostnames where retargeting may act. */
  allowlist: string[];
  /** Why heyo turned retargeting off by itself, if it did. */
  offReason: null | 'wrong-clicks' | 'irreversible';
  /** Times at which the user reported a wrong click. */
  wrongReports: number[];
  /** Share of fires held back as a control. Tests set it to 0 or 1 to make runs repeatable. */
  heldShare: number;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'shadow',
  waitForDoubleClick: false,
  allowlist: ALLOWLIST.map((site) => site.host),
  offReason: null,
  wrongReports: [],
  heldShare: GATES.heldShare,
};

const KEY = 'settings';

export async function readSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get(KEY))[KEY] as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function writeSettings(change: Partial<Settings>): Promise<Settings> {
  const next = { ...(await readSettings()), ...change };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

/** Calls back with the new settings whenever they change. */
export function watchSettings(onChange: (settings: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    const change = area === 'local' ? changes[KEY] : undefined;
    if (change) onChange({ ...DEFAULT_SETTINGS, ...(change.newValue as Partial<Settings>) });
  });
}
