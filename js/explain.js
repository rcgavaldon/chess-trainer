// explain.js — heuristic move-explanation engine. Plain English "why" for each move.
// The eval/label (from analysis.classifyMove) is the source of truth for good/bad;
// these heuristics only supply the REASON. A heuristic that disagrees with the eval
// is never shown. One salient sentence per move (priority-ordered).
//
// chess.js v1.x primitives used: attackers(square,color), isAttacked(square,color),
// get(square), board(), move(), put/remove, isCheck() — the backbone of the detectors.

import { Chess } from 'chess.js';

const PIECE_VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

const BAD = new Set(['Inaccuracy', 'Miss', 'Mistake', 'Blunder']);
const GOOD = new Set(['Brilliant', 'Great', 'Best', 'Excellent', 'Good']);

// Flip the active-color field of a FEN (used by the SEE swap-off, which edits the
// board manually via put/remove rather than playing legal moves).
function setTurn(fen, color) {
  const f = fen.split(' ');
  f[1] = color;
  f[3] = '-'; // en passant target no longer valid after a manual edit
  return f.join(' ');
}

// SEE-lite: material the side-to-move can win by capturing on `square`, by force.
// Recursive least-valuable-attacker swap-off. Ignores pins/x-rays (acceptable: we
// only surface a result when the engine eval also dropped, which filters noise).
export function see(fen, square) {
  let c;
  try { c = new Chess(fen); } catch { return 0; } // defensive: never throw out of a detector
  const victim = c.get(square);
  if (!victim || victim.type === 'k') return 0;   // a king can never be won in an exchange
  const side = c.turn();
  const attackers = c.attackers(square, side);
  if (!attackers.length) return 0;
  attackers.sort((a, b) => PIECE_VAL[c.get(a).type] - PIECE_VAL[c.get(b).type]);
  const from = attackers[0];
  const attackerType = c.get(from).type;
  const c2 = new Chess(fen);
  c2.remove(square);
  c2.remove(from);
  c2.put({ type: attackerType, color: side }, square);
  const next = setTurn(c2.fen(), side === 'w' ? 'b' : 'w');
  return Math.max(0, PIECE_VAL[victim.type] - see(next, square));
}

// After our move it's the opponent's turn — find our most valuable piece they can win by force.
function detectHanging(fenAfter, move) {
  const chess = new Chess(fenAfter);
  const them = chess.turn();
  const us = them === 'w' ? 'b' : 'w';
  let worst = null;
  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq || sq.color !== us) continue;
      if (!chess.isAttacked(sq.square, them)) continue;
      const swing = see(fenAfter, sq.square);
      if (swing > 0 && (!worst || swing > worst.swing)) worst = { square: sq.square, piece: sq.type, swing };
    }
  }
  if (worst && worst.square === move.to) worst.movedPieceHangs = true;
  return worst;
}

// The just-moved piece attacks 2+ winnable enemy targets.
function detectFork(fenAfter, move) {
  const chess = new Chess(fenAfter);
  const mover = move.color;
  const forkerSq = move.to;
  const forker = chess.get(forkerSq);
  if (!forker) return null;
  const enemy = mover === 'w' ? 'b' : 'w';
  const targets = [];
  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq || sq.color !== enemy) continue;
      if (!chess.attackers(sq.square, mover).includes(forkerSq)) continue;
      const defended = chess.isAttacked(sq.square, enemy);
      const winnable = sq.type === 'k' || !defended || PIECE_VAL[sq.type] > PIECE_VAL[forker.type];
      if (winnable) targets.push({ square: sq.square, piece: sq.type, isKing: sq.type === 'k' });
    }
  }
  if (targets.length >= 2) {
    targets.sort((a, b) => PIECE_VAL[b.piece] - PIECE_VAL[a.piece]);
    return { forker: forker.type, targets };
  }
  return null;
}

// Pushing a pawn that shelters a castled king.
function detectKingShieldPawnMove(fenBefore, move) {
  if (move.piece !== 'p') return null;
  const chess = new Chess(fenBefore);
  const me = move.color;
  let kingSq = null;
  for (const row of chess.board()) for (const sq of row) if (sq && sq.type === 'k' && sq.color === me) kingSq = sq.square;
  if (!kingSq) return null;
  const kFile = kingSq.charCodeAt(0) - 97;
  const kRank = +kingSq[1];
  const castledKingside = kFile >= 5;
  const castledQueenside = kFile <= 2;
  if (!castledKingside && !castledQueenside) return null;
  const homeRank = me === 'w' ? 1 : 8;
  if (Math.abs(kRank - homeRank) > 1) return null;
  const pFile = move.from.charCodeAt(0) - 97;
  if (Math.abs(pFile - kFile) > 1) return null;
  return { side: castledKingside ? 'kingside' : 'queenside' };
}

