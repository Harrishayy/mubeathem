import { MOMENTS, PERSONAS, type CallView, type Outcome } from '@cue/core';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BriefView,
  Button,
  CallTimer,
  Chip,
  ComplianceCard,
  ConnectionPill,
  DebriefForm,
  Drawer,
  EmptyState,
  ErrorState,
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
  ScrollArea,
  SegmentedControl,
  Sheet,
  Dialog,
  Skeleton,
  Sparkline,
  Sprout,
  SuggestionCard,
  Switch,
  TextArea,
  TextField,
  ToastRegion,
  Tooltip,
  TranscriptView,
  UpNextList,
  FlagsView,
  ActionBar,
  AppBar,
  Bar,
  BandTag,
  CallTimeline,
  CueStage,
  DataTable,
  KeyValue,
  Kpi,
  KpiStrip,
  Pane,
  PaneSection,
  Hint,
  StatGrid,
  type OverbarMode,
  type SuggestionCardHandle,
  type ToastData,
  Board,
  BoardSection,
  Screen,
  SectionNav,
  Toolbar,
  Workspace,
  type Column,
} from '../src';
import { CARD_SPECS, suggestionFrom } from '../src/fixtures/demo';
import { COMPLIANCE_SUGGESTION, DEMO_PLAYBOOK, DEMO_STATS, VIEWS, stressSuggestion } from '../src/fixtures/views';
import type { Playback } from './playback';
import type { GalleryState } from './state';

function Section({ id, title, lede, children }: { id: string; title: string; lede?: ReactNode; children: ReactNode }) {
  return (
    <section className="g-section" id={id} aria-labelledby={`${id}-h`}>
      <div className="g-section__head">
        <h2 className="g-section__title" id={`${id}-h`}>
          {title}
        </h2>
        {lede && <p className="g-section__lede">{lede}</p>}
      </div>
      {children}
    </section>
  );
}

function Specimen({ label, children, wide, className }: { label: string; children: ReactNode; wide?: boolean; className?: string }) {
  return (
    <figure className={`g-spec${wide ? ' g-spec--wide' : ''}${className ? ` ${className}` : ''}`}>
      <figcaption className="g-spec__label">{label}</figcaption>
      <div className="g-spec__body">{children}</div>
    </figure>
  );
}

const noop = () => {};

/** Every component, every state. `only` limits it to one group (cards, sprout) for focused screenshots. */
export function Catalogue({ state: s, playback, only }: { state: GalleryState; playback: Playback; only?: 'cards' | 'sprout' }) {
  const views = useMemo(() => {
    const v = Object.fromEntries(Object.entries(VIEWS).map(([k, f]) => [k, f()])) as Record<keyof typeof VIEWS, CallView>;
    return s.stress ? { ...v, cold: v.stress, gatekeeper: v.stress, compliance: { ...v.compliance, prospect: v.stress.prospect } } : v;
  }, [s.stress]);
  const cards = useMemo(() => {
    const list = Object.entries(CARD_SPECS).map(([k, spec]) => ({ k, s: suggestionFrom(spec) }));
    return s.stress ? list.map((c) => ({ ...c, s: stressSuggestion(c.s) })) : list;
  }, [s.stress]);

  if (only === 'cards') return <CardsSection cards={cards} stress={s.stress} />;
  if (only === 'sprout') return <SproutSection />;

  return (
    <>
      <DemoSection playback={playback} />
      <DashboardSection views={views} stress={s.stress} />
      <OverbarSection views={views} />
      <CardsSection cards={cards} stress={s.stress} />
      <SproutSection />
      <CallPartsSection views={views} />
      <AfterCallSection views={views} />
      <PrimitivesSection />
    </>
  );
}

function WorkspaceSpecimen({ stress, rows, long }: { stress: boolean; rows: typeof TABLE_ROWS; long: string }) {
  const [tab, setTab] = useState('lines');
  return (
    <div className="cue-dash" style={{ minHeight: 0, height: 460 }}>
      <Workspace
        rail={{ label: 'Filters', summary: stress ? long : '2 on', children: <Pane label="Filters" side="rail">{stress ? long : 'Moment, rep, outcome.'}</Pane> }}
        drawer={{ label: 'Detail', count: 3, width: 'minmax(220px, 26%)', children: <Pane label="Detail" side="drawer">{stress ? long : 'The selected row in full.'}</Pane> }}
      >
        <KpiStrip foldId="g-kpis">
          <Kpi label="Calls" value="751" />
          <Kpi label="Booked" value="15%" tone="ok" />
          <Kpi label="Spend" value="$0.62" />
        </KpiStrip>
        <Pane paneId="g-lines" label="Lines" summary={stress ? long : '3 ranked · best 62%'} pad="none" grow={1.4} tabs={[{ id: 'lines', label: 'Ranked', count: rows.length }, { id: 'queue', label: 'Waiting', count: 2 }]} tab={tab} onTab={setTab}>
          <DataTable label="Workspace lines" columns={TABLE_COLUMNS} rows={rows} rowKey={(r) => r.id} minWidth={420} />
        </Pane>
        <Pane paneId="g-jobs" label="AI jobs" summary="13 timeouts">
          {stress ? long : 'Folds to its head; the summary stays.'}
        </Pane>
      </Workspace>
    </div>
  );
}

