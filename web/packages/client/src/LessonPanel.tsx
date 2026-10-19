import { useState, type KeyboardEvent } from 'react';
import { STUDENT_SAY_MAX, type AnalysisData, type BoardState, type ClientMessage, type LessonView } from '@board/shared';
import { GameMoves } from './LessonGame';
import { LessonDone, LessonHistory } from './LessonHistory';
import { LessonStrip } from './LessonStrip';
import type { LessonLayout } from './lessonLayout';
import { replayPath, type ReplayView } from './useLessonReplay';

interface Props {
  state: BoardState;
  analysis: AnalysisData | null;
  replay: ReplayView;
  connected: boolean;
  send(msg: ClientMessage): void;
  layout: LessonLayout;
  /** Переключатель движка: скрывает линии полосы и шкалу у доски, поэтому его держит App. */
  engine: { on: boolean; set(on: boolean): void };
}

function placeholder(l: LessonView, replaying: boolean): string {
  if (l.status === 'running' && !l.online) return 'Помощник не подключён';
  if (l.phase === 'coach') return 'Подожди, тренер отвечает';
  if (replaying) return 'Подожди, идёт показ ходов';
  // ход верный, тренер спросил «почему?»: вердикт остаётся до следующего хода
  if (l.phase === 'student' && l.verdict) return 'Ответь фразой или покажи ход на доске';
  return 'Ход на доске или короткая фраза';
}

function Actions({ state, replay, disabled, send }: { state: BoardState; replay: ReplayView; disabled: boolean; send(msg: ClientMessage): void }) {
  const l = state.lesson!;
  if (l.status !== 'running') return null;
  if (l.phase === 'pause') {
    return (
      <div className="lesson-actions" data-testid="lesson-actions">
        <button type="button" className="primary" disabled={disabled} onClick={() => send({ event: 'lessonNext', data: {} })}>
          Дальше
        </button>
      </div>
    );
  }
  if (l.phase !== 'feedback') return null;
  const error = l.verdict?.kind === 'wrong' || l.verdict?.kind === 'weaker' || l.verdict?.kind === 'unavailable';
  const retry = (
    <button
      key="retry"
      type="button"
      className={error ? 'primary' : undefined}
      disabled={disabled}
      onClick={() => send({ event: 'lessonRetry', data: {} })}
    >
      {error ? 'Попробовать другой ход' : 'К позиции'}
    </button>
  );
  const again = l.replay && replayPath(state, l.replay) && (
    <button key="again" type="button" disabled={replay.replaying} onClick={replay.restart}>
      Повторить показ
    </button>
  );
  return (
    <div className="lesson-actions" data-testid="lesson-actions">
      {error ? [retry, again] : [again, retry]}
    </div>
  );
}

/** Колонка тренера: полоса движка, история позиции с кнопками, поле ввода. */
export function LessonPanel({ state, analysis, replay, connected, send, layout, engine }: Props) {
  const l = state.lesson!;
  const [text, setText] = useState('');
  const running = l.status === 'running';
  const blocked = !connected || !running || !l.online || l.phase === 'coach' || replay.replaying;

  const submit = () => {
    const said = text.trim();
    if (blocked || said.length === 0 || said.length > STUDENT_SAY_MAX) return;
    send({ event: 'lessonSay', data: { text: said } });
    setText('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    submit();
  };

  const offline = running && !l.online;
  const done = l.phase === 'done';
  return (
    <section className="lesson-col" style={{ width: layout.column, height: layout.panel }}>
      <LessonStrip state={state} analysis={analysis} replay={replay} fullStrip={layout.fullStrip} engine={engine} />
      {done ? (
        <LessonDone lesson={l} />
      ) : offline && l.game ? (
        <div className="lesson-history">
          <GameMoves game={l.game} />
        </div>
      ) : (
        <LessonHistory
          lesson={l}
          actions={<Actions state={state} replay={replay} disabled={!connected || !l.online || replay.replaying} send={send} />}
        />
      )}
      {!done && (
        <div className={`lesson-input${blocked ? ' blocked' : ''}`}>
          <input
            type="text"
            aria-label="Фраза тренеру"
            maxLength={STUDENT_SAY_MAX}
            placeholder={placeholder(l, replay.replaying)}
            value={text}
            disabled={blocked}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
          />
          <button type="button" aria-label="отправить" disabled={blocked || text.trim() === ''} onClick={submit}>
            ↑
          </button>
        </div>
      )}
    </section>
  );
}
