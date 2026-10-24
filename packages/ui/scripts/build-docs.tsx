/**
 * Builds docs/design/index.html: one self-contained page (inline CSS, no build needed, opens from
 * disk) rendered from the real components and the real token CSS, so it can't drift from the code.
 *
 *   pnpm --filter @cue/ui docs
 *
 * test/docs.test.ts fails when the page is older than the CSS it embeds.
 */
import { MOMENTS, MOMENT_FAMILIES, type CallView } from '@cue/core';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  BriefView,
  Button,
  Chip,
  ComplianceCard,
  ConnectionPill,
  CueRoot,
  DebriefForm,
  Drawer,
  EmptyState,
  ErrorState,
  FONT_HREF,
  ICON_NAMES,
  Icon,
  IconButton,
  Kbd,
  MASCOT_STATES,
  Meter,
  ModelGrowthPanel,
  MomentChip,
  OutcomeBar,
  Overbar,
  PersonaChip,
  PlaybookBoard,
  ProspectHeader,
  Rating,
  ReceptivityMeter,
  SegmentedControl,
  Skeleton,
  Sparkline,
  Sprout,
  SuggestionCard,
  Switch,
  TextArea,
  TextField,
  TranscriptView,
  UpNextList,
  FlagsView,
  type Direction,
} from '../src';
import { CARD_SPECS, suggestionFrom } from '../src/fixtures/demo';
import { COMPLIANCE_SUGGESTION, DEMO_PLAYBOOK, DEMO_STATS, VIEWS } from '../src/fixtures/views';
import { contrast, over, parseColor } from './color.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../../../docs/design/index.html');
const noop = () => {};

/** styles.css with every @import inlined, in order. */
export function bundleCss(file = join(here, '../src/styles.css')): string {
  const css = readFileSync(file, 'utf8');
  return css.replace(/@import\s+'([^']+)';/g, (_, rel: string) => bundleCss(resolve(dirname(file), rel)));
}

type Look = { dir: Direction; theme: 'light' | 'dark'; name: string };
const LOOKS: Look[] = [
  { dir: 'honey', theme: 'light', name: 'Honey' },
  { dir: 'night', theme: 'dark', name: 'Night Shift' },
  { dir: 'signal', theme: 'light', name: 'Signal' },
];
const DARK_LOOKS: Look[] = [
  { dir: 'honey', theme: 'dark', name: 'Honey · dark' },
  { dir: 'signal', theme: 'dark', name: 'Signal · dark' },
];

const root = (look: Look, children: ReactNode, className = '') => (
  <CueRoot key={`${look.dir}-${look.theme}`} direction={look.dir} theme={look.theme} className={`d-look ${className}`}>
    {children}
  </CueRoot>
);

const views = Object.fromEntries(Object.entries(VIEWS).map(([k, f]) => [k, f()])) as Record<keyof typeof VIEWS, CallView>;

/* ───────── token tables ───────── */

