# 01 · Core logic (`packages/core`)

The pure logic every other part shares. No I/O, no network, no Node-only APIs (it runs in the
extension and the browser too). Everything deterministic given its inputs (pass an `rng` where random).

Read: `context.md` §4–§6, `architecture.md` §3 and §5, then `packages/core/src/schema/*` and `taxonomy.ts`.

## Build (files you own)

| File | Exports (fixed signatures; other workstreams already code against them) |
|---|---|
| `src/ids.ts` | `newId(prefix: 'call'\|'turn'\|'sug'\|'line'\|'evt'): string` (time-sortable, e.g. `call_01J…`) |
| `src/call/reduce.ts` | `emptyView(callId): CallView`, `applyEvent(view: CallView, e: CallEvent): CallView`, `reduceCall(events: CallEvent[]): CallView` |
| `src/call/record.ts` | `buildCallRecord(events: CallEvent[]): CallRecord` |
| `src/signals/features.ts` | `computeFeatures(turns: Turn[], index: number, opts?: { callStartedAt?: number }): TurnFeatures`, `detectSignals(text: string, f: TurnFeatures): ToneSignal[]` |
| `src/signals/rules.ts` | `rulesReadMoment(input: ReadMomentInput): ReadMomentOutput` (keyword + shape heuristics; good enough to demo with no network), `toSituation(o: ReadMomentOutput): Situation` (clamps, camelCases) |
| `src/policy/rules.ts` | `CORGI_POLICY: string[]`, `findRiskyClaims(text: string): { claim: string; rule: string; rephrase: string }[]` (fast pre-filter: "definitely covered", "guarantee(d)", "you're covered for", premium figures like "$2k a year", "no exclusions", "cheapest") |
| `src/playbook/seed.ts` | `SEED_PLAYBOOK: PlaybookLine[]`: 3–5 lines for every suggesting moment, Corgi voice (context.md §4.3 examples verbatim where given), varied `style`s (straight, self-aware, question, proof), seeded stats so the demo has evidence (e.g. the self-aware "what's this regarding?" line wins with cold CEOs: 41 calls) |
| `src/playbook/bandit.ts` | `rankLines(lines: PlaybookLine[], s: Pick<Situation,'persona'\|'receptivity'\|'moment'>, opts?: { k?: number; rng?: () => number; exploreSlot?: boolean }): RankedLine[]` where `RankedLine = { line: PlaybookLine; sampledWinRate: number; stats: LineStats; evidence: Evidence }`. Thompson sampling on Beta(1 + wins, 1 + losses) per situation key, backing off to moment-level `*` stats when a situation has < 5 shows, one exploration slot for a line with < 10 shows. `evidenceFor(line, situationKey): Evidence` writes the card's sentence ("Booked 11 of 34 times here", "2.1× the straight answer with cold CEOs · 41 calls", "New line, getting a fair trial") |
| `src/playbook/apply.ts` | `applyReview(lines: PlaybookLine[], record: CallRecord, review: CallReview, opts: { now: number }): { lines: PlaybookLine[]; changed: string[]; candidates: PlaybookLine[] }`: increments shown/used/stepWins/booked/lost per situation key and `*`, adds candidate lines (dedupe by similarity ≥ 0.8 against existing) |
| `src/playbook/similarity.ts` | `lineSimilarity(a: string, b: string): number` 0..1 (normalised token overlap + bigram Dice; fast, no deps), `matchUsage(said: string, shown: string[]): { index: number; score: number } \| null` |
| `src/playbook/stepwin.ts` | `stepWin(moment: Moment, turnsAfter: Turn[], outcome?: Outcome): boolean` implementing context.md §6.2 |
| `src/mascot.ts` | `type MascotState = 'idle'\|'listening'\|'thinking'\|'suggesting'\|'warning'\|'celebrating'\|'learning'\|'offline'`, `mascotFor(view: CallView \| null, conn?: 'live'\|'reconnecting'\|'offline'): MascotState` |
| `src/format.ts` | `formatDuration(ms)`, `formatPercent(x)`, `formatMultiplier(x)` ("2.1×"), `truncateWords(text, n)` |
| `src/fixtures/demo.ts` | `DEMO_PROSPECT` (Maya Chen, CEO, Lumen Labs, Series A in March), `DEMO_REP`, `DEMO_SCRIPT` (the context.md §11 demo as an ordered list of `{speaker, text, expect?: Moment}`, both the warm and cold "what's this regarding?" variants), `demoEvents(): CallEvent[]` (a full realistic event log through review, used by UI galleries and tests) |
| `src/index.ts` | re-export all of the above (uncomment the lines already there) |

## Rules

- `reduceCall` must be idempotent on replay and tolerate out-of-order interim turns (final replaces
  interim with the same id; interim after final is ignored). `current` stays on screen until a new
  `suggestion.shown` replaces it, or the rep dismisses it, or the call ends. `pending` is true between a final prospect `turn.added`
  and the next `situation.read`/`suggestion.skipped`/`pipeline.error` for that turn.
- History is capped at 200 turns in the view (record keeps all).
- Mascot: offline beats everything; `warning` when the newest flag is a violation in the last 8 s;
  `celebrating` when outcome is booked; `learning` while status is `reviewing`; `thinking` when
  pending; `suggesting` when current is set and < 6 s old; `listening` when live; else `idle`.
  Take "now" from the latest event `at`, not `Date.now()`, so it's pure.

## Acceptance

- [ ] Vitest coverage for every module: reducer replay, interim/final, record from `demoEvents()` parses
      against `CallRecord`, bandit prefers a winning line over 1000 seeded draws but still explores,
      `applyReview` math, similarity sanity, rules read on every `DEMO_SCRIPT` line hits its `expect`
      (≥ 85%), claim pre-filter true/false positives, mascot transitions.
- [ ] Every exported function has a one-line doc comment.
- [ ] `pnpm --filter @cue/core typecheck && pnpm --filter @cue/core test` green.
