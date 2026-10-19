import { describe, expect, it } from 'vitest';
import {
  LESSON_REPLAY_MS,
  LESSON_VERDICT_WORD,
  countSentences,
  studentTextProblem,
  type LessonVerdictKind,
} from './lesson';

describe('countSentences', () => {
  it('counts sentence boundaries, not dots inside moves and numbers', () => {
    expect(countSentences('Хороший ход! Почему именно его?')).toBe(2);
    expect(countSentences('После 25.Nd3 конь связан.')).toBe(1);
    expect(countSentences('Оценка +1.2, было +3.0. Дальше')).toBe(2);
    expect(countSentences('')).toBe(0);
  });
  it('lets a closing quote or bracket after the terminator end the sentence', () => {
    expect(countSentences('Он сказал «стоп.» Дальше. Ещё.')).toBe(3);
    expect(countSentences('Видишь (шах!) Ходи.')).toBe(2);
    expect(countSentences('Он сказал "стоп." Дальше')).toBe(2);
  });
  it('treats a tail without a mark as a sentence and ignores blanks', () => {
    expect(countSentences('Раз. Два. Три')).toBe(3);
    expect(countSentences('   ')).toBe(0);
    expect(countSentences('Что?! Да…')).toBe(2);
  });
});

describe('studentTextProblem', () => {
  it('lets pieces with squares in words and bare squares through', () => {
    expect(studentTextProblem('конь d3 связан')).toBeNull();
    expect(studentTextProblem('Посмотри на поле f7. Кто его защищает?')).toBeNull();
    expect(studentTextProblem('Ферзь бьёт пешку e5, а слон прикрывает c4.')).toBeNull();
    expect(studentTextProblem('Верно, продолжай. Было 3 хода до мата.')).toBeNull();
    expect(studentTextProblem('')).toBeNull();
  });
  it('rejects a SAN piece move', () => {
    expect(studentTextProblem('Сыграй Nd3, и конь связан')).toBe('Nd3');
    expect(studentTextProblem('После Qxf7+ король уходит')).toBe('Qxf7+');
    expect(studentTextProblem('Может быть, Nbd2?')).toBe('Nbd2');
    expect(studentTextProblem('Ход Rae1 лучше')).toBe('Rae1');
  });
  it('rejects a pawn capture and a promotion', () => {
    expect(studentTextProblem('А если exd5?')).toBe('exd5');
    expect(studentTextProblem('Пешка идёт e8=Q и выигрывает')).toBe('e8=Q');
  });
  it('rejects castling written with letters or zeros', () => {
    expect(studentTextProblem('Лучше O-O сразу')).toBe('O-O');
    expect(studentTextProblem('Лучше 0-0 сразу')).toBe('0-0');
    expect(studentTextProblem('Длинная O-O-O тоже возможна')).toBe('O-O-O');
    expect(studentTextProblem('Лучше О-О сразу')).toBe('О-О');
    expect(studentTextProblem('Длинная О-О-О тоже возможна')).toBe('О-О-О');
    expect(studentTextProblem('Было 12.О-О и всё')).toBe('12.О-О');
  });
  it('rejects a numbered move', () => {
    expect(studentTextProblem('На 25.Nd3 есть ответ')).toBe('25.Nd3');
    expect(studentTextProblem('Было 25...e5 и всё')).toBe('25...e5');
    expect(studentTextProblem('Посмотри 12.a4')).toBe('12.a4');
  });
  it('rejects evaluations', () => {
    expect(studentTextProblem('Оценка +1.2 в твою пользу')).toBe('+1.2');
    expect(studentTextProblem('Стало −0.8, хуже')).toBe('−0.8');
    expect(studentTextProblem('Стало -0,8, хуже')).toBe('-0,8');
    expect(studentTextProblem('Здесь #3 и всё')).toBe('#3');
    expect(studentTextProblem('Тут #-2 против тебя')).toBe('#-2');
    expect(studentTextProblem('Это мат в 3 хода')).toBe('мат в 3');
    expect(studentTextProblem('Это Мат  в 2')).toBe('Мат  в 2');
    expect(studentTextProblem('Есть угроза мата в 3')).toBe('мата в 3');
    expect(studentTextProblem('Будет мат за 3 хода')).toBe('мат за 3');
    expect(studentTextProblem('Ты выиграл +3 пешки')).toBe('+3');
    expect(studentTextProblem('Стало −2, плохо')).toBe('−2');
  });
  it('does not mistake plain numbers and hyphens after digits for evals', () => {
    expect(studentTextProblem('Счёт 2-3,5 очка')).toBeNull();
    expect(studentTextProblem('Думал 21 секунда')).toBeNull();
    expect(studentTextProblem('Позиция 2 из 3')).toBeNull();
    expect(studentTextProblem('Матч за 3 минуты')).toBeNull();
  });
  it('returns the earliest offending fragment', () => {
    expect(studentTextProblem('Сначала +1.2, потом Nd3')).toBe('+1.2');
  });
});

describe('verdict words and replay constant', () => {
  it('has a badge word for every kind except info', () => {
    const kinds: Exclude<LessonVerdictKind, 'info'>[] = ['correct', 'weaker', 'wrong', 'unavailable'];
    expect(Object.keys(LESSON_VERDICT_WORD).sort()).toEqual([...kinds].sort());
    expect(LESSON_VERDICT_WORD.correct).toBe('Верно');
    expect(LESSON_VERDICT_WORD.weaker).toBe('Неплохо, но есть сильнее');
    expect(LESSON_VERDICT_WORD.wrong).toBe('Ошибка');
    expect(LESSON_VERDICT_WORD.unavailable).toBe('Не могу проверить ход: движок недоступен');
  });
  it('replays at 800 ms per move', () => {
    expect(LESSON_REPLAY_MS).toBe(800);
  });
});
