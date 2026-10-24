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

const VIA_LABEL: Record<string, string> = { exa: 'Exa', valyu: 'Valyu', crm: 'CRM', web: 'Web', manual: 'You', fixture: 'Sample' };
/** "Exa", "Valyu", "CRM": where a hook or source came from, in a word. */
export function viaLabel(via: string | undefined | null): string | null {
  if (!via) return null;
  return VIA_LABEL[via] ?? via.charAt(0).toUpperCase() + via.slice(1);
}

function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

function dateLabel(s: string | null): string | null {
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return s;
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(t);
}

/**
 * The pre-call brief: a summary, hooks with where each came from (Exa, Valyu, CRM; linked to the page
 * when there is one), a suggested opener, and a collapsible list of every source the research read.
 */
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
        {brief.hooks.map((h, i) => {
          const url = safeUrl(h.url) ?? safeUrl(h.source);
          const via = viaLabel(h.via);
          return (
            <li key={i} className="cue-brief__hook">
              <Chip size="sm" tone="accent">
                {PRODUCT_LABEL[h.product]}
              </Chip>
              {url ? (
                <a className="cue-brief__hook-text cue-brief__hook-link" href={url} target="_blank" rel="noopener noreferrer">
                  {h.hook}
                  <span className="cue-vh"> (opens in a new tab)</span>
                </a>
              ) : (
                <span className="cue-brief__hook-text">{h.hook}</span>
              )}
              {(via || url) && (
                <span className="cue-brief__prov">
                  {via && <span className="cue-brief__via" title={`Found by ${via}`}>{via}</span>}
                  {url && (
                    <span className="cue-brief__src">
                      {host(url)}
                      <Icon name="external" size={12} />
                    </span>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="cue-brief__opener">
        <div className="cue-brief__opener-head">
          <span className="cue-brief__label">Suggested opener</span>
          <IconButton icon={copied ? 'check' : 'copy'} label={copied ? 'Copied' : 'Copy opener'} size="sm" onClick={copy} />
        </div>
        <p className="cue-brief__opener-text">{brief.opener}</p>
        {brief.servedBy !== 'mubit' && <p className="cue-card__note">{brief.servedBy === 'rules' ? 'Written from saved details only (the model was offline)' : 'Saved brief from earlier'}</p>}
      </div>
      {brief.sources && brief.sources.length > 0 && (
        <details className="cue-brief__sources">
          <summary className="cue-brief__sources-head">
            <Icon name="chevron" size={14} className="cue-brief__sources-chev" />
            <span>Where this came from</span>
            <span className="cue-brief__sources-n">{brief.sources.length}</span>
          </summary>
          <ul className="cue-brief__sources-list">
            {brief.sources.map((src, i) => {
              const url = safeUrl(src.url);
              const via = viaLabel(src.via);
              const date = dateLabel(src.publishedAt);
              return (
                <li key={i} className="cue-brief__source">
                  {url ? (
                    <a href={url} target="_blank" rel="noopener noreferrer" className="cue-brief__source-title">
                      {src.title || host(url)}
                      <Icon name="external" size={12} />
                      <span className="cue-vh"> (opens in a new tab)</span>
                    </a>
                  ) : (
                    <span className="cue-brief__source-title">{src.title}</span>
                  )}
                  <span className="cue-brief__source-meta">
                    {via && <span className="cue-brief__via">{via}</span>}
                    {url && <span>{host(url)}</span>}
                    {date && <time dateTime={src.publishedAt ?? undefined}>{date}</time>}
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}
