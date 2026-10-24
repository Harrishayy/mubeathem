import { CueRoot, EmptyState, Sprout } from '@cue/ui';
import { useEffect } from 'react';
import { PipSurface } from '../shell/PipSurface';
import { attachCall } from '../state/call';

/** Fallback pop-out (no Document PiP): a separate window that follows the same call. */
export function PipRoute({ id }: { id: string | null }) {
  useEffect(() => {
    if (id) attachCall(id);
  }, [id]);
  if (!id) {
    return (
      <CueRoot direction="night" className="web-pip">
        <EmptyState art={<Sprout state="idle" size={72} />} title="No call to follow">
          Start a call in the main Cue window, then pop out again.
        </EmptyState>
      </CueRoot>
    );
  }
  return <PipSurface win={null} />;
}
