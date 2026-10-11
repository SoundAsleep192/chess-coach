import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { FakeSocket, StateBuilder, fakeFactory } from './test-utils';

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
});
