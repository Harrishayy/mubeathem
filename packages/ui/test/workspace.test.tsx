import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { CueRoot, Kpi, KpiStrip, Pane, Workspace } from '../src';

const wrap = (ui: ReactNode) => render(<CueRoot theme="light">{ui}</CueRoot>);

function Screen({ storageKey }: { storageKey?: string }) {
  const [tab, setTab] = useState('a');
  return (
    <Workspace
      storageKey={storageKey}
      rail={{ label: 'Filters', summary: '3 on', children: <Pane label="Filters" side="rail">rail body</Pane> }}
      drawer={{ label: 'Requests', count: 12, children: <Pane label="Requests" side="drawer">drawer body</Pane> }}
    >
      <KpiStrip foldId="kpis">
        <Kpi label="Calls" value="751" />
        <Kpi label="Spend" value="$0.62" />
      </KpiStrip>
      <Pane paneId="out" label="Outcomes" summary="16% booked with a cue" tabs={[{ id: 'a', label: 'By moment', count: 12 }, { id: 'b', label: 'Top lines' }]} tab={tab} onTab={setTab}>
        {tab === 'a' ? 'moments table' : 'lines table'}
      </Pane>
      <Pane paneId="jobs" label="AI jobs" summary="13 timeouts">
        jobs table
      </Pane>
    </Workspace>
  );
}

afterEach(() => window.localStorage.clear());

describe('Workspace', () => {
  it('folds the rail and drawer to labelled strips and opens them again', () => {
    wrap(<Screen />);
    fireEvent.click(within(screen.getByRole('region', { name: 'Filters' })).getByRole('button', { name: 'Fold filters' }));
    expect(screen.queryByText('rail body')).toBeNull();
    const strip = screen.getByRole('button', { name: 'Show filters' });
    expect(strip.textContent).toContain('3 on');
    fireEvent.click(strip);
    expect(screen.getByText('rail body')).toBeTruthy();

    fireEvent.click(within(screen.getByRole('region', { name: 'Requests' })).getByRole('button', { name: 'Fold requests' }));
    expect(screen.getByRole('button', { name: 'Show requests' }).textContent).toContain('12');
  });

  it('[ and ] fold the sides; typing in a field does not', () => {
    wrap(
      <>
        <input aria-label="Search" />
        <Screen />
      </>,
    );
    fireEvent.keyDown(document.body, { key: '[' });
    expect(screen.getByRole('button', { name: 'Show filters' })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: ']' });
    expect(screen.getByRole('button', { name: 'Show requests' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search' }), { key: '[' });
    expect(screen.getByRole('button', { name: 'Show filters' })).toBeTruthy();
  });

  it('a pane folds to its head and keeps its summary; the others share the space', () => {
    wrap(<Screen />);
    const jobs = screen.getByRole('region', { name: 'AI jobs' });
    fireEvent.click(within(jobs).getByRole('button', { name: 'Fold ai jobs' }));
    expect(jobs.className).toContain('is-folded');
    expect(within(jobs).queryByText('jobs table')).toBeNull();
    expect(within(jobs).getByText('13 timeouts')).toBeTruthy();
    expect(within(jobs).getByRole('button', { name: 'Open ai jobs' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('focus fills the centre with one pane, hides the numbers, and Esc brings everything back', () => {
    const { container } = wrap(<Screen />);
    fireEvent.click(within(screen.getByRole('region', { name: 'Outcomes' })).getByRole('button', { name: 'Focus outcomes' }));
    expect(container.querySelector('.cue-ws')!.getAttribute('data-focus')).toBe('out');
    expect(screen.getByRole('region', { name: 'Outcomes' }).className).toContain('is-focused');
    expect(screen.queryByText('751')).toBeNull();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(container.querySelector('.cue-ws')!.hasAttribute('data-focus')).toBe(false);
    expect(screen.getByText('751')).toBeTruthy();
  });

  it('tabs are a tablist with the panel labelled by the chosen tab', () => {
    wrap(<Screen />);
    const out = screen.getByRole('region', { name: 'Outcomes' });
    const tabs = within(out).getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    fireEvent.click(tabs[1]!);
    expect(within(out).getByText('lines table')).toBeTruthy();
    expect(within(out).getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tabs[1]!.id);
  });

  it('KPIs fold to a one-line ticker with the same figures', () => {
    wrap(<Screen />);
    fireEvent.click(screen.getByRole('button', { name: 'Fold the numbers' }));
    const ticker = screen.getByRole('group', { name: 'Headline numbers' });
    expect(ticker.textContent).toContain('Calls');
    expect(ticker.textContent).toContain('751');
    expect(ticker.textContent).toContain('$0.62');
  });

  it('remembers folds per screen', () => {
    const first = wrap(<Screen storageKey="t1" />);
    fireEvent.click(within(screen.getByRole('region', { name: 'AI jobs' })).getByRole('button', { name: 'Fold ai jobs' }));
    act(() => first.unmount());
    wrap(<Screen storageKey="t1" />);
    expect(screen.getByRole('region', { name: 'AI jobs' }).className).toContain('is-folded');
  });
});
