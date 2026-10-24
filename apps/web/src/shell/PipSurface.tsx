import { CueRoot, Overbar } from '@cue/ui';
import { useEffect } from 'react';
import { bindSpaceToTalk } from '../capture/speaker';
import { fitPip } from '../pip';
import { settingsStore } from '../state/settings';
import { useStore } from '../state/store';
import { uiStore } from '../state/ui';
import { useOverbar } from './useOverbar';

/** What the pop-out window renders: the inline overbar for the current call, nothing else. */
export function PipSurface({ win }: { win: Window | null }) {
  const s = useStore(settingsStore);
  const props = useOverbar({ win, hotkeys: true });
  const mode = useStore(uiStore, (u) => u.overbar);
  useEffect(() => (win ? bindSpaceToTalk(win) : undefined), [win]);
  useEffect(() => {
    if (win) fitPip(mode);
  }, [mode, win]);
  // Night Shift reads best floating over other apps; honour an explicit Signal choice.
  const direction = s.direction === 'signal' ? 'signal' : 'night';
  return (
    <CueRoot direction={direction} theme={s.theme} density={s.density} className="web-pip">
      <Overbar {...props} placement="inline" drawers={{ transcript: false }} />
    </CueRoot>
  );
}
