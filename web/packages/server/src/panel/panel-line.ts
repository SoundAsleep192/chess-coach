import { Chess } from 'chess.js';
import type { EngineLine, PanelLine } from '@board/shared';

export const PANEL_PLIES = 8;

/** Линия движка для панели: SAN с номерами, оценка со стороны белых. Нелегальный ход обрывает линию. */
export function toPanelLine(fen: string, line: EngineLine): PanelLine {
  const chess = new Chess(fen);
  const sign = fen.split(' ')[1] === 'w' ? 1 : -1;
  const san: string[] = [];
  for (const uci of line.pv.slice(0, PANEL_PLIES)) {
    const [, turn, , , , full] = chess.fen().split(' ');
    let played;
    try {
      played = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      break;
    }
    san.push(turn === 'w' ? `${full}.${played.san}` : san.length === 0 ? `${full}...${played.san}` : played.san);
  }
  const out: PanelLine = { san };
  if (line.mate !== undefined) out.mate = sign * line.mate;
  else if (line.cp !== undefined) out.cp = sign * line.cp;
  return out;
}