const TABLE_COLUMNS: Column<(typeof TABLE_ROWS)[number]>[] = [
  { key: 'rank', header: '#', width: '48px', mono: true, render: (r) => r.rank },
  { key: 'text', header: 'Line', render: (r) => <span className="cue-table__line">{r.text}</span> },
  { key: 'rate', header: 'Win rate', width: '90px', mono: true, align: 'end', render: (r) => `${Math.round(r.rate * 100)}%` },
];

const TABLE_ROWS = [
  { id: 'a', rank: '01', text: 'Makes sense, most founders do. When did they last re-quote you after the raise?', rate: 0.62, calls: 24 },
  { id: 'b', rank: '02', text: 'Totally fair. Brokers are great at renewals; we are a second quote built for funded startups.', rate: 0.51, calls: 41 },
  { id: 'c', rank: '03', text: 'Good, that means someone is looking. Did they cover the new board under D&O?', rate: 0.47, calls: 19 },
];

/** The dashboard system: band, panes, KPIs, tables, readouts, the flush cue and the call timeline. */
function DashboardSection({ views, stress }: { views: Record<keyof typeof VIEWS, CallView>; stress: boolean }) {
  const [sel, setSel] = useState<string | null>('a');
  const long = 'An extremely long unbroken string that must wrap rather than truncate: Supercalifragilisticexpialidocious-insurance-for-AI-startups-after-a-Series-A';
  const rows = stress ? TABLE_ROWS.map((r) => ({ ...r, text: `${r.text} ${long}` })) : TABLE_ROWS;
  const v = views.objection;
  return (
    <Section id="dashboard" title="Dashboard" lede="The olive band, cream panes with ruled heads, KPIs, tables that scroll inside their own box, readouts, the cue set flush in a pane, and the call timeline. Text wraps; nothing truncates.">
      <Specimen label="AppBar · BandTag" wide>
        <AppBar
          active="playbook"
          tabs={[
            { id: 'live', label: 'Live', href: '#', live: true },
            { id: 'contacts', label: 'Contacts', href: '#' },
            { id: 'team', label: 'Team', href: '#' },
            { id: 'playbook', label: 'Playbook', href: '#', count: 42 },
            { id: 'model', label: 'Model', href: '#', count: '6/6' },
            { id: 'insights', label: 'Insights', href: '#' },
          ]}
          onNavigate={(_, e) => e.preventDefault()}
          end={<BandTag>Mubit · 6/6 adapters</BandTag>}
        />
      </Specimen>
      <Specimen label="Workspace · rail, centre, drawer; panes fold, focus and hold tabs ([ ] and Esc)" wide>
        <WorkspaceSpecimen stress={stress} rows={rows} long={long} />
      </Specimen>
      <Specimen label="Toolbar · SectionNav · Board · BoardSection · Screen (the page layout)" wide>
        <div className="cue-dash" style={{ minHeight: 0 }}>
          <Toolbar label="Specimen filters">
            <span className="cue-label">Range</span>
            <span className="cue-filter" role="group" aria-label="Range">
              <button type="button" aria-pressed="true">7 days</button>
              <button type="button" aria-pressed="false">All</button>
            </span>
            <SectionNav links={[{ id: 'g-board-a', label: 'Report row' }, { id: 'g-board-b', label: 'List + detail' }]} />
          </Toolbar>
          <Board>
            <BoardSection id="g-board-a" title="A report row" hint={stress ? long : 'Panes on 12 columns take their content height; full width below 1080 px.'}>
              <Pane label="Span 4" span={4} scroll={false}>
                {stress ? long : 'Four of twelve.'}
              </Pane>
              <Pane label="Span 8 · capped" span={8} scroll="cap" pad="none">
                <DataTable label="Capped table" columns={TABLE_COLUMNS} rows={rows} rowKey={(r) => r.id} minWidth={420} />
              </Pane>
            </BoardSection>
            <BoardSection id="g-board-b" title="List + detail" hint="A Screen fills the window under the pinned band and toolbar.">
              <div style={{ height: 260, display: 'grid' }}>
                <Screen>
                  <Pane label="List" pad="none">
                    <DataTable label="Screen list" columns={TABLE_COLUMNS} rows={rows} rowKey={(r) => r.id} minWidth={420} />
                  </Pane>
                  <Pane label="Detail" as="aside">
                    {stress ? long : 'The selected row in full.'}
                  </Pane>
                </Screen>
              </div>
            </BoardSection>
          </Board>
        </div>
      </Specimen>
      <Specimen label="KpiStrip · Kpi" wide>
        <KpiStrip>
          <Kpi label="Mubit calls" value="709" note="1.85M tokens" />
          <Kpi label="Succeeded" value="95%" note="36 failed or cancelled" tone="warn" />
          <Kpi label="Booking rate" value="13%" note="+13 pts when a cue was used" tone="ok" />
          <Kpi label="Turn → card" value="2.1 s" note={stress ? long : 'p95 3.6 s over 190 cards'} />
        </KpiStrip>
      </Specimen>
      <Specimen label="Pane · DataTable (selectable, Enter/Space) · ActionBar" wide>
        <div style={{ height: 300, display: 'grid' }}>
          <Pane label="Lines" meta="3 ranked" actions={<BandTag tone="plain">filter</BandTag>} pad="none" footer={<ActionBar end={<Button size="sm" variant="ghost">Retire</Button>}><Button size="sm" variant="primary" icon="check">Approve</Button></ActionBar>}>
            <DataTable
              label="Ranked lines"
              rows={rows}
              rowKey={(r) => r.id}
              selectedKey={sel}
              onSelect={(r) => setSel(r.id)}
              rowFamily={() => 'objection'}
              columns={[
                { key: 'rank', header: '#', width: '40px', mono: true, render: (r) => r.rank },
                { key: 'text', header: 'Line', render: (r) => <span className="cue-table__line">{r.text}</span> },
                { key: 'rate', header: 'Win rate', width: '170px', render: (r) => <Bar value={r.rate} label={`${Math.round(r.rate * 100)}%`} /> },
                { key: 'calls', header: 'Calls', width: '60px', mono: true, align: 'end', render: (r) => r.calls },
              ]}
            />
          </Pane>
        </div>
      </Specimen>
      <Specimen label="Pane hint · PaneSection hint · Hint">
        <Pane label="Your booking rate" hint={stress ? long : 'Meetings booked out of calls where someone picked up. Compared with the team average.'} scroll={false}>
          <PaneSection label="Weekly" hint="Calls and meetings per week, oldest first.">
            <Hint term="read_moment">{stress ? long : "Cue's read of who is on the line, their mood and what just happened."}</Hint>
          </PaneSection>
        </Pane>
      </Specimen>
      <Specimen label="KeyValue · StatGrid · PaneSection">
        <Pane label="Prospect" scroll={false} pad="none">
          <div style={{ padding: 16 }}>
            <KeyValue items={[{ label: 'Stage', value: stress ? long : 'Series A, $14M (March)' }, { label: 'On the line', value: 'CEO 92%' }, { label: 'You talked', value: <Bar value={0.42} label="42%" tone="accent" /> }]} />
          </div>
          <PaneSection label="Scorecard">
            <StatGrid items={[{ label: 'Cues used', value: '3/4', note: 'One skipped' }, { label: 'Flags', value: '0' }, { label: 'Talk ratio', value: '46%' }, { label: 'Turn → cue', value: '1.6 s' }]} />
          </PaneSection>
        </Pane>
      </Specimen>
      <Specimen label="CueStage · flush, in a pane">
        <div style={{ height: 420, display: 'grid' }}>
          <Pane label="Cue" pad="none">
            <CueStage view={v} onAction={noop} variant="flush" shortcuts />
          </Pane>
        </div>
      </Specimen>
      <Specimen label="CallTimeline · live and booked" wide>
        <Pane label="Call timeline" scroll={false} pad="none">
          <CallTimeline view={v} now={v.startedAt + 95_000} />
          <CallTimeline view={views.booked} />
        </Pane>
      </Specimen>
    </Section>
  );
}

