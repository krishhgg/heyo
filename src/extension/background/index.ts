import type { LogExport } from '../../core/types';
import { addCount, clearLog, putRecord, readLog, setFollowUp } from '../db';
import type { PingReply, PingRequest, WorkerMessage } from '../messages';
import { decisionVersion } from '../version';

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
  }
}

chrome.runtime.onMessage.addListener((message: WorkerMessage, _sender, sendResponse) => {
  const write = queue.then(() => store(message));
  queue = write.catch((error: unknown) => console.error('heyo could not store a message', error));
  // Answering after the write keeps the worker alive until the write is done.
  void queue.then(() => sendResponse(true));
  return true;
});

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

const api = { pingTab, exportLog, clearLog, openReview };

export type HeyoWorkerApi = typeof api;

declare global {
  var heyo: HeyoWorkerApi;
}

globalThis.heyo = api;
