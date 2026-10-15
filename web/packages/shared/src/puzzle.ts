import type { PuzzleSession } from './index.ts';

/** После решения: есть равноценный первый ход (ход решения или альтернатива), которым ученик в этой сессии ещё не решал. */
export function alternativesLeft(pz: Pick<PuzzleSession, 'solution' | 'rootAlternatives' | 'found'>): boolean {
  return [pz.solution[0], ...pz.rootAlternatives].some((m) => !pz.found.includes(m));
}
