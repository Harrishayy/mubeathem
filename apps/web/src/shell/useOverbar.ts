import type { OverbarProps, SuggestionCardHandle } from '@cue/ui';
import { useCallback, useRef } from 'react';
import { levelStore } from '../capture/level';
import { useHotkeys } from '../hooks/useHotkeys';
import { navigate } from '../router';
import { callStore, endCall, sendAction } from '../state/call';
import { settingsStore } from '../state/settings';
import { useStore } from '../state/store';
import { setOverbar, toast, uiStore } from '../state/ui';

export async function endAndDebrief(outcome?: Parameters<typeof endCall>[0]): Promise<void> {
  const id = callStore.get().callId;
  if (!id) return;
  try {
    await endCall(outcome);
    navigate({ name: 'debrief', id });
  } catch (e) {
    toast({ tone: 'bad', title: 'Could not end the call', description: e instanceof Error ? e.message : String(e) });
  }
}

/** Overbar props bound to the stores, plus the live-call shortcuts (⌘/Ctrl+. U D E B Esc). */
export function useOverbar(opts: { win?: Window | null; hotkeys?: boolean } = {}): Omit<OverbarProps, 'placement'> {
  const { view, connection } = useStore(callStore);
  const mode = useStore(uiStore, (u) => u.overbar);
  const voiceLevel = useStore(levelStore);
  const debug = useStore(settingsStore, (s) => s.debug);
  // The card on screen; shortcuts go through it so its own state (Used, the editor) stays in step.
  const card = useRef<SuggestionCardHandle | null>(null);

  const onAction = useCallback<OverbarProps['onAction']>((sid, action, text) => void sendAction(sid, action, text), []);
  const live = view?.status === 'live';
  const current = live ? view?.current ?? null : null;

  useHotkeys(
    {
      'mod+.': () => setOverbar(uiStore.get().overbar === 'expanded' ? 'collapsed' : 'expanded'),
      escape: () => setOverbar('collapsed'),
      u: () => current && (card.current ? card.current.use() : void sendAction(current.id, 'used')),
      d: () => current && (card.current ? card.current.dismiss() : void sendAction(current.id, 'dismissed')),
      e: () => {
        if (!current || current.kind === 'compliance') return;
        if (card.current) return card.current.edit();
        setOverbar('expanded');
        // The card mounts on expand; open its editor once it has.
        requestAnimationFrame(() => requestAnimationFrame(() => card.current?.edit()));
      },
      b: () => live && void endAndDebrief('meeting_booked'),
    },
    opts.hotkeys !== false && !!view,
    [opts.win],
  );

  return {
    view,
    connection,
    mode,
    onModeChange: setOverbar,
    onAction,
    onEnd: () => void endAndDebrief(),
    onOpenSettings: () => navigate({ name: 'settings' }),
    voiceLevel,
    cardRef: card,
    debug,
  };
}