function DemoSection({ playback: p }: { playback: Playback }) {
  const [mode, setMode] = useState<OverbarMode>('expanded');
  return (
    <Section
      id="demo"
      title="Play the demo call"
      lede="Core's scripted call (context.md §11) through the real reducer at real speed: gatekeeper, opener, the cold “what's this regarding?”, the broker, the slip, the price question, booked."
    >
      <div className="g-demo">
        <div className="g-demo__controls">
          <Button variant="primary" icon={p.playing ? 'pause' : 'play'} onClick={p.playing ? p.pause : p.play} data-testid="demo-play">
            {p.playing ? 'Pause' : p.done ? 'Play again' : p.view ? 'Resume' : 'Play the call'}
          </Button>
          <IconButton icon="refresh" label="Restart" onClick={p.restart} />
          <SegmentedControl
            label="Variant"
            size="sm"
            value={p.variant}
            onChange={p.setVariant}
            options={[
              { value: 'cold', label: 'Cold CEO' },
              { value: 'warm', label: 'Warm CEO' },
            ]}
          />
          <SegmentedControl
            label="Speed"
            size="sm"
            value={String(p.speed)}
            onChange={(v) => p.setSpeed(Number(v))}
            options={[
              { value: '1', label: '1×' },
              { value: '2', label: '2×' },
              { value: '4', label: '4×' },
            ]}
          />
          <Meter className="g-demo__progress" value={p.progress} label="Call progress" size="sm" />
        </div>
        <div className="g-demo__stage">
          <div className="g-frame g-frame--page">
            <span className="g-frame__tag">Overbar on a page</span>
            <div className="g-frame__host" />
            <Overbar view={p.view} connection="live" mode={mode} onModeChange={setMode} onAction={noop} onEnd={noop} placement="top" voiceLevel={p.voiceLevel} now={p.now} />
          </div>
          <div className="g-frame g-frame--panel">
            <span className="g-frame__tag">Side panel</span>
            <Overbar view={p.view} connection="live" mode="expanded" onModeChange={noop} onAction={noop} placement="inline" voiceLevel={p.voiceLevel} now={p.now} drawers={{ transcript: true }} debug />
          </div>
        </div>
      </div>
    </Section>
  );
}

