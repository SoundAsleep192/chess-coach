import { LESSON_VERDICT_WORD, type AnalysisData, type BoardState, type LessonView, type NodeId } from '@board/shared';
import { TypingDots } from './LessonHistory';
import { formatEval } from './Panel';
import { moveNumber } from './nav';
import { replayPath, type ReplayView } from './useLessonReplay';

/** Имя движка в заголовке полосы: сервис движка один, Stockfish 19. */
export const ENGINE_NAME = 'Stockfish 19';

/** Ходы узлов пути после первого, с номерами: «1...e5 2.Nf3». */
export function lineSans(state: BoardState, path: NodeId[]): string[] {
  return path.slice(1).map((id, i) => {
    const node = state.nodes[id];
    return `${moveNumber(state.nodes[node.parent!].fen, i === 0)}${node.san}`;
  });
}

/**
 * Линии движка разворачиваются, только когда лучший ход уже не подсказка: позиция решена (pause, done) или в разборе
 * после хода с вердиктом «Верно» в этой позиции. После ошибки, хода «слабее», недоступного движка и после показа
 * тренера (info, линия на фразу) - только оценка и показанная линия. Без помощника занятие стоит, движок ученик
 * включает сам.
 */
function linesOpen(l: LessonView): boolean {
  if (l.status === 'running' && !l.online) return true;
  if (l.phase === 'pause' || l.phase === 'done') return true;
  return (
    l.phase === 'feedback' &&
    l.transcript.some((e) => e.who === 'coach' && e.kind === 'verdict' && e.text === LESSON_VERDICT_WORD.correct)
  );
}

/** Переключатель заблокирован, пока ученик думает, пока тренер отвечает и во время показа; без помощника доступен. */
export function engineLocked(l: LessonView, replaying: boolean): boolean {
  return replaying || (l.status === 'running' && l.online && (l.phase === 'student' || l.phase === 'coach'));
}

interface Props {
  state: BoardState;
  analysis: AnalysisData | null;
  replay: ReplayView;
  fullStrip: boolean;
  engine: { on: boolean; set(on: boolean): void };
}

function Body({ state, analysis, replay, fullStrip, engine }: Props) {
  const l = state.lesson!;
  const r = l.replay;
  const verdictScore = engine.on ? l.verdict?.score : undefined;
  if (replay.replaying && r) {
    const sans = lineSans(state, replayPath(state, r) ?? []);
    const shown = (i: number) => (i < replay.step - 1 ? ' shown' : i === replay.step - 1 ? ' current' : ' rest');
    return (
      <div className="strip-replay" data-testid="strip-replay">
        {verdictScore && <span className="line-eval">{formatEval(verdictScore)}</span>}
        {sans.map((san, i) => (
          <span key={i} className={`strip-move${shown(i)}`}>
            {san}
          </span>
        ))}
      </div>
    );
  }
  if (l.status === 'running' && l.online && (l.phase === 'student' || l.phase === 'coach')) {
    if (l.phase === 'student') return <div className="strip-closed">Движок скрыт, пока ты думаешь над ходом</div>;
    return (
      <div className="strip-closed">
        {l.verdict?.score ? 'Линии появятся вместе с ответом' : 'Оценка появится вместе с ответом'}
        <TypingDots />
      </div>
    );
  }
  if (!engine.on) return <div className="strip-closed">Движок выключен</div>;

  const current = analysis?.nodeId === state.cursor ? analysis : null;
  const top = current?.status === 'ready' ? current.lines[0] : undefined;
  if (!linesOpen(l)) {
    const score = l.verdict?.score ?? top;
    const shown = r && r.to === state.cursor ? lineSans(state, replayPath(state, r) ?? []) : [];
    return (
      <div className="strip-row" data-testid="strip-refutation">
        <span className="line-eval">{score ? formatEval(score) : '…'}</span>
        {shown.length > 0 && ` ${shown.join(' ')}`}
      </div>
    );
  }
  if (current?.status === 'unavailable') return <div className="strip-closed">Движок недоступен</div>;
  if (!current || current.status === 'pending' || !top) {
    return (
      <div className="strip-row">
        <span className="strip-row-text" data-testid="strip-row">…</span>
      </div>
    );
  }
  if (!fullStrip) {
    return (
      <div className="strip-row">
        <span className="strip-row-text" data-testid="strip-row">
          <span className="line-eval">{formatEval(top)}</span> {top.san.join(' ')}
        </span>
        {current.depth !== undefined && <span className="strip-depth">гл. {current.depth}</span>}
      </div>
    );
  }
  return (
    <div className="strip-full">
      <div className="strip-header">
        {ENGINE_NAME}
        {current.depth !== undefined && ` · глубина ${current.depth}`}
      </div>
      <ol className="engine-lines" data-testid="strip-lines">
        {current.lines.slice(0, 3).map((line, i) => (
          <li key={i}>
            <span className="line-eval">{formatEval(line)}</span> {line.san.join(' ')}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Полоса движка над историей: слева переключатель, справа показ, оценка с опровержением, строка или три линии. */
export function LessonStrip(props: Props) {
  const { engine } = props;
  const locked = engineLocked(props.state.lesson!, props.replay.replaying);
  return (
    <div className="engine-strip" data-testid="engine-strip">
      <label className={`engine-toggle${locked ? ' locked' : ''}`}>
        <input
          type="checkbox"
          role="switch"
          aria-label="Движок"
          checked={engine.on && !locked}
          disabled={locked}
          onChange={(e) => engine.set(e.target.checked)}
        />
        <span className="toggle-track" aria-hidden="true" />
      </label>
      <div className="strip-body">
        <Body {...props} />
      </div>
    </div>
  );
}
