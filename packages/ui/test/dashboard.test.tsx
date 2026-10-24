import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AppBar, Bar, CallTimeline, CueRoot, CueStage, DataTable, KeyValue, Kpi, Pane, StatGrid, packRows } from '../src';
import { VIEWS } from '../src/fixtures/views';

const wrap = (ui: ReactNode) => render(<CueRoot theme="light">{ui}</CueRoot>);

describe('dashboard primitives', () => {
  it('Pane is a named landmark with head, body and footer', () => {
    wrap(
      <Pane label="Transcript" meta="8 turns" actions={<button type="button">Filter</button>} footer={<button type="button">Send</button>}>
        <p>body</p>
      </Pane>,
    );
    const pane = screen.getByRole('region', { name: 'Transcript' });
    expect(within(pane).getByText('8 turns')).toBeTruthy();
    expect(within(pane).getByRole('button', { name: 'Send' }).closest('.cue-pane__foot')).toBeTruthy();
  });

  it('DataTable selects rows by click, Enter and Space, and marks the selection', () => {
    const onSelect = vi.fn();
    const rows = [
      { id: 'a', t: 'First line' },
      { id: 'b', t: 'Second line' },
    ];
    wrap(<DataTable label="Lines" rows={rows} rowKey={(r) => r.id} selectedKey="a" onSelect={onSelect} columns={[{ key: 't', header: 'Line', render: (r) => r.t }]} />);
    const [, first, second] = screen.getAllByRole('row');
    expect(first!.getAttribute('aria-selected')).toBe('true');
    expect(second!.getAttribute('aria-selected')).toBe('false');
    fireEvent.click(second!);
    fireEvent.keyDown(second!, { key: 'Enter' });
    fireEvent.keyDown(first!, { key: ' ' });
    expect(onSelect.mock.calls.map((c) => c[0].id)).toEqual(['b', 'b', 'a']);
    // The table scrolls inside its own region, never the page.
    expect(screen.getByRole('region', { name: 'Lines' }).className).toContain('cue-table-wrap');
  });

  it('DataTable shows the empty state instead of an empty table', () => {
    wrap(<DataTable label="Lines" rows={[]} rowKey={() => 'x'} columns={[]} empty={<p>Nothing yet</p>} />);
    expect(screen.getByText('Nothing yet')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('AppBar marks the active tab and shows counts and the live dot', () => {
    wrap(<AppBar active="playbook" tabs={[{ id: 'live', label: 'Live', href: '#/live', live: true }, { id: 'playbook', label: 'Playbook', href: '#/playbook', count: 42 }]} />);
    expect(screen.getByRole('link', { name: /Playbook/ }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: /Live/ }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByLabelText('call in progress')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
  });

  it('Bar clamps out-of-range and non-finite values', () => {
    const { container } = wrap(
      <>
        <Bar value={1.7} label="max" />
        <Bar value={-2} />
        <Bar value={Number.NaN} />
      </>,
    );
    const fills = [...container.querySelectorAll<HTMLElement>('.cue-bar-h__fill')].map((f) => f.style.transform);
    expect(fills).toEqual(['scaleX(1.0000)', 'scaleX(0.0000)', 'scaleX(0.0000)']);
  });

  it('Kpi, KeyValue and StatGrid render their labels and values', () => {
    wrap(
      <>
        <Kpi label="Spend" value="$0.59" note="list price" />
        <KeyValue items={[{ label: 'Stage', value: 'Series A' }]} />
        <StatGrid items={[{ label: 'Cues used', value: '3/4' }]} />
      </>,
    );
    for (const t of ['Spend', '$0.59', 'Stage', 'Series A', 'Cues used', '3/4']) expect(screen.getByText(t)).toBeTruthy();
  });
});

describe('call timeline', () => {
  it('packRows never puts two flags closer than a flag width in one row', () => {
    const xs = [0.1, 0.11, 0.12, 0.5, 0.505, 0.99];
    const width = 400;
    const rows = packRows(xs, width);
    const placed = xs.map((x, i) => ({ px: Math.min(x * width, width - 40), row: rows[i]! }));
    for (const a of placed) for (const b of placed) if (a !== b && a.row === b.row) expect(Math.abs(a.px - b.px)).toBeGreaterThanOrEqual(40);
    expect(rows.slice(0, 3)).toEqual([0, 1, 2]);
  });

  it('lists every cue with a text equivalent and draws a now rule', () => {
    const v = VIEWS.booked();
    const { container } = wrap(<CallTimeline view={v} />);
    const items = container.querySelectorAll('.cue-tl__cue');
    expect(items.length).toBe(v.history.length);
    expect(items[0]!.textContent).toMatch(/Q01.*Q01 at \d\d:\d\d/);
    expect(container.querySelectorAll('.cue-tl__now').length).toBeGreaterThan(0);
  });
});

describe('CueStage', () => {
  it('flush variant renders the live card with its actions', () => {
    const v = VIEWS.objection();
    const onAction = vi.fn();
    wrap(<CueStage view={v} onAction={onAction} variant="flush" />);
    fireEvent.click(screen.getByRole('button', { name: 'Used it' }));
    expect(onAction).toHaveBeenCalledWith(v.current!.id, 'used', undefined);
    expect(document.querySelector('.cue-stage--flush')).toBeTruthy();
  });
});
