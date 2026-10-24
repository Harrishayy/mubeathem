import type { CallView } from '@cue/core';
import { useMemo, useState } from 'react';
import { Button, Icon, Overbar, type Connection, type OverbarMode } from '../src';
import { VIEWS, type ViewName } from '../src/fixtures/views';
import type { Playback } from './playback';
import type { GalleryState } from './state';

export function pickView(name: string, stress: boolean): CallView | null {
  if (name === 'none') return null;
  if (stress) return VIEWS.stress();
  const fn = VIEWS[name as ViewName];
  return fn ? fn() : VIEWS.cold();
}

function connectionFor(name: string): Connection {
  return name === 'offline' ? 'offline' : name === 'reconnecting' ? 'reconnecting' : 'live';
}

/** A stand-in for the page Cue floats over (a CRM contact record). Only gallery chrome. */
function HostPage({ compact }: { compact?: boolean }) {
  return (
    <div className={`g-host${compact ? ' g-host--compact' : ''}`} aria-hidden>
      <div className="g-host__nav">
        <span className="g-host__logo" />
        <span className="g-host__pill" />
        <span className="g-host__pill" />
        <span className="g-host__pill g-host__pill--short" />
      </div>
      <div className="g-host__body">
        <aside className="g-host__side">
          <span className="g-host__avatar" />
          <span className="g-host__line g-host__line--strong" />
          <span className="g-host__line" />
          <span className="g-host__btn" />
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="g-host__line" style={{ width: `${60 + ((i * 17) % 35)}%` }} />
          ))}
        </aside>
        <section className="g-host__main">
          <span className="g-host__line g-host__line--title" />
          {Array.from({ length: compact ? 5 : 9 }, (_, i) => (
            <div key={i} className="g-host__row">
              <span className="g-host__dot" />
              <span className="g-host__line" style={{ width: `${40 + ((i * 23) % 50)}%` }} />
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

/** Full-viewport scenes used for screenshots and the e2e checks. */
export function Scene({ state: s, playback, onMode }: { state: GalleryState; playback: Playback; onMode: (m: OverbarMode) => void }) {
  const fixture = useMemo(() => pickView(s.view, s.stress), [s.view, s.stress]);
  const view = s.play ? playback.view : fixture;
  const connection = connectionFor(s.view);
  const [last, setLast] = useState<string | null>(null);
  const common = {
    view,
    connection,
    mode: s.mode,
    onModeChange: onMode,
    onAction: (id: string, a: string) => setLast(`${a} · ${id}`),
    onEnd: () => setLast('end'),
    onOpenSettings: () => setLast('settings'),
    voiceLevel: s.play ? playback.voiceLevel : 0.45,
    now: s.play ? playback.now : undefined,
    accessory: new URLSearchParams(location.search).get('accessory') ? (
      <div className="g-acc" role="status">
        <Icon name="mic-off" size={16} />
        <span>Cue isn't listening to this tab yet.</span>
        <Button size="sm" variant="primary" icon="mic">
          Start Cue
        </Button>
      </div>
    ) : undefined,
  };

  if (s.scene === 'panel')
    return (
      <div className="g-panel-scene" data-testid="scene-panel">
        <Overbar {...common} placement="inline" mode={s.mode} drawers={{ brief: true }} />
      </div>
    );

  return (
    <div className="g-scene" data-testid={`scene-${s.scene}`}>
      <HostPage compact={s.scene === 'sheet'} />
      <Overbar {...common} placement={s.scene === 'sheet' ? 'sheet' : 'top'} />
      {s.play && (
        <div className="g-scene__controls">
          <Button size="sm" variant="secondary" icon={playback.playing ? 'pause' : 'play'} onClick={playback.playing ? playback.pause : playback.play}>
            {playback.playing ? 'Pause' : 'Play'}
          </Button>
        </div>
      )}
      <output className="cue-vh" data-testid="last-action">
        {last}
      </output>
    </div>
  );
}
