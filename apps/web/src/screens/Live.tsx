import { useStore } from '../state/store';
import { callStore } from '../state/call';
import { CallConsole } from './live/CallConsole';
import { NewCall } from './live/NewCall';

/** The Live dashboard: the new-call composer, or the call console once a call is on. */
export function Live() {
  const hasCall = useStore(callStore, (s) => s.view !== null);
  return (
    <div className="web-screen web-live">{hasCall ? <CallConsole /> : <NewCall />}</div>
  );
}
