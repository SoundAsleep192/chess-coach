import { describe, expect, it } from 'vitest';
import {
  START_FEN,
  addLine,
  addMove,
  deleteBranch,
  fromGame,
  isSubtreeBy,
  mainLine,
  mainLineNodeAtPly,
  pathTo,
  plyFromFen,
  promote,
  toPgn,
} from './tree';
import { TreeError } from './tree-error';

const sans = (nodes: { san: string | null }[]) => nodes.map((n) => n.san).join(' ');

function expectTreeError(fn: () => unknown, code: string, text?: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(TreeError);
    expect((e as TreeError).code).toBe(code);
    if (text) expect((e as TreeError).message).toContain(text);
    return;
  }
  throw new Error('expected TreeError');
}

describe('fromGame', () => {
  it('builds the main line from moves and puts the cursor at the end', () => {
    const t = fromGame({ moves: ['e4', 'e5', 'Nf3'] });
    expect(sans(mainLine(t).slice(1))).toBe('e4 e5 Nf3');
    expect(t.nodes[t.cursor].san).toBe('Nf3');
    expect(t.nodes[t.rootId].ply).toBe(0);
    expect(t.nodes[t.cursor].ply).toBe(3);
  });

  it('cuts the main line with upto: the position before ply upto is the last one', () => {
    const t = fromGame({ pgn: '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *' }, { upto: 4 });
    expect(sans(mainLine(t).slice(1))).toBe('e4 e5 Nf3');
    expect(t.nodes[t.cursor].ply).toBe(3);
  });

  it('reads nested variations from PGN without losses (pgn-parser check)', () => {
    const pgn = '1. e4 e5 (1... c5 2. Nf3 (2. c3 d5 (2... Nf6)) 2... d6) 2. Nf3 Nc6 *';
    const t = fromGame({ pgn });
    const root = t.nodes[t.rootId];
    const e4 = t.nodes[root.children[0]];
    expect(e4.children.map((id) => t.nodes[id].san)).toEqual(['e5', 'c5']);
    const c5 = t.nodes[e4.children[1]];
    expect(c5.author).toBe('coach');
    expect(c5.children.map((id) => t.nodes[id].san)).toEqual(['Nf3', 'c3']);
    const c3 = t.nodes[c5.children[1]];
    expect(c3.children.map((id) => t.nodes[id].san)).toEqual(['d5', 'Nf6']);
    expect(toPgn(t)).toBe('1. e4 e5 (1... c5 2. Nf3 (2. c3 d5 (2... Nf6)) 2... d6) 2. Nf3 Nc6 *\n');
  });

  it('accepts chess.com / lichess PGN with headers and clock comments', () => {
    const pgn = [
      '[Event "Live Chess"]',
      '[Site "Chess.com"]',
      '[White "sex_sempai"]',
      '[Black "Der_Zerstorer"]',
      '[Result "1/2-1/2"]',
      '[CurrentPosition "rnbqkbnr/pp2pppp/2p5/3p4/3PP3/8/PPP2PPP/RNBQKBNR w KQkq - 0 3"]',
      '[ECOUrl "https://www.chess.com/openings/Caro-Kann-Defense-2.d4-d5"]',
      '[TimeControl "600"]',
      '[Link "https://www.chess.com/game/live/147276340892"]',
      '',
      '1. e4 { [%clk 0:09:59.6] } 1... c6 { [%clk 0:09:58.7] } 2. d4 { [%clk 0:09:57.7] } 2... d5 { [%clk 0:09:58.6] } { [%cal Gc4a3] } 1/2-1/2',
    ].join('\n');
    const t = fromGame({ pgn }, { plyOffset: 0 });
    expect(sans(mainLine(t).slice(1))).toBe('e4 c6 d4 d5');
    expect(Object.values(t.nodes).every((n) => n.caption === undefined)).toBe(true);
  });

  it('starts from a FEN header with black to move and numbers moves from the FEN', () => {
    const fen = '8/6pp/p7/1p1pk2P/1P2pNn1/P3P1P1/3K4/8 b - - 4 43';
    const t = fromGame({ pgn: `[SetUp "1"]\n[FEN "${fen}"]\n\n43... Kf5 44. Nxd5 *` });
    expect(t.nodes[t.rootId].ply).toBe(85);
    expect(mainLineNodeAtPly(t, 86)!.id).toBe(t.rootId);
    expect(toPgn(t)).toBe(`[SetUp "1"]\n[FEN "${fen}"]\n\n43... Kf5 44. Nxd5 *\n`);
  });

  it('rejects an illegal move in PGN and garbage PGN', () => {
    expectTreeError(() => fromGame({ pgn: '1. e4 e5 2. Ke3 *' }), 'illegal', 'Ke3');
    expectTreeError(() => fromGame({ pgn: '1. e4 e5 2. Zz9 *' }), 'bad_request');
  });

  it('allocates ids after seqStart so ids of the previous tree are never reused', () => {
    const t = fromGame({ moves: ['e4'] }, { seqStart: 40 });
    expect(Object.keys(t.nodes).sort()).toEqual(['n41', 'n42']);
    expect(t.seq).toBe(42);
  });
});

