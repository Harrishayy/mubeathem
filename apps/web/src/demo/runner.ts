import { DEMO_PROSPECT, DEMO_REP, newId, type CallEvent, type CallView, type Moment } from '@cue/core';
import { getApi } from '../state/api';
import { addTurn, callStore, endCall, onCallEvent, startCall } from '../state/call';
import { settingsStore } from '../state/settings';
import { createStore } from '../state/store';
import { uiStore } from '../state/ui';
import { navigate } from '../router';
import { CARD_TIMEOUT_MS, planDemo, READ_MS, type DemoStep } from './plan';

export type DemoStatus = 'idle' | 'starting' | 'running' | 'paused' | 'debrief' | 'learning' | 'done' | 'stopped' | 'error';

export interface CardTiming {
  turnId: string;
  prospect: string;
  /** What the pipeline answered: a card's moment, or why it stayed quiet. */
  moment: Moment | null;
  skipped: string | null;
  /** Server-measured, prospect finishing → card ready. */
  latencyMs: number | null;
  /** Client-measured, final turn posted → card on screen. */
  wallMs: number | null;
  servedBy: string | null;
}

export interface DemoState {
  status: DemoStatus;
  step: number;
  total: number;
  callId: string | null;
  timings: CardTiming[];
  message: string | null;
}

export const demoStore = createStore<DemoState>({ status: 'idle', step: 0, total: 0, callId: null, timings: [], message: null });

class Stopped extends Error {}

let token = 0;
let paused = false;
let resumeWaiters: (() => void)[] = [];

const isActive = (t: number) => t === token;

/** Sleep that honours pause and stop. Paused time doesn't count. */
async function wait(ms: number, t: number): Promise<void> {
  let left = ms;
  while (left > 0) {
    if (!isActive(t)) throw new Stopped();
    if (paused) {
      await new Promise<void>((r) => resumeWaiters.push(r));
      continue;
    }
    const slice = Math.min(left, 100);
    await new Promise((r) => setTimeout(r, slice));
    left -= slice;
  }
  if (!isActive(t)) throw new Stopped();
}

/** Resolves with the first event the predicate accepts, or null after `ms`. */
function waitForEvent<T>(pick: (e: CallEvent, v: CallView) => T | null, ms: number, t: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(null), ms);
    const iv = setInterval(() => !isActive(t) && done(null), 200);
    const off = onCallEvent((e, v) => {
      const hit = pick(e, v);
      if (hit !== null) done(hit);
    });
    function done(x: T | null) {
      clearTimeout(timer);
      clearInterval(iv);
      off();
      resolve(x);
    }
  });
}

function patch(p: Partial<DemoState>) {
  demoStore.set((s) => ({ ...s, ...p }));
}

export function pauseDemo(): void {
  if (demoStore.get().status !== 'running') return;
  paused = true;
  patch({ status: 'paused' });
}

export function resumeDemo(): void {
  if (!paused) return;
  paused = false;
  const w = resumeWaiters;
  resumeWaiters = [];
  for (const r of w) r();
  patch({ status: 'running' });
}

export function stopDemo(): void {
  token++;
  resumeDemo();
  const s = demoStore.get().status;
  if (s !== 'idle' && s !== 'done' && s !== 'error') patch({ status: 'stopped', message: 'Demo stopped' });
}

export function dismissDemo(): void {
  stopDemo();
  demoStore.set({ status: 'idle', step: 0, total: 0, callId: null, timings: [], message: null });
}

