import { type Receptivity } from '@cue/core';
import { Button, Chip, IconButton, Overbar, SegmentedControl, Sprout, TextField, TranscriptView } from '@cue/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useCapture } from '../capture/useCapture';
import { dispatchSpeaker } from '../capture/speaker';
import { navigate } from '../router';
import { getApi } from '../state/api';
import { addTurn, callStore, detachCall, endCall, startCall } from '../state/call';
import { settingsStore } from '../state/settings';
import { useStore } from '../state/store';
import { toast } from '../state/ui';
import { useOverbar } from '../shell/useOverbar';

type Role = 'ceo' | 'cfo' | 'engineer' | 'gatekeeper';
const ROLE_TITLE: Record<Role, string> = { ceo: 'CEO', cfo: 'CFO', engineer: 'VP Engineering', gatekeeper: 'Executive Assistant' };
const ROLE_NAME: Record<Role, string> = { ceo: 'Jordan Park', cfo: 'Priya Natarajan', engineer: 'Sam Okafor', gatekeeper: 'Riley Brooks' };
const ROLE_LABEL: Record<Role, string> = { ceo: 'CEO', cfo: 'CFO', engineer: 'Engineer', gatekeeper: 'Gatekeeper' };
const OBJECTIONS = ['We already have a broker', 'Just send me an email', 'Now is not a good time', "We're not interested", 'How much does it cost?', "We're covered already"];

/** Let the rep finish a thought (several mic finals) before the prospect answers. */
const REPLY_DEBOUNCE_MS = 1_100;

function speak(text: string) {
  try {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.04;
    window.speechSynthesis.speak(u);
  } catch {
    /* no voice: the line is on screen anyway */
  }
}

/** Practice: a simulated prospect (simulate_prospect through Mubit) replies to what you say. */
export function Practice() {
  const { view } = useStore(callStore);
  const practicing = view?.source === 'practice';
  return <div className="web-screen web-page web-practice">{practicing && view ? <PracticeCall /> : <PracticeSetup />}</div>;
}