const BAR_STATES: { label: string; view: keyof typeof VIEWS | null; conn?: 'live' | 'reconnecting' | 'offline' }[] = [
  { label: 'No call', view: null },
  { label: 'Ringing, brief ready', view: 'ringing' },
  { label: 'Reading the moment', view: 'thinking' },
  { label: 'Gatekeeper', view: 'gatekeeper' },
  { label: 'Cold “what’s this regarding?”', view: 'cold' },
  { label: 'Objection', view: 'objection' },
  { label: 'Compliance', view: 'compliance' },
  { label: 'Buying signal', view: 'signal' },
  { label: 'Quiet (nothing to say)', view: 'quiet' },
  { label: 'Reconnecting', view: 'cold', conn: 'reconnecting' },
  { label: 'Offline', view: 'cold', conn: 'offline' },
  { label: 'Ended, booked', view: 'booked' },
];

function OverbarSection({ views }: { views: Record<keyof typeof VIEWS, CallView> }) {
  const [mode, setMode] = useState<OverbarMode>('expanded');
  return (
    <Section id="overbar" title="Overbar" lede="Collapsed it is one pill under 56 px. The line fades instead of wrapping; the moment's colour glows under Sprout. Expanded, the context.md §4.1 panel.">
      <div className="g-bars" data-testid="bar-states">
        {BAR_STATES.map((b) => (
          <Specimen key={b.label} label={b.label} wide>
            <Overbar view={b.view ? views[b.view] : null} connection={b.conn ?? 'live'} mode="collapsed" onModeChange={noop} onAction={noop} placement="inline" voiceLevel={0.5} />
          </Specimen>
        ))}
      </div>
      <div className="g-grid g-grid--2">
        <Specimen label="Expanded · side panel width" className="g-spec--panel">
          <Overbar view={views.cold} connection="live" mode={mode} onModeChange={setMode} onAction={noop} onEnd={noop} onOpenSettings={noop} placement="inline" />
        </Specimen>
        <Specimen label="Expanded · compliance">
          <Overbar view={views.compliance} connection="live" mode="expanded" onModeChange={noop} onAction={noop} placement="inline" drawers={{ flags: true }} />
        </Specimen>
        <Specimen label="Expanded · reading the moment">
          <Overbar view={views.thinking} connection="live" mode="expanded" onModeChange={noop} onAction={noop} placement="inline" />
        </Specimen>
        <Specimen label="Expanded · fallback note">
          <Overbar view={views.error} connection="live" mode="expanded" onModeChange={noop} onAction={noop} placement="inline" />
        </Specimen>
        <Specimen label="Expanded · no call">
          <Overbar view={null} connection="live" mode="expanded" onModeChange={noop} onAction={noop} placement="inline" />
        </Specimen>
        <Specimen label="Expanded · ended and booked">
          <Overbar view={views.booked} connection="live" mode="expanded" onModeChange={noop} onAction={noop} placement="inline" />
        </Specimen>
      </div>
      <div className="g-grid g-grid--2">
        <Specimen label="Accessory · attached under the bar (moves with it)">
          <Overbar view={views.ringing} connection="live" mode="collapsed" onModeChange={noop} onAction={noop} placement="inline" accessory={<Accessory />} />
        </Specimen>
        <Specimen label="Debug provenance (served by, latency, request id)">
          <Overbar view={views.gatekeeper} connection="live" mode="expanded" onModeChange={noop} onAction={noop} placement="inline" debug />
        </Specimen>
      </div>
      <Specimen label="Expanded · wide container (two columns from 860 px)" wide>
        <Overbar view={views.objection} connection="live" mode="expanded" onModeChange={noop} onAction={noop} placement="inline" drawers={{ brief: true, transcript: true }} />
      </Specimen>
    </Section>
  );
}