function tokenBlocks() {
  const out: { name: string; vars: [string, string][] }[] = [];
  for (const [file, label] of [['honey.css', 'Honey'], ['night.css', 'Night Shift'], ['signal.css', 'Signal']] as const) {
    const css = readFileSync(join(here, '../src/tokens', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1]!.includes('data-dir'));
    const base: Record<string, string> = {};
    blocks.forEach((m, i) => {
      const vars = Object.fromEntries([...m[2]!.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((d) => [d[1]!, d[2]!.trim()]));
      if (i === 0) Object.assign(base, vars);
      out.push({ name: i === 0 ? label + (blocks.length > 1 ? ' · light' : '') : `${label} · dark`, vars: Object.entries(i === 0 ? vars : { ...base, ...vars }) });
    });
  }
  return out;
}

const SEMANTIC = ['bg', 'surface', 'surface-2', 'surface-3', 'ink', 'ink-2', 'ink-3', 'line', 'line-strong', 'accent', 'accent-ink', 'accent-soft', 'accent-text', 'focus', 'ok', 'warn', 'bad', 'info', 'glass'];

function TokenTable({ name, vars }: { name: string; vars: [string, string][] }) {
  const map = Object.fromEntries(vars);
  return (
    <div className="d-tokens">
      <h4>{name}</h4>
      <table>
        <tbody>
          {SEMANTIC.filter((k) => map[k]).map((k) => (
            <tr key={k}>
              <td>
                <span className="d-sw" style={{ background: map[k] }} />
              </td>
              <td>
                <code>--{k}</code>
              </td>
              <td>
                <code className="d-val">{map[k]}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MomentMatrix() {
  const blocks = tokenBlocks();
  return (
    <div className="d-scroll-x">
      <table className="d-matrix">
        <thead>
          <tr>
            <th>Family</th>
            {blocks.map((b) => (
              <th key={b.name}>{b.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MOMENT_FAMILIES.map((f) => (
            <tr key={f}>
              <th>{f}</th>
              {blocks.map((b) => {
                const m = Object.fromEntries(b.vars);
                const surface = over(parseColor(m.surface!)!, parseColor(m.bg!.startsWith('#') ? m.bg! : '#000')!);
                const soft = parseColor(m[`moment-${f}-soft`]!)!;
                const ink = parseColor(m[`moment-${f}-ink`]!)!;
                const cr = contrast(ink, soft).toFixed(1);
                const cs = contrast(ink, surface).toFixed(1);
                return (
                  <td key={b.name}>
                    <span className="d-chip" style={{ background: m[`moment-${f}-soft`], color: m[`moment-${f}-ink`] }}>
                      <span className="d-dot" style={{ background: m[`moment-${f}`] }} />
                      {f}
                    </span>
                    <span className="d-cr">
                      {cr}:1 · {cs}:1
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ───────── catalogue entries ───────── */

const CATALOGUE: { name: string; props: string; states: string; render?: () => ReactNode }[] = [
  { name: 'CueRoot', props: "direction?: 'honey'|'night'|'signal'; theme?: 'light'|'dark'|'system'; density?: 'comfortable'|'compact'; motion?: 'system'|'reduce'|'full'; className?; children", states: 'Sets data-dir / data-theme / data-density. Night is always dark. Resolves system theme and reduced motion.' },
  {
    name: 'Overbar',
    props: "view: CallView | null; connection: 'live'|'reconnecting'|'offline'; mode: 'collapsed'|'expanded'; onModeChange(mode); onAction(suggestionId, action, text?); onEnd?(); onOpenSettings?(); placement?: 'top'|'inline'|'sheet'; voiceLevel?: number; drawers?: { brief?; transcript?; flags? }; accessory?: ReactNode; cardRef?: Ref<SuggestionCardHandle>; debug?: boolean; now?: number",
    states: 'no call · ringing · reading the moment · card (8 families) · compliance · quiet · reconnecting · offline · ended · booked · reviewing · fallback note',
  },
  { name: 'SuggestionCard', props: "suggestion: Suggestion; onAction?; size?: 'hero'|'compact'; showEvidence?: boolean; editing?; onEditingChange?(b); debug?; ref → { use(), dismiss(), edit(), thumbsUp(), thumbsDown() }", states: 'every moment family · hero / compact · model offline / cached note · debug provenance · on trial · new line · used · thumbs · editing (controlled or not)', render: () => <SuggestionCard suggestion={suggestionFrom(CARD_SPECS.broker)} onAction={noop} /> },
  { name: 'ComplianceCard', props: 'suggestion: Suggestion (kind compliance); onAction?', states: 'violation · unsure · insufficient · inconsistent (verdict label) · pulses once', render: () => <ComplianceCard suggestion={COMPLIANCE_SUGGESTION()} onAction={noop} /> },
  { name: 'MomentChip', props: "moment: Moment; size?: 'sm'|'md'; iconOnly?", states: 'all 16 moments × 2 sizes', render: () => <div className="d-wrap">{MOMENTS.slice(0, 11).map((m) => <MomentChip key={m} moment={m} size="sm" />)}</div> },
  { name: 'PersonaChip', props: 'persona: Persona; confidence?: number', states: 'confident · unsure (< 0.6, dashed, "?")', render: () => <div className="d-wrap"><PersonaChip persona="ceo" confidence={0.9} /><PersonaChip persona="cfo" confidence={0.4} /></div> },
  { name: 'ReceptivityMeter', props: 'score: number; trend?: {tMs, score}[]; label?: boolean', states: 'cold → warm · warming / cooling · bars only', render: () => <div className="d-wrap"><ReceptivityMeter score={-0.9} trend={[{ tMs: 0, score: 0.2 }, { tMs: 1, score: -0.3 }, { tMs: 2, score: -0.9 }]} /><ReceptivityMeter score={0.8} /><ReceptivityMeter score={0.1} label={false} /></div> },
  { name: 'UpNextList', props: 'items: UpNext[]', states: 'two or three items · stacks under 440 px', render: () => <UpNextList items={views.cold.current?.upNext ?? []} /> },
  { name: 'CallTimer', props: 'startedAt: number; endedAt?: number | null; now?: number (replay clock)', states: 'ticking · ended · over an hour' },
  { name: 'ConnectionPill', props: "connection: 'live'|'reconnecting'|'offline'", states: 'live · reconnecting · offline', render: () => <div className="d-wrap"><ConnectionPill connection="live" /><ConnectionPill connection="reconnecting" /><ConnectionPill connection="offline" /></div> },
  { name: 'ProspectHeader', props: 'prospect: Prospect; situation: Situation | null; trend', states: 'with / without a read · long names clamp to two lines', render: () => <ProspectHeader prospect={views.cold.prospect} situation={views.cold.situation} trend={views.cold.receptivityTrend} /> },
  { name: 'TranscriptView', props: 'turns: Turn[]; interim?: Turn | null; highlightTurnId?; follow?; names?; maxHeight?', states: 'empty · following · scrolled up (jump to latest) · interim · highlighted', render: () => <TranscriptView turns={views.cold.turns.slice(-4)} maxHeight={200} names={{ prospect: 'Maya' }} /> },
  { name: 'BriefView', props: 'brief: Brief | null; loading?: boolean', states: 'loading · empty · ready · rules-served', render: () => <BriefView brief={views.cold.brief} /> },
  { name: 'FlagsView', props: 'flags: PolicyCheck[]', states: 'none · violation · unsure', render: () => <FlagsView flags={views.compliance.flags} /> },
  { name: 'Sprout', props: 'state: MascotState; size?: number; voiceLevel?: number; growth?: number; decorative?', states: MASCOT_STATES.join(' · ') },
  { name: 'DebriefForm', props: 'view: CallView; onSubmit(f: FeedbackRequest): Promise<void>; onSkip?(); autoFocus?', states: 'empty · outcome missing (error) · saving · failed (retry) · saved', render: () => <DebriefForm view={views.booked} onSubmit={async () => {}} onSkip={noop} autoFocus={false} /> },
  { name: 'OutcomeBar', props: 'onOutcome(o: Outcome); value?: Outcome | null', states: 'nothing primary until chosen · chosen = primary', render: () => <OutcomeBar onOutcome={noop} value="meeting_booked" /> },
  { name: 'PlaybookBoard', props: 'data: PlaybookResponse; onApprove?(id); onReject?(id); highlightIds?: string[]', states: 'no candidates · candidates (policy OK / breaks policy) · approved · rejected · leaderboard · just learned', render: () => <PlaybookBoard data={DEMO_PLAYBOOK} onApprove={noop} onReject={noop} highlightIds={['line_cand_1']} /> },
  { name: 'ModelGrowthPanel', props: 'stats: StatsResponse; live?: boolean', states: 'no calls · growing · ready for an adapter (blooms)', render: () => <ModelGrowthPanel stats={DEMO_STATS} live /> },
];

const PRIMITIVES: { name: string; props: string; render: () => ReactNode }[] = [
  { name: 'Button', props: "variant: primary|secondary|ghost|danger; size: sm|md|lg; icon; iconEnd; loading; block", render: () => <div className="d-wrap"><Button variant="primary" icon="check">Used it</Button><Button>Secondary</Button><Button variant="ghost">Ghost</Button><Button variant="danger" icon="phone-off">End call</Button><Button loading variant="primary">Saving</Button><Button disabled>Disabled</Button></div> },
  { name: 'IconButton', props: 'icon; label (required: aria-label + tooltip); variant; size; pressed', render: () => <div className="d-wrap"><IconButton icon="settings" label="Settings" /><IconButton icon="thumbs-up" label="Good" pressed /><IconButton icon="copy" label="Copy" variant="secondary" /></div> },
  { name: 'Icon', props: `name: ${ICON_NAMES.length} names; size; label?`, render: () => <div className="d-wrap d-icons">{ICON_NAMES.map((n) => <span key={n} title={n}><Icon name={n} size={20} /></span>)}</div> },
  { name: 'Chip · Kbd', props: 'tone | family; icon; size; onClick → toggle', render: () => <div className="d-wrap"><Chip>Neutral</Chip><Chip tone="accent">D&amp;O</Chip><Chip tone="ok" icon="check">Within policy</Chip><Chip tone="warn">Check later</Chip><Chip tone="bad" icon="alert">Breaks policy</Chip><Chip family="signal" icon="spark">Family</Chip><Kbd keys={['⌘', 'Enter']} /></div> },
  { name: 'Switch · SegmentedControl', props: 'label; checked; onCheckedChange · label; showLabel?; options; value; onChange', render: () => <div className="d-stack"><Switch label="Follow the transcript" checked onCheckedChange={noop} /><SegmentedControl label="x" value="b" onChange={noop} options={[{ value: 'a', label: 'Brief' }, { value: 'b', label: 'Transcript' }, { value: 'c', label: 'Flags' }]} /></div> },
  { name: 'TextField · TextArea', props: 'label; hint; error; optional; maxLength (counter near the limit); autosize', render: () => <div className="d-stack"><TextField label="A better line" hint="What you wish you'd said." defaultValue="" /><TextField label="With an error" defaultValue="maya@" error="That email is missing its domain." /><TextArea label="Notes" optional /></div> },
  { name: 'Rating', props: 'label; value: 1–5 | null; onChange', render: () => <Rating label="How did it feel?" value={4} onChange={noop} /> },
  { name: 'Drawer', props: 'title; icon; meta; open | defaultOpen; onOpenChange', render: () => <div><Drawer title="Brief" icon="brief" defaultOpen meta="3 hooks"><p className="d-copy">Grid-rows height animation; hidden content is inert.</p></Drawer><Drawer title="Transcript" icon="chat" meta={12}>…</Drawer></div> },
  { name: 'Sheet · Toast', props: 'open; onClose; title; modal; snapPoints?: (\'half\'|\'full\')[]; onSnapChange? · tone; title; description; action; duration', render: () => <p className="d-copy">Bottom sheet with a drag handle (flick or drag down to close, Escape closes); toasts pause on hover and while the tab is hidden. See the gallery.</p> },
  { name: 'Skeleton · Meter · Sparkline', props: 'lines · value; max; label; valueText; tone · values; min; max; baseline; label', render: () => <div className="d-stack"><Skeleton lines={2} /><Meter value={18} max={25} label="Examples" valueText="18 / 25" /><Sparkline values={[0.2, -0.1, -0.5, -0.2, 0.4, 0.8]} min={-1} max={1} baseline={0} width={140} height={32} label="trend" /></div> },
  { name: 'EmptyState · ErrorState', props: 'title; children; art; action; compact · title; message; onRetry', render: () => <div className="d-stack"><EmptyState compact title="No flags">Everything said so far is within policy.</EmptyState><ErrorState compact message="Mubit didn't answer in time; the playbook's top line is showing." onRetry={noop} /></div> },
];

const MOTION = [
  ['Card swap', '150 ms', 'ease-out (0.23, 1, 0.32, 1)', 'cross-fade + 6 px lift + 3 px blur; exit 120 ms. One card at a time.'],
  ['Bar line swap', '160 ms', 'ease-out', 'same as the card, inside the pill'],
  ['Panel open (top)', '240 ms / exit 140 ms', 'ease-out', 'opacity + 8 px + scale 0.985 from the top edge'],
  ['Drawer', '240 ms', 'drawer (0.32, 0.72, 0, 1)', 'grid-template-rows 0fr → 1fr, content fades'],
  ['Sheet', '360 ms / exit 220 ms', 'drawer', 'translateY(100%) → 0; drag or flick (> 500 px/s) to close'],
  ['Press', '120 ms', 'ease-out', 'scale(0.97) on :active, every pressable'],
  ['Tooltip', '125 ms', 'ease-out', '450 ms delay; instant once one is open'],
  ['Compliance pulse', '900 ms, once', 'ease-out', 'inset ring from the moment colour; the only pulse in Cue'],
  ['Sprout idle / listening', '4.2 s / 2.8 s loops', 'ease-in-out', 'breathe; leaves sway; ring follows voice level (120 ms)'],
  ['Sprout one-shots', '620–1100 ms', 'ease-out', 'nod (suggesting), pulse (warning), bloom + six-leaf confetti (celebrating), grow (learning)'],
  ['Reduced motion', '—', '—', 'loops stop, movement goes; fades stay; each Sprout state keeps a static pose'],
];

/* ───────── page ───────── */

function Page() {
  const chrome: Look = { dir: 'honey', theme: 'light', name: 'Honey' };
  return (
    <CueRoot direction={chrome.dir} theme={chrome.theme} className="d-page">
      <header className="d-hero">
        <Sprout state="listening" size={72} voiceLevel={0.6} />
        <div>
          <h1>Cue design system</h1>
          <p className="d-lede">
            A calm co-pilot for cold calls: one glance, one line, back to the conversation. One component set in three directions, built on Mubit's honey and sage. Rendered here from the real components and the real token CSS.
          </p>
          <nav className="d-nav" aria-label="Sections">
            {['principles', 'directions', 'type', 'tokens', 'moments', 'sprout', 'overbar', 'components', 'primitives', 'motion', 'build'].map((s) => (
              <a key={s} href={`#${s}`}>
                {s}
              </a>
            ))}
          </nav>
          <label className="d-toggle">
            <input type="checkbox" id="d-reduce" /> Reduce motion on this page
          </label>
        </div>
      </header>

      <section id="principles" className="d-sec">
        <h2>Principles</h2>
        <ol className="d-principles">
          <li><b>One thing at a time.</b> Never more than one suggestion on screen. A new card cross-fades in over 150 ms with a 6 px lift.</li>
          <li><b>Readable at a glance.</b> The line is set large (21 px Honey, 24 px Signal) in the <i>voice face</i>, Newsreader: what you say looks different from what the UI says.</li>
          <li><b>Colour means the moment.</b> Eight families (gatekeeper slate, opener blue, cold ice, objection violet, signal green, close gold, compliance amber, neutral). The colour glows under Sprout in the bar before you read a word.</li>
          <li><b>Evidence, always.</b> Every card says why it's there; fallbacks carry a quiet “model offline” note, never presented as the model; <code>debug</code> shows the path, latency and request id.</li>
          <li><b>Quiet when it should be.</b> No card is a valid state with its own design, not an error.</li>
          <li><b>Respectful motion.</b> Nothing bounces. Compliance pulses once; it is the only pulse. Reduced motion keeps fades and drops movement.</li>
          <li><b>Tokens only.</b> Components never name a colour; a test fails if they do. Every text pair is contrast-checked in every direction.</li>
          <li><b>Every string, every size.</b> 200-character companies, 320-character lines, unbroken tokens, emoji and CJK; 320 px to 2560 px. Playwright proves it.</li>
        </ol>
      </section>

      <section id="directions" className="d-sec">
        <h2>Three directions, one component set</h2>
        <p className="d-copy">
          <b>Honey</b> (default): cream ground, honey accent, sage ink. Calm, warm, premium; light and dark. <b>Night Shift</b>: the Cluely-style overlay; near-black glass with a 1 px inner highlight and a honey glow; always dark. <b>Signal</b>: phones in hand; Atkinson Hyperlegible Next, 24 px line, stronger moment colours, no translucency, AAA line text.
        </p>
        <div className="d-three">
          {LOOKS.map((l) =>
            root(
              l,
              <>
                <p className="d-look__name">{l.name}</p>
                <Overbar view={views.cold} connection="live" mode="collapsed" onModeChange={noop} onAction={noop} placement="inline" voiceLevel={0.5} />
                <SuggestionCard suggestion={views.cold.current!} onAction={noop} />
                <UpNextList items={views.cold.current?.upNext ?? []} />
              </>,
            ),
          )}
        </div>
        <div className="d-two">
          {DARK_LOOKS.map((l) =>
            root(
              l,
              <>
                <p className="d-look__name">{l.name}</p>
                <Overbar view={views.compliance} connection="live" mode="collapsed" onModeChange={noop} onAction={noop} placement="inline" />
                <ComplianceCard suggestion={views.compliance.current!} onAction={noop} />
              </>,
            ),
          )}
        </div>
      </section>

      <section id="type" className="d-sec">
        <h2>Type</h2>
        <div className="d-three">
          {LOOKS.map((l) =>
            root(
              l,
              <div className="d-type">
                <p className="d-look__name">{l.name}</p>
                <p className="d-type__display">Maya Chen</p>
                <p className="cue-line">“Honestly? Insurance. Worst cold-call topic there is.”</p>
                <p className="d-type__body">UI and body copy, 15 px. Evidence, labels and the rest of the interface sit here, quietly.</p>
                <p className="d-type__meta">
                  <span className="cue-timer">02:14</span> · <code>mbt_req_7f3a91</code>
                </p>
              </div>,
            ),
          )}
        </div>
        <p className="d-copy">
          <b>Newsreader</b> is the voice face (Honey, Night): a text serif with optical sizes, so the line reads like something said rather than chrome. <b>Schibsted Grotesk</b> carries the UI: a sturdy newspaper grotesk with tabular figures for the timer. <b>Atkinson Hyperlegible Next</b> runs all of Signal, built for low vision. <b>Spline Sans Mono</b> for ids. Each has a metric-matched local fallback (<code>size-adjust</code>, ascent/descent overrides) so layout holds before fonts load.
        </p>
      </section>

      <section id="tokens" className="d-sec">
        <h2>Tokens</h2>
        <p className="d-copy">
          Semantic names (Casework method). Shared scales live in <code>base.css</code>: space on a 4 px base, type 11–34 px with the line at 21 px, radii by role, durations 120 / 180 / 240 / 360 ms, z-index, breakpoints 360 / 560 / 860 / 1120, hit targets 36 desktop / 44 touch, a 2 px focus ring. Direction files set colour, families and shape only. Tokens hang off <code>[data-cue]</code>, never <code>:root</code>, so they work in a Shadow DOM.
        </p>
        <div className="d-token-grid">
          {tokenBlocks().map((b) => (
            <TokenTable key={b.name} {...b} />
          ))}
        </div>
      </section>

      <section id="moments" className="d-sec">
        <h2>Moment colours</h2>
        <p className="d-copy">Generated from one OKLCH recipe per family (<code>scripts/moments.mjs</code>) and nudged until each text pair clears its target. Ratios shown: ink on soft · ink on surface. Signal targets 7:1.</p>
        <MomentMatrix />
      </section>

      <section id="sprout" className="d-sec">
        <h2>Sprout</h2>
        <p className="d-copy">A seedling in a honey soil pod: the model growing on your team's calls. Inline SVG under 4 KB, pure function of <code>mascotFor(view, connection)</code> from core. Readable at 20 px.</p>
        {LOOKS.map((l) =>
          root(
            l,
            <div className="d-sprouts">
              {MASCOT_STATES.map((st) => (
                <figure key={st}>
                  <Sprout state={st} size={88} voiceLevel={0.55} growth={st === 'learning' ? 0.7 : undefined} />
                  <span className="d-sprouts__small">
                    <Sprout state={st} size={36} decorative />
                    <Sprout state={st} size={20} decorative />
                  </span>
                  <figcaption>{st}</figcaption>
                </figure>
              ))}
            </div>,
            'd-look--flat',
          ),
        )}
      </section>

      <section id="overbar" className="d-sec">
        <h2>The overbar at every size</h2>
        <p className="d-copy">Collapsed ≤ 56 px: Sprout · live timer · moment · the line (one line, fading) · receptivity · expand. The moment uses a whole-word label, never an ellipsis; container queries swap it for its icon (with a tooltip), then drop receptivity and the live word as the pill narrows. An <code>accessory</code> rides under the bar (above it when docked on a phone). On phones the panel opens as a half-height sheet. Expanded: the §4.1 panel; two columns from 860 px.</p>
        {LOOKS.map((l) => (
          <div key={l.dir} className="d-sizes">
            <p className="d-look__name">{l.name}</p>
            <div className="d-sizes__row">
              {root(
                l,
                <div className="d-phone">
                  <span className="d-frame-label">Phone · 375</span>
                  <Overbar view={views.objection} connection="live" mode="expanded" onModeChange={noop} onAction={noop} placement="inline" />
                </div>,
                'd-frame d-frame--phone',
              )}
              {root(
                l,
                <div>
                  <span className="d-frame-label">Side panel · 400</span>
                  <Overbar view={views.cold} connection="live" mode="expanded" onModeChange={noop} onAction={noop} placement="inline" drawers={{ transcript: true }} />
                </div>,
                'd-frame d-frame--panel',
              )}
              {root(
                l,
                <div className="d-laptop">
                  <span className="d-frame-label">Laptop · top placement</span>
                  <div className="d-laptop__page" />
                  <Overbar view={views.signal} connection="live" mode="expanded" onModeChange={noop} onAction={noop} placement="top" />
                </div>,
                'd-frame d-frame--laptop',
              )}
            </div>
          </div>
        ))}
      </section>

      <section id="components" className="d-sec">
        <h2>Domain components</h2>
        <p className="d-copy">Props are the contract the web app and the extension build against (<code>@cue/ui</code>).</p>
        <div className="d-cat">
          {CATALOGUE.map((c) => (
            <article key={c.name} className="d-entry">
              <h3>{c.name}</h3>
              <pre>{c.props}</pre>
              <p className="d-states">
                <b>States</b> {c.states}
              </p>
              {c.render && root(chrome, c.render(), 'd-look--flat')}
            </article>
          ))}
        </div>
      </section>

      <section id="primitives" className="d-sec">
        <h2>Primitives</h2>
        <div className="d-cat">
          {PRIMITIVES.map((c) => (
            <article key={c.name} className="d-entry">
              <h3>{c.name}</h3>
              <pre>{c.props}</pre>
              {root(chrome, c.render(), 'd-look--flat')}
            </article>
          ))}
        </div>
      </section>

      <section id="motion" className="d-sec">
        <h2>Motion</h2>
        <div className="d-scroll-x">
          <table className="d-table">
            <thead>
              <tr>
                <th>What</th>
                <th>Duration</th>
                <th>Curve</th>
                <th>How</th>
              </tr>
            </thead>
            <tbody>
              {MOTION.map((r) => (
                <tr key={r[0]}>
                  {r.map((c, i) => (
                    <td key={i}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="build" className="d-sec">
        <h2>Build spec</h2>
        <pre className="d-code">{`import '@cue/ui/styles.css';                 // tokens + every component
import { CueRoot, Overbar, FONT_HREF } from '@cue/ui';
// add <link rel="stylesheet" href={FONT_HREF}> to the document head

<CueRoot direction="honey" theme="system">
  <Overbar view={view} connection={conn} mode={mode} onModeChange={setMode}
           onAction={send} placement="top" voiceLevel={level} />
</CueRoot>

// Shadow DOM (extension overlay): inject the CSS as a string
import css from '@cue/ui/styles.css?inline';
shadowRoot.append(Object.assign(document.createElement('style'), { textContent: css }));
// @font-face does not load inside a shadow root: put the FONT_HREF <link> on the host page.`}</pre>
        <ul className="d-list">
          <li><code>packages/ui/src/tokens</code>: base, honey, night, signal, derived. Raw colours live only here.</li>
          <li><code>packages/ui/src/primitives</code>, <code>src/domain</code>, <code>src/mascot</code>: components; CSS in <code>src/styles</code>.</li>
          <li><code>pnpm --filter @cue/ui dev</code>: the gallery (every state, toolbar for direction × theme × density × motion × viewport, stress strings, the demo call playback).</li>
          <li><code>pnpm --filter @cue/ui docs</code>: regenerates this page. <code>pnpm exec playwright test tests/e2e/ui.spec.ts</code>: viewports × themes.</li>
        </ul>
      </section>
    </CueRoot>
  );
}

const PAGE_CSS = `
html,body{margin:0;background:#f3f6ee}
.d-page{max-width:1240px;margin:0 auto;padding:40px 24px 120px;background:var(--bg);display:grid;gap:72px}
.d-hero{display:flex;gap:24px;align-items:flex-start}
.d-hero h1{font-family:var(--font-display);font-weight:560;font-size:44px;line-height:1.05;letter-spacing:-.02em;margin:0 0 10px}
.d-lede{font-size:17px;color:var(--ink-2);max-width:62ch;text-wrap:pretty}
.d-nav{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:16px;font-size:13.5px;font-weight:600}
.d-nav a{color:var(--accent-text);text-decoration:none}.d-nav a:hover{text-decoration:underline}
.d-toggle{display:inline-flex;gap:8px;align-items:center;margin-top:14px;font-size:13px;color:var(--ink-2)}
.d-sec{display:grid;gap:20px;min-width:0}
.d-sec>h2{font-family:var(--font-display);font-weight:560;font-size:32px;letter-spacing:-.015em;margin:0}
.d-copy{color:var(--ink-2);font-size:15px;max-width:72ch;text-wrap:pretty}
.d-principles{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:12px 28px;padding:0;list-style:none;counter-reset:p}
.d-principles li{font-size:14.5px;color:var(--ink-2);padding-top:12px;border-top:1px solid var(--line)}
.d-principles b{color:var(--ink);display:block;font-size:15px;margin-bottom:2px}
.d-three{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:16px}
.d-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:16px}
.d-look{display:grid;gap:16px;align-content:start;padding:20px;border-radius:22px;background:var(--bg);border:1px solid var(--line);min-width:0}
.d-look--flat{padding:16px;border-radius:14px}
.d-look__name{font-family:var(--font-display);font-weight:600;font-size:18px}
.d-type{display:grid;gap:10px}.d-type__display{font-family:var(--font-display);font-weight:var(--display-weight);font-size:30px;letter-spacing:var(--tracking-display)}
.d-type__body{color:var(--ink-2)}.d-type__meta{font-size:13px;color:var(--ink-2)}
.d-token-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,270px),1fr));gap:16px}
.d-tokens h4{margin:0 0 8px;font-size:14px}.d-tokens table{border-collapse:collapse;width:100%;font-size:12px}
.d-tokens td{padding:3px 6px 3px 0;border-bottom:1px solid var(--line)}
.d-sw{display:block;width:22px;height:22px;border-radius:6px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.12)}
.d-val{color:var(--ink-2);word-break:break-all}
.d-scroll-x{overflow-x:auto;max-width:100%}
.d-matrix{border-collapse:collapse;font-size:12px;min-width:820px}
.d-matrix th,.d-matrix td{padding:6px 8px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
.d-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:99px;font-weight:600;font-size:12px}
.d-dot{width:8px;height:8px;border-radius:50%}.d-cr{display:block;color:var(--ink-3);margin-top:3px;font-variant-numeric:tabular-nums}
.d-sprouts{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px}
.d-sprouts figure{margin:0;display:grid;justify-items:center;gap:6px;padding:12px 4px}
.d-sprouts__small{display:flex;gap:10px;align-items:center}
.d-sprouts figcaption{font-family:var(--font-mono);font-size:12px;color:var(--ink-2)}
.d-sizes{display:grid;gap:10px}.d-sizes__row{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;padding-bottom:8px}
.d-frame{flex:none;padding:12px;position:relative}
.d-frame--phone{width:min(100%,375px)}.d-frame--panel{width:min(100%,400px)}.d-frame--laptop{width:min(100%,760px);height:640px;overflow:hidden;transform:translateZ(0);padding:0}
.d-laptop__page{position:absolute;inset:0;background:repeating-linear-gradient(180deg,transparent 0 38px,rgba(128,128,128,.12) 38px 40px),#e9ecef}
.d-frame--laptop[data-theme=dark] .d-laptop__page,[data-dir=night].d-frame--laptop .d-laptop__page{background:repeating-linear-gradient(180deg,transparent 0 38px,rgba(255,255,255,.05) 38px 40px),#1b1e21}
.d-frame-label{display:block;font-size:11.5px;font-weight:600;color:var(--ink-2);margin-bottom:8px}
.d-laptop .d-frame-label{position:absolute;bottom:10px;right:12px;z-index:60}
.d-cat{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,520px),1fr));gap:20px}
.d-entry{display:grid;gap:10px;align-content:start;min-width:0}
.d-entry h3{margin:0;font-family:var(--font-display);font-size:22px;font-weight:560}
.d-entry pre,.d-code{margin:0;font-family:var(--font-mono);font-size:12px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--surface-2);padding:10px 12px;border-radius:10px;color:var(--ink)}
.d-states{font-size:13px;color:var(--ink-2)}.d-states b{color:var(--ink);margin-right:6px}
.d-wrap{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.d-stack{display:grid;gap:12px}
.d-icons span{width:36px;height:36px;display:grid;place-items:center;border-radius:8px;background:var(--surface-2)}
.d-table{border-collapse:collapse;font-size:13.5px;width:100%;min-width:680px}
.d-table th,.d-table td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
.d-list{display:grid;gap:6px;color:var(--ink-2);font-size:14px;padding-left:18px}
@media (max-width:640px){.d-hero{flex-direction:column}.d-hero h1{font-size:34px}.d-page{padding-inline:16px}}
`;

const SCRIPT = `document.getElementById('d-reduce').addEventListener('change',function(e){document.querySelectorAll('[data-cue]').forEach(function(n){if(e.target.checked)n.setAttribute('data-motion','reduce');else n.removeAttribute('data-motion')})});`;

/** The full HTML document. */
export function buildDocs(): string {
  const css = bundleCss();
  const body = renderToStaticMarkup(<Page />);
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Cue Design System</title>
<meta name="description" content="Cue's design system: three directions, tokens, Sprout, the overbar and every component. Generated by packages/ui/scripts/build-docs.tsx.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONT_HREF.replace(/&/g, '&amp;')}">
<style>
/* @cue/ui styles.css, inlined */
${css}
</style>
<style>${PAGE_CSS}</style>
</head>
<body>
${body}
<script>${SCRIPT}</script>
</body>
</html>
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  writeFileSync(OUT, buildDocs());
  console.log(`wrote ${OUT}`);
}