// The engine's preferred move, classified for a specific sentence.
function describeEngineMove(fenBefore, bestMoveUci) {
  const chess = new Chess(fenBefore);
  const cand = chess.moves({ verbose: true }).find((m) => m.from + m.to + (m.promotion || '') === bestMoveUci);
  if (!cand) return { san: bestMoveUci, kind: 'positional' };
  let kind = cand.captured ? 'capture' : 'positional';
  const c2 = new Chess(fenBefore);
  const r = c2.move(cand);
  if (r && c2.isCheckmate()) kind = 'mate';
  else if (r && c2.isCheck()) kind = 'check';
  return { san: cand.san, kind, captured: cand.captured };
}

function openingFlags(move, history, ply) {
  if (ply > 24) return {};
  const flags = {};
  const minor = (p) => p === 'n' || p === 'b';
  const myMoves = history.filter((m) => m.color === move.color);
  if (minor(move.piece) && myMoves.some((m) => m.to === move.from)) flags.samePieceTwice = true;
  if (move.piece === 'q' && ply <= 8) flags.earlyQueen = true;
  return flags;
}

// Build the single explanation sentence for a move.
// ctx = { fenBefore, fenAfter, move (verbose), bestMoveUci, bestMoveSan, pvSans, history, ply, label, winLoss }
export function explainMove(ctx) {
  const reasons = [];
  const add = (prio, type, text) => reasons.push({ prio, type, text });
  const playedUci = ctx.move.from + ctx.move.to + (ctx.move.promotion || '');
  const matchedBest = ctx.bestMoveUci && playedUci === ctx.bestMoveUci;

  if (BAD.has(ctx.label)) {
    const hang = detectHanging(ctx.fenAfter, ctx.move);
    if (hang) {
      const name = NAME[hang.piece];
      if (hang.movedPieceHangs) add(100, 'hang', `This leaves your ${name} on ${hang.square} hanging — it can be taken for free.`);
      else add(98, 'hang', `This drops material: your ${name} on ${hang.square} can now be won by force.`);
    }
    if (ctx.bestMoveUci && !matchedBest) {
      const eng = describeEngineMove(ctx.fenBefore, ctx.bestMoveUci);
      if (eng.kind === 'capture') add(90, 'missed', `You missed ${eng.san}, winning the ${NAME[eng.captured]}.`);
      else if (eng.kind === 'mate') add(94, 'missed', `Stronger was ${eng.san}, which leads to mate.`);
      else if (eng.kind === 'check') add(85, 'missed', `Stronger was ${eng.san}, a check that flips the position.`);
      else add(70, 'missed', `The engine prefers ${eng.san} here.`);
    }
    const ks = detectKingShieldPawnMove(ctx.fenBefore, ctx.move);
    if (ks) add(60, 'kingsafety', `Pushing this pawn weakens the shelter in front of your ${ks.side}-castled king.`);
    const op = openingFlags(ctx.move, ctx.history, ctx.ply);
    if (op.samePieceTwice) add(40, 'opening', `Moving the same piece twice in the opening costs development time.`);
    if (op.earlyQueen) add(38, 'opening', `Bringing the queen out this early lets your opponent develop with tempo by attacking her.`);
  }

  if (GOOD.has(ctx.label)) {
    const fork = detectFork(ctx.fenAfter, ctx.move);
    // suppress fork praise if the forking piece itself hangs
    const forkerSafe = fork && !(detectHanging(ctx.fenAfter, ctx.move)?.square === ctx.move.to);
    if (fork && forkerSafe) {
      const list = fork.targets.map((t) => NAME[t.piece]).join(' and ');
      add(92, 'fork', `Nice fork — your ${NAME[fork.forker]} hits the ${list} at once.`);
    }
    if (ctx.move.captured) {
      const cb = new Chess(ctx.fenBefore);
      const oppDefends = cb.isAttacked(ctx.move.to, cb.turn() === 'w' ? 'b' : 'w');
      if (!oppDefends) add(88, 'freecap', `You win the ${NAME[ctx.move.captured]} for free.`);
    }
    if (matchedBest) add(80, 'best', `Nice — exactly what the engine wanted. It keeps your pieces active and safe.`);
    if (ctx.move.flags && (ctx.move.flags.includes('k') || ctx.move.flags.includes('q')))
      add(45, 'castle', `Castling tucks your king to safety and connects the rooks.`);
  }

  if (!reasons.length) {
    const fb = {
      Brilliant: 'Wow — you gave up material on purpose to win something even bigger. Great eye!',
      Great: 'Awesome — this was the one move that kept you in the game. Hard to find!',
      Best: 'This is the best move. It keeps your pieces working together and doesn\'t give anything away.',
      Excellent: 'Really good move — your position stays strong and safe.',
      Good: 'A solid move that keeps things on track.',
      Book: 'A normal opening move that lots of players know.',
      Inaccuracy: 'Not the sharpest choice — there was a slightly better move here.',
      Miss: 'You were winning here and let a little of your lead slip away.',
      Mistake: 'This gives your opponent a chance — there was a stronger move.',
      Blunder: 'Oops — this loses something important. Slow down and look for a safer move.',
    };
    return { type: 'fallback', text: fb[ctx.label] || 'A reasonable move.', all: [] };
  }
  reasons.sort((a, b) => b.prio - a.prio);
  return { ...reasons[0], all: reasons };
}
