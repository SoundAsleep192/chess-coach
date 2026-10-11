import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBoardSocket } from './useBoardSocket';
import { FakeSocket, StateBuilder, fakeFactory } from './test-utils';

beforeEach(() => {
  FakeSocket.all = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const stateV = (version: number) => {
  const b = new StateBuilder();
  b.line(b.rootId, ['e4'], 'game');
  return b.build(b.rootId, 'free', version);
};

describe('useBoardSocket', () => {
  it('ignores an older state within one connection', () => {
    const { result } = renderHook(() => useBoardSocket(fakeFactory));
    act(() => {
      FakeSocket.last().open();
      FakeSocket.last().emit({ event: 'state', data: stateV(5) });
      FakeSocket.last().emit({ event: 'state', data: stateV(3) });
    });
    expect(result.current.state!.version).toBe(5);
  });

  it('reconnects with a growing pause and accepts the first state of the new connection', () => {
    const { result } = renderHook(() => useBoardSocket(fakeFactory));
    act(() => {
      FakeSocket.last().open();
      FakeSocket.last().emit({ event: 'state', data: stateV(5) });
      FakeSocket.last().drop();
    });
    expect(result.current.connected).toBe(false);
    expect(FakeSocket.all).toHaveLength(1);
    act(() => vi.advanceTimersByTime(500));
    expect(FakeSocket.all).toHaveLength(2);
    act(() => FakeSocket.last().drop());
    act(() => vi.advanceTimersByTime(999));
    expect(FakeSocket.all).toHaveLength(2);
    act(() => vi.advanceTimersByTime(1));
    expect(FakeSocket.all).toHaveLength(3);
    act(() => {
      FakeSocket.last().open();
      FakeSocket.last().emit({ event: 'state', data: stateV(1) });
    });
    expect(result.current.connected).toBe(true);
    expect(result.current.state!.version).toBe(1);
  });

  it('keeps an error until the next message is sent', () => {
    const { result } = renderHook(() => useBoardSocket(fakeFactory));
    act(() => {
      FakeSocket.last().open();
      FakeSocket.last().emit({ event: 'error', data: { code: 'illegal', message: 'x', version: 1 } });
      FakeSocket.last().emit({ event: 'state', data: stateV(1) });
    });
    expect(result.current.error!.code).toBe('illegal');
    act(() => result.current.send({ event: 'navigate', data: { nodeId: 'n1' } }));
    expect(result.current.error).toBeNull();
    expect(FakeSocket.last().sent).toEqual([{ event: 'navigate', data: { nodeId: 'n1' } }]);
  });

  it('ignores the late close of a socket shut down by the effect cleanup (StrictMode remount)', () => {
    const { result } = renderHook(() => useBoardSocket(fakeFactory), { wrapper: StrictMode });
    expect(FakeSocket.all).toHaveLength(2);
    const [stale, live] = FakeSocket.all;
    act(() => live.open());
    expect(result.current.connected).toBe(true);
    // A real WebSocket fires onclose asynchronously after close(); it must not touch the UI or schedule a reconnect.
    act(() => stale.onclose?.());
    expect(result.current.connected).toBe(true);
    act(() => vi.advanceTimersByTime(20000));
    expect(FakeSocket.all).toHaveLength(2);
  });
});
