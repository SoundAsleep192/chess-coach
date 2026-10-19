import type { LessonGame } from '@board/shared';

const players = (game: LessonGame) => `${game.white} - ${game.black}`;

/** Ходы партии до позиции занятия таблицей (номер, белые, чёрные), последний ход подсвечен. Без навигации. */
function MovesTable({ game }: { game: LessonGame }) {
  const last = game.moves.length - 1;
  const rows: number[] = [];
  for (let i = 0; i < game.moves.length; i += 2) rows.push(i);
  const cell = (i: number) => (
    <td className={i === last ? 'current' : undefined}>{game.moves[i] ?? ''}</td>
  );
  return (
    <table className="game-table">
      <tbody>
        {rows.map((i) => (
          <tr key={i}>
            <td className="game-no">{i / 2 + 1}.</td>
            {cell(i)}
            {cell(i + 1)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Карточка в колонке без помощника: «Ходы партии · белые - чёрные» и таблица ходов. */
export function GameMoves({ game }: { game: LessonGame }) {
  return (
    <div className="game-moves" data-testid="game-moves">
      <div className="game-title">Ходы партии · {players(game)}</div>
      <MovesTable game={game} />
    </div>
  );
}

/** Кнопка «Ходы партии ▾» в строке состояния со всплывающим списком и подписью, что ходы не листаются. */
export function GameMovesButton({ game }: { game: LessonGame }) {
  return (
    <details className="game-dropdown">
      <summary>Ходы партии ▾</summary>
      <div className="game-popover">
        <div className="game-title">{players(game)}</div>
        <MovesTable game={game} />
        <div className="game-caption">В занятии ходы не листаются: позиция задаётся тренером.</div>
      </div>
    </details>
  );
}
