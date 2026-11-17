import type { PingReply, PingRequest } from '../messages';

/**
 * Asks the content script in one frame of a tab whether it is running.
 * The verification skill and the end-to-end tests call this through the
 * service worker.
 */
async function pingTab(tabId: number, frameId = 0): Promise<PingReply> {
  const request: PingRequest = { type: 'ping' };
  return chrome.tabs.sendMessage<PingRequest, PingReply>(tabId, request, { frameId });
}

const api = { pingTab };

export type HeyoWorkerApi = typeof api;

declare global {
  var heyo: HeyoWorkerApi;
}

globalThis.heyo = api;
