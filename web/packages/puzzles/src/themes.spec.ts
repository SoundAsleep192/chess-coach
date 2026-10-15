import { describe, expect, it } from 'vitest';
import { radugaThemes } from './themes.ts';

describe('radugaThemes', () => {
  it('maps book headers to Lichess themes, ignoring case and the part number', () => {
    expect(radugaThemes('Двойной удар')).toEqual({ themes: ['fork'], known: true });
    expect(radugaThemes('ДВОЙНОЙ УДАР. ЧАСТЬ 2')).toEqual({ themes: ['fork'], known: true });
    expect(radugaThemes('Вскрытое нападение')).toEqual({ themes: ['discoveredAttack'], known: true });
    expect(radugaThemes('Освобождение линии')).toEqual({ themes: ['clearance'], known: true });
    expect(radugaThemes('Мельница')).toEqual({ themes: [], known: false });
  });

  it('maps every chapter header of the seven volumes, the mixed test chapter to no theme', () => {
    const table: [string, string[]][] = [
      ['Вскрытое нападение с шахом', ['discoveredAttack', 'discoveredCheck']],
      ['Вскрытое нападение без шаха', ['discoveredAttack']],
      ['Вскрытый шах', ['discoveredAttack', 'discoveredCheck']],
      ['Блокировка', ['attraction']],
      ['Спёртый мат', ['smotheredMate', 'mate']],
      ['Блокировка. Спертый мат', ['smotheredMate', 'mate']],
      ['Слабость последней горизонтали', ['backRankMate']],
      ['Рентген', ['xRayAttack']],
      ['Ловля фигуры', ['trappedPiece']],
      ['Промежуточный ход', ['intermezzo']],
      ['Игра на мат', ['mate']],
      ['Мат в 2 хода', ['mate', 'mateIn2']],
      ['Создание неотвратимой угрозы мата', ['mate', 'quietMove']],
      ['Игра на пат', ['equality']],
      ['Проверь себя!', []],
    ];
    for (const [title, themes] of table) expect(radugaThemes(title), title).toEqual({ themes, known: true });
  });
});
