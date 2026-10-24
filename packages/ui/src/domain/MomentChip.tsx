import { MOMENT_META, type Moment } from '@cue/core';
import { cx } from '../lib/cx';

export interface MomentChipProps {
  moment: Moment;
  size?: 'sm' | 'md';
  /** Key only (the label stays available to assistive tech and as a tooltip). */
  iconOnly?: boolean;
  /** Use the tightest whole-word label (for the collapsed bar). Never truncates mid-word. */
  fit?: boolean;
  className?: string;
}

/** Typographer's quotes for taxonomy labels written with straight ones. */
export function smartQuotes(text: string): string {
  return text.replace(/"([^"]*)"/g, '“$1”').replace(/'/g, '’');
}

/** Tighter whole-word labels where the taxonomy's short label is still long or clipped. */
const FIT_LABEL: Partial<Record<Moment, string>> = {
  whats_this_regarding: 'Regarding?',
  brush_off_email: 'Email me',
  objection_broker: 'Broker',
  objection_not_interested: 'Not keen',
  buying_signal: 'Buying',
};

/**
 * A moment label split the way a prompt book writes it: the kind in margin capitals, and what the
 * prospect said (when the moment is a phrase) in quotes. `Objection: "we have a broker"` becomes
 * kind "Objection", said "we have a broker"; `Objection: price` becomes kind "Objection", detail
 * "price"; `"What's this regarding?"` is said only.
 */
export function momentParts(moment: Moment): { kind: string | null; said: string | null; detail: string | null } {
  const label = MOMENT_META[moment].label;
  const quoted = /^(?:([^:"]+):\s*)?"(.+)"$/.exec(label);
  if (quoted) return { kind: quoted[1]?.trim() ?? null, said: smartQuotes(quoted[2]!), detail: null };
  const plain = /^([^:]+):\s*(.+)$/.exec(label);
  if (plain) return { kind: plain[1]!.trim(), said: null, detail: plain[2]!.trim() };
  return { kind: label, said: null, detail: null };
}

/**
 * The moment, keyed by a small square in its family colour. `md` is the slug-line form (kind in
 * capitals, the phrase in quotes); `sm` and `fit` are one short word for tight spaces.
 */
export function MomentChip({ moment, size = 'md', iconOnly, fit, className }: MomentChipProps) {
  const meta = MOMENT_META[moment];
  const title = smartQuotes(meta.label);
  const cls = cx('cue-moment', `cue-moment--${size}`, fit && 'is-fit', `cue-fam-${meta.family}`, iconOnly && 'is-icon-only', className);
  if (iconOnly || fit || size === 'sm') {
    const text = smartQuotes(fit ? FIT_LABEL[moment] ?? meta.short : meta.short);
    return (
      <span className={cls} title={title}>
        <i className="cue-moment__key" aria-hidden />
        <span className={cx('cue-moment__kind', iconOnly && 'cue-vh')}>{iconOnly ? title : text}</span>
      </span>
    );
  }
  const p = momentParts(moment);
  return (
    <span className={cls} title={title}>
      <i className="cue-moment__key" aria-hidden />
      {p.kind && <span className="cue-moment__kind">{p.kind}</span>}
      {p.detail && <span className="cue-moment__kind cue-moment__detail">{p.detail}</span>}
      {p.said && <q className="cue-moment__said">{p.said.replace(/^“|”$/g, '')}</q>}
    </span>
  );
}
