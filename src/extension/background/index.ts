import { GATES, retargetGates } from '../../core/gates';
import { score } from '../../core/metrics';
import type { ClickRecord, LogExport, Review } from '../../core/types';
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
import { DEFAULT_SETTINGS, readSettings, writeSettings, type Settings } from '../settings';
import { decisionVersion } from '../version';

const WEEK_MS = 7 * 86_400_000;

/** How long the toolbar button shows that heyo just sent a click on. */
const BADGE_MS = 2500;

/**
 * Everything that reads or writes the log or the settings runs here, one job
 * at a time. A follow-up never lands before its record, and two requests never
 * work from the same stale copy of the settings.
 */
let queue: Promise<unknown> = Promise.resolve();

function inTurn<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job);
  queue = run.catch((error: unknown) => console.error('heyo could not finish a job', error));
  return run;
}

async function store(message: WorkerMessage, tabId: number | undefined): Promise<void> {
  switch (message.type) {
    case 'count':
      // A count is not part of either gate.
      return addCount(message.site, message.field, Date.now());
    case 'record':
      await putRecord(message.record);
      break;
    case 'followUp':
      await setFollowUp(message.id, message.followUp);
      break;
    case 'fire':
      if (message.fire.outcome === 'sent') flashBadge(tabId);
      await setFire(message.id, message.fire);
      break;
  }
  await enforce();
}

const badgeTimers = new Map<number, ReturnType<typeof setTimeout>>();

/** Marks the toolbar button on one tab for a moment, so the user can tell heyo acted there. */
function flashBadge(tabId: number | undefined): void {
  if (tabId === undefined) return;
  const set = (text: string) => chrome.action.setBadgeText({ text, tabId }).catch(() => undefined);
  void chrome.action.setBadgeBackgroundColor({ color: '#1f3fd6', tabId }).catch(() => undefined);
  void set('→');
  // One timer a tab, started again by each click, so a second click keeps the mark its full time.
  clearTimeout(badgeTimers.get(tabId));
  badgeTimers.set(
    tabId,
    setTimeout(() => {
      badgeTimers.delete(tabId);
      // The tab may be closed by then, which is fine.
      void set('');
    }, BADGE_MS),
  );
}

/**
 * True when the local log passes both data gates in front of retargeting. A
 * log that cannot be read has not passed.
 */
async function gatesPass(): Promise<boolean> {
  try {
    const log = await readLog();
    return retargetGates(score(log.records, log.reviews, decide)).pass;
  } catch {
    return false;
  }
}

/**
 * Runs one job, and turns retargeting off if the job fails. A job can fail
 * after it has changed the log, such as a mark that was stored before a read
 * went wrong, and retargeting does not stay on over a log nobody judged again.
 */
async function orShadow<T>(job: () => Promise<T>): Promise<T> {
  try {
    return await job();
  } catch (error) {
    const settings = await readSettings().catch(() => null);
    if (settings?.mode !== 'shadow') await writeSettings({ mode: 'shadow', offReason: 'error' });
    throw error;
  }
}

/**
 * Retargeting stays on only while the log passes the gates with the decision
 * this worker carries. This runs after every change to the log and each time
 * the worker starts, which covers an update that brings a new decision. It
 * turns retargeting off when the gates no longer pass, and otherwise notes
 * the decision they passed with, which pages wait for before they act.
 */
async function enforce(): Promise<Settings> {
  const settings = await readSettings();
  if (settings.mode !== 'retarget') return settings;
  if (!(await gatesPass())) return writeSettings({ mode: 'shadow', offReason: 'gates' });
  if (settings.gatedWith === decisionVersion) return settings;
  return writeSettings({ gatedWith: decisionVersion });
}

