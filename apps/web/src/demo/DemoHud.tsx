import { MOMENT_META } from '@cue/core';
import { Button, IconButton, Meter, MomentChip, formatMs } from '@cue/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useStore } from '../state/store';
import { uiStore } from '../state/ui';
import { demoStore, dismissDemo, pauseDemo, resumeDemo, stopDemo } from './runner';

const STATUS_COPY: Record<string, string> = {
  starting: 'Starting the call',
  running: 'Demo playing',
  paused: 'Paused',
  debrief: 'Debriefing',
  learning: 'Cue is learning',
  done: 'Demo finished',
  stopped: 'Demo stopped',
  error: 'Demo hit a problem',
};

/** The demo's remote control: progress, pause/stop, and the per-card latencies at the end. */
export function DemoHud() {
  const d = useStore(demoStore);
  const [open, setOpen] = useState(false);
  const pip = useStore(uiStore, (u) => u.pip);
  const playing = d.status === 'running' || d.status === 'paused' || d.status === 'starting';
  // While the call plays, the control rides on the overbar (DemoAccessory); this panel takes over after.
  const visible = d.status !== 'idle' && (!playing || pip);
  const cards = d.timings.filter((t) => t.latencyMs !== null);
  const avg = cards.length ? cards.reduce((a, t) => a + (t.latencyMs ?? 0), 0) / cards.length : null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.aside
          className="web-demo"
          aria-label="Demo controls"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
          data-status={d.status}
        >
          <div className="web-demo__bar">
            <span className={`web-demo__dot is-${d.status}`} aria-hidden />
            <span className="web-demo__label" role="status">
              {STATUS_COPY[d.status]}
              {playing && d.total > 0 && (
                <span className="web-demo__step">
                  {' '}
                  · {d.step}/{d.total}
                </span>
              )}
            </span>
            <span className="web-demo__actions">
              {d.status === 'running' && <IconButton icon="pause" label="Pause the demo" size="sm" onClick={pauseDemo} />}
              {d.status === 'paused' && <IconButton icon="play" label="Resume the demo" size="sm" onClick={resumeDemo} />}
              {cards.length > 0 && <IconButton icon={open ? 'chevron-down' : 'info'} label={open ? 'Hide latencies' : 'Show latencies'} size="sm" onClick={() => setOpen((o) => !o)} />}
              {playing || d.status === 'debrief' || d.status === 'learning' ? (
                <IconButton icon="close" label="Stop the demo" size="sm" onClick={stopDemo} />
              ) : (
                <IconButton icon="close" label="Close" size="sm" onClick={dismissDemo} />
              )}
            </span>
          </div>
          {playing && d.total > 0 && <Meter value={d.step} max={d.total} label="Demo progress" size="sm" />}
          {d.message && d.status !== 'running' && <p className="web-demo__msg">{d.message}</p>}
          {open && cards.length > 0 && (
            <div className="web-demo__lat">
              <p className="web-demo__avg">
                {cards.length} cards · avg {formatMs(avg ?? 0)}
              </p>
              <ol className="web-demo__rows">
                {d.timings.map((t) => (
                  <li key={t.turnId} className={`web-demo__row cue-fam-${t.moment ? MOMENT_META[t.moment].family : 'neutral'}`}>
                    {t.moment ? <MomentChip moment={t.moment} size="sm" iconOnly /> : <span className="web-demo__skip">quiet</span>}
                    <span className="web-demo__text">{t.prospect}</span>
                    <span className="web-demo__ms">{t.latencyMs !== null ? formatMs(t.latencyMs) : t.skipped}</span>
                    {t.servedBy && <span className="web-demo__by">{t.servedBy}</span>}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {d.status === 'error' && (
            <Button size="sm" variant="secondary" onClick={dismissDemo}>
              Close
            </Button>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

/** The demo's progress and pause/stop, attached under the overbar while the call plays. */
export function DemoAccessory() {
  const d = useStore(demoStore);
  const playing = d.status === 'running' || d.status === 'paused' || d.status === 'starting';
  if (!playing) return null;
  return (
    <div className="web-demo-acc" role="group" aria-label="Demo controls">
      <span className={`web-demo__dot is-${d.status}`} aria-hidden />
      <span className="web-demo-acc__label" role="status">
        {d.status === 'paused' ? 'Demo paused' : 'Demo'}
        <span className="web-demo__step">
          {' '}
          {d.step}/{d.total}
        </span>
      </span>
      <span className="web-demo-acc__track" aria-hidden>
        <span className="web-demo-acc__fill" style={{ transform: `scaleX(${d.total ? d.step / d.total : 0})` }} />
      </span>
      {d.status === 'paused' ? <IconButton icon="play" label="Resume the demo" size="sm" onClick={resumeDemo} /> : <IconButton icon="pause" label="Pause the demo" size="sm" onClick={pauseDemo} disabled={d.status === 'starting'} />}
      <IconButton icon="close" label="Stop the demo" size="sm" onClick={stopDemo} />
    </div>
  );
}

/** True while the demo call is playing (the overbar shows DemoAccessory). */
export const demoStoreActive = {
  get: () => ['running', 'paused', 'starting'].includes(demoStore.get().status),
  set: () => {},
  subscribe: demoStore.subscribe,
};
