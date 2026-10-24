import { OUTCOME_LABEL, OUTCOMES, type Outcome } from '@cue/core';
import { ActionBar, Button, Chip, DataTable, Pane, Skeleton, type Column } from '@cue/ui';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { request, type TrellusDispositions } from '../../src/messages';

const VIA_LABEL = { default: 'default', keyword: 'guessed', override: 'yours', unmapped: 'not mapped' } as const;

type Row = TrellusDispositions['learned'][number];

/**
 * How each Trellus disposition maps to the outcome Cue learns from, as a ruled table. Unmapped ones
 * come first: an unmapped "booked" disposition means Cue never hears that a line worked.
 */
export function DispositionsScreen({ onOpenSettings }: { onOpenSettings: () => void }) {
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

  const columns: Column<Row>[] = [
    {
      key: 'raw',
      header: 'Trellus disposition',
      render: (row) => (
        <label htmlFor={`dispo-${row.raw}`} className="sp-dispo__raw">
          {row.raw}
        </label>
      ),
    },
    {
      key: 'outcome',
      header: 'Cue outcome',
      width: '42%',
      render: (row) => {
        const value = edits[row.raw] ?? data!.map[row.raw] ?? '';
        return (
          <span className="sp-dispo__cell">
            <select
              id={`dispo-${row.raw}`}
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
          </span>
        );
      },
    },
  ];

  const unmappedCount = data ? data.unmapped.filter((u) => !edits[u]).length : 0;
  const editCount = Object.keys(edits).length;

  return (
    <form onSubmit={save} className="sp-form" aria-label="Dispositions to outcomes">
      <Pane
        label="Dispositions to outcomes"
        meta={data ? (unmappedCount > 0 ? `${unmappedCount} not mapped` : `${rows.length} mapped`) : undefined}
        pad="none"
        scroll={false}
        footer={
          rows.length > 0 ? (
            <ActionBar
              end={
                saved ? (
                  <Chip size="sm" tone="ok" icon="check">
                    Saved
                  </Chip>
                ) : undefined
              }
            >
              <Button type="submit" variant="primary" loading={saving} disabled={editCount === 0}>
                {editCount > 0 ? `Save ${editCount} ${editCount === 1 ? 'change' : 'changes'}` : 'Save mapping'}
              </Button>
            </ActionBar>
          ) : undefined
        }
      >
        {!data && !error && (
          <div className="sp-pad">
            <Skeleton lines={3} />
          </div>
        )}
        {(data?.error || error) && (
          <p className="sp-banner sp-banner--inset" role="alert">
            {error ?? data?.error}
          </p>
        )}
        {data && rows.length === 0 && (
          <div className="sp-pad sp-stack">
            <p className="sp-hint">No dispositions yet. They appear here once Trellus is connected and has synced a call.</p>
            <div>
              <Button size="sm" variant="secondary" icon="settings" onClick={onOpenSettings}>
                Connect Trellus
              </Button>
            </div>
          </div>
        )}
        {rows.length > 0 && <DataTable label="Trellus dispositions" columns={columns} rows={rows} rowKey={(r) => r.raw} minWidth={0} />}
      </Pane>
    </form>
  );
}