/** Turns retargeting on only when the gates pass. Turning it off always works. */
async function setMode(mode: Settings['mode']): Promise<PageReply> {
  if (mode === 'shadow') {
    return { ok: true, settings: await writeSettings({ mode, offReason: null }) };
  }
  const before = await readSettings();
  if (!(await gatesPass())) return { ok: false, settings: before };
  // The user has seen the warning about a click that could not be undone and
  // turned retargeting on all the same, so it is not shown again.
  const wrongReports = before.wrongReports.map(({ id, t }) => ({ id, t }));
  const change = { mode, offReason: null, gatedWith: decisionVersion, wrongReports };
  return { ok: true, settings: await writeSettings(change) };
}

/** The click with this id, if heyo sent it on to the control the mark is about. */
async function sentClick(recordId: string, candidate?: number): Promise<ClickRecord | null> {
  const { records } = await readLog();
  const record = records.find((r) => r.id === recordId);
  if (!record || record.decision.action !== 'retarget' || record.fire?.outcome !== 'sent') {
    return null;
  }
  return candidate === undefined || candidate === record.decision.candidate ? record : null;
}

/** How many of the reports were made in the last week. */
function thisWeek(reports: Settings['wrongReports'], now: number): number {
  return reports.filter((r) => r.t > now - WEEK_MS).length;
}

/**
 * Applies the turn-off rules after a mark, and stores the reports. Retargeting
 * turns off after a wrong click that could not be undone, after more than one
 * reported wrong click in a week, or when the marks no longer pass the gates.
 * `reported` says this mark was a wrong click heyo sent on.
 */
async function settle(
  wrongReports: Settings['wrongReports'],
  reported: boolean,
  irreversible: boolean,
): Promise<Settings> {
  const now = Date.now();
  const before = await readSettings();
  const tooMany = thisWeek(wrongReports, now) > GATES.maxWrongPerWeek;
  let change: Partial<Settings> = { wrongReports };
  if (before.mode === 'retarget') {
    // heyo says why it turned retargeting off only when it did.
    if (irreversible) {
      change = { ...change, mode: 'shadow', offReason: 'irreversible' };
    } else if (reported && tooMany) {
      change = { ...change, mode: 'shadow', offReason: 'wrong-clicks' };
    } else if (!(await gatesPass())) {
      change = { ...change, mode: 'shadow', offReason: reported ? 'wrong-clicks' : 'gates' };
    }
  } else if (before.offReason === 'irreversible') {
    // The reason goes when the report that gave it is taken back. If the
    // other reports are still too many for a week, that becomes the reason.
    if (!wrongReports.some((r) => r.irreversible)) {
      change = { ...change, offReason: tooMany ? 'wrong-clicks' : null };
    }
  } else if (before.offReason === 'wrong-clicks') {
    if (!tooMany && (await gatesPass())) change = { ...change, offReason: null };
  }
  return writeSettings(change);
}

/**
 * The reports that still count, with one for this click if it has none yet.
 * A report older than a week is dropped, unless its click could not be undone.
 */
function withReport(
  reports: Settings['wrongReports'],
  id: string,
  now: number,
  irreversible: boolean,
): Settings['wrongReports'] {
  const kept = reports.filter((r) => r.irreversible || r.t > now - WEEK_MS);
  const old = kept.find((r) => r.id === id);
  if (!old) return [...kept, irreversible ? { id, t: now, irreversible } : { id, t: now }];
  return irreversible ? kept.map((r) => (r === old ? { ...r, irreversible } : r)) : kept;
}

/**
 * Records that a click heyo sent on was wrong. The report counts as a wrong
 * review mark for that fire, and a click is reported once however often it is
 * marked.
 */
async function reportWrong(recordId: string, irreversible: boolean): Promise<PageReply> {
  const now = Date.now();
  // A report is about a click heyo sent on, and nothing else.
  const record = await sentClick(recordId);
  if (!record || record.decision.action !== 'retarget') {
    return { ok: false, settings: await readSettings() };
  }
  await putReview({ recordId, candidate: record.decision.candidate, verdict: 'wrong', t: now });
  const reports = withReport((await readSettings()).wrongReports, recordId, now, irreversible);
  return { ok: true, settings: await settle(reports, true, irreversible) };
}

