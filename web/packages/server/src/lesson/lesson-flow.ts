import {
  LESSON_TRANSCRIPT_MAX,
  LESSON_VERDICT_WORD,
  PANEL_OFF,
  STUDENT_SAY_MAX,
  type BoardState,
  type LessonAction,
  type LessonEntry,
  type LessonInput,
  type LessonPhase,
  type LessonPositionSetup,
  type LessonReplyBody,
  type LessonStartBody,
  type LessonVerdict,
  type LessonVerdictBody,
  type LessonView,
  type NodeId,
  type Tree,
} from '@board/shared';
import { BoardError } from '../board/board-error';
import { moveToken } from '../inbox/inbox-format';
import { treeOf } from '../puzzles/puzzle-flow';
import { addLine, addMove, fromGame, promote } from '../tree/tree';

/** Чистые переходы занятия у доски: каждая функция получает состояние и возвращает новое. Модель и движок зовёт помощник. */

export const LESSON_RUNNING = 'a lesson is running: stop it first with coach lesson stop';

export function isLessonRunning(s: BoardState): boolean {
  return s.mode === 'lesson' && s.lesson?.status === 'running';
}

const entry = (who: LessonEntry['who'], kind: LessonEntry['kind'], text: string, now: Date): LessonEntry => ({
  who,
  kind,
  text,
  at: now.toISOString(),
});

const capped = (transcript: LessonEntry[]): LessonEntry[] => transcript.slice(-LESSON_TRANSCRIPT_MAX);

/** Запись о вердикте: info - ответ на демонстрационный ход, плашки нет. */
function verdictEntries(v: LessonVerdict | undefined, now: Date): LessonEntry[] {
  return v && v.kind !== 'info' ? [entry('coach', 'verdict', LESSON_VERDICT_WORD[v.kind], now)] : [];
}

function positionEntries(p: LessonPositionSetup, now: Date): LessonEntry[] {
  return [entry('coach', 'say', p.context, now), entry('coach', 'say', p.task, now)];
}

/** Занятие должно идти; иначе frozen. */
function activeLesson(s: BoardState): LessonView {
  if (!isLessonRunning(s)) throw new BoardError('frozen', 'no lesson is running');
  return s.lesson!;
}

/** Ввод ученика (ход, фраза, «Дальше») принимается, только пока помощник подключён: иначе ответа не будет и занятие зависнет. */
function answerableLesson(s: BoardState): LessonView {
  const l = activeLesson(s);
  if (!l.online) throw new BoardError('frozen', 'the lesson assistant is not connected: tell the coach in the chat');
  return l;
}

/** Дерево, поля доски и поля занятия для новой позиции; общее для startLesson и действия position. */
function withPosition(s: BoardState, p: LessonPositionSetup, title: string): Pick<BoardState, keyof Tree | 'orientation' | 'meta' | 'panel' | 'treeEpoch' | 'puzzle'> {
  const tree = fromGame({ fen: p.fen }, { seqStart: s.seq });
  return {
    ...tree,
    orientation: p.orientation,
    meta: { title, plyOffset: tree.nodes[tree.rootId].ply, ...(p.gameId ? { gameId: p.gameId } : {}) },
    panel: PANEL_OFF,
    treeEpoch: (s.treeEpoch ?? 0) + 1,
    puzzle: undefined,
  };
}

/** online - есть ли подключённый помощник: берётся из аргумента, а не из старого занятия. */
export function startLesson(s: BoardState, b: LessonStartBody, now: Date, online: boolean): BoardState {
  const board = withPosition(s, b.position, b.title);
  const seq = s.lesson?.lessonId === b.lessonId ? s.lesson.seq : 0;
  const transcript = [...(b.intro ? [entry('coach', 'say', b.intro, now)] : []), ...positionEntries(b.position, now)];
  const lesson: LessonView = {
    lessonId: b.lessonId,
    title: b.title,
    status: 'running',
    index: b.index,
    total: b.total,
    label: b.position.label,
    phase: 'student',
    node: board.rootId,
    transcript: capped(transcript),
    seq,
    online,
    game: b.position.game,
  };
  return { ...s, ...board, mode: 'lesson', lesson };
}

