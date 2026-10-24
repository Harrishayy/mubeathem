import { describe, expect, it } from 'vitest';
import { applyIdentity, selfIdentifies } from '../signals/identity';
import type { Situation } from '../schema';

const base: Situation = {
  persona: 'gatekeeper', personaConfidence: 0.8, receptivity: 'warm', receptivityScore: 0.7, moment: 'gatekeeper', momentConfidence: 0.7,
  tone: { engagement: 0.6, warmth: 0.7, patience: 0.6, interest: 0.5 }, signals: [], shouldSuggest: true, rationale: 'still the screener',
};
const maya = { name: 'Maya Chen', title: 'CEO' };

describe('selfIdentifies', () => {
  it('spots the contact introducing themselves', () => {
    for (const t of ['Hi, this is Maya.', 'Maya speaking.', "It's Maya, who's this?", 'maya here', 'You’ve got Maya.']) expect(selfIdentifies(t, maya)).toBe(true);
  });
  it('ignores mentions of the contact by someone else', () => {
    for (const t of ["Maya's in a meeting.", 'Let me get Maya for you.', 'Is this about Maya?', 'This is Mayan pottery']) expect(selfIdentifies(t, maya)).toBe(false);
  });
});

describe('applyIdentity', () => {
  it('turns a gatekeeper read into a CEO opener when the CEO picks up', () => {
    const s = applyIdentity(base, 'Hi, this is Maya.', maya);
    expect(s.persona).toBe('ceo');
    expect(s.moment).toBe('opener');
    expect(s.shouldSuggest).toBe(true);
  });
  it('keeps the moment when it is not a gatekeeper moment', () => {
    const s = applyIdentity({ ...base, moment: 'whats_this_regarding' }, "It's Maya. What's this about?", maya);
    expect(s).toMatchObject({ persona: 'ceo', moment: 'whats_this_regarding' });
  });
  it('leaves the read alone without a self-introduction or with a gatekeeper title', () => {
    expect(applyIdentity(base, 'Hold on, let me put you through.', maya)).toBe(base);
    expect(applyIdentity(base, 'This is Sam.', { name: 'Sam Lee', title: 'Executive Assistant' })).toBe(base);
  });
});