/** An example accessory: what the extension shows before capture starts. */
function Accessory() {
  return (
    <div className="g-acc" role="status">
      <Icon name="mic-off" size={16} />
      <span>Cue isn't listening to this tab yet.</span>
      <Button size="sm" variant="primary" icon="mic">
        Start Cue
      </Button>
    </div>
  );
}

/** Keyboard shortcuts through the card handle: U used, E edit, D dismiss, + / - thumbs. */
function ShortcutCard({ onAction }: { onAction: (id: string, a: string, text?: string) => void }) {
  const ref = useRef<SuggestionCardHandle>(null);
  const [editing, setEditing] = useState(false);
  const s = useMemo(() => suggestionFrom(CARD_SPECS.signal), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      const k = e.key.toLowerCase();
      if (k === 'u') ref.current?.use();
      else if (k === 'e') ref.current?.edit();
      else if (k === 'd') ref.current?.dismiss();
      else if (k === '+') ref.current?.thumbsUp();
      else if (k === '-') ref.current?.thumbsDown();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return <SuggestionCard ref={ref} suggestion={s} onAction={onAction} editing={editing} onEditingChange={setEditing} />;
}

function CardsSection({ cards, stress }: { cards: { k: string; s: ReturnType<typeof suggestionFrom> }[]; stress: boolean }) {
  const [log, setLog] = useState<string[]>([]);
  const onAction = (id: string, a: string, text?: string) => setLog((l) => [`${a}${text ? `: ${text}` : ''}`, ...l].slice(0, 3));
  const compliance = useMemo(() => (stress ? { ...COMPLIANCE_SUGGESTION(), compliance: { ...COMPLIANCE_SUGGESTION().compliance!, claim: stressSuggestion().say.slice(0, 400), rephrase: stressSuggestion().say } } : COMPLIANCE_SUGGESTION()), [stress]);
  const first = cards[0]!.s;
  return (
    <Section id="cards" title="Suggestion cards" lede="One card per moment family. Colour means the moment; the line is set in the voice face; evidence always says why.">
      <div className="g-grid g-grid--cards" data-testid="cards">
        {cards.map(({ k, s }) => (
          <SuggestionCard key={k} suggestion={s} onAction={onAction} />
        ))}
        <ComplianceCard suggestion={compliance} onAction={onAction} />
      </div>
      <div className="g-grid g-grid--3">
        <Specimen label="Compact">
          <SuggestionCard suggestion={first} size="compact" onAction={onAction} />
        </Specimen>
        <Specimen label="Served by rules (model unavailable)">
          <SuggestionCard suggestion={{ ...first, servedBy: 'rules' }} />
        </Specimen>
        <Specimen label="Keyboard: U used · E edit · D dismiss · + / − thumbs">
          <ShortcutCard onAction={onAction} />
        </Specimen>
        <Specimen label="Without evidence or actions">
          <SuggestionCard suggestion={first} showEvidence={false} />
        </Specimen>
      </div>
      <p className="g-log" aria-live="polite">
        {log.length ? `Last action: ${log[0]}` : 'Try the card actions: Used it, thumbs, edit, dismiss.'}
      </p>
    </Section>
  );
}

function SproutSection() {
  const [voice, setVoice] = useState(0.5);
  const [growth, setGrowth] = useState(0.64);
  const [key, setKey] = useState(0);
  return (
    <Section id="sprout" title="Sprout" lede="The model growing on your team's calls. Pure function of its state; every state has a static pose for reduced motion. Readable at 20 px.">
      <div className="g-sprouts" data-testid="sprouts" key={key}>
        {MASCOT_STATES.map((st) => (
          <figure key={st} className="g-sprout">
            <div className="g-sprout__big">
              <Sprout state={st} size={96} voiceLevel={voice} growth={st === 'learning' ? growth : undefined} />
            </div>
            <div className="g-sprout__small">
              <Sprout state={st} size={40} voiceLevel={voice} growth={st === 'learning' ? growth : undefined} decorative />
              <Sprout state={st} size={20} voiceLevel={voice} decorative />
            </div>
            <figcaption>{st}</figcaption>
          </figure>
        ))}
      </div>
      <div className="g-row">
        <label className="g-range">
          Voice level <input type="range" min={0} max={1} step={0.01} value={voice} onChange={(e) => setVoice(Number(e.target.value))} />
        </label>
        <label className="g-range">
          Growth <input type="range" min={0} max={1} step={0.01} value={growth} onChange={(e) => setGrowth(Number(e.target.value))} />
        </label>
        <Button size="sm" variant="secondary" icon="refresh" onClick={() => setKey((k) => k + 1)}>
          Replay one-shot states
        </Button>
      </div>
    </Section>
  );
}

function CallPartsSection({ views }: { views: Record<keyof typeof VIEWS, CallView> }) {
  const v = views.cold;
  return (
    <Section id="parts" title="Call parts" lede="The pieces the overbar is built from, each usable on its own.">
      <div className="g-grid g-grid--2">
        <Specimen label="MomentChip · every moment, sm and md" wide>
          <div className="g-wrap">
            {MOMENTS.map((m) => (
              <MomentChip key={m} moment={m} />
            ))}
          </div>
          <div className="g-wrap">
            {MOMENTS.map((m) => (
              <MomentChip key={m} moment={m} size="sm" />
            ))}
          </div>
        </Specimen>
        <Specimen label="PersonaChip · confident and unsure">
          <div className="g-wrap">
            {PERSONAS.map((p, i) => (
              <PersonaChip key={p} persona={p} confidence={i % 2 ? 0.45 : 0.9} />
            ))}
          </div>
        </Specimen>
        <Specimen label="ReceptivityMeter · cold to warm, with trend">
          <div className="g-wrap">
            {[-1, -0.6, -0.2, 0.25, 0.7, 1].map((sc) => (
              <ReceptivityMeter key={sc} score={sc} />
            ))}
          </div>
          <div className="g-wrap">
            <ReceptivityMeter score={-0.5} trend={[{ tMs: 0, score: 0.3 }, { tMs: 1, score: 0 }, { tMs: 2, score: -0.5 }]} />
            <ReceptivityMeter score={0.8} trend={[{ tMs: 0, score: -0.6 }, { tMs: 1, score: 0.1 }, { tMs: 2, score: 0.8 }]} />
            <ReceptivityMeter score={0.2} label={false} />
          </div>
        </Specimen>
        <Specimen label="ConnectionPill · CallTimer">
          <div className="g-wrap">
            <ConnectionPill connection="live" />
            <ConnectionPill connection="reconnecting" />
            <ConnectionPill connection="offline" />
            <CallTimer startedAt={Date.now() - 134_000} />
            <CallTimer startedAt={Date.now() - 3_725_000} endedAt={Date.now()} />
          </div>
        </Specimen>
        <Specimen label="ProspectHeader" wide>
          <ProspectHeader prospect={v.prospect} situation={v.situation} trend={v.receptivityTrend} />
        </Specimen>
        <Specimen label="UpNextList">
          <UpNextList items={v.current?.upNext ?? []} />
        </Specimen>
        <Specimen label="TranscriptView · following, with interim">
          <TranscriptView turns={v.turns.filter((t) => t.final)} interim={{ id: 'turn_interim', speaker: 'prospect', text: 'Ha, fair enough. Go', tMs: 41000, final: false, via: 'sim' }} names={{ prospect: 'Maya' }} maxHeight={240} />
        </Specimen>
        <Specimen label="TranscriptView · empty">
          <TranscriptView turns={[]} />
        </Specimen>
        <Specimen label="BriefView · ready">
          <BriefView brief={v.brief} />
        </Specimen>
        <Specimen label="BriefView · with provenance and sources">
          <BriefView
            brief={
              v.brief && {
                ...v.brief,
                hooks: v.brief.hooks.map((h, i) => ({ ...h, via: ['exa', 'valyu', 'crm'][i % 3]!, ...(i % 3 === 2 ? {} : { url: `https://example.com/news/${i}` }) })),
                sources: [
                  { title: 'Lumen Labs raises $14M Series A to scale lab automation', url: 'https://example.com/news/0', via: 'exa', publishedAt: '2026-03-12' },
                  { title: 'Maya Chen on hiring the first 40 engineers, and why the next 40 will be harder to find than the first', url: 'https://example.com/news/1', via: 'valyu', publishedAt: null },
                  { title: 'CRM record', url: null, via: 'crm', publishedAt: null },
                ],
              }
            }
          />
        </Specimen>
        <Specimen label="BriefView · loading and empty">
          <BriefView brief={null} loading />
          <BriefView brief={null} />
        </Specimen>
        <Specimen label="FlagsView">
          <FlagsView flags={views.compliance.flags} />
        </Specimen>
        <Specimen label="FlagsView · none">
          <FlagsView flags={[]} />
        </Specimen>
      </div>
    </Section>
  );
}

function AfterCallSection({ views }: { views: Record<keyof typeof VIEWS, CallView> }) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [fail, setFail] = useState(false);
  return (
    <Section id="after" title="After the call" lede="Outcome taps, the 20-second debrief, the playbook and the model growing.">
      <Specimen label="OutcomeBar" wide>
        <OutcomeBar onOutcome={setOutcome} value={outcome} />
      </Specimen>
      <div className="g-grid g-grid--2">
        <Specimen label="DebriefForm">
          <DebriefForm
            view={views.booked}
            autoFocus={false}
            onSubmit={() => new Promise((res, rej) => setTimeout(() => (fail ? rej(new Error('Server unreachable. Your notes are kept; try again.')) : res()), 700))}
            onSkip={noop}
          />
          <Switch label="Make the save fail" checked={fail} onCheckedChange={setFail} />
        </Specimen>
        <Specimen label="ModelGrowthPanel">
          <ModelGrowthPanel stats={DEMO_STATS} live />
        </Specimen>
      </div>
      <Specimen label="PlaybookBoard" wide>
        <PlaybookBoard data={DEMO_PLAYBOOK} onApprove={noop} onReject={noop} highlightIds={['line_cand_1', 'line_wtr_cold']} />
      </Specimen>
    </Section>
  );
}

