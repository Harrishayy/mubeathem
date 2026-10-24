import { MOMENT_META, type PlaybookLine, type PlaybookResponse } from '@cue/core';
import { useState } from 'react';
import { cx } from '../lib/cx';
import { formatPercent } from '../lib/core';
import { Button } from '../primitives/Button';
import { Chip } from '../primitives/Chip';
import { EmptyState } from '../primitives/Feedback';
import { Meter } from '../primitives/Meter';
import { MomentChip } from './MomentChip';

export interface PlaybookBoardProps {
  data: PlaybookResponse;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  /** Line or candidate ids that just changed (e.g. from playbook.updated): drawn with a "just learned" mark. */
  highlightIds?: string[];
  className?: string;
}

function LearnedMark() {
  return (
    <Chip size="sm" tone="ok" icon="leaf" className="cue-learned-chip">
      Just learned
    </Chip>
  );
}

function Candidate({ line, onApprove, onReject, fresh }: { line: PlaybookLine; onApprove?: (id: string) => void; onReject?: (id: string) => void; fresh?: boolean }) {
  const [decided, setDecided] = useState<'approved' | 'rejected' | null>(null);
  const blocked = line.policy?.verdict === 'violation';
  const from = line.minedFrom?.repName ? `From ${line.minedFrom.repName}'s call` : 'From a recent call';
  return (
    <li className={cx('cue-cand', `cue-fam-${MOMENT_META[line.moment].family}`, decided && `is-${decided}`, fresh && 'is-learned')}>
      <div className="cue-cand__head">
        <MomentChip moment={line.moment} size="sm" />
        <span className="cue-cand__from">{from}</span>
        {fresh && <LearnedMark />}
        {line.policy && (
          <Chip size="sm" tone={blocked ? 'bad' : line.policy.verdict === 'supported' ? 'ok' : 'warn'} icon={blocked ? 'alert' : 'shield'}>
            {blocked ? 'Breaks policy' : line.policy.verdict === 'supported' ? 'Policy OK' : 'Needs a check'}
          </Chip>
        )}
      </div>
      <p className="cue-cand__text">{line.text}</p>
      {blocked && line.policy?.note && <p className="cue-cand__note">{line.policy.note}</p>}
      <div className="cue-cand__actions">
        {decided ? (
          <span className="cue-cand__decided" role="status">
            {decided === 'approved' ? 'Approved: joins the playbook on trial' : 'Rejected'}
          </span>
        ) : (
          <>
            <Button
              size="sm"
              variant="primary"
              icon="check"
              disabled={blocked || !onApprove}
              title={blocked ? "Lines that break policy can't be approved" : undefined}
              onClick={() => (setDecided('approved'), onApprove?.(line.id))}
            >
              Approve
            </Button>
            <Button size="sm" variant="ghost" icon="close" disabled={!onReject} onClick={() => (setDecided('rejected'), onReject?.(line.id))}>
              Reject
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

/** The team playbook: candidate lines waiting for a manager, then what's winning per moment. */
export function PlaybookBoard({ data, onApprove, onReject, highlightIds, className }: PlaybookBoardProps) {
  const fresh = new Set(highlightIds ?? []);
  const candidates = data.lines.filter((l) => l.status === 'candidate');
  const boards = data.leaderboard.filter((b) => b.lines.length > 0);
  return (
    <div className={cx('cue-playbook', className)}>
      <section className="cue-playbook__section" aria-labelledby="cue-pb-cand">
        <h2 className="cue-playbook__title" id="cue-pb-cand">
          Waiting for approval <span className="cue-count">{candidates.length}</span>
        </h2>
        {candidates.length === 0 ? (
          <EmptyState compact title="Nothing to review">
            When a rep goes off-script and books, Cue proposes their line here.
          </EmptyState>
        ) : (
          <ul className="cue-playbook__cands">
            {candidates.map((l) => (
              <Candidate key={l.id} line={l} onApprove={onApprove} onReject={onReject} fresh={fresh.has(l.id)} />
            ))}
          </ul>
        )}
      </section>
      <section className="cue-playbook__section" aria-labelledby="cue-pb-win">
        <h2 className="cue-playbook__title" id="cue-pb-win">
          What's winning
        </h2>
        {boards.length === 0 ? (
          <EmptyState compact title="No results yet">Lines get ranked once they have been shown on a few calls.</EmptyState>
        ) : (
          <div className="cue-playbook__boards">
            {boards.map((b) => (
              <section key={b.moment} className={cx('cue-board', `cue-fam-${MOMENT_META[b.moment].family}`)} aria-label={MOMENT_META[b.moment].label}>
                <header className="cue-board__head">
                  <MomentChip moment={b.moment} />
                  <span className="cue-board__rule">{MOMENT_META[b.moment].winRule}</span>
                </header>
                <ol className="cue-board__lines">
                  {b.lines.map((l, i) => (
                    <li key={l.lineId} className={cx('cue-board__line', i === 0 && 'is-top', fresh.has(l.lineId) && 'is-learned')}>
                      <span className="cue-board__rank" aria-hidden>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <div className="cue-board__body">
                        <p className="cue-board__text">{l.text}</p>
                        {fresh.has(l.lineId) && <LearnedMark />}
                        <div className="cue-board__ev">
                          {l.evidence.winRate !== undefined && (
                            <Meter
                              size="sm"
                              tone="moment"
                              value={l.evidence.winRate}
                              label="Win rate"
                              valueText={`${formatPercent(l.evidence.winRate)} · ${l.evidence.calls} calls`}
                              className="cue-board__meter"
                            />
                          )}
                          {l.evidence.basis === 'explore' && <Chip size="sm" icon="leaf">On trial</Chip>}
                        </div>
                        <p className="cue-board__evtext">{l.evidence.text}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
