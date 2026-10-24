import { ErrorState, KeyValue, Skeleton } from '@cue/ui';
import { useCallback, useEffect, useState } from 'react';
import { request, type CallSummary } from '../../src/messages';
import { ago, outcomeWords } from '../../src/ui/format';

/** The review's findings and the rep's own words can repeat each other; show each once. */
function unique(xs: string[] | undefined): string[] {
  const seen = new Set<string>();
  return (xs ?? []).filter((x) => {
    const k = x.trim().toLowerCase().replace(/[.!]+$/, '');
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

type Load = { state: 'loading' } | { state: 'ok'; calls: CallSummary[] } | { state: 'error'; message: string };

/** This contact's previous calls (newest first), without the call on screen now. */
export function useContactHistory(contactId: string | null | undefined, excludeCallId?: string | null): { load: Load; retry: () => void } {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!contactId) return;
    let live = true;
    setLoad({ state: 'loading' });
    void request<CallSummary[]>({ type: 'contacts.history', contactId, limit: 4 }).then((res) => {
      if (!live) return;
      setLoad(res.ok ? { state: 'ok', calls: res.data.filter((c) => c.id !== excludeCallId).slice(0, 3) } : { state: 'error', message: res.error });
    });
    return () => {
      live = false;
    };
  }, [contactId, excludeCallId, tick]);
  return { load, retry: useCallback(() => setTick((t) => t + 1), []) };
}

/**
 * "Last time": how the previous call with this person went (outcome, when, what went well and what
 * didn't, Cue's review), then one line for each call before that.
 */
export function LastTime({ contactId, excludeCallId, first }: { contactId: string; excludeCallId?: string | null; first: string }) {
  const { load, retry } = useContactHistory(contactId, excludeCallId);
  if (load.state === 'loading')
    return (
      <div className="sp-pad" aria-busy="true">
        <Skeleton lines={3} />
      </div>
    );
  if (load.state === 'error') return <ErrorState compact title="Couldn't load past calls" message={load.message} onRetry={retry} className="sp-pad" />;
  const [last, ...earlier] = load.calls;
  if (!last) return <p className="sp-empty">This is your first call with {first}. Cue will remember how it goes.</p>;
  const well = unique(last.wentWell);
  const badly = unique(last.wentBadly);
  return (
    <div className="sp-last">
      <KeyValue
        items={[
          { label: 'When', value: `${ago(last.startedAt)} · ${new Date(last.startedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` },
          { label: 'Outcome', value: outcomeWords(last.outcome) ?? 'Not recorded' },
          ...(last.rating ? [{ label: 'How it felt', value: `${last.rating} of 5` }] : []),
          ...(last.rep?.name ? [{ label: 'Called by', value: last.rep.name }] : []),
        ]}
      />
      {last.reviewSummary && <p className="sp-last__review">{last.reviewSummary}</p>}
      {well.length > 0 && (
        <div className="sp-last__group">
          <span className="cue-label">Went well</span>
          <ul className="sp-list">
            {well.slice(0, 3).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {badly.length > 0 && (
        <div className="sp-last__group">
          <span className="cue-label">Didn't land</span>
          <ul className="sp-list">
            {badly.slice(0, 3).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {earlier.length > 0 && (
        <div className="sp-last__group">
          <span className="cue-label">Before that</span>
          <ul className="sp-last__earlier">
            {earlier.map((c) => (
              <li key={c.id}>
                <span className="cue-num">{new Date(c.startedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span> {outcomeWords(c.outcome) ?? 'No outcome'}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
