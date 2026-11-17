// Messages between the service worker and content scripts.
import type { ClickRecord, Fire, FollowUp } from '../core/types';
import type { Settings } from './settings';

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

/** What heyo did about an already-sent record while retargeting was on. */
export interface FireMessage {
  type: 'fire';
  id: string;
  fire: Fire;
}

export type WorkerMessage = CountMessage | RecordMessage | FollowUpMessage | FireMessage;

/** Requests from the review page. Only the service worker changes settings. */
export type PageRequest =
  | { type: 'setMode'; mode: Settings['mode'] }
  | { type: 'setWaitForDoubleClick'; value: boolean }
  | { type: 'reportWrong'; recordId: string; irreversible: boolean };

export interface PageReply {
  /** False when the request was refused, such as turning retargeting on before the gates pass. */
  ok: boolean;
  settings: Settings;
}
