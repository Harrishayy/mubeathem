import { MOMENT_META, type UpNext } from '@cue/core';
import { cx } from '../lib/cx';

export interface UpNextListProps {
  items: UpNext[];
  className?: string;
}

/** Strips quotes the text may already carry; the <q> adds curly ones. */
function unquote(text: string): string {
  return text.trim().replace(/^["“'‘]+|["”'’]+$/g, '');
}

/**
 * Standby: the two or three likeliest next things the prospect says, and the move for each. Set as a
 * two-column table (if they say / you) with a moment key in the margin, so the rep can read across.
 */
export function UpNextList({ items, className }: UpNextListProps) {
  if (items.length === 0) return null;
  return (
    <section className={cx('cue-upnext', className)} aria-label="Up next">
      <h3 className="cue-upnext__head">
        <span className="cue-label cue-upnext__title">Standby · if they say</span>
        <span className="cue-label cue-upnext__you" aria-hidden>
          You
        </span>
      </h3>
      <ul className="cue-upnext__list">
        {items.map((it, i) => {
          const meta = MOMENT_META[it.moment];
          return (
            <li key={`${it.ifTheySay}-${i}`} className={cx('cue-upnext__item', `cue-fam-${meta.family}`)} style={{ '--i': i } as React.CSSProperties}>
              <i className="cue-upnext__key" title={meta.label} aria-hidden />
              <q className="cue-upnext__say">{unquote(it.ifTheySay)}</q>
              <span className="cue-upnext__move">
                <span className="cue-vh">then </span>
                {it.move}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
