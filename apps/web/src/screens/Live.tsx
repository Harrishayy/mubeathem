import { useStore } from '../state/store';
import { callStore } from '../state/call';
import { CallConsole } from './live/CallConsole';
import { NewCall } from './live/NewCall';

/** The overbar (rendered globally) over a calm backdrop: the composer, or the call console. */
export function Live() {
  const hasCall = useStore(callStore, (s) => s.view !== null);
  return (
    <div className="web-screen web-live">
      <div className="web-backdrop" aria-hidden />
      {hasCall ? <CallConsole /> : <NewCall />}
    </div>
  );
}
