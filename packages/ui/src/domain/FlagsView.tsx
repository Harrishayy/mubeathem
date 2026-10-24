import type { PolicyCheck, PolicyVerdict } from '@cue/core';
import { cx } from '../lib/cx';
import { Chip, type ChipTone } from '../primitives/Chip';
import { EmptyState } from '../primitives/Feedback';
import { VERDICT_LABEL } from './ComplianceCard';

const TONE: Record<PolicyVerdict, ChipTone> = { violation: 'bad', supported: 'ok', unsure: 'warn', insufficient_information: 'warn', inconsistent_context: 'warn' };

/** Policy checks on this call, newest first. */
export function FlagsView({ flags, className }: { flags: PolicyCheck[]; className?: string }) {
  if (flags.length === 0)
    return (
      <EmptyState compact title="No flags">
        Everything said so far is within policy.
      </EmptyState>
    );
  return (
    <ul className={cx('cue-flags', className)}>
      {[...flags].reverse().map((f, i) => (
        <li key={`${f.turnId ?? i}-${i}`} className="cue-flag">
          <div className="cue-flag__head">
            <Chip size="sm" tone={TONE[f.verdict]} icon={f.verdict === 'supported' ? 'check' : 'alert'}>
              {VERDICT_LABEL[f.verdict]}
            </Chip>
            <span className="cue-flag__who">{f.speaker === 'rep' ? 'You said' : 'Prospect said'}</span>
          </div>
          <q className="cue-flag__claim">{f.claim}</q>
          <p className="cue-flag__rule">{f.rule}</p>
          {f.rephrase && (
            <p className="cue-flag__rephrase">
              <span className="cue-flag__try">Try</span> {f.rephrase}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
