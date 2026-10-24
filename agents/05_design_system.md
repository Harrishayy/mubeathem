# 05 · Design system (`packages/ui`, `docs/design`)

Cue's look, motion and every component, built once and rendered in three places: the extension's
Shadow-DOM overbar on Trellus/HubSpot, the extension side panel, and the standalone web app (laptop,
phone, pop-out Picture-in-Picture). It has to be the best-looking thing in the demo and hold up on
every screen size and every string length.

Read: `context.md` §4 (the experience and design principles: follow them), `architecture.md` §7,
`packages/core/src/taxonomy.ts` (moments, families, labels) and `schema/` (the props you render).

## Learn from the previous projects first (spend real time here)

The user's earlier products each built a design system this way. Take the best of each and go further.

| Project | Look at | Take |
|---|---|---|
| Casework (monopoly) | `$REFS/monopoly/docs/plan/06-tokens.md`, `05-components.md`, `apps/web/src/tokens/*.css`, `apps/web/src/ui/*`, `apps/web/src/app/(app)/design` (if present), `docs/design/casework-design-directions.html`, `packages/core/src/run/mascot.ts`, `CLAUDE.md` "Rules" | Semantic tokens only, no hex in components; several **directions** over one component set via `[data-dir]`; shared scales (space/type/durations/z/breakpoints/hit targets); component catalogue with states; every component shown in all states on a design page; mascot driven by a pure state function |
| Raightway | `/Users/harrishayyanar/Documents/raightway/docs/design/directions/index.html` + `src/*.js`, `ui_spec.md`, `frontend/apps/web/src/{ui,styles,layout}` | A single self-contained directions page (open in a browser) with the catalogue and build spec; "professional, not AI-made"; no control without a purpose |
| Tiramisu | `$REFS/tiramisu/docs/mockups/_brief/foundation.css`, `docs/mockups/*.html` | Named palette with a story, warm shadow tokens, motion tokens (`--ease-out`, `--ease-drawer`, press/ui/sheet durations, stagger), radii per role, display + body font pairing |

`$REFS` = `/private/tmp/claude-501/-Users-harrishayyanar-Documents-mubeathem/2c00735b-29e4-4673-a76c-20c1d15500ed/scratchpad/refs`.
If the skills `emil-design-eng`, `frontend-design` or `impeccable:impeccable` are available to you, load them before designing.

## Brand

Cue runs on Mubit, so it borrows Mubit's world: honey amber `#efbd73`/`#ffe2a6`, deep sage
`#345c46`/`#567756`/`#66805a`, lichen `#a6b297`, cream `#f8f5ee`/`#f6f8f2` (from mubit.ai). The
hackathon is Mubit's **Night Shift**. Use these as raw palette values in the token files only.

**Mascot: Sprout.** A small seedling (two leaves on a stem in a soil pod, a face made of two dots and a
tiny mouth) that is the model growing on your team's calls; it ties to Banyan Sapling and to Mubit's
adapters. Inline SVG, animated with CSS/motion, ≤ 4 KB, readable at 20 px (collapsed bar) and 96 px
(empty states, celebrations). States from core `MascotState`: `idle` (slow breathe), `listening` (leaves
sway, a soft ring pulses with the prospect's voice level prop 0..1), `thinking` (leaves curl, three-dot
shimmer), `suggesting` (perks up, one small nod), `warning` (leaves fold, amber, single pulse; the only
pulsing thing in the UI), `celebrating` (blooms a flower, confetti of 6 leaves, once), `learning` (grows a
new leaf; used on the model panel, `growth` prop 0..1 = examples / 25), `offline` (droops, grey). Respect
`prefers-reduced-motion` (swap to state-specific static poses).

## Directions (one component set, three looks via `[data-dir]` on the root)

1. **Honey** (default): cream ground, honey accent, sage ink; light and dark (`[data-theme]`, follows
   system by default). Calm, warm, premium.
