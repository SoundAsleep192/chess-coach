import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { FakeSocket, StateBuilder, fakeFactory, puzzleSession } from './test-utils';

beforeEach(() => {
  FakeSocket.all = [];
});
afterEach(cleanup);

function setup(mode: 'free' | 'frozen') {
  const b = new StateBuilder();
  const [e4, e5] = b.line(b.rootId, ['e4', 'e5', 'Nf3'], 'game');
  const [c5] = b.line(e4, ['c5'], 'coach');
  render(<App socket={fakeFactory} />);
  const ws = FakeSocket.last();
  act(() => {
    ws.open();
    ws.emit({ event: 'state', data: b.build(e5, mode) });
  });
  return { ws, e4, e5, c5, b };
}

describe('App', () => {
  it('navigates with arrow keys and picks a variation with down', () => {
    const { ws, e4, c5 } = setup('free');
    expect(screen.getByTestId('mode-banner').textContent).toContain('Свободный просмотр');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(ws.sent).toEqual([
      { event: 'navigate', data: { nodeId: e4 } },
      { event: 'navigate', data: { nodeId: c5 } },
    ]);
  });

  it('navigates by clicking a move and by buttons', () => {
    const { ws, b, c5 } = setup('free');
    fireEvent.click(document.querySelector(`[data-node-id="${c5}"]`)!);
    fireEvent.click(screen.getByRole('button', { name: 'в начало' }));
    expect(ws.sent).toEqual([
      { event: 'navigate', data: { nodeId: c5 } },
      { event: 'navigate', data: { nodeId: b.rootId } },
    ]);
  });

  it('blocks keys, clicks and buttons while frozen, but still flips the board', () => {
    const { ws, c5 } = setup('frozen');
    expect(screen.getByTestId('mode-banner').textContent).toContain('Заморожено тренером');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.click(document.querySelector(`[data-node-id="${c5}"]`)!);
    fireEvent.click(screen.getByRole('button', { name: 'назад' }));
    expect(ws.sent).toEqual([]);
    expect((screen.getByRole('button', { name: 'перевернуть' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the error from the server on the status bar', () => {
    const { ws } = setup('free');
    act(() => ws.emit({ event: 'error', data: { code: 'frozen', message: 'frozen', version: 1 } }));
    expect(screen.getByTestId('mode-banner').textContent).toContain('Доска заморожена тренером');
  });

  it('shows the offline banner after the connection drops', () => {
    const { ws } = setup('free');
    act(() => ws.drop());
    expect(screen.getByTestId('mode-banner').textContent).toContain('Нет связи');
  });

  it('blocks keys, clicks, buttons and branch deletion while offline', () => {
    const { ws, b, e5, c5 } = setup('free');
    // студенческая ветка, чтобы появилась кнопка удаления
    const [bc4] = b.line(e5, ['Bc4'], 'student');
    act(() => ws.emit({ event: 'state', data: b.build(e5, 'free', 2) }));
    // Закрываем «связь» только на уровне хука, сокет остаётся открытым: если бы блокировки
    // в App не было, send дошёл бы до сокета и попал бы в ws.sent.
    act(() => ws.onclose!());
    expect(ws.readyState).toBe(1);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    for (const id of [c5, bc4]) {
      const btn = document.querySelector(`[data-node-id="${id}"]`) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      fireEvent.click(btn);
    }
    const del = screen.getByRole('button', { name: 'удалить ветку Bc4' }) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    fireEvent.click(del);
    fireEvent.click(screen.getByRole('button', { name: 'назад' }));
    expect(ws.sent).toEqual([]);
    expect((screen.getByRole('button', { name: 'назад' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'перевернуть' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the puzzle banner and blocks all browsing while the puzzle is being solved', () => {
    const b = new StateBuilder('q3k3/8/8/3N4/8/8/8/6K1 w - - 0 1');
    const [nc7] = b.line(b.rootId, ['Nc7+', 'Kd7'], 'game');
    const s = b.build(nc7, 'puzzle');
    s.puzzle = puzzleSession({ done: 1, phase: 'reply' });
    const { container } = render(<App socket={fakeFactory} />);
    const ws = FakeSocket.last();
    act(() => {
      ws.open();
      ws.emit({ event: 'state', data: s });
    });
    expect(screen.getByTestId('mode-banner').textContent).toContain('Задача: Дорофеева, т.1 №1, ход белых');
    for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) fireEvent.keyDown(window, { key });
    for (const name of ['в начало', 'назад', 'вперёд', 'в конец']) {
      const btn = screen.getByRole('button', { name }) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      fireEvent.click(btn);
    }
    const moveButtons = container.querySelectorAll<HTMLButtonElement>('.moves button');
    expect(moveButtons.length).toBeGreaterThan(0);
    moveButtons.forEach((m) => {
      expect(m.disabled).toBe(true);
      fireEvent.click(m);
    });
    expect(ws.sent).toEqual([]);
    act(() => ws.emit({ event: 'error', data: { code: 'frozen', message: 'wait for the opponent reply', version: 1 } }));
    expect(screen.getByTestId('mode-banner').textContent).toContain('Во время задачи можно только ходить');
  });

  it('resets a manual board flip when the next puzzle arrives', () => {
    const mk = (puzzleId: string) => {
      const b = new StateBuilder('q3k3/8/8/3N4/8/8/8/6K1 w - - 0 1');
      const s = b.build(b.rootId, 'puzzle');
      s.puzzle = puzzleSession({ puzzleId, label: puzzleId, solution: ['d5c7'] });
      return s;
    };
    const { container } = render(<App socket={fakeFactory} />);
    const ws = FakeSocket.last();
    const firstSquare = () => container.querySelector('[data-square]')?.getAttribute('data-square');
    act(() => {
      ws.open();
      ws.emit({ event: 'state', data: mk('p1') });
    });
    expect(firstSquare()).toBe('a8');
    fireEvent.click(screen.getByRole('button', { name: 'перевернуть' }));
    expect(firstSquare()).toBe('h1');
    act(() => ws.emit({ event: 'state', data: mk('p2') }));
    expect(firstSquare()).toBe('a8');
  });

  it('after «Показать решение» shows the answer and lets the student browse the solution', () => {
    const b = new StateBuilder('q3k3/8/8/3N4/8/8/8/6K1 w - - 0 1');
    const [nc7] = b.line(b.rootId, ['Nc7+', 'Kd7', 'Nxa8'], 'game');
    b.line(b.rootId, ['Nf6+'], 'student');
    const s = b.build(b.rootId, 'free');
    s.puzzle = puzzleSession({ status: 'failed', answer: '1.Nc7+ Kd7 2.Nxa8' });
    render(<App socket={fakeFactory} />);
    const ws = FakeSocket.last();
    act(() => {
      ws.open();
      ws.emit({ event: 'state', data: s });
    });
    expect(screen.getByTestId('mode-banner').textContent).toContain('Решение: 1.Nc7+ Kd7 2.Nxa8');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(ws.sent).toEqual([{ event: 'navigate', data: { nodeId: nc7 } }]);
  });

  it('shows the puzzle buttons by phase and sends their commands', () => {
    // курсор всё время в корне: react-chessboard в jsdom не умеет анимировать смену позиции
    const b = new StateBuilder('q3k3/8/8/3N4/8/8/8/6K1 w - - 0 1');
    render(<App socket={fakeFactory} />);
    const ws = FakeSocket.last();
    const emit = (puzzle: Parameters<typeof puzzleSession>[0], mode: 'puzzle' | 'free' = 'puzzle') => {
      const s = b.build(b.rootId, mode);
      s.puzzle = puzzleSession(puzzle);
      act(() => ws.emit({ event: 'state', data: s }));
    };
    const button = (name: string) => screen.queryByRole('button', { name }) as HTMLButtonElement | null;
    act(() => ws.open());
    emit({ phase: 'move' });
    expect(button('Ещё раз')).toBeNull();
    expect(button('Показать решение')).not.toBeNull();
    emit({ phase: 'feedback', errors: 1, feedback: { kind: 'wrong', text: 'После Nf6+ оценка −8.0 (хуже), было +9.0 (выигрыш).' } });
    expect(screen.getByTestId('mode-banner').textContent).toContain('После Nf6+ оценка −8.0');
    fireEvent.click(button('Ещё раз')!);
    fireEvent.click(button('Показать решение')!);
    emit({ status: 'solved', found: ['d5c7'], rootAlternatives: ['d5f6'] }, 'free');
    expect(screen.getByTestId('mode-banner').textContent).toContain('Решено! Есть ещё одно решение');
    expect(button('Показать решение')).toBeNull();
    fireEvent.click(button('Найти другое')!);
    expect(ws.sent).toEqual([
      { event: 'puzzleRetry', data: {} },
      { event: 'puzzleGiveUp', data: {} },
      { event: 'puzzleAnother', data: {} },
    ]);
    emit({ status: 'solved', found: ['d5c7', 'd5f6'], rootAlternatives: ['d5f6'] }, 'free');
    expect(button('Найти другое')).toBeNull();
  });

  it('disables the puzzle buttons without a connection', () => {
    const b = new StateBuilder('q3k3/8/8/3N4/8/8/8/6K1 w - - 0 1');
    render(<App socket={fakeFactory} />);
    const ws = FakeSocket.last();
    const s = b.build(b.rootId, 'puzzle');
    s.puzzle = puzzleSession({ phase: 'feedback', feedback: { kind: 'weaker', text: 'Хороший ход, но есть сильнее.' } });
    act(() => {
      ws.open();
      ws.emit({ event: 'state', data: s });
    });
    act(() => ws.onclose!());
    const retry = screen.getByRole('button', { name: 'Ещё раз' }) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    fireEvent.click(retry);
    expect(ws.sent).toEqual([]);
  });
});
