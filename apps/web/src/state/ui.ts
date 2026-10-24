import type { ToastData } from '@cue/ui';
import { createStore } from './store';

export interface UiState {
  overbar: 'collapsed' | 'expanded';
  /** The overbar is showing in a pop-out window. */
  pip: boolean;
  toasts: ToastData[];
  /** Line ids the playbook should highlight (just updated by a review). */
  highlightLines: string[];
  /** The call whose debrief is open in the modal, over whatever screen the rep is on. */
  debrief: string | null;
}

export const uiStore = createStore<UiState>({ overbar: 'collapsed', pip: false, toasts: [], highlightLines: [], debrief: null });

/** Open the debrief for a call as a modal on the current screen (never a page change). */
export function openDebrief(callId: string): void {
  uiStore.set((u) => (u.debrief === callId ? u : { ...u, debrief: callId, overbar: 'collapsed' }));
}

export function closeDebrief(): void {
  uiStore.set((u) => (u.debrief === null ? u : { ...u, debrief: null }));
}

let n = 0;
export function toast(t: Omit<ToastData, 'id'>): void {
  const id = `t${++n}`;
  uiStore.set((u) => ({ ...u, toasts: [...u.toasts.slice(-2), { ...t, id }] }));
}

export function dismissToast(id: string): void {
  uiStore.set((u) => ({ ...u, toasts: u.toasts.filter((x) => x.id !== id) }));
}

export function setOverbar(mode: UiState['overbar']): void {
  uiStore.set((u) => (u.overbar === mode ? u : { ...u, overbar: mode }));
}