2. **Night Shift**: the Cluely-style overlay. Near-black translucent glass (`backdrop-filter: blur`) with
   a 1 px inner highlight, honey glow on the accent, sage for success. Always dark. For floating over
   any page.
3. **Signal**: maximum legibility for the phones-in-hand case: high contrast, bigger line type (24 px),
   stronger moment colours, no translucency. Light and dark. Must pass WCAG AA everywhere, AAA for the
   line text.

Moment colour families (context.md §4.2): gatekeeper slate, opener blue, cold ice, objection violet,
signal green, close gold, compliance amber, neutral. Tokens `--moment-<family>`, `--moment-<family>-soft`,
`--moment-<family>-ink` per direction × theme, all text pairs ≥ 4.5:1. Write a tiny contrast check
test (`test/contrast.test.ts`) that parses the token CSS and asserts it.

## Tokens (`src/tokens/`)

`base.css` (scales shared by all directions: space 4-px base, type scale with the line at 20–22 px,
radii, durations 120/180/240/360, easings, z-index, breakpoints 360/560/860/1120, hit targets ≥ 36
desktop / ≥ 44 touch, focus ring) + `honey.css`, `night.css`, `signal.css`, + `tokens.css` that imports
them. Semantic names in the style of Casework (`--bg`, `--surface`, `--surface-2`, `--ink`, `--ink-2`,
`--ink-3`, `--line`, `--line-strong`, `--accent`, `--accent-ink`, `--accent-soft`, `--ok`, `--warn`,
`--bad`, `--info`, `--glass`, `--shadow-1/2/3`, `--font-display`, `--font-body`, `--font-mono`). Fonts:
pick a distinctive pairing (not Inter/Roboto/system-only), loaded from Google Fonts by the apps, with
system fallbacks that keep metrics close. Components never use a raw colour.

## Components (`src/`)

Everything keyboard reachable, visible focus, status never by colour alone, `prefers-reduced-motion`
honoured, RTL-safe logical properties, and **no layout breaks with long strings** (200-char company
names, 320-char lines, 60-char unbroken tokens, emoji, CJK). Use `motion` for enter/exit and layout;
the card swap is a ~150 ms cross-fade with a tiny y-shift (context.md §4.2), no bouncing.

Primitives (`src/primitives/`): `Button`, `IconButton`, `Icon` (inline SVG set: wave, door, question,
mail, clock, shield, spark, calendar, chat, alert, voicemail, check, dot, mic, mic-off, phone, chevron,
expand, collapse, pin, settings, close, thumbs-up, thumbs-down, edit, copy, external, sprout, wifi-off),
`Chip`, `Kbd`, `Tooltip`, `Switch`, `SegmentedControl`, `TextField`, `TextArea`, `Rating` (1–5),
`Drawer` (inline collapsible), `Sheet` (mobile bottom sheet with drag handle), `Toast`, `Skeleton`,
`Meter`, `Sparkline`, `EmptyState`, `ErrorState`, `VisuallyHidden`, `ScrollArea`.

Domain (`src/domain/`): props are fixed now; workstreams 06/07 build against them.

