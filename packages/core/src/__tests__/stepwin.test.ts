import { describe, expect, it } from 'vitest';
import { stepWin } from '../playbook/stepwin';
import { turn } from './helpers';

const p = (text: string, tMs = 0) => turn(`p${tMs}`, 'prospect', text, tMs);
const r = (text: string, tMs = 0) => turn(`r${tMs}`, 'rep', text, tMs);

describe('stepWin', () => {
  it('credits every moment when the call books', () => {
    expect(stepWin('opener', [], 'meeting_booked')).toBe(true);
    expect(stepWin('close', [], 'meeting_booked')).toBe(true);
  });

  it('gatekeeper: transferred or got a name or time', () => {
    expect(stepWin('gatekeeper', [r('line', 0), p('Hold on, let me put you through.', 1000)])).toBe(true);
    expect(stepWin('gatekeeper', [r('line', 0), p("She's usually free after four.", 1000)])).toBe(true);
    expect(stepWin('gatekeeper', [r('line', 0), p("We don't take sales calls.", 1000)])).toBe(false);
    expect(stepWin('gatekeeper', [p('Hold on.', 1000)], 'gatekeeper_blocked')).toBe(false);
  });

  it('opener: the prospect is still talking 30 s later', () => {
    expect(stepWin('opener', [r('line', 10_000), p('ok', 12_000), p('go on', 41_000)])).toBe(true);
    expect(stepWin('opener', [r('line', 10_000), p('ok', 12_000)])).toBe(false);
    expect(stepWin('opener', [])).toBe(false);
  });

  it('"what\'s this regarding?": a follow-up question rather than ending the call', () => {
    expect(stepWin('whats_this_regarding', [r('line'), p('Ha. Okay, what kind of insurance?', 1)])).toBe(true);
    expect(stepWin('whats_this_regarding', [r('line'), p('Not interested, bye.', 1)])).toBe(false);
    expect(stepWin('whats_this_regarding', [r('line'), p('Mm.', 1), p('Fine.', 2)])).toBe(false);
  });

  it('objections and brush-offs: the call goes past the next two turns', () => {
    const alive = [r('line', 0), p('Hm, not since the seed.', 1), r('So…', 2)];
    expect(stepWin('objection_broker', alive)).toBe(true);
    expect(stepWin('brush_off_email', alive.slice(0, 2))).toBe(false);
    expect(stepWin('objection_broker', [r('line', 0), p("No thanks, I've got to go.", 1), r('ok', 2)])).toBe(false);
  });

  it('close and buying signal only win on a booking', () => {
    expect(stepWin('close', [r('x'), p('Sounds good'), r('y')], 'follow_up')).toBe(false);
    expect(stepWin('buying_signal', [r('x'), p('ok'), r('y')])).toBe(false);
  });

  it('compliance: no risky claim from the rep afterwards', () => {
    expect(stepWin('compliance', [r("That's exactly what the quote call will confirm.")])).toBe(true);
    expect(stepWin('compliance', [r("Honestly you'd be covered for that.")])).toBe(false);
  });

  it('quiet moments never win on their own', () => {
    expect(stepWin('small_talk', [r('x'), p('y'), r('z')])).toBe(false);
  });
});
