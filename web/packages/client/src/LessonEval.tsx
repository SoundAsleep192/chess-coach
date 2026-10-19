import type { AnalysisData, BoardState, Orientation, Score } from '@board/shared';
import { evalShare, formatEval } from './Panel';

/**
 * Число для шкалы занятия (со стороны белых): оценка из вердикта, как только он есть (и пока тренер отвечает);
 * без помощника - верхняя линия анализа позиции под курсором. Переключатель движка выключен - шкалы нет.
 */
export function lessonScore(state: BoardState, analysis: AnalysisData | null, engineOn: boolean): Score | null {
  const l = state.lesson;
  if (!engineOn || !l) return null;
  if (l.verdict?.score) return l.verdict.score;
  const offline = l.status === 'running' && !l.online;
  const top = analysis?.nodeId === state.cursor && analysis.status === 'ready' ? analysis.lines[0] : undefined;
  return offline && top ? top : null;
}

/** Колонка шкалы рядом с доской: ширина есть всегда, даже без оценки, чтобы доска не прыгала. */
export function EvalColumn({ score, orientation, height }: { score: Score | null; orientation: Orientation; height: number }) {
  return (
    <div className="lesson-bar" style={{ height }}>
      {score && (
        <>
          <div className="lesson-eval" data-testid="lesson-eval">{formatEval(score)}</div>
          <div className={`eval-bar${orientation === 'black' ? ' flipped' : ''}`} data-testid="eval-bar">
            <div className="eval-white" style={{ height: `${evalShare(score) * 100}%` }} />
          </div>
        </>
      )}
    </div>
  );
}