```ts
<CueRoot direction?: 'honey'|'night'|'signal' theme?: 'light'|'dark'|'system' density?: 'comfortable'|'compact' className? children />
<Overbar view: CallView | null, connection: 'live'|'reconnecting'|'offline', mode: 'collapsed'|'expanded',
         onModeChange(mode), onAction(suggestionId, action: SuggestionAction, text?: string),
         onEnd?(), onOpenSettings?(), placement?: 'top'|'inline'|'sheet', voiceLevel?: number,
         drawers?: { brief?: boolean; transcript?: boolean; flags?: boolean } />
<SuggestionCard suggestion: Suggestion, onAction?, size?: 'hero'|'compact', showEvidence?: boolean />
<ComplianceCard suggestion: Suggestion (kind 'compliance'), onAction? />
<MomentChip moment: Moment, size?: 'sm'|'md' />      <PersonaChip persona: Persona, confidence?: number />
<ReceptivityMeter score: number, trend?: { tMs: number; score: number }[], label?: boolean />
<UpNextList items: UpNext[] />      <CallTimer startedAt: number, endedAt?: number | null />
<ProspectHeader prospect: Prospect, situation: Situation | null, trend />
<TranscriptView turns: Turn[], interim?: Turn | null, highlightTurnId?: string, follow?: boolean />
<BriefView brief: Brief | null, loading?: boolean />      <FlagsView flags: PolicyCheck[] />
<ConnectionPill connection />      <Sprout state: MascotState, size?: number, voiceLevel?: number, growth?: number />
<DebriefForm view: CallView, onSubmit(f: FeedbackRequest): Promise<void>, onSkip?() />
<PlaybookBoard data: PlaybookResponse, onApprove?(id), onReject?(id) />
<ModelGrowthPanel stats: StatsResponse, live?: boolean />   (per-task progress to the 25-example adapter threshold, Sprout growing per task, latency/cost, last request id with copy)
<OutcomeBar onOutcome(o: Outcome) />   (Booked / Follow-up / Not interested / … quick taps at call end)
```

The `Overbar` is the hero: collapsed it is one pill ≤ 56 px tall (Sprout · LIVE 02:14 · moment chip ·
the line, single line with fade-out truncation · receptivity mini meter · expand); expanded it shows the
context.md §4.1 panel. `placement: 'top'` = fixed pill centred at the top of the viewport (max 720 px
wide, 12 px from the top, draggable left/right, remembers position); `'inline'` = fills its container
(side panel, PiP window); `'sheet'` = phone layout (collapsed pill at the bottom above the safe area,
expands to a bottom sheet). It must work from 320 px to 2560 px wide and down to 360 px tall.

## Gallery and the design page

- `gallery/` (Vite app, `pnpm --filter @cue/ui dev`): every component in every state, with a toolbar
  for direction × theme × density × reduced motion × viewport presets, a "stress" toggle that swaps in
  extreme strings, and a scripted "play the demo call" that feeds `demoEvents()` from `@cue/core`
  through the Overbar at real speed. (Core is being built in parallel: until `demoEvents` exists, use
  local fixtures in `src/fixtures/` that parse against the schemas, then switch.)
- `docs/design/index.html`: one self-contained page (inline CSS/JS, no build needed, opens from disk)
  presenting the system the way Raightway and Casework did: principles, the three directions side by
  side, tokens, the moment colours, Sprout's states, the overbar at phone/laptop/side-panel sizes in
  each direction, the component catalogue with states and props, and motion specs. Build it from the
  real CSS (copy `tokens.css` in) so it never drifts.

## Tests

- Vitest + Testing Library (`test/`): render each domain component with fixtures in all states; a11y
  basics (roles, labels, focus order in Overbar and DebriefForm); long-string fixtures don't throw; the
  contrast test.
- Playwright (`tests/e2e/ui.spec.ts`, root `playwright.config.ts` is yours to create: projects for
  chromium at 320×640, 375×812, 768×1024, 1280×800, 1920×1080): open the gallery, for each direction ×
  theme assert no horizontal overflow on the page (`scrollWidth <= clientWidth`), the collapsed Overbar
  is ≤ 56 px tall and fully visible, the line truncates instead of wrapping in collapsed mode, the card
  text never overflows its box with the stress strings, and save screenshots to `test-results/ui/`.
  Look at the screenshots yourself and fix what looks wrong.

## Acceptance

- [ ] `pnpm --filter @cue/ui typecheck && pnpm --filter @cue/ui test && pnpm --filter @cue/ui build` green.
- [ ] `pnpm exec playwright test tests/e2e/ui.spec.ts` green; you reviewed the screenshots.
- [ ] `docs/design/index.html` opens from disk and shows everything above.
- [ ] Report: the component list with states, the font choice and why, screenshots paths, anything you'd still polish.
