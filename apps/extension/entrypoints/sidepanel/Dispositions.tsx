import { OUTCOME_LABEL, OUTCOMES, type Outcome } from '@cue/core';
import { Button, Chip, Skeleton } from '@cue/ui';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { request, type TrellusDispositions } from '../../src/messages';

const VIA_LABEL = { default: 'default', keyword: 'guessed', override: 'yours', unmapped: 'not mapped' } as const;

/**
 * How each Trellus disposition maps to the outcome Cue learns from. Unmapped ones come first: an
 * unmapped "booked" disposition means Cue never hears that a line worked.
 */
export function DispositionsEditor() {
  const [data, setData] = useState<TrellusDispositions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Outcome>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void request<TrellusDispositions>({ type: 'trellus.dispositions' }).then((r) => (r.ok ? setData(r.data) : setError(r.error)));
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const unmapped = new Set(data.unmapped);
    return [...data.learned].sort((a, b) => Number(unmapped.has(b.raw)) - Number(unmapped.has(a.raw)) || a.raw.localeCompare(b.raw));
  }, [data]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!data) return;
    setSaving(true);
    const r = await request<TrellusDispositions>({ type: 'trellus.setDispositions', overrides: { ...data.overrides, ...edits } });
    setSaving(false);
    if (r.ok) {
      setData(r.data);
      setEdits({});
      setSaved(true);
      setError(null);
    } else setError(r.error);
  };

  if (!data && !error) return <Skeleton lines={3} />;

  return (
    <form className="sp-dispo" onSubmit={save} aria-labelledby="set-dispo">
      <h3 id="set-dispo" className="sp-label">
        Dispositions to outcomes
      </h3>
      {data?.error && <p className="sp-hint">{data.error}</p>}
      {error && (
        <p className="sp-banner" role="alert">
          {error}
        </p>
      )}
      {data && rows.length === 0 && <p className="sp-hint">No dispositions yet. They appear once Trellus is connected.</p>}
      {rows.length > 0 && (
        <ul className="sp-dispo__list">
          {rows.map((row) => {
            const value = edits[row.raw] ?? data!.map[row.raw] ?? '';
            const id = `dispo-${row.raw}`;
            return (
              <li key={row.raw} className="sp-dispo__row">
                <label htmlFor={id} className="sp-dispo__raw">
                  {row.raw}
                </label>
                <select
                  id={id}
                  className="sp-select"
                  value={value}
                  onChange={(e) => {
                    setSaved(false);
                    setEdits({ ...edits, [row.raw]: e.target.value as Outcome });
                  }}
                >
                  {!value && <option value="">Not mapped</option>}
                  {OUTCOMES.map((o) => (
                    <option key={o} value={o}>
                      {OUTCOME_LABEL[o]}
                    </option>
                  ))}
                </select>
                <Chip size="sm" tone={row.via === 'unmapped' && !edits[row.raw] ? 'warn' : edits[row.raw] || row.via === 'override' ? 'accent' : 'neutral'}>
                  {edits[row.raw] ? 'edited' : VIA_LABEL[row.via]}
                </Chip>
              </li>
            );
          })}
        </ul>
      )}
      {rows.length > 0 && (
        <div className="sp-row">
          <Button type="submit" variant="secondary" loading={saving} disabled={Object.keys(edits).length === 0}>
            Save mapping
          </Button>
          {saved && (
            <Chip size="sm" tone="ok" icon="check">
              Saved
            </Chip>
          )}
        </div>
      )}
    </form>
  );
}
