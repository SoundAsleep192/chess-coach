import { alternativesLeft, type BoardState } from '@board/shared';

export type BannerKind =
  | 'free'
  | 'frozen'
  | 'puzzle'
  | 'checking'
  | 'correct'
  | 'weaker'
  | 'wrong'
  | 'unavailable'
  | 'solved'
  | 'solvedAlt'
  | 'failed'
  | 'offline'
  | 'lesson'
  | 'replay';

export interface Banner {
  kind: BannerKind;
  text: string;
  /** Хвост text, который пишется серым («· позиция 1/3»). */
  muted?: string;
}

/** Строка состояния занятия: помощника нет, тренер отвечает, идёт показ, номер позиции или конец серии. */
function lessonBanner(state: BoardState, replay?: { step: number; total: number }): Banner {
  const l = state.lesson!;
  if (l.status === 'running' && !l.online) {
    return { kind: 'unavailable', text: 'Помощник у доски не подключён. Напиши тренеру в чат' };
  }
  if (l.status === 'running' && l.phase === 'coach') return { kind: 'checking', text: 'Тренер отвечает…' };
  // k - ходов показа уже на доске: 0, пока доска стоит в начале показа
  if (replay) return { kind: 'replay', text: `Показываю ходы… ${replay.step} из ${replay.total}` };
  // index с нуля; в конце серии сервер оставляет index последней позиции, поэтому пишем total/total
  const muted = l.status === 'done' ? ` · серия пройдена, ${l.total}/${l.total}` : ` · позиция ${l.index + 1}/${l.total}`;
  return { kind: 'lesson', text: `Занятие: ${l.title}${muted}`, muted };
}

/**
 * Текст и вид плашки над доской. Тексты вердиктов задачи приходят с сервера в puzzle.feedback.
 * replay - идёт показ ходов в занятии (состояние клиента): сколько ходов показано и сколько всего.
 */
export function banner(state: BoardState, connected: boolean, replay?: { step: number; total: number }): Banner {
  if (!connected) return { kind: 'offline', text: 'Нет связи, переподключаюсь…' };
  if (state.mode === 'lesson' && state.lesson) return lessonBanner(state, replay);
  const pz = state.puzzle;
  if (pz?.status === 'solving') {
    if (pz.phase === 'checking') return { kind: 'checking', text: 'Проверяю ход…' };
    const fb = pz.feedback;
    if (fb?.kind === 'wrong') return { kind: 'wrong', text: fb.text };
    if (fb?.kind === 'weaker' || fb?.kind === 'repeat') return { kind: 'weaker', text: fb.text };
    if (fb?.kind === 'unavailable') return { kind: 'unavailable', text: fb.text };
    if (fb?.kind === 'correct') return { kind: 'correct', text: fb.text };
    const side = pz.side === 'white' ? 'белых' : 'чёрных';
    return { kind: 'puzzle', text: `Задача: ${pz.label}, ход ${side}${pz.bonus ? '. Найдите другое решение' : ''}` };
  }
  if (pz?.status === 'solved') {
    return !pz.bonus && alternativesLeft(pz)
      ? { kind: 'solvedAlt', text: 'Решено! Есть ещё одно решение' }
      : { kind: 'solved', text: `Решено: ${pz.label}` };
  }
  if (pz?.status === 'failed') return { kind: 'failed', text: pz.answer ? `Решение: ${pz.answer}` : `Не решено: ${pz.label}` };
  return state.mode === 'frozen'
    ? { kind: 'frozen', text: 'Заморожено тренером' }
    : { kind: 'free', text: 'Свободный просмотр' };
}

/**
 * Тянуть фигуры можно в свободном режиме, в задаче, когда сервер ждёт ход решающего, и в занятии,
 * когда ход за учеником с позиции занятия и помощник подключён. Показ ходов App проверяет сам.
 */
export function canDrag(state: BoardState, connected: boolean): boolean {
  if (!connected) return false;
  if (state.mode === 'free') return true;
  if (state.mode === 'lesson') {
    const l = state.lesson;
    return !!l && l.status === 'running' && l.phase === 'student' && l.online && state.cursor === l.node;
  }
  const pz = state.puzzle;
  return state.mode === 'puzzle' && pz?.status === 'solving' && pz.phase === 'move';
}
