import { useId } from 'react';
import { cx } from '../lib/cx';

export interface MeterProps {
  value: number;
  max?: number;
  label: string;
  /** Visible text after the bar, e.g. "18 / 25". Defaults to none. */
  valueText?: string;
  showLabel?: boolean;
  tone?: 'accent' | 'ok' | 'warn' | 'bad' | 'moment';
  size?: 'sm' | 'md';
  className?: string;
}

/** A bounded value as a bar. role="meter" with a text value, so it never relies on colour. */
export function Meter({ value, max = 1, label, valueText, showLabel = false, tone = 'accent', size = 'md', className }: MeterProps) {
  const id = useId();
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className={cx('cue-meter', `cue-meter--${tone}`, `cue-meter--${size}`, className)}>
      {showLabel && (
        <span className="cue-meter__label" id={id}>
          {label}
        </span>
      )}
      <div
        className="cue-meter__track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueText}
        aria-label={showLabel ? undefined : label}
        aria-labelledby={showLabel ? id : undefined}
      >
        <span className="cue-meter__fill" style={{ transform: `scaleX(${pct / 100})` }} />
      </div>
      {valueText && <span className="cue-meter__value">{valueText}</span>}
    </div>
  );
}

export interface SparklineProps {
  values: number[];
  /** Value range; defaults to the data's min/max. */
  min?: number;
  max?: number;
  width?: number;
  height?: number;
  label: string;
  /** Draw a zero line (useful for -1..1 receptivity). */
  baseline?: number;
  /** Hide from assistive tech when surrounding text already says the trend. */
  decorative?: boolean;
  className?: string;
}

/** Tiny trend line with an end dot. Decorative unless labelled; the label carries the meaning. */
export function Sparkline({ values, min, max, width = 64, height = 20, label, baseline, decorative, className }: SparklineProps) {
  const pad = 2.5;
  const lo = min ?? Math.min(...values, 0);
  const hi = max ?? Math.max(...values, 1);
  const span = hi - lo || 1;
  const pts = values.length === 1 ? [values[0]!, values[0]!] : values;
  const x = (i: number) => pad + (i / Math.max(1, pts.length - 1)) * (width - pad * 2);
  const y = (v: number) => pad + (1 - (v - lo) / span) * (height - pad * 2);
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const last = pts.length - 1;
  return (
    <svg className={cx('cue-spark', className)} viewBox={`0 0 ${width} ${height}`} width={width} height={height} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : label} aria-hidden={decorative || undefined}>
      {baseline !== undefined && <line className="cue-spark__base" x1={pad} x2={width - pad} y1={y(baseline)} y2={y(baseline)} />}
      {values.length > 0 && (
        <>
          <path className="cue-spark__area" d={`${d} L${x(last).toFixed(1)} ${height - pad} L${pad} ${height - pad} Z`} />
          <path className="cue-spark__line" d={d} />
          <circle className="cue-spark__dot" cx={x(last)} cy={y(pts[last]!)} r={2.2} />
        </>
      )}
    </svg>
  );
}
