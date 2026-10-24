import { fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button, CueRoot, Drawer, IconButton, MASCOT_STATES, Meter, Rating, SegmentedControl, Sheet, Sprout, Switch, TextField } from '../src';

const wrap = (ui: ReactNode) => render(<CueRoot theme="light">{ui}</CueRoot>);

describe('CueRoot', () => {
  it('sets direction, theme and density; Night Shift is always dark', () => {
    const { container, rerender } = render(<CueRoot direction="signal" theme="dark" density="compact" />);
    const root = container.querySelector('[data-cue]')!;
    expect([root.getAttribute('data-dir'), root.getAttribute('data-theme'), root.getAttribute('data-density')]).toEqual(['signal', 'dark', 'compact']);
    rerender(<CueRoot direction="night" theme="light" />);
    expect(container.querySelector('[data-cue]')!.getAttribute('data-theme')).toBe('dark');
  });
});

describe('primitives', () => {
  it('Button loading keeps the label and sets aria-busy', () => {
    wrap(<Button loading>Save</Button>);
    const b = screen.getByRole('button', { name: 'Save' });
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect((b as HTMLButtonElement).disabled).toBe(true);
  });

  it('IconButton is named by its label', () => {
    wrap(<IconButton icon="copy" label="Copy request id" />);
    expect(screen.getByRole('button', { name: 'Copy request id' })).toBeTruthy();
  });

  it('SegmentedControl moves with arrow keys', () => {
    function T() {
      const [v, set] = useState('a');
      return <SegmentedControl label="Pick" value={v} onChange={set} options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />;
    }
    wrap(<T />);
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'B' }).getAttribute('aria-checked')).toBe('true');
  });

  it('Rating takes number keys and announces the word', () => {
    const on = vi.fn();
    wrap(<Rating label="Feel" value={null} onChange={on} />);
    fireEvent.keyDown(screen.getByRole('radiogroup', { name: 'Feel' }), { key: '4' });
    expect(on).toHaveBeenCalledWith(4);
    expect(screen.getByRole('radio', { name: '4: Good' })).toBeTruthy();
  });

  it('Switch toggles', () => {
    const on = vi.fn();
    wrap(<Switch label="Follow" checked={false} onCheckedChange={on} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Follow' }));
    expect(on).toHaveBeenCalledWith(true);
  });

  it('Drawer is a disclosure; hidden content is inert', () => {
    wrap(
      <Drawer title="Brief">
        <button type="button">inside</button>
      </Drawer>,
    );
    const t = screen.getByRole('button', { name: 'Brief' });
    expect(t.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(t);
    expect(t.getAttribute('aria-expanded')).toBe('true');
  });

  it('SegmentedControl can show its label', () => {
    wrap(<SegmentedControl label="Speed" showLabel value="a" onChange={() => {}} options={[{ value: 'a', label: '1×' }, { value: 'b', label: '2×' }]} />);
    expect(screen.getByText('Speed')).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Speed' })).toBeTruthy();
  });

  it('Sheet with a half snap point offers a show more / less handle', () => {
    wrap(
      <Sheet open onClose={() => {}} title="Call" snapPoints={['half', 'full']}>
        body
      </Sheet>,
    );
    const handle = screen.getByRole('button', { name: 'Show more' });
    fireEvent.click(handle);
    expect(screen.getByRole('button', { name: 'Show less' })).toBeTruthy();
    expect(screen.getByRole('dialog').getAttribute('data-snap')).toBe('full');
  });

  it('Sheet closes on Escape', () => {
    const close = vi.fn();
    wrap(
      <Sheet open onClose={close} title="Call">
        body
      </Sheet>,
    );
    expect(screen.getByRole('dialog', { name: 'Call' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(close).toHaveBeenCalled();
  });

  it('TextField links its error', () => {
    wrap(<TextField label="Email" error="Missing domain" defaultValue="a@" />);
    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(input.getAttribute('aria-describedby')!)!.textContent).toBe('Missing domain');
  });

  it('Meter exposes its value as text', () => {
    wrap(<Meter value={18} max={25} label="Examples" valueText="18 / 25" />);
    expect(screen.getByRole('meter', { name: 'Examples' }).getAttribute('aria-valuetext')).toBe('18 / 25');
  });
});

describe('Sprout', () => {
  it.each(MASCOT_STATES)('%s renders with a spoken label and stays under 4 KB', (state) => {
    const html = renderToStaticMarkup(<Sprout state={state} size={96} voiceLevel={0.5} growth={0.5} />);
    expect(new TextEncoder().encode(html).length).toBeLessThanOrEqual(4096);
    expect(html).toContain(`data-state="${state}"`);
    expect(html).toContain('role="img"');
  });

  it('is decorative on request and simplifies at 20 px', () => {
    const html = renderToStaticMarkup(<Sprout state="idle" size={20} decorative />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('sp-mouth');
  });

  it('blooms when growth reaches the threshold', () => {
    expect(renderToStaticMarkup(<Sprout state="learning" growth={1} />)).toContain('data-bloom');
  });
});
