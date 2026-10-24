import { PRODUCT_LABEL, type Brief } from '@cue/core';
import { useState } from 'react';
import { cx } from '../lib/cx';
import { IconButton } from '../primitives/Button';
import { Chip } from '../primitives/Chip';
import { EmptyState, Skeleton } from '../primitives/Feedback';
import { Icon } from '../primitives/Icon';

export interface BriefViewProps {
  brief: Brief | null;
  loading?: boolean;
  className?: string;
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** The pre-call brief: a summary, three hooks with their source, and a suggested opener. */
export function BriefView({ brief, loading, className }: BriefViewProps) {
  const [copied, setCopied] = useState(false);
  if (loading && !brief)
    return (
      <div className={cx('cue-brief', 'is-loading', className)} aria-busy="true" aria-label="Researching the prospect">
        <Skeleton lines={2} />
        <Skeleton width="80%" />
        <Skeleton width="70%" />
        <p className="cue-brief__loading">Researching the prospect…</p>
      </div>
    );
  if (!brief) return <EmptyState compact title="No brief for this call">Cue researches the company when the dial starts.</EmptyState>;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(brief.opener);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={cx('cue-brief', className)}>
      <p className="cue-brief__summary">{brief.summary}</p>
      <ul className="cue-brief__hooks">
        {brief.hooks.map((h, i) => (
          <li key={i} className="cue-brief__hook">
            <Chip size="sm" tone="accent">
              {PRODUCT_LABEL[h.product]}
            </Chip>
            <span className="cue-brief__hook-text">{h.hook}</span>
            {h.source && (
              <a className="cue-brief__src" href={h.source} target="_blank" rel="noreferrer">
                {host(h.source)}
                <Icon name="external" size={12} />
                <span className="cue-vh"> (opens in a new tab)</span>
              </a>
            )}
          </li>
        ))}
      </ul>
      <div className="cue-brief__opener">
        <div className="cue-brief__opener-head">
          <span className="cue-brief__label">Suggested opener</span>
          <IconButton icon={copied ? 'check' : 'copy'} label={copied ? 'Copied' : 'Copy opener'} size="sm" onClick={copy} />
        </div>
        <p className="cue-brief__opener-text">{brief.opener}</p>
        {brief.servedBy !== 'mubit' && <p className="cue-card__note">{brief.servedBy === 'rules' ? 'Written from CRM facts · model offline' : 'Cached brief'}</p>}
      </div>
    </div>
  );
}
