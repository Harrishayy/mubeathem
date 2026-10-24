import { PERSONA_LABEL, type Prospect, type Situation } from '@cue/core';
import { cx } from '../lib/cx';
import { ReceptivityMeter } from './ReceptivityMeter';

export interface ProspectHeaderProps {
  prospect: Prospect;
  situation: Situation | null;
  trend: { tMs: number; score: number }[];
  className?: string;
}

/**
 * Who you're talking to, as the top of a call sheet: the name set in the display face, the record
 * line in margin capitals, and a small readout (who Cue thinks is on the line, and how warm they are).
 */
export function ProspectHeader({ prospect, situation, trend, className }: ProspectHeaderProps) {
  const stage = prospect.facts.stage ?? prospect.facts.funding;
  const meta = [prospect.title, prospect.company, stage].filter(Boolean).join(' · ');
  const unsure = situation ? situation.personaConfidence < 0.6 : false;
  return (
    <header className={cx('cue-prospect', className)}>
      <div className="cue-prospect__id">
        <h2 className="cue-prospect__name" title={prospect.name}>
          {prospect.name || 'Unknown prospect'}
        </h2>
        {meta && (
          <p className="cue-prospect__meta" title={meta}>
            {meta}
          </p>
        )}
      </div>
      {situation && (
        <dl className="cue-prospect__read">
          <div>
            <dt className="cue-label">On the line</dt>
            <dd className={cx('cue-prospect__persona', unsure && 'is-unsure')} title={unsure ? 'A guess so far' : undefined}>
              {PERSONA_LABEL[situation.persona]}
              {unsure && <span className="cue-persona__q">?</span>}
            </dd>
          </div>
          <div>
            <dt className="cue-label">Mood</dt>
            <dd>
              <ReceptivityMeter score={situation.receptivityScore} trend={trend} />
            </dd>
          </div>
        </dl>
      )}
    </header>
  );
}
