import type { SuggestionCardHandle } from '@cue/ui';
import { useEffect, type RefObject } from 'react';

/** U used · D dismiss · E edit · + / - thumbs. Never while typing, never with modifiers. */
export const CARD_KEYS: Record<string, keyof SuggestionCardHandle> = { u: 'use', d: 'dismiss', e: 'edit', '+': 'thumbsUp', '=': 'thumbsUp', '-': 'thumbsDown' };

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

/**
 * Drives the card on screen from the keyboard. `scope` is where keys are heard: the side panel's
 * document, or the overlay's shadow root (so typing on the CRM page never triggers Cue).
 */
export function useCardShortcuts(ref: RefObject<SuggestionCardHandle | null>, scope: () => Document | ShadowRoot | null, enabled = true) {
  useEffect(() => {
    const target = scope();
    if (!enabled || !target) return;
    const onKey = (e: Event) => {
      const k = e as KeyboardEvent;
      if (k.altKey || k.ctrlKey || k.metaKey || k.repeat) return;
      const composed = k.composedPath()[0] ?? k.target;
      if (isTyping(composed)) return;
      const action = CARD_KEYS[k.key.toLowerCase()];
      const card = ref.current;
      if (!action || !card) return;
      k.preventDefault();
      card[action]();
    };
    target.addEventListener('keydown', onKey);
    return () => target.removeEventListener('keydown', onKey);
  }, [ref, scope, enabled]);
}
