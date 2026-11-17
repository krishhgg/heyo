// Messages between the service worker and content scripts.

/** The service worker asks a frame whether its content script is running. */
export interface PingRequest {
  type: 'ping';
}

export interface PingReply {
  ok: true;
  version: string;
  top: boolean;
}

export type ContentRequest = PingRequest;
