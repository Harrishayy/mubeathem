import { DEMO_PROSPECT, type Prospect } from '@cue/core';
import { Button, Icon, Kbd, SegmentedControl, Sprout, TextField } from '@cue/ui';
import { useState, type FormEvent } from 'react';
import { runDemo } from '../../demo/runner';
import { demoStore } from '../../demo/runner';
import { startCall } from '../../state/call';
import { settingsStore, updateSettings, type DemoVariant } from '../../state/settings';
import { useStore } from '../../state/store';
import { toast } from '../../state/ui';

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

const EMPTY = { name: '', title: '', company: '', phone: '', funding: '' };

/** The calm start screen: a minimal call composer and the hands-free demo. */
export function NewCall() {
  const s = useStore(settingsStore);
  const demo = useStore(demoStore, (d) => d.status);
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const prospect: Prospect = {
      name: f.name.trim(),
      title: f.title.trim(),
      company: f.company.trim(),
      ...(f.phone.trim() ? { phone: f.phone.trim() } : {}),
      facts: f.funding.trim() ? { funding: f.funding.trim() } : {},
    };
    try {
      await startCall({ source: 'cue', prospect, rep: { id: s.repId, name: s.repName } });
    } catch (err) {
      toast({ tone: 'bad', title: 'Could not start the call', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const fillDemo = () =>
    setF({ name: DEMO_PROSPECT.name, title: DEMO_PROSPECT.title, company: DEMO_PROSPECT.company, phone: DEMO_PROSPECT.phone ?? '', funding: DEMO_PROSPECT.facts.funding ?? '' });

  const demoBusy = demo === 'starting' || demo === 'running' || demo === 'paused';

  return (
    <div className="web-start">
      <section className="web-start__intro">
        <p className="web-eyebrow">Cue · live cold-call overbar</p>
        <h1 className="web-display">Know exactly what to say next.</h1>
        <p className="web-lead">
          Cue reads every prospect turn, recognises the moment and puts the one line that books meetings right there, in a bar that floats over your dialer.
        </p>
        <ul className="web-keys" aria-label="Shortcuts during a call">
          <li>
            <Kbd keys={[MOD, '.']} /> expand
          </li>
          <li>
            <Kbd keys={['U']} /> used it
          </li>
          <li>
            <Kbd keys={['D']} /> dismiss
          </li>
          <li>
            <Kbd keys={['E']} /> edit
          </li>
          <li>
            <Kbd keys={['B']} /> booked
          </li>
          <li>
            <Kbd keys={['Space']} /> hold to talk as you
          </li>
        </ul>
      </section>

      <section className="web-panel web-start__demo" aria-labelledby="demo-title">
        <div className="web-start__demo-art">
          <Sprout state={demoBusy ? 'thinking' : 'idle'} size={64} />
        </div>
        <div className="web-start__demo-body">
          <h2 className="web-h2" id="demo-title">
            Watch a call
          </h2>
          <p className="web-muted">Plays the Lumen Labs call against the real server: gatekeeper, the cold “what's this regarding?”, the broker objection, a compliance slip and the booking. Hands-free, the same every time.</p>
          <SegmentedControl<DemoVariant>
            label="Prospect's mood"
            size="sm"
            options={[
              { value: 'cold', label: 'Cold' },
              { value: 'warm', label: 'Warm' },
              { value: 'both', label: 'Both' },
            ]}
            value={s.demoVariant}
            onChange={(v) => updateSettings({ demoVariant: v })}
          />
          <div className="web-row">
            <Button variant="primary" icon="play" onClick={() => void runDemo()} loading={demo === 'starting'} disabled={demoBusy}>
              Run the demo
            </Button>
          </div>
        </div>
      </section>

      <form className="web-panel web-start__form" onSubmit={submit} aria-labelledby="new-call-title">
        <div className="web-panel__head">
          <h2 className="web-h2" id="new-call-title">
            New call
          </h2>
          <Button size="sm" variant="ghost" icon="spark" onClick={fillDemo}>
            Demo prospect
          </Button>
        </div>
        <div className="web-grid-2">
          <TextField label="Name" value={f.name} onChange={set('name')} maxLength={200} autoComplete="off" placeholder="Maya Chen" />
          <TextField label="Title" value={f.title} onChange={set('title')} maxLength={200} autoComplete="off" placeholder="CEO" />
          <TextField label="Company" value={f.company} onChange={set('company')} maxLength={200} autoComplete="off" placeholder="Lumen Labs" />
          <TextField label="Phone" optional value={f.phone} onChange={set('phone')} maxLength={40} inputMode="tel" autoComplete="off" />
        </div>
        <TextField label="What you know" optional hint="Funding, headcount, anything the brief should use." value={f.funding} onChange={set('funding')} maxLength={500} />
        <div className="web-row web-row--end">
          <span className="web-muted web-small">
            <Icon name="shield" size={14} /> Only you speak. Cue whispers.
          </span>
          <Button type="submit" variant="primary" icon="phone" loading={busy}>
            Start call
          </Button>
        </div>
      </form>
    </div>
  );
}
