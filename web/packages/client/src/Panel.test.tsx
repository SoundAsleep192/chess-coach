import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AnalysisData, BoardState, PanelSettings } from '@board/shared';
import { Panel, evalShare, formatEval } from './Panel';
import { StateBuilder } from './test-utils';

afterEach(cleanup);

describe('formatEval and evalShare', () => {
  it('formats white-side evals like Lichess', () => {
    expect(formatEval({ cp: 123 })).toBe('+1.2');
    expect(formatEval({ cp: -40 })).toBe('−0.4');
    expect(formatEval({ cp: 0 })).toBe('0.0');
    expect(formatEval({ mate: 3 })).toBe('#3');
    expect(formatEval({ mate: -2 })).toBe('#−2');
  });
  it('mate fills the bar, equal is half', () => {
    expect(evalShare({ mate: 1 })).toBe(1);
    expect(evalShare({ mate: -1 })).toBe(0);
    expect(evalShare({ cp: 0 })).toBeCloseTo(0.5);
    expect(evalShare(undefined)).toBeCloseTo(0.5);
  });
});

function make(panel: PanelSettings | undefined, mode: 'free' | 'puzzle' = 'free') {
  const b = new StateBuilder();
  const [e4] = b.line(b.rootId, ['e4'], 'game');
  const state: BoardState = { ...b.build(e4, mode), panel };
  return { state, cursor: e4, root: b.rootId };
}
const ready = (nodeId: string, over: Partial<AnalysisData> = {}): AnalysisData => ({
  nodeId,
  fen: 'x',
  status: 'ready',
  lines: [
    { cp: 120, san: ['1...e5', '2.Nf3'] },
    { cp: -40, san: ['1...c5'] },
    { mate: 3, san: ['1...d5'] },
  ],
  ...over,
});
const FULL: PanelSettings = { eval: true, lines: 2, note: 'Смотри на центр\nвторая строка' };

describe('Panel', () => {
  it('renders nothing when off or in a puzzle', () => {
    const off = make({ eval: false, lines: 0 });
    const { container, rerender } = render(<Panel state={off.state} analysis={null} orientation="white" />);
    expect(container.firstChild).toBeNull();
    rerender(<Panel state={make(undefined).state} analysis={null} orientation="white" />);
    expect(container.firstChild).toBeNull();
    const pz = make(FULL, 'puzzle');
    rerender(<Panel state={pz.state} analysis={ready(pz.cursor)} orientation="white" />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the bar, two lines and the note for the cursor node', () => {
    const { state, cursor } = make(FULL);
    render(<Panel state={state} analysis={ready(cursor)} orientation="white" />);
    expect(screen.getByTestId('eval-value').textContent).toBe('+1.2');
    const bar = screen.getByTestId('eval-bar');
    const share = evalShare({ cp: 120 }) * 100;
    expect((bar.firstChild as HTMLElement).style.height).toBe(`${share}%`);
    const lines = screen.getByTestId('engine-lines').querySelectorAll('li');
    expect(lines).toHaveLength(2);
    expect(lines[0].textContent).toBe('+1.2 1...e5 2.Nf3');
    expect(lines[1].textContent).toBe('−0.4 1...c5');
    expect(screen.getByTestId('coach-note').textContent).toBe('Смотри на центр\nвторая строка');
  });

  it('shows only the parts that are enabled', () => {
    const { state, cursor } = make({ eval: false, lines: 0, note: 'только заметка' });
    render(<Panel state={state} analysis={ready(cursor)} orientation="white" />);
    expect(screen.queryByTestId('eval-bar')).toBeNull();
    expect(screen.queryByTestId('engine-lines')).toBeNull();
    expect(screen.getByTestId('coach-note').textContent).toBe('только заметка');
  });

  it('shows the status label in the text area when eval is off but lines are on', () => {
    const { state, cursor } = make({ eval: false, lines: 2 });
    const { rerender } = render(<Panel state={state} analysis={null} orientation="white" />);
    expect(screen.queryByTestId('eval-bar')).toBeNull();
    expect(screen.getByTestId('engine-status').textContent).toBe('…');
    rerender(<Panel state={state} analysis={ready(cursor, { status: 'unavailable', lines: [] })} orientation="white" />);
    expect(screen.getByTestId('engine-status').textContent).toBe('Движок недоступен');
    rerender(<Panel state={state} analysis={ready(cursor)} orientation="white" />);
    expect(screen.queryByTestId('engine-status')).toBeNull();
  });

  it('treats analysis for another node as pending', () => {
    const { state, root } = make(FULL);
    render(<Panel state={state} analysis={ready(root)} orientation="white" />);
    expect(screen.getByTestId('eval-value').textContent).toBe('…');
    expect(screen.getByTestId('engine-lines').querySelectorAll('li')).toHaveLength(0);
  });

  it('shows «Движок недоступен» when unavailable', () => {
    const { state, cursor } = make(FULL);
    render(<Panel state={state} analysis={ready(cursor, { status: 'unavailable', lines: [] })} orientation="white" />);
    expect(screen.getByTestId('eval-value').textContent).toBe('Движок недоступен');
    expect(screen.getByTestId('eval-bar').className).toContain('unavailable');
  });

  it('says мат or пат for an empty ready analysis', () => {
    const mate = new StateBuilder('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1');
    const stale = new StateBuilder('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    for (const [b, text] of [[mate, 'мат'], [stale, 'пат']] as const) {
      const state: BoardState = { ...b.build(b.rootId), panel: FULL };
      const { unmount } = render(
        <Panel state={state} analysis={{ nodeId: b.rootId, fen: 'x', status: 'ready', lines: [] }} orientation="white" />,
      );
      expect(screen.getByTestId('eval-value').textContent).toBe(text);
      unmount();
    }
  });

  it('puts the white part on top when the board is flipped to black', () => {
    const { state, cursor } = make(FULL);
    const { rerender } = render(<Panel state={state} analysis={ready(cursor)} orientation="white" />);
    expect(screen.getByTestId('eval-bar').className).not.toContain('flipped');
    rerender(<Panel state={state} analysis={ready(cursor)} orientation="black" />);
    expect(screen.getByTestId('eval-bar').className).toContain('flipped');
  });
});