function PracticeSetup() {
  const s = useStore(settingsStore);
  const other = useStore(callStore, (c) => (c.view && c.view.source !== 'practice' && c.view.status === 'live' ? c.view : null));
  const [role, setRole] = useState<Role>('ceo');
  const [mood, setMood] = useState<Receptivity>('cool');
  const [objections, setObjections] = useState<string[]>([OBJECTIONS[0]!]);
  const [company, setCompany] = useState('Northwind Robotics');
  const [busy, setBusy] = useState(false);

  const toggle = (o: string) => setObjections((xs) => (xs.includes(o) ? xs.filter((x) => x !== o) : xs.length >= 6 ? xs : [...xs, o]));

  const start = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const v = await startCall({
        source: 'practice',
        prospect: { name: ROLE_NAME[role], title: ROLE_TITLE[role], company: company.trim() || 'Northwind Robotics', facts: { funding: 'Seed, $4M (last year)' } },
        rep: { id: s.repId, name: s.repName },
        practice: { mood, objections },
      });
      // The prospect picks up first.
      const r = await getApi().practiceNext(v.id);
      if (s.practiceVoice) speak(r.turn.text);
    } catch (err) {
      toast({ tone: 'bad', title: 'Could not start practice', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="web-page__head">
        <div>
          <p className="web-eyebrow">Practice</p>
          <h1 className="web-h1">Rehearse the track</h1>
          <p className="web-muted">A simulated prospect answers what you say, and Cue coaches you live, exactly as on a real call.</p>
        </div>
      </header>
      {other && (
        <p className="web-note web-note--warn" role="status">
          A live call is on. Starting practice will leave it running in the background.
        </p>
      )}
      <form className="web-panel web-stack web-practice__setup" onSubmit={start}>
        <fieldset className="web-fieldset">
          <legend className="cue-field__label">Who picks up</legend>
          <div className="web-chips" role="radiogroup" aria-label="Who picks up">
            {(Object.keys(ROLE_TITLE) as Role[]).map((r) => (
              <Chip key={r} onClick={() => setRole(r)} selected={role === r} icon={role === r ? 'check' : undefined}>
                {ROLE_LABEL[r]}
              </Chip>
            ))}
          </div>
        </fieldset>
        <SegmentedControl<Receptivity>
          label="Their mood"
          options={[
            { value: 'warm', label: 'Warm' },
            { value: 'neutral', label: 'Neutral' },
            { value: 'cool', label: 'Cool' },
            { value: 'cold', label: 'Cold' },
          ]}
          value={mood}
          onChange={setMood}
        />
        <fieldset className="web-fieldset">
          <legend className="cue-field__label">Objections they'll raise</legend>
          <div className="web-chips">
            {OBJECTIONS.map((o) => (
              <Chip key={o} onClick={() => toggle(o)} selected={objections.includes(o)} icon={objections.includes(o) ? 'check' : 'plus'}>
                {o}
              </Chip>
            ))}
          </div>
        </fieldset>
        <TextField label="Company" value={company} onChange={(e) => setCompany(e.target.value)} maxLength={200} />
        <div className="web-row web-row--end">
          <Button type="submit" variant="primary" icon="phone" loading={busy}>
            Start practice call
          </Button>
        </div>
      </form>
    </>
  );
}

function PracticeCall() {
  const { view } = useStore(callStore);
  const voice = useStore(settingsStore, (s) => s.practiceVoice);
  const transcriber = useStore(settingsStore, (s) => s.transcriber);
  const props = useOverbar();
  const capture = useCapture(view?.startedAt ?? null);
  const [text, setText] = useState('');
  const [replying, setReplying] = useState(false);
  const answered = useRef<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // In practice the mic is always you.
  useEffect(() => {
    dispatchSpeaker({ type: 'lock', speaker: 'rep' });
    return () => dispatchSpeaker({ type: 'lock', speaker: null });
  }, []);

  const finals = view?.turns.filter((t) => t.final) ?? [];
  const last = finals.at(-1);
  const live = view?.status === 'live';

  // When you've spoken (typed or mic) and paused, the prospect answers.
  useEffect(() => {
    if (!view || !live || !last || last.speaker !== 'rep' || replying || answered.current === last.id) return;
    const id = last.id;
    const timer = setTimeout(async () => {
      answered.current = id;
      setReplying(true);
      try {
        const r = await getApi().practiceNext(view.id);
        if (voice) speak(r.turn.text);
        if (r.ended) {
          await new Promise((res) => setTimeout(res, 1_800));
          await endCall(r.booked ? 'meeting_booked' : undefined);
          navigate({ name: 'debrief', id: view.id });
        }
      } catch (err) {
        toast({ tone: 'bad', title: 'The prospect went quiet', description: err instanceof Error ? err.message : String(err) });
      } finally {
        setReplying(false);
      }
    }, REPLY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [last?.id, last?.speaker, live, replying, view, voice]);

  if (!view) return null;

  const send = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    addTurn({ speaker: 'rep', text: t, final: true, tMs: Math.max(0, Date.now() - view.startedAt), via: 'typed' });
    setText('');
    input.current?.focus();
  };

  return (
    <div className="web-practice__call">
      <section className="web-practice__bar" aria-label="Cue">
        <Overbar {...props} mode="expanded" onModeChange={() => {}} placement="inline" />
      </section>
      <section className="web-panel web-practice__talk" aria-label="Conversation">
        <div className="web-panel__head">
          <div className="web-row">
            <Sprout state={replying ? 'thinking' : 'listening'} size={28} decorative />
            <h2 className="web-h3 web-trunc">
              {view.prospect.name} · {view.prospect.title}
            </h2>
          </div>
          {live ? (
            <Button size="sm" variant="ghost" icon="phone-off" onClick={async () => (await endCall(), navigate({ name: 'debrief', id: view.id }))}>
              Hang up
            </Button>
          ) : (
            <Button size="sm" variant="ghost" icon="plus" onClick={detachCall}>
              New practice
            </Button>
          )}
        </div>
        <TranscriptView turns={finals} interim={view.turns.at(-1)?.final === false ? view.turns.at(-1)! : null} names={{ prospect: view.prospect.name.split(' ')[0] }} maxHeight="min(46vh, 460px)" />
        {replying && (
          <p className="web-typing" role="status">
            <span className="web-typing__dots" aria-hidden>
              <span />
              <span />
              <span />
            </span>
            {view.prospect.name.split(' ')[0]} is replying
          </p>
        )}
        {live && (
          <form className="web-say__row" onSubmit={send}>
            {transcriber === 'webspeech' && capture.supported && (
              <IconButton
                icon={capture.state === 'listening' ? 'mic-off' : 'mic'}
                label={capture.state === 'listening' ? 'Stop the mic' : 'Speak instead'}
                variant={capture.state === 'listening' ? 'danger' : 'secondary'}
                onClick={() => (capture.state === 'listening' ? capture.stop() : void capture.start())}
              />
            )}
            <label className="web-sr" htmlFor="practice-say">
              What you say
            </label>
            <input id="practice-say" ref={input} className="web-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Say your line…" maxLength={4000} autoComplete="off" autoFocus />
            <IconButton icon="arrow-right" label="Say it" type="submit" variant="primary" disabled={!text.trim()} />
          </form>
        )}
        {capture.error && <p className="web-note web-note--warn">{capture.error}</p>}
      </section>
    </div>
  );
}
