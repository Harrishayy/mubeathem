import type { ToastData } from '@cue/ui';
import { createStore } from './store';

export interface UiState {
  overbar: 'collapsed' | 'expanded';
  /** The overbar is showing in a pop-out window. */
  pip: boolean;
  toasts: ToastData[];
  /** Line ids the playbook should highlight (just updated by a review). */
  highlightLines: string[];
}

export const uiStore = createStore<UiState>({ overbar: 'collapsed', pip: false, toasts: [], highlightLines: [] });

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