describe('plyFromFen', () => {
  it('counts plies from the FEN move number and side to move', () => {
    expect(plyFromFen(START_FEN)).toBe(0);
    expect(plyFromFen('8/8/8/8/8/8/k7/4K3 b - - 0 43')).toBe(85);
  });
});

describe('addMove', () => {
  it('returns the existing child for a known move and creates a new node otherwise', () => {
    const t0 = fromGame({ moves: ['e4', 'e5'] });
    const root = t0.rootId;
    const same = addMove(t0, root, 'e2e4', 'student');
    expect(same.created).toBe(false);
    expect(same.node.author).toBe('game');
    expect(same.tree.nodes[root].children).toHaveLength(1);
    const fresh = addMove(t0, root, 'd2d4', 'student');
    expect(fresh.created).toBe(true);
    expect(fresh.node).toMatchObject({ san: 'd4', uci: 'd2d4', ply: 1, author: 'student', parent: root });
    expect(fresh.tree.nodes[root].children).toEqual([t0.nodes[root].children[0], fresh.node.id]);
    expect(t0.nodes[root].children).toHaveLength(1);
  });

  it('handles castling and promotion in UCI', () => {
    const castle = fromGame({ fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1' });
    const oo = addMove(castle, castle.rootId, 'e1g1', 'student');
    expect(oo.node).toMatchObject({ san: 'O-O', uci: 'e1g1' });
    const oooBySan = addLine(castle, castle.rootId, ['O-O-O'], 'coach');
    expect(oooBySan.nodes[0].uci).toBe('e1c1');

    const promo = fromGame({ fen: '8/4P3/8/8/8/8/k7/4K3 w - - 0 1' });
    expectTreeError(() => addMove(promo, promo.rootId, 'e7e8', 'student'), 'illegal');
    const knight = addMove(promo, promo.rootId, 'e7e8n', 'student');
    expect(knight.node).toMatchObject({ san: 'e8=N', uci: 'e7e8n' });
    const queen = addLine(promo, promo.rootId, ['e8=Q'], 'coach');
    expect(queen.nodes[0].uci).toBe('e7e8q');
  });

  it('throws not_found for an unknown parent', () => {
    expectTreeError(() => addMove(fromGame({}), 'n999', 'e2e4', 'student'), 'not_found');
  });
});

describe('addLine', () => {
  it('reuses existing moves and appends new ones', () => {
    const t0 = fromGame({ moves: ['e4', 'e5'] });
    const { tree, nodes } = addLine(t0, t0.rootId, ['e4', 'c5', 'Nf3'], 'coach');
    expect(nodes.map((n) => n.author)).toEqual(['game', 'coach', 'coach']);
    const e4 = tree.nodes[tree.nodes[tree.rootId].children[0]];
    expect(e4.children.map((id) => tree.nodes[id].san)).toEqual(['e5', 'c5']);
  });

  it('rejects a line with an illegal move in the middle and leaves the tree unchanged', () => {
    const t0 = fromGame({ moves: ['e4'] });
    expectTreeError(() => addLine(t0, t0.cursor, ['e5', 'Ke3', 'Nf3'], 'coach'), 'illegal', 'move 2 (Ke3)');
    expect(Object.keys(t0.nodes)).toHaveLength(2);
  });
});

describe('deleteBranch', () => {
  it('removes the subtree and moves the cursor to the parent when it was inside', () => {
    const t0 = fromGame({ moves: ['e4', 'e5'] });
    const e4 = t0.nodes[t0.rootId].children[0];
    const { tree: t1, nodes } = addLine(t0, e4, ['c5', 'Nf3', 'd6'], 'student');
    const withCursor = { ...t1, cursor: nodes[2].id };
    const t2 = deleteBranch(withCursor, nodes[0].id);
    expect(t2.cursor).toBe(e4);
    expect(t2.nodes[e4].children).toHaveLength(1);
    expect(nodes.every((n) => t2.nodes[n.id] === undefined)).toBe(true);
  });

  it('keeps the cursor when it is outside the deleted branch and refuses to delete the root', () => {
    const t0 = fromGame({ moves: ['e4', 'e5'] });
    const { tree: t1, node } = addMove(t0, t0.rootId, 'd2d4', 'student');
    expect(deleteBranch(t1, node.id).cursor).toBe(t0.cursor);
    expectTreeError(() => deleteBranch(t1, t1.rootId), 'bad_request');
  });
});

describe('isSubtreeBy', () => {
  it('is false when the coach continued a student branch', () => {
    const t0 = fromGame({ moves: ['e4'] });
    const s = addMove(t0, t0.cursor, 'c7c5', 'student');
    expect(isSubtreeBy(s.tree, s.node.id, 'student')).toBe(true);
    const c = addLine(s.tree, s.node.id, ['Nf3'], 'coach');
    expect(isSubtreeBy(c.tree, s.node.id, 'student')).toBe(false);
  });
});

describe('pathTo and mainLineNodeAtPly', () => {
  it('returns the nodes from the root', () => {
    const t = fromGame({ moves: ['e4', 'e5', 'Nf3'] });
    expect(pathTo(t, t.cursor).map((n) => n.san)).toEqual([null, 'e4', 'e5', 'Nf3']);
    expect(pathTo(t, t.cursor).map((n) => n.ply)).toEqual([0, 1, 2, 3]);
  });

  it('addresses positions by review ply with a non-zero plyOffset', () => {
    const fen = '8/6pp/p7/1p1pk2P/1P2pNn1/P3P1P1/3K4/8 b - - 4 43';
    const t = fromGame({ fen, moves: ['Kf5', 'Nxd5', 'Ne5'] }, { plyOffset: 85 });
    expect(mainLineNodeAtPly(t, 86)!.id).toBe(t.rootId);
    expect(mainLineNodeAtPly(t, 87)!.san).toBe('Kf5');
    expect(mainLineNodeAtPly(t, 89)!.san).toBe('Ne5');
    expect(mainLineNodeAtPly(t, 90)).toBeNull();
    expect(mainLineNodeAtPly(t, 85)).toBeNull();
  });

  it('returns null past the end of a game cut with upto', () => {
    const t = fromGame({ pgn: '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *' }, { upto: 4 });
    expect(mainLineNodeAtPly(t, 4)!.san).toBe('Nf3');
    expect(mainLineNodeAtPly(t, 5)).toBeNull();
  });
});

describe('toPgn', () => {
  it('writes nested variations and marks student branches', () => {
    const t0 = fromGame({ moves: ['e4', 'e5', 'Nf3', 'Nc6'] });
    const [, e4, e5] = mainLine(t0);
    const a = addLine(t0, e4.id, ['c5', 'Nf3'], 'coach');
    const b = addLine(a.tree, a.nodes[0].id, ['c3', 'd5'], 'coach');
    const c = addLine(b.tree, e5.id, ['Bc4'], 'student');
    const d = addLine(c.tree, c.nodes[0].id, ['Nf6'], 'coach');
    expect(toPgn(d.tree, { Event: 'Board', Mode: 'free' })).toBe(
      '[Event "Board"]\n[Mode "free"]\n\n' +
        '1. e4 e5 (1... c5 2. Nf3 (2. c3 d5)) 2. Nf3 (2. Bc4 {ученик} 2... Nf6) 2... Nc6 *\n',
    );
  });

  it('marks a student move that continues the main line', () => {
    const t0 = fromGame({ moves: ['e4'] });
    const s = addMove(t0, t0.cursor, 'e7e5', 'student');
    expect(toPgn(s.tree)).toBe('1. e4 e5 {ученик} *\n');
  });
});

describe('promote', () => {
  it('moves a variation to the front so it becomes the main line, and leaves the root alone', () => {
    const base = fromGame({ moves: ['e4', 'e5'] });
    const { tree, node: d4 } = addMove(base, base.rootId, 'd2d4', 'student');
    expect(sans(mainLine(tree).slice(1))).toBe('e4 e5');
    const promoted = promote(tree, d4.id);
    expect(sans(mainLine(promoted).slice(1))).toBe('d4');
    expect(promoted.nodes[promoted.rootId].children).toHaveLength(2);
    expect(sans(mainLine(tree).slice(1))).toBe('e4 e5');
    expect(promote(promoted, promoted.rootId)).toEqual(promoted);
  });

  it('fromGame with upto cuts variations at the same ply as the main line', () => {
    const pgn = '1. e4 e5 (1... c5 2. Nf3 d6 3. d4) 2. Nf3 Nc6 *';
    const tree = fromGame({ pgn }, { upto: 4 });
    const plies = Object.values(tree.nodes).map((n) => n.ply);
    expect(Math.max(...plies)).toBe(3);
    const sans = Object.values(tree.nodes).map((n) => n.san);
    expect(sans).toContain('c5');
    expect(sans).toContain('Nf3');
    expect(sans).not.toContain('d6');
    expect(sans).not.toContain('d4');
  });
});
