import { GATES, retargetGates } from '../../core/gates';
import { score } from '../../core/metrics';
import type { LogExport } from '../../core/types';
import { decide } from '../../decision';
import {
  addCount,
  clearLog,
  importLog,
  putRecord,
  putReview,
  readLog,
  setFire,
  setFollowUp,
  type Log,
} from '../db';
import type { PageReply, PageRequest, PingReply, PingRequest, WorkerMessage } from '../messages';
import { readSettings, writeSettings, type Settings } from '../settings';
import { decisionVersion } from '../version';

const WEEK_MS = 7 * 86_400_000;

/** How long the toolbar button shows that heyo just sent a click on. */
const BADGE_MS = 2500;

/** Writes run one at a time, so a follow-up never lands before its record. */
let queue: Promise<unknown> = Promise.resolve();

function store(message: WorkerMessage): Promise<void> {
  switch (message.type) {
    case 'count':
      return addCount(message.site, message.field, Date.now());
    case 'record':
      return putRecord(message.record);
    case 'followUp':
      return setFollowUp(message.id, message.followUp);
    case 'fire':
      if (message.fire.outcome === 'sent') flashBadge();
      return setFire(message.id, message.fire);
  }
}

/** Marks the toolbar button for a moment, so the user can tell heyo acted. */
function flashBadge(): void {
  void chrome.action.setBadgeBackgroundColor({ color: '#1f3fd6' });
  void chrome.action.setBadgeText({ text: '→' });
  setTimeout(() => void chrome.action.setBadgeText({ text: '' }), BADGE_MS);
}

/** True when the local log passes both data gates in front of retargeting. */
async function gatesPass(): Promise<boolean> {
  await queue;
  const log = await readLog();
  return retargetGates(score(log.records, log.reviews, decide)).pass;
}

/** Turns retargeting on only when the gates pass. Turning it off always works. */
async function setMode(mode: Settings['mode']): Promise<PageReply> {
  if (mode === 'retarget' && !(await gatesPass())) {
    return { ok: false, settings: await readSettings() };
  }
  return { ok: true, settings: await writeSettings({ mode, offReason: null }) };
}

/**
 * Records that a click heyo sent on was wrong. The report counts as a wrong
 * review mark for that fire. Retargeting turns off after a wrong click that
 * could not be undone, after more than one report in a week, or when the
 * marks no longer pass the gates.
 */
async function reportWrong(recordId: string, irreversible: boolean): Promise<PageReply> {
  await queue;
  const now = Date.now();
  const { records } = await readLog();
  const record = records.find((r) => r.id === recordId);
  if (!record || record.decision.action !== 'retarget') {
    return { ok: false, settings: await readSettings() };
  }
  await putReview({ recordId, candidate: record.decision.candidate, verdict: 'wrong', t: now });
  const before = await readSettings();
  const wrongReports = [...before.wrongReports.filter((t) => t > now - WEEK_MS), now];
  let change: Partial<Settings> = { wrongReports };
  if (irreversible) change = { ...change, mode: 'shadow', offReason: 'irreversible' };
  else if (wrongReports.length > GATES.maxWrongPerWeek || !(await gatesPass())) {
    change = { ...change, mode: 'shadow', offReason: 'wrong-clicks' };
  }
  return { ok: true, settings: await writeSettings(change) };
}

function answer(request: PageRequest): Promise<PageReply> {
  switch (request.type) {
    case 'setMode':
      return setMode(request.mode);
    case 'setWaitForDoubleClick':
      return writeSettings({ waitForDoubleClick: request.value }).then((settings) => ({
        ok: true,
        settings,
      }));
    case 'reportWrong':
      return reportWrong(request.recordId, request.irreversible);
  }
}

const PAGE_REQUESTS = new Set(['setMode', 'setWaitForDoubleClick', 'reportWrong']);

chrome.runtime.onMessage.addListener(
  (message: WorkerMessage | PageRequest, sender, sendResponse) => {
    if (PAGE_REQUESTS.has(message.type)) {
      // Settings change only at the request of one of the extension's own pages.
      if (sender.url?.startsWith(chrome.runtime.getURL(''))) {
        void answer(message as PageRequest).then(sendResponse);
        return true;
      }
      return false;
    }
    const write = queue.then(() => store(message as WorkerMessage));
    queue = write.catch((error: unknown) => console.error('heyo could not store a message', error));
    // Answering after the write keeps the worker alive until the write is done.
    void queue.then(() => sendResponse(true));
    return true;
  },
);

/** The toolbar button opens the review page, or switches to it if it is already open. */
chrome.action.onClicked.addListener(() => {
  void openReview();
});

async function openReview(): Promise<void> {
  const url = chrome.runtime.getURL('review.html');
  const open = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [url] });
  const existing = open[0];
  if (existing && existing.tabId >= 0) {
    await chrome.tabs.update(existing.tabId, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

/**
 * Asks the content script in one frame of a tab whether it is running.
 * The verification skill and the end-to-end tests call this through the
 * service worker.
 */
async function pingTab(tabId: number, frameId = 0): Promise<PingReply> {
  const request: PingRequest = { type: 'ping' };
  return chrome.tabs.sendMessage<PingRequest, PingReply>(tabId, request, { frameId });
}

/** The whole local log, in the format the scorer reads. Waits for pending writes. */
async function exportLog(): Promise<LogExport> {
  await queue;
  return {
    format: 'heyo-log',
    v: 1,
    exportedAt: Date.now(),
    extensionVersion: chrome.runtime.getManifest().version,
    decisionVersion,
    ...(await readLog()),
  };
}

/**
 * Hooks for the end-to-end tests and the verification drives, which reach the
 * service worker directly. No page can call these.
 */
const api = {
  pingTab,
  exportLog,
  clearLog,
  openReview,
  setMode,
  reportWrong,
  readSettings,
  /** Loads an exported log into the store, such as a synthetic one that passes the gates. */
  importLog: (log: Log) => importLog(log),
  /** Replaces the list of sites where retargeting may act. */
  setAllowlist: (allowlist: string[]) => writeSettings({ allowlist }),
  setWaitForDoubleClick: (value: boolean) => writeSettings({ waitForDoubleClick: value }),
  /** Sets the share of fires held back as a control: 0 sends every fire, 1 holds every fire. */
  setHeldShare: (heldShare: number) => writeSettings({ heldShare }),
};

export type HeyoWorkerApi = typeof api;

declare global {
  var heyo: HeyoWorkerApi;
}

globalThis.heyo = api;
