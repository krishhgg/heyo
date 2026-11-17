// Messages between the service worker and content scripts.
import type { ClickRecord, FollowUp } from '../core/types';

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

/** How one plain left click was classified. Every click sends exactly one of these. */
export interface CountMessage {
  type: 'count';
  site: string;
  field: 'hits' | 'emptyReacted' | 'emptyIgnored';
}

/** An empty-space click that had something nearby. */
export interface RecordMessage {
  type: 'record';
  record: ClickRecord;
}

/** The press that followed an already-sent record. */
export interface FollowUpMessage {
  type: 'followUp';
  id: string;
  followUp: FollowUp;
}

export type WorkerMessage = CountMessage | RecordMessage | FollowUpMessage;