function PrimitivesSection() {
  const [seg, setSeg] = useState('one');
  const [sw, setSw] = useState(true);
  const [rating, setRating] = useState<number | null>(4);
  const [text, setText] = useState('');
  const [sheet, setSheet] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const addToast = (tone: ToastData['tone']) =>
    setToasts((t) => [...t, { id: String(Date.now()), tone, title: tone === 'ok' ? 'Debrief saved' : tone === 'bad' ? "Couldn't reach the server" : tone === 'warn' ? 'Mic paused' : 'Trellus synced', description: tone === 'bad' ? 'Your notes are kept locally.' : undefined, action: tone === 'bad' ? { label: 'Retry', onClick: noop } : undefined }]);
  return (
    <Section id="primitives" title="Primitives" lede="The vocabulary underneath. Tokens only, keyboard reachable, visible focus, status never by colour alone.">
      <div className="g-grid g-grid--3">
        <Specimen label="Button · variants">
          <div className="g-wrap">
            <Button variant="primary" icon="check">
              Used it
            </Button>
            <Button>Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger" icon="phone-off">
              End call
            </Button>
          </div>
        </Specimen>
        <Specimen label="Button · sizes and states">
          <div className="g-wrap">
            <Button size="sm">Small</Button>
            <Button size="lg" variant="primary">
              Large
            </Button>
            <Button loading variant="primary">
              Saving
            </Button>
            <Button disabled>Disabled</Button>
          </div>
        </Specimen>
        <Specimen label="IconButton · with tooltips">
          <div className="g-wrap">
            <IconButton icon="settings" label="Settings" />
            <IconButton icon="thumbs-up" label="Good suggestion" pressed />
            <IconButton icon="copy" label="Copy" variant="secondary" />
            <IconButton icon="phone-off" label="End call" variant="danger" />
            <IconButton icon="close" label="Dismiss" size="sm" />
          </div>
        </Specimen>
        <Specimen label="Icon set" wide>
          <div className="g-icons">
            {ICON_NAMES.map((n) => (
              <Tooltip key={n} label={n}>
                <span className="g-icon" tabIndex={0}>
                  <Icon name={n} size={20} />
                </span>
              </Tooltip>
            ))}
          </div>
        </Specimen>
        <Specimen label="Chip · tones">
          <div className="g-wrap">
            <Chip>Neutral</Chip>
            <Chip tone="accent">D&amp;O</Chip>
            <Chip tone="ok" icon="check">
              Within policy
            </Chip>
            <Chip tone="warn">Check later</Chip>
            <Chip tone="bad" icon="alert">
              Breaks policy
            </Chip>
            <Chip tone="info">Info</Chip>
            <Chip family="objection" icon="shield">
              Family
            </Chip>
            <Chip onClick={noop} selected>
              Toggle
            </Chip>
          </div>
        </Specimen>
        <Specimen label="Kbd · Switch · SegmentedControl">
          <div className="g-stack">
            <Kbd keys={['⌘', 'Enter']} />
            <Switch label="Follow the transcript" description="Scrolls with new turns" checked={sw} onCheckedChange={setSw} />
            <Switch label="Disabled" checked={false} onCheckedChange={noop} disabled />
            <SegmentedControl
              label="Drawer"
              showLabel
              value={seg}
              onChange={setSeg}
              options={[
                { value: 'one', label: 'Brief' },
                { value: 'two', label: 'Transcript' },
                { value: 'three', label: 'Flags' },
              ]}
            />
          </div>
        </Specimen>
        <Specimen label="TextField · TextArea">
          <div className="g-stack">
            <TextField label="A better line" value={text} onChange={(e) => setText(e.target.value)} hint="What you wish you'd said." maxLength={60} />
            <TextField label="With an error" defaultValue="maya@" error="That email is missing its domain." />
            <TextField label="Disabled" defaultValue="Read only" disabled />
            <TextArea label="Notes" optional placeholder="Anything else" />
          </div>
        </Specimen>
        <Specimen label="Rating">
          <Rating label="How did it go?" value={rating} onChange={setRating} />
          <Rating label="Unrated" value={null} onChange={noop} />
        </Specimen>
        <Specimen label="Drawer">
          <Drawer title="Brief" icon="spark" defaultOpen meta="3 hooks">
            <p className="g-copy">Drawers collapse with the grid-rows trick: interruptible, no measuring.</p>
          </Drawer>
          <Drawer title="Transcript" icon="chat" meta={12}>
            <p className="g-copy">Hidden content is inert.</p>
          </Drawer>
        </Specimen>
        <Specimen label="Dialog · Sheet · Toast">
          <div className="g-wrap">
            <Button onClick={() => setDialog(true)}>Open dialog</Button>
            <Button onClick={() => setSheet(true)}>Open sheet</Button>
            <Button onClick={() => addToast('ok')}>Toast</Button>
            <Button onClick={() => addToast('bad')}>Error toast</Button>
          </div>
          <ToastRegion inline toasts={[{ id: 'a', tone: 'ok', title: 'Debrief saved', description: 'Cue is learning from this call.', duration: null }, { id: 'b', tone: 'warn', title: 'Mic paused', duration: null }]} onDismiss={noop} />
          <ToastRegion toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
          <Dialog open={dialog} onClose={() => setDialog(false)} eyebrow="Debrief" title="How did it go?" description="Maya Chen · CEO · Lumen Labs">
            <div className="g-sheet-body">
              <p className="g-copy">Work that belongs to the current screen opens here, never in a new page. Escape, the close button or the backdrop close it.</p>
              <Button variant="primary" onClick={() => setDialog(false)}>
                Done
              </Button>
            </div>
          </Dialog>
          <Sheet open={sheet} onClose={() => setSheet(false)} title="A bottom sheet" modal>
            <div className="g-sheet-body">
              <p className="g-copy">Drag the handle down or flick to close. Escape closes too.</p>
              <Button variant="primary" onClick={() => setSheet(false)}>
                Done
              </Button>
            </div>
          </Sheet>
        </Specimen>
        <Specimen label="Skeleton · Meter · Sparkline">
          <div className="g-stack">
            <Skeleton lines={3} />
            <Meter value={18} max={25} label="Examples" valueText="18 / 25" />
            <Meter value={25} max={25} tone="ok" label="Examples" valueText="25 / 25" />
            <Meter value={0.2} tone="bad" label="Errors" showLabel valueText="20%" />
            <Sparkline values={[0.2, 0.1, -0.3, -0.5, -0.2, 0.4, 0.8]} min={-1} max={1} baseline={0} width={120} height={32} label="Receptivity over the call" />
          </div>
        </Specimen>
        <Specimen label="EmptyState · ErrorState">
          <EmptyState compact title="No flags">
            Everything said so far is within policy.
          </EmptyState>
          <ErrorState message="Mubit didn't answer in time. The playbook's top line is showing instead." onRetry={noop} compact />
        </Specimen>
        <Specimen label="EmptyState with Sprout">
          <EmptyState art={<Sprout state="idle" size={72} />} title="Ready when you are" action={<Button variant="primary">Add a contact</Button>}>
            Start a call in Trellus and Cue will show the line to say next.
          </EmptyState>
        </Specimen>
        <Specimen label="ScrollArea · edge fades">
          <ScrollArea maxHeight={140} label="Scrollable example">
            <ol className="g-numbers">
              {Array.from({ length: 14 }, (_, i) => (
                <li key={i}>Line {i + 1} of a list that scrolls</li>
              ))}
            </ol>
          </ScrollArea>
        </Specimen>
      </div>
    </Section>
  );
}
