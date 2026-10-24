import { useCallback, useEffect, useRef, useState } from 'react';

export interface Resource<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Load something from the server, optionally re-polling. Keeps the last good data on a failed poll so
 * the screen doesn't flash, and stops polling while the tab is hidden.
 */
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[], pollMs?: number): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = async () => {
      try {
        const d = await loadRef.current(ctrl.signal);
        if (ctrl.signal.aborted) return;
        setData(d);
        setError(null);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (!ctrl.signal.aborted) {
          setLoading(false);
          if (pollMs) schedule();
        }
      }
    };
    const schedule = () => {
      timer = setTimeout(() => (document.hidden ? schedule() : void run()), pollMs);
    };
    setLoading(true);
    void run();
    return () => {
      ctrl.abort();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, pollMs, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}
