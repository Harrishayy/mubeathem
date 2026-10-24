import { describe, expect, it } from 'vitest';
import { CallEvent } from '@cue/core';
import { createTrellusClient, importedCallToEvents, TrellusSource, type ImportedCall } from '../src';
import { createFakeTrellusFetch, FIXTURE_API_KEY } from '../src/fixtures';
import { fakeClock, OCT_20, OCT_24 } from './helpers';

function ids() {
  let n = 0;
  return { newId: (prefix: string) => `${prefix}_01JB${String(++n).padStart(22, '0')}` };
}

async function importedFixtures(): Promise<ImportedCall[]> {
  const clock = fakeClock(OCT_24);
  const client = createTrellusClient({ apiKey: FIXTURE_API_KEY, fetch: createFakeTrellusFetch({ now: clock.now }), now: clock.now, sleep: clock.sleep });
  return new TrellusSource({ client, now: clock.now }).listRecent({ since: OCT_20 });
}

describe('importedCallToEvents', () => {
  it('produces call.started → turns → call.ended → outcome.recorded that parse once stamped', async () => {
    for (const call of await importedFixtures()) {
      const inputs = importedCallToEvents(call, ids());
      expect(inputs[0]!.type).toBe('call.started');
      expect(inputs.at(-2)!.type).toBe('call.ended');
      expect(inputs.at(-1)!.type).toBe('outcome.recorded');
      expect(inputs.filter((e) => e.type === 'turn.added')).toHaveLength(call.turns.length);

      const stamped = inputs.map((e, i) => ({ ...e, seq: i + 1, at: e.at ?? 0 }));
      for (const e of stamped) {
        const parsed = CallEvent.safeParse(e);
        if (!parsed.success) throw new Error(`${e.type}: ${parsed.error.message}`);
      }
      const ats = stamped.map((e) => e.at);
      expect([...ats].sort((a, b) => a - b)).toEqual(ats);
      expect(new Set(stamped.map((e) => e.callId)).size).toBe(1);
    }
  });

  it('marks the source and keeps raw Trellus strings', async () => {
    const [call] = await importedFixtures();
    const events = importedCallToEvents(call!, ids());
    const started = events[0]!;
    if (started.type !== 'call.started') throw new Error('expected call.started');
    expect(started.source).toBe('import');
    expect(started.trellusSessionId).toBe(call!.trellusSessionId);
    const outcome = events.at(-1)!;
    if (outcome.type !== 'outcome.recorded') throw new Error('expected outcome.recorded');
    expect(outcome.outcome.source).toBe('trellus');
    expect(outcome.outcome.raw['user_log.disposition']).toBe('Not Interested');
  });

  it('omits outcome.recorded when there is none and stretches duration to cover the last turn', () => {
    const call: ImportedCall = {
      trellusSessionId: 'S',
      startedAt: OCT_20,
      durationMs: 1000,
      prospect: { name: 'A', title: '', company: '', facts: {} },
      rep: { id: 'usr_1', name: 'Rep' },
      turns: [{ id: 'turn_S_0', speaker: 'prospect', text: 'Hello', tMs: 4000, durMs: 500, final: true, via: 'trellus' }],
      outcome: null,
      raw: {},
    };
    const events = importedCallToEvents(call, ids());
    expect(events.map((e) => e.type)).toEqual(['call.started', 'turn.added', 'call.ended']);
    const ended = events[2]!;
    expect(ended.type === 'call.ended' && ended.durationMs).toBe(4500);
  });
});
