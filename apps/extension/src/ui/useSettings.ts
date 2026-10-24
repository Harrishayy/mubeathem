import { useCallback, useEffect, useState } from 'react';
import { loadSettings, updateSettings, watchSettings, type Settings } from '../settings';

/** Settings from chrome.storage, live across every surface. Null until loaded. */
export function useSettings(): [Settings | null, (patch: Partial<Settings>) => Promise<void>] {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    let alive = true;
    void loadSettings().then((s) => alive && setSettings(s));
    const stop = watchSettings((s) => alive && setSettings(s));
    return () => {
      alive = false;
      stop();
    };
  }, []);
  const update = useCallback(async (patch: Partial<Settings>) => {
    setSettings(await updateSettings(patch));
  }, []);
  return [settings, update];
}
