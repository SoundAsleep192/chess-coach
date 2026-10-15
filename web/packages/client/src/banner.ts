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
  | 'offline';

/** Текст и вид плашки над доской. Тексты вердиктов приходят с сервера в puzzle.feedback. */
export function banner(state: BoardState, connected: boolean): { kind: BannerKind; text: string } {
  if (!connected) return { kind: 'offline', text: 'Нет связи, переподключаюсь…' };
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

/** Тянуть фигуры можно в свободном режиме и в задаче, когда сервер ждёт ход решающего. */
export function canDrag(state: BoardState, connected: boolean): boolean {
  if (!connected) return false;
  if (state.mode === 'free') return true;
  const pz = state.puzzle;
  return state.mode === 'puzzle' && pz?.status === 'solving' && pz.phase === 'move';
}
