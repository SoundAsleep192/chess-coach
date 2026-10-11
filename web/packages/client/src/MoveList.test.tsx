import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MoveList } from './MoveList';
import { StateBuilder } from './test-utils';

afterEach(cleanup);

function sample() {
  const b = new StateBuilder();
  const [e4, e5] = b.line(b.rootId, ['e4', 'e5', 'Nf3', 'Nc6'], 'game');
  const [c5] = b.line(e4, ['c5', 'Nf3'], 'coach');
  const [c3] = b.line(c5, ['c3'], 'coach');
  const [bc4] = b.line(e5, ['Bc4'], 'student');
  return { b, e4, e5, c5, c3, bc4 };
}

describe('MoveList', () => {
  it('renders the main line with move numbers and nested variations', () => {
    const { b, e5 } = sample();
    const { container } = render(<MoveList state={b.build(e5)} disabled={false} onSelect={() => {}} onDelete={() => {}} />);
    const text = container.textContent!.replace(/×/g, '').replace(/\s+/g, ' ');
    expect(text).toBe('1.e4e51...c52.Nf32.c32.Nf32.Bc42...Nc6');
    const variations = container.querySelectorAll('.variations .variations');
    expect(variations).toHaveLength(1);
  });

  it('marks authors and the current move', () => {
    const { b, e5, bc4, c5 } = sample();
    render(<MoveList state={b.build(e5)} disabled={false} onSelect={() => {}} onDelete={() => {}} />);
    expect(screen.getByText('e5').getAttribute('aria-current')).toBe('true');
    expect(document.querySelector(`[data-node-id="${bc4}"]`)!.className).toContain('author-student');
    expect(document.querySelector(`[data-node-id="${c5}"]`)!.className).toContain('author-coach');
  });

  it('selects a move on click and deletes a student branch', () => {
    const { b, e5, c5, bc4 } = sample();
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    render(<MoveList state={b.build(e5)} disabled={false} onSelect={onSelect} onDelete={onDelete} />);
    fireEvent.click(document.querySelector(`[data-node-id="${c5}"]`)!);
    expect(onSelect).toHaveBeenCalledWith(c5);
    expect(screen.getAllByRole('button', { name: /удалить ветку/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'удалить ветку Bc4' }));
    expect(onDelete).toHaveBeenCalledWith(bc4);
  });

  it('disables all moves when disabled', () => {
    const { b, e5 } = sample();
    render(<MoveList state={b.build(e5)} disabled onSelect={() => {}} onDelete={() => {}} />);
    const buttons = screen.getAllByRole('button') as HTMLButtonElement[];
    expect(buttons.every((btn) => btn.disabled)).toBe(true);
  });
});
