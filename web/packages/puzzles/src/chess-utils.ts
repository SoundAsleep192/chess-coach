import { Chess } from 'chess.js';

export type Side = 'w' | 'b';

export class LineError extends Error {
  name = 'LineError';
}

export function uciMove(uci: string): { from: string; to: string; promotion?: string } {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] };
}

const SAN = /^(?:O-O(?:-O)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h](?:x[a-h])?[1-8](?:=?[QRBN])?)[+#]?$/;
const LOOKALIKE: Record<string, string> = { а: 'a', с: 'c', е: 'e', х: 'x', о: 'o', О: 'O' };

/**
 * Ход из книги в SAN chess.js. Полгар: X - взятие, m - мат. «Радуга»: Кр, Ф, Л, С, К и «:» для взятия.
 * Кириллические буквы, похожие на латинские (с, е, а), заменяются. Номер хода и оценки !? отбрасываются.
 */
export function normalizeSan(raw: string): string {
  let t = raw.trim().replace(/^\d+\.(?:\.\.|…)?/, '');
  t = t.replace(/Кр/g, 'K').replace(/К/g, 'N').replace(/Ф/g, 'Q').replace(/Л/g, 'R').replace(/С/g, 'B');
  t = t.replace(/[асехоО]/g, (c) => LOOKALIKE[c]);
  t = t.replace(/[X:×]/g, 'x').replace(/0-0-0/g, 'O-O-O').replace(/0-0/g, 'O-O');
  t = t.replace(/[!?]+/g, '').replace(/m$/, '#');
  return t;
}

export interface BookLine {
  /** Чей первый ход по записи: «1.» - белых, «1...» - чёрных; null, если номеров нет. */
  side: Side | null;
  moves: string[];
}

/** Главная линия ответа: без комментариев [..], вариантов (..), номеров ходов и результата. */
export function parseBookLine(text: string): BookLine {
  let t = text.replace(/[–—]/g, '-').replace(/\[[^\]]*\]/g, ' ');
  let previous: string;
  do {
    previous = t;
    t = t.replace(/\([^()]*\)/g, ' ');
  } while (t !== previous);
  const first = t.match(/\d+\s*\.(\s*\.\.|…)?/);
  const side: Side | null = first ? (first[1] ? 'b' : 'w') : null;
  const moves = t
    .split(/\s+/)
    .map(normalizeSan)
    .filter((m) => SAN.test(m));
  return { side, moves };
}

/** Линия в SAN (в любой книжной записи) -> UCI. Нелегальный ход - LineError с номером и записью. */
export function sanLineToUci(fen: string, sans: string[]): string[] {
  const chess = new Chess(fen);
  return sans.map((raw, i) => {
    const san = normalizeSan(raw);
    try {
      return chess.move(san).lan;
    } catch {
      throw new LineError(`move ${i + 1} (${raw}) is illegal in ${chess.fen()}`);
    }
  });
}

function squares(placement: string): string[] {
  const out: string[] = [];
  for (const rank of placement.split('/')) {
    for (const ch of rank) {
      if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) out.push('');
      else out.push(ch);
    }
  }
  return out;
}

/** Права рокировки по положению: король и ладья на исходных полях (так принято в задачах). */
export function castlingFor(placement: string): string {
  const board = squares(placement);
  const at = (sq: string) => board[(8 - Number(sq[1])) * 8 + (sq.charCodeAt(0) - 97)];
  let rights = '';
  if (at('e1') === 'K') {
    if (at('h1') === 'R') rights += 'K';
    if (at('a1') === 'R') rights += 'Q';
  }
  if (at('e8') === 'k') {
    if (at('h8') === 'r') rights += 'k';
    if (at('a8') === 'r') rights += 'q';
  }
  return rights || '-';
}

export function placementToFen(placement: string, side: Side): string {
  return `${placement} ${side} ${castlingFor(placement)} - 0 1`;
}

/** null - позиция годится для задачи; иначе причина. chess.js не проверяет шах стороне, которая не ходит. */
export function validatePosition(fen: string): string | null {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch (e) {
    return (e as Error).message;
  }
  const toMove = chess.turn();
  const other: Side = toMove === 'w' ? 'b' : 'w';
  const king = chess
    .board()
    .flat()
    .find((p) => p && p.type === 'k' && p.color === other);
  if (king && chess.isAttacked(king.square, toMove)) {
    return `${other === 'w' ? 'white' : 'black'} king is in check but it is not their move`;
  }
  if (chess.moves().length === 0) return 'no legal moves (mate or stalemate on the diagram)';
  return null;
}

export function fenAfter(fen: string, ucis: string[]): string {
  const chess = new Chess(fen);
  for (const uci of ucis) chess.move(uciMove(uci));
  return chess.fen();
}

/** Другие матующие ходы на месте последнего хода решения (для приёмки «альтернативный мат»). */
export function alternativeMates(fen: string, solution: string[]): string[] {
  const chess = new Chess(fenAfter(fen, solution.slice(0, -1)));
  const last = solution.at(-1);
  const out: string[] = [];
  for (const move of chess.moves({ verbose: true })) {
    if (move.lan === last) continue;
    chess.move(move.san);
    if (chess.isCheckmate()) out.push(move.lan);
    chess.undo();
  }
  return out;
}
