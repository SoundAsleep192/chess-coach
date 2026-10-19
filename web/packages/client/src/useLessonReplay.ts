import { useCallback, useEffect, useState } from 'react';
import { LESSON_REPLAY_MS, type BoardNode, type BoardState, type LessonReplay, type LessonView, type NodeId } from '@board/shared';

/** Что показывает доска во время показа ходов тренера. shownNode - null, когда показа нет. */
export interface ReplayView {
  shownNode: NodeId | null;
  /** Сколько ходов показа уже на доске, 0..total. */
  step: number;
  total: number;
  replaying: boolean;
  /** «Повторить показ»: проиграть последний lesson.replay заново, без сервера. */
  restart(): void;
}

/** Узлы показа от from до to включительно; null, если узла нет в дереве или to не потомок from. */
export function replayPath(state: BoardState, r: LessonReplay): NodeId[] | null {
  const path: NodeId[] = [];
  let id: NodeId | null = r.to;
  while (id !== null) {
    const node: BoardNode | undefined = state.nodes[id];
    if (!node) return null;
    path.unshift(id);
    if (id === r.from) return path;
    id = node.parent;
  }
  return null;
}

/** Занятие, которое показывает страница: режим lesson. Остановленное занятие (режим free) считается отсутствующим. */
function shownLesson(state: BoardState): LessonView | undefined {
  return state.mode === 'lesson' ? state.lesson : undefined;
}

interface Track {
  loaded: boolean;
  /** lessonId показываемого занятия; null - занятия нет. */
  key: string | null;
  /** id последнего показа, который уже проигран (или помечен увиденным). */
  played: number | null;
  run: { id: number; step: number } | null;
}

const INITIAL: Track = { loaded: false, key: null, played: null, run: null };

/**
 * Следующее состояние по пришедшему BoardState. Первое состояние после загрузки страницы только помечает показ
 * увиденным. Новое занятие или занятие после отсутствия забывает проигранный id: seq у нового lessonId начинается с нуля.
 */
function advance(t: Track, state: BoardState | null): Track {
  if (!state) return t;
  const lesson = shownLesson(state);
  const key = lesson?.lessonId ?? null;
  const id = lesson?.replay?.id ?? null;
  if (!t.loaded) return { loaded: true, key, played: id, run: null };
  const played = key === t.key ? t.played : null;
  if (id !== null && id !== played) return { loaded: true, key, played: id, run: { id, step: 0 } };
  return key === t.key ? t : { ...t, key, played };
}

export function useLessonReplay(state: BoardState | null): ReplayView {
  const [stored, setTrack] = useState<Track>(INITIAL);
  // Сверка во время рендера, а не в эффекте: иначе на один кадр мелькнёт конец показа.
  const track = advance(stored, state);
  if (track !== stored) setTrack(track);

  const replay = state ? shownLesson(state)?.replay : undefined;
  const run = track.run && replay && replay.id === track.run.id ? track.run : null;
  const path = run && state ? replayPath(state, replay!) : null;
  const total = path ? path.length - 1 : 0;
  const step = run && path ? Math.min(run.step, total) : 0;
  const replaying = path !== null && step < total;

  useEffect(() => {
    if (!replaying) return;
    const timer = setTimeout(
      () => setTrack((t) => (t.run ? { ...t, run: { ...t.run, step: t.run.step + 1 } } : t)),
      LESSON_REPLAY_MS,
    );
    return () => clearTimeout(timer);
  }, [replaying, run?.id, step]);

  const replayId = replay?.id;
  const restart = useCallback(() => {
    if (replayId !== undefined) setTrack((t) => ({ ...t, run: { id: replayId, step: 0 } }));
  }, [replayId]);

  return {
    shownNode: replaying ? path![step] : null,
    step: path ? step : 0,
    total,
    replaying,
    restart,
  };
}