export function lessonMove(s: BoardState, parentId: NodeId, uci: string, now: Date): BoardState {
  const l = answerableLesson(s);
  if (l.phase !== 'student') throw new BoardError('frozen', `wait: the coach is answering (phase ${l.phase})`);
  if (parentId !== l.node || s.cursor !== l.node) throw new BoardError('frozen', 'the move must be made from the lesson position');
  const { tree, node } = addMove(treeOf(s), parentId, uci, 'student');
  const id = l.seq + 1;
  const pending: LessonInput = { id, kind: 'move', node: node.id, uci: node.uci!, san: node.san!, resume: 'student' };
  const text = moveToken(s.nodes[parentId].fen, node.san!, true);
  return {
    ...s,
    ...tree,
    cursor: node.id,
    lesson: {
      ...l,
      phase: 'coach',
      pending,
      verdict: undefined,
      seq: id,
      transcript: capped([...l.transcript, entry('student', 'move', text, now)]),
    },
  };
}

export function lessonSay(s: BoardState, text: string, now: Date): BoardState {
  const l = answerableLesson(s);
  if (l.phase !== 'student' && l.phase !== 'feedback' && l.phase !== 'pause') {
    throw new BoardError('frozen', `wait: the coach is answering (phase ${l.phase})`);
  }
  const said = text.trim();
  if (said.length < 1 || said.length > STUDENT_SAY_MAX) {
    throw new BoardError('bad_request', `a phrase must be 1-${STUDENT_SAY_MAX} characters`);
  }
  const id = l.seq + 1;
  return {
    ...s,
    lesson: {
      ...l,
      phase: 'coach',
      pending: { id, kind: 'say', text: said, resume: l.phase },
      seq: id,
      transcript: capped([...l.transcript, entry('student', 'say', said, now)]),
    },
  };
}

export function lessonNext(s: BoardState, _now: Date): BoardState {
  const l = answerableLesson(s);
  if (l.phase !== 'pause') throw new BoardError('frozen', 'there is nothing to continue from');
  const id = l.seq + 1;
  return { ...s, lesson: { ...l, phase: 'coach', pending: { id, kind: 'next', resume: 'pause' }, seq: id } };
}

export function lessonRetry(s: BoardState): BoardState {
  const l = activeLesson(s);
  if (l.phase !== 'feedback') throw new BoardError('frozen', 'nothing to retry: the lesson waits for something else');
  return { ...s, cursor: l.node, lesson: { ...l, phase: 'student', verdict: undefined } };
}

/** Вердикт и ответ принимаются только на последнее событие, которое ждёт тренера. */
function awaited(s: BoardState, inputId: number): { l: LessonView; p: LessonInput } {
  const l = s.lesson;
  if (!isLessonRunning(s) || l?.phase !== 'coach' || !l.pending || l.pending.id !== inputId) {
    throw new BoardError('stale', `input ${inputId} is not the one the lesson waits for`);
  }
  return { l, p: l.pending };
}

export function applyLessonVerdict(s: BoardState, b: LessonVerdictBody, now: Date): BoardState {
  const { l } = awaited(s, b.inputId);
  return {
    ...s,
    lesson: { ...l, verdict: b.verdict, transcript: capped([...l.transcript, ...verdictEntries(b.verdict, now)]) },
  };
}

/** Какие действия подходят какому событию (accept - у хода). */
function actionFits(a: LessonAction, kind: LessonInput['kind'], accept: boolean): boolean {
  switch (a.type) {
    case 'none':
      return kind !== 'move';
    case 'ask':
      return (kind === 'move' && accept) || kind === 'say';
    case 'arrows':
      return kind === 'say';
    case 'back':
      return (kind === 'move' && !accept) || kind === 'say';
    case 'feedback':
      return kind === 'move' && !accept;
    default:
      return true;
  }
}

