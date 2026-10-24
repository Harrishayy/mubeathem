import { CallView, PlaybookResponse, StatsResponse, Suggestion } from '@cue/core';
import { describe, expect, it } from 'vitest';
import { CARD_SPECS, complianceSuggestion, rebaseEvents, suggestionFrom } from '../src/fixtures/demo';
import { STRESS } from '../src/fixtures/stress';
import { DEMO_PLAYBOOK, DEMO_STATS, VIEWS, galleryEvents, stressSuggestion } from '../src/fixtures/views';

describe('fixtures parse against the core contracts', () => {
  it('every card spec builds a valid Suggestion', () => {
    for (const spec of Object.values(CARD_SPECS)) expect(() => Suggestion.parse(suggestionFrom(spec))).not.toThrow();
    expect(() => Suggestion.parse(complianceSuggestion())).not.toThrow();
  });

  it('every named view is a valid CallView', () => {
    for (const [name, make] of Object.entries(VIEWS)) {
      const r = CallView.safeParse(make());
      expect(r.success, `${name}: ${r.success ? '' : r.error.message}`).toBe(true);
    }
  });

  it('the stress suggestion sits at the schema limits and still parses', () => {
    const s = stressSuggestion();
    expect(() => Suggestion.parse(s)).not.toThrow();
    expect(s.say.length).toBeGreaterThan(300);
    expect(STRESS.token.length).toBe(60);
    expect(STRESS.company.length).toBeLessThanOrEqual(200);
  });

  it('playbook and stats fixtures are valid', () => {
    expect(() => PlaybookResponse.parse(DEMO_PLAYBOOK)).not.toThrow();
    expect(() => StatsResponse.parse(DEMO_STATS)).not.toThrow();
  });

  it('rebasing moves every timestamp by the same amount', () => {
    const ev = galleryEvents('cold', 1_000_000);
    expect(ev[0]!.at).toBe(1_000_000);
    const shown = ev.find((e) => e.type === 'suggestion.shown');
    expect(shown && shown.type === 'suggestion.shown' && shown.suggestion.createdAt).toBe(shown!.at);
    expect(rebaseEvents(ev, 5)[0]!.at).toBe(5);
  });
});