async function playStep(step: DemoStep, callId: string, t: number, speed: number): Promise<void> {
  const { line } = step;
  await wait(step.gapMs, t);
  const id = newId('turn');
  const started = callStore.get().view?.startedAt ?? Date.now();
  const tMs = Math.max(0, Date.now() - started);
  if (step.interim) {
    await wait(Math.round(step.speakMs / 2), t);
    addTurn({ id, speaker: line.speaker, text: step.interim, final: false, tMs, via: 'demo' });
    await wait(step.speakMs - Math.round(step.speakMs / 2), t);
  } else {
    await wait(step.speakMs, t);
  }

  // Listen before posting so a fast rules card can't slip past.
  const answer = step.waitForCard
    ? waitForEvent<{ kind: 'shown' | 'skipped'; e: CallEvent }>(
        (e) =>
          e.type === 'suggestion.shown' && e.suggestion.turnId === id
            ? { kind: 'shown', e }
            : e.type === 'suggestion.skipped' && e.turnId === id
              ? { kind: 'skipped', e }
              : null,
        CARD_TIMEOUT_MS,
        t,
      )
    : null;
  const postedAt = performance.now();
  addTurn({ id, speaker: line.speaker, text: line.text, final: true, tMs, durMs: step.speakMs, via: 'demo' });

  if (answer) {
    const got = await answer;
    if (!isActive(t)) throw new Stopped();
    const wallMs = got ? Math.round(performance.now() - postedAt) : null;
    const timing: CardTiming = { turnId: id, prospect: line.text, moment: null, skipped: null, latencyMs: null, wallMs, servedBy: null };
    if (got?.kind === 'shown' && got.e.type === 'suggestion.shown') {
      const s = got.e.suggestion;
      Object.assign(timing, { moment: s.situation.moment, latencyMs: s.latencyMs, servedBy: s.servedBy });
    } else if (got?.kind === 'skipped' && got.e.type === 'suggestion.skipped') {
      timing.skipped = got.e.reason;
    } else {
      timing.skipped = 'no answer in time';
    }
    patch({ timings: [...demoStore.get().timings, timing] });
    if (got?.kind === 'shown') await wait(Math.round(READ_MS / speed), t);
  } else if (line.speaker === 'rep' && line.expect === 'compliance') {
    // Let the compliance card land and be seen.
    await waitForEvent((e) => (e.type === 'suggestion.shown' && e.suggestion.kind === 'compliance' ? true : null), 6_000, t);
    await wait(Math.round(READ_MS / speed), t);
  }
  void callId;
}

/**
 * Hands-free demo (context.md §11): starts a call for the demo prospect against the real server, says
 * every line of DEMO_SCRIPT at speaking pace, books the meeting, submits the debrief and shows the
 * playbook learning. Identical every run.
 */
export async function runDemo(): Promise<void> {
  const t = ++token;
  paused = false;
  const { demoVariant, demoSpeed, demoHandsFree, repName, repId } = settingsStore.get();
  const steps = planDemo(demoVariant, demoSpeed);
  demoStore.set({ status: 'starting', step: 0, total: steps.length, callId: null, timings: [], message: null });
  try {
    navigate({ name: 'live' });
    const view = await startCall({
      source: 'cue',
      prospect: DEMO_PROSPECT,
      rep: { id: repId || DEMO_REP.id, name: repName || DEMO_REP.name, tenureDays: DEMO_REP.tenureDays },
    });
    patch({ callId: view.id, status: 'running' });
    uiStore.set((u) => ({ ...u, overbar: 'expanded' }));
    // Let the brief land: the demo opens on it.
    await waitForEvent((e) => (e.type === 'brief.ready' ? true : null), Math.round(4_000 / demoSpeed), t);
    await wait(Math.round(1_600 / demoSpeed), t);

    for (const step of steps) {
      patch({ step: step.index + 1 });
      await playStep(step, view.id, t, demoSpeed);
    }

    await wait(Math.round(1_200 / demoSpeed), t);
    const ended = await endCall('meeting_booked');
    if (!isActive(t)) return;
    patch({ status: 'debrief' });
    navigate({ name: 'debrief', id: view.id });
    if (!demoHandsFree) {
      patch({ status: 'done', message: 'Call booked. Fill in the debrief to teach Cue.' });
      return;
    }
    await wait(Math.round(3_200 / demoSpeed), t);
    const v = callStore.get().view ?? ended;
    const helpful = (v?.history ?? []).filter((h) => h.action === 'used' || h.action === 'thumbs_up' || h.action === 'edited').map((h) => h.suggestion.id);
    await getApi().feedback(view.id, {
      outcome: 'meeting_booked',
      rating: 5,
      attitude: 'curious',
      whatWorked: 'Owning the cold "what\'s this regarding?" with the self-aware line, then asking for the meeting on the price question.',
      whatDidnt: 'Nearly promised cover before underwriting.',
      helpful,
      unhelpful: [],
    });
    patch({ status: 'learning' });
    await waitForEvent((e) => (e.type === 'playbook.updated' || e.type === 'review.completed' ? true : null), 25_000, t);
    await waitForEvent((e) => (e.type === 'playbook.updated' ? true : null), 4_000, t);
    await wait(Math.round(4_500 / demoSpeed), t);
    navigate({ name: 'playbook' });
    patch({ status: 'done', message: 'The lines you used just got their win.' });
  } catch (e) {
    if (e instanceof Stopped) return;
    if (isActive(t)) patch({ status: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}