export function applyLessonReply(s: BoardState, b: LessonReplyBody, now: Date): BoardState {
  const { l, p } = awaited(s, b.inputId);
  const accept = b.accept === true && p.kind === 'move';
  const a = b.action;
  if (!actionFits(a, p.kind, b.accept === true)) {
    throw new BoardError('bad_request', `action ${a.type} does not fit a ${p.kind} event${b.accept ? ' with accept' : ''}`);
  }
  let tree = treeOf(s);
  let node = l.node;
  if (accept) {
    node = p.node;
    tree = promote(tree, node);
  }
  // оценка из ответа считается, только если вердикта ещё не было
  const verdict = l.verdict ?? b.verdict;
  const said = b.say?.trim();
  const transcript = [
    ...l.transcript,
    ...(l.verdict ? [] : verdictEntries(b.verdict, now)),
    ...(said ? [entry('coach', 'say', said, now)] : []),
  ];
  const next: LessonView = { ...l, pending: undefined, verdict, node, transcript: capped(transcript) };
  const done = (t: Tree, patch: Partial<LessonView>): BoardState => ({ ...s, ...t, lesson: { ...next, ...patch } });
  switch (a.type) {
    case 'none':
      return done(tree, { phase: p.resume as LessonPhase });
    case 'ask':
      return done({ ...tree, cursor: node }, { phase: 'student' });
    case 'play': {
      const added = addMove(tree, node, a.uci, 'coach');
      const t = promote(added.tree, added.node.id);
      return done({ ...t, cursor: added.node.id }, {
        phase: 'student',
        node: added.node.id,
        verdict: undefined,
        replay: { from: node, to: added.node.id, id: p.id },
      });
    }
    case 'line': {
      if (a.moves.length === 0) throw new BoardError('bad_request', 'a line needs at least one move');
      const added = addLine(tree, a.from, a.moves, 'coach');
      const last = added.nodes.at(-1)!.id;
      added.tree.nodes[last] = { ...added.tree.nodes[last], arrows: a.arrows ?? [] };
      return done({ ...added.tree, cursor: last }, { phase: a.then, replay: { from: a.from, to: last, id: p.id } });
    }
    case 'arrows': {
      tree.nodes = structuredClone(tree.nodes);
      tree.nodes[tree.cursor] = { ...tree.nodes[tree.cursor], arrows: a.arrows };
      return done(tree, { phase: p.resume as LessonPhase });
    }
    case 'back':
      return done({ ...tree, cursor: node }, { phase: 'student', verdict: undefined });
    case 'feedback': {
      // курсор остаётся на ходе ученика (событие здесь всегда move без accept)
      const moved = (p as Extract<LessonInput, { kind: 'move' }>).node;
      tree.nodes = structuredClone(tree.nodes);
      tree.nodes[moved] = { ...tree.nodes[moved], arrows: a.arrows ?? [] };
      return done({ ...tree, cursor: moved }, { phase: 'feedback' });
    }
    case 'pause':
      return done(tree, { phase: 'pause' });
    case 'position': {
      const board = withPosition(s, a.position, l.title);
      return {
        ...s,
        ...board,
        lesson: {
          ...next,
          index: a.index,
          label: a.position.label,
          game: a.position.game,
          phase: 'student',
          node: board.rootId,
          verdict: undefined,
          replay: undefined,
          transcript: capped(positionEntries(a.position, now)),
        },
      };
    }
    case 'end':
      return done(tree, { status: 'done', phase: 'done', summary: a.summary });
  }
}

export function stopLesson(s: BoardState, _now: Date): BoardState {
  const l = activeLesson(s);
  return { ...s, mode: 'free', lesson: { ...l, status: 'stopped', pending: undefined } };
}

export function setAssistantOnline(s: BoardState, online: boolean): BoardState {
  return s.lesson ? { ...s, lesson: { ...s.lesson, online } } : s;
}
