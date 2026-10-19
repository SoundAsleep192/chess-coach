import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LESSON_REPLAY_MS, type BoardState } from '@board/shared';
import { App } from './App';
import { FakeSocket, StateBuilder, fakeFactory, puzzleSession, said } from './test-utils';

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

describe('App in a lesson', () => {
  // корень n1; ход ученика e4 = n2; опровержение e5 Nf3 = n3, n4
  const b = new StateBuilder();
  const [e4, e5, nf3] = b.line(b.rootId, ['e4', 'e5', 'Nf3'], 'student');

  // react-chessboard анимирует смену позиции по размеру клетки, а в jsdom размеры нулевые
  beforeEach(() => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 50, 50));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function start(first: BoardState) {
    render(<App socket={fakeFactory} />);
    const ws = FakeSocket.last();
    act(() => {
      ws.open();
      ws.emit({ event: 'state', data: first });
    });
    return { ws, emit: (s: BoardState) => act(() => ws.emit({ event: 'state', data: s })) };
  }
  const board = () => screen.getByTestId('lesson-board');
  const canMove = () => board().getAttribute('data-can-move');
  const phrase = () => screen.getByRole('textbox', { name: 'Фраза тренеру' }) as HTMLInputElement;

  it('drag allowed only in phase student at lesson.node with the assistant online', () => {
    const { emit, ws } = start(b.lesson(b.rootId, {}, 1));
    expect(canMove()).toBe('true');
    emit(b.lesson(e4, { phase: 'coach' }, 2));
    expect(canMove()).toBe('false');
    emit(b.lesson(e4, { phase: 'feedback' }, 3));
    expect(canMove()).toBe('false');
    emit(b.lesson(b.rootId, { online: false }, 4));
    expect(canMove()).toBe('false');
    emit(b.lesson(b.rootId, {}, 5));
    expect(canMove()).toBe('true');
    act(() => ws.onclose!());
    expect(canMove()).toBe('false');
  });

  it('regular engine panel is not shown in lesson mode, only the lesson strip', () => {
    const s: BoardState = { ...b.lesson(e4, { phase: 'pause', verdict: { kind: 'correct', score: { cp: 30 } } }), panel: { eval: true, lines: 3 } };
    const { ws } = start(s);
    act(() => ws.emit({ event: 'analysis', data: { nodeId: e4, fen: 'x', status: 'ready', depth: 20, lines: [{ cp: 30, san: ['1...e5'] }] } }));
    expect(screen.queryByTestId('panel')).toBeNull();
    expect(screen.getByTestId('engine-strip')).toBeTruthy();
    // в занятии ходы не листаются: ни кнопок навигации, ни списка ходов дерева
    expect(screen.queryByRole('button', { name: 'назад' })).toBeNull();
    expect(document.querySelector('.moves')).toBeNull();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(ws.sent).toEqual([]);
    // стрелки в поле ввода остаются полю
    expect(fireEvent.keyDown(phrase(), { key: 'ArrowLeft' })).toBe(true);
    // шкала с числом из вердикта
    expect(screen.getByTestId('lesson-eval').textContent).toBe('+0.3');
    expect(screen.getByTestId('mode-banner').textContent).toContain('Занятие: проверяй ответ соперника · позиция 1/3');
  });

  it('engine choice resets when the assistant drops or the position changes', () => {
    const toggle = () => screen.getByRole('switch', { name: 'Движок' }) as HTMLInputElement;
    const analysisAt = (nodeId: string) => ({
      event: 'analysis' as const,
      data: { nodeId, fen: 'x', status: 'ready' as const, depth: 20, lines: [{ cp: 90, san: ['1.e4'] }] },
    });
    const { emit, ws } = start(b.lesson(e4, { phase: 'pause', verdict: { kind: 'correct', score: { cp: 30 } } }, 1));
    // ученик выключил и снова включил движок в разборе
    fireEvent.click(toggle());
    expect(screen.queryByTestId('lesson-eval')).toBeNull();
    fireEvent.click(toggle());
    expect(screen.getByTestId('lesson-eval').textContent).toBe('+0.3');
    // помощник отвалился, ученик думает над ходом: анализ позиции занятия не виден, пока не включит сам
    emit(b.lesson(b.rootId, {}, 2));
    emit(b.lesson(b.rootId, { online: false }, 3));
    act(() => ws.emit(analysisAt(b.rootId)));
    expect(toggle().checked).toBe(false);
    expect(screen.queryByTestId('lesson-eval')).toBeNull();
    expect(screen.getByTestId('engine-strip').textContent).not.toContain('1.e4');
    fireEvent.click(toggle());
    expect(screen.getByTestId('lesson-eval').textContent).toBe('+0.9');
    // помощник вернулся, ученик выключил движок; новая позиция - снова по умолчанию (включён)
    emit(b.lesson(e4, { phase: 'pause', verdict: { kind: 'correct', score: { cp: 30 } } }, 4));
    fireEvent.click(toggle());
    expect(screen.queryByTestId('lesson-eval')).toBeNull();
    emit(b.lesson(e4, { index: 1, phase: 'pause', verdict: { kind: 'correct', score: { cp: 30 } } }, 5));
    expect(screen.getByTestId('lesson-eval').textContent).toBe('+0.3');
  });

  it('coach phase: veil on the board, input disabled; replay: no veil, input disabled', () => {
    vi.useFakeTimers();
    try {
      const { emit } = start(b.lesson(b.rootId, {}, 1));
      expect(screen.queryByTestId('board-veil')).toBeNull();
      emit(b.lesson(e4, { phase: 'coach', transcript: [said('student', 'move', '1.e4')] }, 2));
      expect(screen.getByTestId('board-veil').textContent).toContain('Тренер отвечает');
      expect(board().className).toContain('locked');
      expect(phrase().disabled).toBe(true);
      expect(screen.getByTestId('mode-banner').textContent).toContain('Тренер отвечает…');
      // ответ с опровержением: показ по ходу раз в LESSON_REPLAY_MS, без вуали, всё выключено
      emit(b.lesson(nf3, { phase: 'feedback', verdict: { kind: 'wrong', score: { cp: -110 } }, replay: { from: e4, to: nf3, id: 1 } }, 3));
      expect(screen.queryByTestId('board-veil')).toBeNull();
      expect(board().getAttribute('data-node')).toBe(e4);
      expect(board().className).toContain('locked');
      expect(phrase().disabled).toBe(true);
      expect(phrase().placeholder).toBe('Подожди, идёт показ ходов');
      expect((screen.getByRole('button', { name: 'Попробовать другой ход' }) as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByTestId('mode-banner').textContent).toContain('Показываю ходы… 0 из 2');
      expect(document.querySelector('.strip-move.current')).toBeNull();
      act(() => void vi.advanceTimersByTime(LESSON_REPLAY_MS));
      expect(board().getAttribute('data-node')).toBe(e5);
      expect(screen.getByTestId('mode-banner').textContent).toContain('Показываю ходы… 1 из 2');
      expect(document.querySelector('.strip-move.current')!.textContent).toBe('1...e5');
      act(() => void vi.advanceTimersByTime(LESSON_REPLAY_MS));
      expect(board().getAttribute('data-node')).toBe(nf3);
      expect(board().className).not.toContain('locked');
      expect(phrase().disabled).toBe(false);
      expect(screen.getByTestId('mode-banner').textContent).toContain('позиция 1/3');
      // «Повторить показ» запускает показ заново без сервера
      fireEvent.click(screen.getByRole('button', { name: 'Повторить показ' }));
      expect(board().getAttribute('data-node')).toBe(e4);
      expect(FakeSocket.last().sent).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
