import { Chess } from 'chess.js';
import { winPct, type AnalysisData, type BoardState, type Orientation, type PanelLine } from '@board/shared';

const MINUS = '−';

/** Оценка со стороны белых: '+1.2' | '−0.4' | '0.0' | '#3' | '#−2'. */
export function formatEval(l: Pick<PanelLine, 'cp' | 'mate'>): string {
  if (l.mate !== undefined) return l.mate < 0 ? `#${MINUS}${Math.abs(l.mate)}` : `#${l.mate}`;
  const pawns = Math.round((l.cp ?? 0) / 10) / 10;
  if (pawns === 0) return '0.0';
  return `${pawns < 0 ? MINUS : '+'}${Math.abs(pawns).toFixed(1)}`;
}

/** Доля белых на шкале, 0..1. */
export function evalShare(l: Pick<PanelLine, 'cp' | 'mate'> | undefined): number {
  return winPct(l ?? { cp: 0 }) / 100;
}

interface Shown {
  label: string;
  share: number;
  unavailable: boolean;
  lines: PanelLine[];
}

function describe(analysis: AnalysisData | null, fen: string): Shown {
  if (!analysis) return { label: '…', share: 0.5, unavailable: false, lines: [] };
  if (analysis.status === 'unavailable') return { label: 'Движок недоступен', share: 0.5, unavailable: true, lines: [] };
  if (analysis.status === 'pending') return { label: '…', share: 0.5, unavailable: false, lines: [] };
  if (analysis.lines.length === 0) {
    const chess = new Chess(fen);
    const mated = chess.isCheckmate();
    const white = chess.turn() === 'w';
    return { label: mated ? 'мат' : 'пат', share: mated ? (white ? 0 : 1) : 0.5, unavailable: false, lines: [] };
  }
  return { label: formatEval(analysis.lines[0]), share: evalShare(analysis.lines[0]), unavailable: false, lines: analysis.lines };
}

export function Panel({
  state,
  analysis,
  orientation,
}: {
  state: BoardState;
  analysis: AnalysisData | null;
  orientation: Orientation;
}) {
  const panel = state.panel;
  if (state.mode === 'puzzle' || (!panel?.eval && !panel?.lines && !panel?.note)) return null;

  const fen = state.nodes[state.cursor].fen;
  const current = analysis?.nodeId === state.cursor ? analysis : null;
  const shown = describe(current, fen);
  const lineCount = panel.lines ?? 0;

  return (
    <div className="panel" data-testid="panel">
      {panel.eval && (
        <div className="eval">
          <div className="eval-value" data-testid="eval-value">{shown.label}</div>
          <div
            className={`eval-bar${shown.unavailable ? ' unavailable' : ''}${orientation === 'black' ? ' flipped' : ''}`}
            data-testid="eval-bar"
          >
            <div className="eval-white" style={{ height: `${shown.share * 100}%` }} />
          </div>
        </div>
      )}
      <div className="panel-text">
        {!panel.eval && lineCount > 0 && shown.lines.length === 0 && (
          <div className="engine-status" data-testid="engine-status">{shown.label}</div>
        )}
        {lineCount > 0 && (
          <ol className="engine-lines" data-testid="engine-lines">
            {shown.lines.slice(0, lineCount).map((line, i) => (
              <li key={i}>
                <span className="line-eval">{formatEval(line)}</span> {line.san.join(' ')}
              </li>
            ))}
          </ol>
        )}
        {panel.note && (
          <div className="coach-note" data-testid="coach-note">{panel.note}</div>
        )}
      </div>
    </div>
  );
}
