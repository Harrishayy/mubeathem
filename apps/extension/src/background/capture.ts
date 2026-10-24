import type { Speaker } from '@cue/core';
import type { SttCredentials } from '../capture/stt';
import type { CaptureStatus, OffscreenCommand } from '../messages';

const OFFSCREEN_PATH = 'offscreen.html';
let creating: Promise<void> | null = null;

async function hasOffscreen(): Promise<boolean> {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [url] });
  return contexts.length > 0;
}

/** One offscreen document at a time; concurrent callers share the creation. */
export async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: 'Capture the call tab audio and the microphone to transcribe the call for live suggestions.',
    })
    .catch((e: unknown) => {
      // Another caller won the race: that's fine.
      if (!String(e).includes('Only a single offscreen')) throw e;
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}

export async function closeOffscreen(): Promise<void> {
  try {
    if (await hasOffscreen()) await chrome.offscreen.closeDocument();
  } catch {
    /* already closed */
  }
}

/** Maps tabCapture's errors to what the rep can do about them. */
export function tabCaptureError(raw: string): CaptureStatus {
  const s = raw.toLowerCase();
  if (s.includes('not been invoked') || s.includes('activetab') || s.includes('permission')) {
    return { state: 'denied', message: 'Click the Cue icon or press Alt+Shift+C on the call tab so Cue can hear the prospect.' };
  }
  if (s.includes('active stream')) return { state: 'error', message: 'Another extension is already capturing this tab.' };
  if (s.includes('chrome://') || s.includes('cannot capture')) return { state: 'unavailable', message: 'Chrome does not allow capturing this page.' };
  return { state: 'error', message: raw };
}

export function getTabStreamId(tabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
        const err = chrome.runtime.lastError;
        if (err || !id) reject(new Error(err?.message ?? 'No stream id'));
        else resolve(id);
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

function send(cmd: OffscreenCommand): Promise<unknown> {
  return chrome.runtime.sendMessage(cmd);
}

/**
 * Starts capture: the call tab's audio (prospect) and the mic (rep), in the offscreen document.
 * Tab capture failing never blocks the mic, and neither blocks typed turns.
 */
export async function startCapture(
  tabId: number | null,
  callStartedAt: number,
  opts: { stt: () => Promise<SttCredentials | null>; micSpeaker: Speaker },
  report: (side: 'tab' | 'mic', s: CaptureStatus) => void,
): Promise<void> {
  let tabStreamId: string | null = null;
  if (tabId === null) report('tab', { state: 'unavailable', message: 'No call tab. Start Cue from the dialer tab to hear the prospect.' });
  else {
    report('tab', { state: 'starting' });
    try {
      tabStreamId = await getTabStreamId(tabId);
    } catch (e) {
      report('tab', tabCaptureError(e instanceof Error ? e.message : String(e)));
    }
  }
  report('mic', { state: 'starting' });
  const [stt] = await Promise.all([tabStreamId ? opts.stt() : Promise.resolve(null), ensureOffscreen()]);
  await send({ target: 'offscreen', type: 'capture.start', tabStreamId, callStartedAt, mic: true, stt, micSpeaker: opts.micSpeaker });
}

export async function setMicSpeaker(micSpeaker: Speaker): Promise<void> {
  try {
    if (await hasOffscreen()) await send({ target: 'offscreen', type: 'capture.speaker', micSpeaker });
  } catch {
    /* no capture running */
  }
}

export async function stopCapture(): Promise<void> {
  try {
    if (await hasOffscreen()) await send({ target: 'offscreen', type: 'capture.stop' });
  } catch {
    /* the document may already be gone */
  }
  await closeOffscreen();
}
