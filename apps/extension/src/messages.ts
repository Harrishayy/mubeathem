import type { CallView, FeedbackRequest, Outcome, Prospect, Speaker, SuggestionAction, TrellusDispositionsResponse, TrellusStatusResponse } from '@cue/core';
import type { Connection, TranscriberTurn } from '@cue/client';
import type { SttCredentials } from './capture/stt';
import type { TrellusCallState } from './context/trellus';

/** Capture of one side of the call. */
export interface CaptureStatus {
  state: 'off' | 'starting' | 'on' | 'unavailable' | 'denied' | 'error';
  /** Plain-English reason shown next to the retry. */
  message?: string;
}

export type Phase = 'idle' | 'starting' | 'live' | 'ended';

/** What every Cue surface renders. The background owns it and broadcasts every change. */
export interface SessionState {
  phase: Phase;
  callId: string | null;
  view: CallView | null;
  connection: Connection;
  /** The tab the call is on (its audio is the prospect). */
  tabId: number | null;
  capture: { tab: CaptureStatus; mic: CaptureStatus };
  /** Who the mic is attributed to. 'rep' normally; 'prospect' while the rep holds the switch on a single-mic call. */
  micSpeaker: Speaker;
  /** Turns waiting for the server. */
  pendingTurns: number;
  /** The last thing that went wrong, for a banner. Cleared on the next success. */
  error: string | null;
  /** Contact and dialer state the overlay last read from the call tab. */
  page: PageContext | null;
}

export interface PageContext {
  tabId: number | null;
  host: string;
  prospect: Prospect | null;
  trellus: { present: boolean; state: TrellusCallState };
}

export interface Levels {
  prospect: number;
  rep: number;
}

/** Requests from the side panel and the overlay to the background. */
export type UiRequest =
  | { type: 'session.get' }
  | { type: 'session.start'; prospect: Prospect; tabId?: number | null; source?: 'trellus' | 'cue' }
  | { type: 'session.end'; outcome?: Outcome }
  | { type: 'session.turn'; speaker: Speaker; text: string }
  | { type: 'session.action'; suggestionId: string; action: SuggestionAction; text?: string }
  | { type: 'session.feedback'; feedback: FeedbackRequest }
  | { type: 'session.reset' }
  | { type: 'capture.retry' }
  /** Single-mic calls: who the mic is hearing right now (when the tab can't be transcribed). */
  | { type: 'capture.micSpeaker'; speaker: Speaker }
  | { type: 'page.context'; context: PageContext }
  | { type: 'panel.open' }
  | { type: 'server.health' }
  | { type: 'trellus.status' }
  | { type: 'trellus.setKey'; apiKey: string; teamId?: string }
  | { type: 'trellus.dispositions' }
  | { type: 'trellus.setDispositions'; overrides: Record<string, Outcome> };

export type UiResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

/** Background → offscreen document. */
export type OffscreenCommand =
  | { target: 'offscreen'; type: 'capture.start'; tabStreamId: string | null; callStartedAt: number; mic: boolean; stt: SttCredentials | null; micSpeaker: Speaker }
  | { target: 'offscreen'; type: 'capture.speaker'; micSpeaker: Speaker }
  | { target: 'offscreen'; type: 'capture.stop' };

/** Offscreen document → background. */
export type OffscreenEvent =
  | { type: 'capture.turn'; turn: TranscriberTurn }
  | { type: 'capture.levels'; levels: Levels }
  | { type: 'capture.status'; side: 'tab' | 'mic'; status: CaptureStatus }
  | { type: 'offscreen.ready' };

/** Background → UI ports. */
export type Broadcast = { type: 'state'; state: SessionState } | { type: 'levels'; levels: Levels } | { type: 'overlay.toggle'; visible: boolean };

export const UI_PORT = 'cue-ui';

export type HealthSummary = { ok: boolean; mubit: boolean; trellus: boolean; message?: string };
export type TrellusStatus = TrellusStatusResponse;
export type TrellusDispositions = TrellusDispositionsResponse;

export function initialState(): SessionState {
  return {
    phase: 'idle',
    callId: null,
    view: null,
    connection: 'live',
    tabId: null,
    capture: { tab: { state: 'off' }, mic: { state: 'off' } },
    micSpeaker: 'rep',
    pendingTurns: 0,
    error: null,
    page: null,
  };
}

/** Sends a request to the background and unwraps the response; never throws for a missing receiver. */
export async function request<T = unknown>(msg: UiRequest): Promise<UiResponse<T>> {
  try {
    const res = (await chrome.runtime.sendMessage(msg)) as UiResponse<T> | undefined;
    return res ?? { ok: false, error: 'Cue did not answer. Reload the extension.' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
