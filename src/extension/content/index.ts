import type { ContentRequest, PingReply } from '../messages';

chrome.runtime.onMessage.addListener((request: ContentRequest, _sender, sendResponse) => {
  if (request.type === 'ping') {
    const reply: PingReply = {
      ok: true,
      version: chrome.runtime.getManifest().version,
      top: window === window.top,
    };
    sendResponse(reply);
  }
  return false;
});
