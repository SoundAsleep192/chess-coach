import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LESSON_REPLAY_MS, type BoardState, type LessonView } from '@board/shared';
import { StateBuilder } from './test-utils';
import { replayPath, useLessonReplay } from './useLessonReplay';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// корень n1; ход ученика e4 = n2; опровержение e5 Nf3 = n3, n4; другая линия d4 d5 = n5, n6
const b = new StateBuilder();
const [e4, e5, nf3] = b.line(b.rootId, ['e4', 'e5', 'Nf3'], 'coach');
const [d4, d5] = b.line(b.rootId, ['d4', 'd5'], 'coach');

const withReplay = (id: number | null, over: Partial<LessonView> = {}, from = e4, to = nf3): BoardState =>
  b.lesson(to, { phase: 'feedback', ...(id === null ? {} : { replay: { from, to, id } }), ...over });

function mount(first: BoardState | null) {
  return renderHook(({ s }: { s: BoardState | null }) => useLessonReplay(s), { initialProps: { s: first } });
}
const tick = () => act(() => void vi.advanceTimersByTime(LESSON_REPLAY_MS));

describe('replayPath', () => {
  it('goes from the start node to the end node, null for missing or unrelated nodes', () => {
    const s = withReplay(1);
    expect(replayPath(s, { from: e4, to: nf3, id: 1 })).toEqual([e4, e5, nf3]);
    expect(replayPath(s, { from: e4, to: 'n99', id: 1 })).toBeNull();
    expect(replayPath(s, { from: d4, to: nf3, id: 1 })).toBeNull();
  });
});

describe('useLessonReplay', () => {
  it('marks the replay of the first state as seen without animating', () => {
    const { result } = mount(withReplay(4));
    expect(result.current.replaying).toBe(false);
    expect(result.current.shownNode).toBeNull();
  });

  it('plays a new replay move by move, then hands the board back', () => {
    const { result, rerender } = mount(withReplay(null));
    rerender({ s: withReplay(1) });
    expect(result.current).toMatchObject({ replaying: true, shownNode: e4, step: 0, total: 2 });
    tick();
    expect(result.current).toMatchObject({ replaying: true, shownNode: e5, step: 1 });
    tick();
    expect(result.current).toMatchObject({ replaying: false, shownNode: null, step: 2, total: 2 });
    tick();
    expect(result.current.replaying).toBe(false);
  });

  it('a new id mid-replay restarts from its own first node (no stale step)', () => {
    const { result, rerender } = mount(withReplay(null));
    rerender({ s: withReplay(1) });
    tick();
    expect(result.current.step).toBe(1);
    rerender({ s: withReplay(2, {}, b.rootId, d5) });
    expect(result.current).toMatchObject({ replaying: true, shownNode: b.rootId, step: 0, total: 2 });
    tick();
    expect(result.current.shownNode).toBe(d4);
  });

  it('the same state again does not replay; restart() plays the last replay again', () => {
    const { result, rerender } = mount(withReplay(null));
    rerender({ s: withReplay(1) });
    tick();
    tick();
    rerender({ s: withReplay(1, { phase: 'pause' }) });
    expect(result.current.replaying).toBe(false);
    act(() => result.current.restart());
    expect(result.current).toMatchObject({ replaying: true, shownNode: e4, step: 0 });
    tick();
    tick();
    expect(result.current.replaying).toBe(false);
  });

  it('a stale replay with missing nodes never animates and never crashes', () => {
    const { result, rerender } = mount(withReplay(null));
    rerender({ s: withReplay(1, {}, e4, 'n99') });
    expect(result.current).toMatchObject({ replaying: false, shownNode: null });
    act(() => result.current.restart());
    expect(result.current.replaying).toBe(false);
  });

  it('forgets the last played id on a new lesson and after the lesson was absent', () => {
    const { result, rerender } = mount(withReplay(null));
    rerender({ s: withReplay(1) });
    tick();
    tick();
    // новое занятие: seq с нуля, тот же id - это новый показ
    rerender({ s: withReplay(1, { lessonId: 'L2' }) });
    expect(result.current.replaying).toBe(true);
    tick();
    tick();
    // занятие остановлено (режим free), потом возобновлено с тем же id
    rerender({ s: { ...withReplay(1, { lessonId: 'L2', status: 'stopped' }), mode: 'free' } });
    expect(result.current.replaying).toBe(false);
    rerender({ s: withReplay(1, { lessonId: 'L2' }) });
    expect(result.current.replaying).toBe(true);
  });

  it('stops when the replay disappears (new position)', () => {
    const { result, rerender } = mount(withReplay(null));
    rerender({ s: withReplay(1) });
    rerender({ s: withReplay(null, { phase: 'student' }) });
    expect(result.current).toMatchObject({ replaying: false, shownNode: null });
  });
});
