import type { Turn } from '@cue/core';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cx } from '../lib/cx';
import { formatDuration } from '../lib/core';
import { Button } from '../primitives/Button';
import { EmptyState } from '../primitives/Feedback';
import { ScrollArea } from '../primitives/ScrollArea';

export interface TranscriptViewProps {
  turns: Turn[];
  interim?: Turn | null;
  highlightTurnId?: string;
  /** Keep the newest turn in view while the reader is at the bottom. */
  follow?: boolean;
  /** Speaker names; defaults to "You" and "Prospect". */
  names?: { rep?: string; prospect?: string };
  maxHeight?: number | string;
  className?: string;
}

/**
 * The live transcript, speaker-labelled. Follows new turns unless the reader has scrolled up, in
 * which case a "Jump to latest" button appears. Interim speech is shown dimmed until it is final.
 */
export function TranscriptView({ turns, interim, highlightTurnId, follow = true, names, maxHeight = 320, className }: TranscriptViewProps) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const all = interim && !turns.some((t) => t.id === interim.id) ? [...turns, interim] : turns;
  const last = all.at(-1);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && follow && atBottom) el.scrollTop = el.scrollHeight;
  }, [last?.id, last?.text, follow, atBottom]);

  useEffect(() => {
    if (!highlightTurnId) return;
    scroller.current?.querySelector(`[data-turn="${CSS.escape(highlightTurnId)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [highlightTurnId]);

  if (all.length === 0) return <EmptyState compact title="Nothing said yet">The transcript appears here as the call is heard.</EmptyState>;

  return (
    <div className={cx('cue-transcript', className)}>
      <ScrollArea
        ref={scroller}
        maxHeight={maxHeight}
        label="Transcript"
        onScroll={(el) => setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 24)}
      >
        <ol className="cue-transcript__list" aria-live="off">
          {all.map((t) => (
            <li
              key={t.id}
              data-turn={t.id}
              className={cx('cue-turn', `cue-turn--${t.speaker}`, !t.final && 'is-interim', t.id === highlightTurnId && 'is-highlight')}
            >
              <span className="cue-turn__who">{t.speaker === 'rep' ? names?.rep ?? 'You' : names?.prospect ?? 'Prospect'}</span>
              <span className="cue-turn__time">{formatDuration(t.tMs)}</span>
              <p className="cue-turn__text">
                {t.text}
                {!t.final && <span className="cue-turn__more" aria-label="still speaking" />}
              </p>
            </li>
          ))}
        </ol>
      </ScrollArea>
      {!atBottom && follow && (
        <Button
          size="sm"
          variant="secondary"
          iconEnd="chevron-down"
          className="cue-transcript__jump"
          onClick={() => {
            const el = scroller.current;
            if (el) el.scrollTop = el.scrollHeight;
            setAtBottom(true);
          }}
        >
          Jump to latest
        </Button>
      )}
    </div>
  );
}
