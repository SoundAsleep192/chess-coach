import { useCallback, useEffect, useState } from 'react';
import type { NodeId } from '@board/shared';
import { banner, canDrag } from './banner';
import { BoardView } from './BoardView';
import { EvalColumn, lessonScore } from './LessonEval';
import { GameMovesButton } from './LessonGame';
import { TypingDots } from './LessonHistory';
import { LessonPanel } from './LessonPanel';
import { lessonLayout, useViewport } from './lessonLayout';
import { MoveList } from './MoveList';
import { Panel } from './Panel';
import { PromotionPicker } from './PromotionPicker';
import { PuzzleControls } from './PuzzleControls';
import { dropToMove, promotionUci, type PromotionPiece } from './moves';
import { navTarget, type NavKey } from './nav';
import { useBoardSocket, type SocketFactory } from './useBoardSocket';
import { useLessonReplay } from './useLessonReplay';

const KEYS: Record<string, NavKey> = {
  ArrowLeft: 'prev',
  ArrowRight: 'next',
  Home: 'start',
  End: 'end',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

const ERROR_TEXT: Record<string, string> = {
  frozen: 'Доска заморожена тренером',
  illegal: 'Нелегальный ход',
  forbidden: 'Эту ветку удалить нельзя',
  not_found: 'Позиция уже изменилась, доска обновлена',
  storage: 'Ошибка хранения на сервере',
  bad_request: 'Сервер отклонил запрос',
};

export function App({ socket }: { socket?: SocketFactory }) {
  const { state, connected, error, send, analysis } = useBoardSocket(socket);
  const [flipped, setFlipped] = useState(false);
  const [pending, setPending] = useState<{ parentId: NodeId; from: string; to: string } | null>(null);
  const replay = useLessonReplay(state);
  const viewport = useViewport();
  // Переключатель движка в занятии: выбор ученика живёт в пределах одной позиции и одного состояния помощника.
  // Без выбора включён при подключённом помощнике и выключен без него: анализ позиции без помощника
  // (лучший ход) не появляется, пока ученик сам не включит движок в этом состоянии.
  const [engineChoice, setEngineChoice] = useState<{ key: string; on: boolean } | null>(null);
  // Листать дерево можно только в свободном режиме: при заморозке, в задаче и в занятии - нельзя.
  // Без связи send молча теряет сообщения, поэтому действия блокируем так же, как при заморозке.
  const locked = state?.mode !== 'free' || !connected;
  // Во время показа ходов тренера доска заблокирована: ходы отбрасываются, в очередь не ставятся.
  const dragging = state ? canDrag(state, connected) && !replay.replaying : false;

  const go = useCallback(
    (key: NavKey) => {
      if (!state || locked) return;
      const target = navTarget(state, key);
      if (target) send({ event: 'navigate', data: { nodeId: target } });
    },
    [state, locked, send],
  );

  // Каждая новая задача открывается со стороны решающего: ручной переворот сбрасываем.
  const puzzleId = state?.puzzle?.puzzleId;
  useEffect(() => setFlipped(false), [puzzleId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = KEYS[e.key];
      // стрелки и Home/End в поле ввода занятия двигают курсор текста, а не доску
      if (!key || e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      go(key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  if (!state) {
    return <div className="status offline">{connected ? 'Загрузка доски…' : 'Нет связи с доской, переподключаюсь…'}</div>;
  }

  const node = state.nodes[state.cursor];
  const orientation = flipped ? (state.orientation === 'white' ? 'black' : 'white') : state.orientation;

  const onDrop = (from: string, to: string) => {
    if (!dragging) return;
    const result = dropToMove(node.fen, from, to);
    if (result.kind === 'move') send({ event: 'move', data: { parentId: node.id, uci: result.uci } });
    if (result.kind === 'promotion') setPending({ parentId: node.id, from, to });
  };

  const onPromote = (piece: PromotionPiece) => {
    if (pending && dragging) {
      send({ event: 'move', data: { parentId: pending.parentId, uci: promotionUci(pending.from, pending.to, piece) } });
    }
    setPending(null);
  };

  const errorText = (code: string, message: string) =>
    state.mode === 'puzzle' && code === 'frozen' ? 'Во время задачи можно только ходить' : (ERROR_TEXT[code] ?? message);
  const promotion = pending && (
    <PromotionPicker color={node.fen.split(' ')[1] === 'w' ? 'w' : 'b'} onPick={onPromote} onCancel={() => setPending(null)} />
  );

  const lesson = state.mode === 'lesson' ? state.lesson : undefined;
  if (lesson) {
    const layout = lessonLayout(viewport.w, viewport.h);
    const status = banner(state, connected, replay.replaying ? replay : undefined);
    const lead = status.muted ? status.text.slice(0, status.text.length - status.muted.length) : status.text;
    const engineKey = `${lesson.lessonId}|${lesson.index}|${state.rootId}|${lesson.online}`;
    const engine = {
      on: engineChoice?.key === engineKey ? engineChoice.on : lesson.online,
      set: (on: boolean) => setEngineChoice({ key: engineKey, on }),
    };
    // во время показа доска рисует показываемый узел, стрелки - только в конце
    const shown = replay.shownNode ? { ...state.nodes[replay.shownNode], arrows: [] } : node;
    const thinking = lesson.status === 'running' && lesson.online && lesson.phase === 'coach';
    const boardLocked = thinking || replay.replaying;
    return (
      <div className={`lesson-app ${layout.mode}`}>
        <header className={`lesson-status ${status.kind}`} role="status" data-testid="mode-banner">
          <span className="lesson-status-text">
            {status.kind === 'checking' && <span className="spinner" aria-hidden="true" />}
            {lead}
            {status.muted && <span className="muted">{status.muted}</span>}
            {error && <span className="error"> · {errorText(error.code, error.message)}</span>}
          </span>
          {lesson.game && !(lesson.status === 'running' && !lesson.online) && <GameMovesButton game={lesson.game} />}
        </header>
        <main className="lesson-main">
          <div className="lesson-board-group">
            <EvalColumn score={lessonScore(state, analysis, engine.on)} orientation={state.orientation} height={layout.board} />
            <div
              className={`lesson-board${boardLocked ? ' locked' : ''}`}
              style={{ width: layout.board, height: layout.board }}
              data-testid="lesson-board"
              data-node={shown.id}
              data-can-move={String(dragging)}
            >
              <BoardView node={shown} orientation={state.orientation} canMove={dragging} onDrop={onDrop} />
              {thinking && (
                <div className="board-veil" data-testid="board-veil">
                  <span>
                    Тренер отвечает
                    <TypingDots />
                  </span>
                </div>
              )}
            </div>
          </div>
          <LessonPanel
            state={state}
            analysis={analysis}
            replay={replay}
            connected={connected}
            send={send}
            layout={layout}
            engine={engine}
          />
        </main>
        {promotion}
      </div>
    );
  }

  const status = banner(state, connected);
  return (
    <div className="app">
      <div className={`status ${status.kind}`} role="status" data-testid="mode-banner">
        {status.text}
        {error && <span className="error"> · {errorText(error.code, error.message)}</span>}
      </div>
      <main className="layout">
        <section className="board-col">
          <BoardView node={node} orientation={orientation} canMove={dragging} onDrop={onDrop} />
          {node.caption && <div className="caption">{node.caption}</div>}
          <div className="controls">
            <button type="button" aria-label="в начало" disabled={locked} onClick={() => go('start')}>⏮</button>
            <button type="button" aria-label="назад" disabled={locked} onClick={() => go('prev')}>◀</button>
            <button type="button" aria-label="вперёд" disabled={locked} onClick={() => go('next')}>▶</button>
            <button type="button" aria-label="в конец" disabled={locked} onClick={() => go('end')}>⏭</button>
            <button type="button" aria-label="перевернуть" onClick={() => setFlipped((f) => !f)}>⇅</button>
          </div>
          {state.puzzle && <PuzzleControls puzzle={state.puzzle} disabled={!connected} send={send} />}
        </section>
        <aside className="moves-col">
          <Panel state={state} analysis={analysis} orientation={orientation} />
          {state.meta.title && <h1 className="title">{state.meta.title}</h1>}
          <MoveList
            state={state}
            disabled={locked}
            onSelect={(nodeId) => !locked && send({ event: 'navigate', data: { nodeId } })}
            onDelete={(nodeId) => !locked && send({ event: 'deleteBranch', data: { nodeId } })}
          />
        </aside>
      </main>
      {promotion}
    </div>
  );
}