/**
 * Stores a mark from the review page. A wrong mark on a click heyo sent on is
 * a report of a wrong click, the same as one made on the Retargeting tab, and
 * a mark changed to something else takes that report back.
 */
async function mark(review: Review): Promise<PageReply> {
  await putReview(review);
  const now = Date.now();
  const before = (await readSettings()).wrongReports;
  const sent = (await sentClick(review.recordId, review.candidate)) !== null;
  const wrong = sent && review.verdict === 'wrong';
  let reports = before;
  if (wrong) reports = withReport(before, review.recordId, now, false);
  else if (sent) reports = before.filter((r) => r.id !== review.recordId);
  return { ok: true, settings: await settle(reports, wrong, false) };
}

/** Deletes the log, and the reports that were about it. An empty log passes no gate. */
async function clear(): Promise<PageReply> {
  await clearLog();
  // With the log go the reports and any reason that named them. If retargeting
  // was on, the check below turns it off and says the log no longer passes.
  await writeSettings({ wrongReports: [], offReason: null });
  return { ok: true, settings: await enforce() };
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
    case 'review':
      return mark(request.review);
    case 'clearLog':
      return clear();
  }
}

const PAGE_REQUESTS = new Set<string>([
  'setMode',
  'setWaitForDoubleClick',
  'reportWrong',
  'review',
  'clearLog',
] satisfies PageRequest['type'][]);

chrome.runtime.onMessage.addListener(
  (message: WorkerMessage | PageRequest, sender, sendResponse) => {
    if (PAGE_REQUESTS.has(message.type)) {
      // The settings and the marks change only at the request of one of the extension's own pages.
      if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
      void inTurn(() => orShadow(() => answer(message as PageRequest)))
        // The page gets an answer also when the settings cannot be read.
        .catch(async () => ({
          ok: false,
          settings: await readSettings().catch(() => DEFAULT_SETTINGS),
        }))
        .then(sendResponse);
      return true;
    }
    // Answering after the write keeps the worker alive until the write is done.
    void inTurn(() => orShadow(() => store(message as WorkerMessage, sender.tab?.id))).then(
      () => sendResponse(true),
      () => sendResponse(false),
    );
    return true;
  },
);

// Whenever the worker starts, for whatever reason, it checks the gates once.
void inTurn(() => orShadow(enforce));
// Chrome starts the worker for these two, so the check runs right after an
// update that brings a new decision, and at browser start, before any page asks.
chrome.runtime.onInstalled.addListener(() => void inTurn(() => orShadow(enforce)));
chrome.runtime.onStartup.addListener(() => void inTurn(() => orShadow(enforce)));

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

/** The whole local log, in the format the scorer reads. */
async function exportLog(): Promise<LogExport> {
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
  openReview,
  /** Waits for pending writes, like everything below. */
  exportLog: () => inTurn(exportLog),
  clearLog: () => inTurn(clear),
  setMode: (mode: Settings['mode']) => inTurn(() => setMode(mode)),
  reportWrong: (recordId: string, irreversible: boolean) =>
    inTurn(() => reportWrong(recordId, irreversible)),
  readSettings: () => inTurn(readSettings),
  /** Loads an exported log into the store, such as a synthetic one that passes the gates. */
  importLog: (log: Log) => inTurn(() => importLog(log).then(enforce)),
  /** Lets retargeting act on a test's own pages, on top of the sites in the code. */
  allowTestHosts: (testHosts: string[]) => inTurn(() => writeSettings({ testHosts })),
  setWaitForDoubleClick: (value: boolean) =>
    inTurn(() => writeSettings({ waitForDoubleClick: value })),
  /** Sets the share of fires held back as a control: 0 sends every fire, 1 holds every fire. */
  holdTestShare: (testHeldShare: number) => inTurn(() => writeSettings({ testHeldShare })),
};

export type HeyoWorkerApi = typeof api;

declare global {
  var heyo: HeyoWorkerApi;
}

globalThis.heyo = api;
