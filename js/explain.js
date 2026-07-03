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

// ---------------------------------------------------------------------------
// Positional / instructional detectors — these run on GOOD and NEUTRAL moves so
// almost every move gets a specific, position-aware reason (no LLM needed).
// ---------------------------------------------------------------------------
const CENTER4 = new Set(['d4', 'e4', 'd5', 'e5']);
const fileOf = (sq) => sq.charCodeAt(0) - 97;
const rankOf = (sq) => +sq[1];
const backRank = (color) => (color === 'w' ? 1 : 8);

function fileOpenness(chess, file, color) {
  let own = 0, enemy = 0;
  for (let r = 1; r <= 8; r++) {
    const p = chess.get(String.fromCharCode(97 + file) + r);
    if (p && p.type === 'p') { if (p.color === color) own++; else enemy++; }
  }
  if (own === 0 && enemy === 0) return 'open';
  if (own === 0) return 'semi';
  return 'closed';
}

function piecesLeft(chess) {
  let n = 0;
  for (const row of chess.board()) for (const sq of row) if (sq && sq.type !== 'k' && sq.type !== 'p') n++;
  return n;
}

// Could an enemy pawn ever advance to attack this square (to kick a knight off it)?
function pawnCanAttack(chess, sq, byColor) {
  const f = fileOf(sq), r = rankOf(sq);
  for (const df of [-1, 1]) {
    const ff = f + df; if (ff < 0 || ff > 7) continue;
    for (let rr = 1; rr <= 8; rr++) {
      const p = chess.get(String.fromCharCode(97 + ff) + rr);
      if (p && p.type === 'p' && p.color === byColor) {
        if (byColor === 'w' && rr < r) return true;
        if (byColor === 'b' && rr > r) return true;
      }
    }
  }
  return false;
}

// The just-moved piece creates a single concrete winning threat (forks handled separately).
function detectThreat(ctx) {
  const m = ctx.move;
  const chess = new Chess(ctx.fenAfter);
  const mover = m.color, enemy = mover === 'w' ? 'b' : 'w';
  const moverFen = setTurn(ctx.fenAfter, mover);
  let best = null;
  for (const row of chess.board()) for (const sq of row) {
    if (!sq || sq.color !== enemy) continue;
    if (!chess.attackers(sq.square, mover).includes(m.to)) continue;
    const swing = see(moverFen, sq.square);
    if (swing > 0 && (!best || swing > best.swing)) best = { square: sq.square, piece: sq.type, swing };
  }
  return best;
}

// The moved piece was under attack on its old square and is safe now.
function detectEscape(ctx) {
  const enemy = ctx.move.color === 'w' ? 'b' : 'w';
  const before = new Chess(ctx.fenBefore);
  if (!before.isAttacked(ctx.move.from, enemy)) return null;
  if (see(setTurn(ctx.fenBefore, enemy), ctx.move.from) <= 0) return null;
  if (see(setTurn(ctx.fenAfter, enemy), ctx.move.to) > 0) return null; // still hangs
  return { piece: ctx.move.piece };
}

function detectRecapture(ctx) {
  if (!ctx.move.captured) return null;
  const last = ctx.history[ctx.history.length - 1];
  return last && last.captured && last.to === ctx.move.to ? { piece: ctx.move.captured } : null;
}

function detectOpenFileRook(ctx) {
  if (ctx.move.piece !== 'r') return null;
  const o = fileOpenness(new Chess(ctx.fenAfter), fileOf(ctx.move.to), ctx.move.color);
  return o === 'closed' ? null : { file: ctx.move.to[0], openness: o };
}

function detectOutpost(ctx) {
  if (ctx.move.piece !== 'n') return null;
  const chess = new Chess(ctx.fenAfter);
  const m = ctx.move;
  const pawnDefended = chess.attackers(m.to, m.color).some((s) => { const p = chess.get(s); return p && p.type === 'p'; });
  if (!pawnDefended) return null;
  const advanced = m.color === 'w' ? rankOf(m.to) >= 4 : rankOf(m.to) <= 5;
  if (!advanced) return null;
  if (pawnCanAttack(chess, m.to, m.color === 'w' ? 'b' : 'w')) return null;
  return { square: m.to };
}

function detectDevelopment(ctx) {
  const m = ctx.move;
  if (ctx.ply > 22 || (m.piece !== 'n' && m.piece !== 'b')) return null;
  if (rankOf(m.from) !== backRank(m.color)) return null;
  const chess = new Chess(ctx.fenAfter);
  const eyesCenter = [...CENTER4].some((sq) => chess.attackers(sq, m.color).includes(m.to));
  return { piece: m.piece, eyesCenter };
}

function detectCenterPawn(ctx) {
  return ctx.move.piece === 'p' && CENTER4.has(ctx.move.to) && ctx.ply <= 16;
}

function detectPassedPush(ctx) {
  const m = ctx.move;
  if (m.piece !== 'p') return null;
  const chess = new Chess(ctx.fenAfter);
  if (piecesLeft(chess) > 6) return null;
  const f = fileOf(m.to), r = rankOf(m.to), enemy = m.color === 'w' ? 'b' : 'w';
  for (let df = -1; df <= 1; df++) {
    const ff = f + df; if (ff < 0 || ff > 7) continue;
    for (let rr = 1; rr <= 8; rr++) {
      const p = chess.get(String.fromCharCode(97 + ff) + rr);
      if (p && p.type === 'p' && p.color === enemy) {
        if (m.color === 'w' && rr > r) return null;
        if (m.color === 'b' && rr < r) return null;
      }
    }
  }
  return true;
}

function detectKingActivity(ctx) {
  const m = ctx.move;
  if (m.piece !== 'k' || piecesLeft(new Chess(ctx.fenAfter)) > 5) return null;
  const dist = (sq) => Math.abs(3.5 - fileOf(sq)) + Math.abs(4.5 - rankOf(sq));
  return dist(m.to) < dist(m.from) ? true : null;
}

// Phase- and grade-aware fallbacks. Each teaches a principle; rotated by ply so the
// same grade never reads identically twice in a row.
const FALLBACKS = {
  opening: {
    good: ['Smooth development — pieces out, fighting for the center.',
      'A healthy developing move — pieces out, king heading to safety.',
      'Solid — pieces toward the center, ready to castle.'],
    bad: ['A little slow — each opening move should develop a piece or grab the center.',
      'A bit loose this early — finish developing first.'],
  },
  middlegame: {
    good: ['Solid — pieces coordinated, no targets given.',
      'Sensible — improves your position without a weakness.',
      'Steady — building pressure, everything defended.'],
    bad: ['More was available — improve your worst-placed piece.',
      'A bit passive — look for an active plan.'],
  },
  endgame: {
    good: ['Clean technique — you keep your edge.',
      'Good — active pieces, pawns rolling.',
      'Accurate — no counterplay allowed.'],
    bad: ['Endgames need precision — a more accurate path was there.',
      'Careful — a more active try was available.'],
  },
};

function phaseOf(ctx) {
  if (ctx.ply <= 18) return 'opening';
  return piecesLeft(new Chess(ctx.fenAfter)) <= 6 ? 'endgame' : 'middlegame';
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
      else add(70, 'missed', `${eng.san} was the stronger move here.`);
    }
    const ks = detectKingShieldPawnMove(ctx.fenBefore, ctx.move);
    if (ks) add(60, 'kingsafety', `Pushing this pawn weakens the shelter in front of your ${ks.side}-castled king.`);
    const op = openingFlags(ctx.move, ctx.history, ctx.ply);
    if (op.samePieceTwice) add(40, 'opening', `Moving the same piece twice in the opening costs development time.`);
    if (op.earlyQueen) add(38, 'opening', `The queen out this early lets them gain time by attacking her.`);
  }

  if (!BAD.has(ctx.label)) {
    const hangsSelf = detectHanging(ctx.fenAfter, ctx.move)?.square === ctx.move.to;
    if (ctx.move.promotion) add(97, 'promo', `Promotion! Your pawn becomes a ${NAME[ctx.move.promotion]}.`);
    const fork = detectFork(ctx.fenAfter, ctx.move);
    if (fork && !hangsSelf) {
      const list = fork.targets.map((t) => NAME[t.piece]).join(' and ');
      add(95, 'fork', `Fork! Your ${NAME[fork.forker]} hits the ${list} at once — one will fall.`);
    }
    if (ctx.move.captured) {
      // Judge the capture on the RESULTING position (fenAfter), not fenBefore: moving the capturing
      // piece can reveal a defender it was blocking, so a "trade" would otherwise read as "free".
      // Then use static-exchange eval to tell a genuine free win / won exchange from an even trade.
      const oppColor = ctx.move.color === 'w' ? 'b' : 'w';
      const canRecapture = new Chess(ctx.fenAfter).isAttacked(ctx.move.to, oppColor);
      if (!canRecapture) {
        add(90, 'freecap', `Wins the ${NAME[ctx.move.captured]} for free — nothing can recapture on ${ctx.move.to}.`);
      } else {
        const net = (PIECE_VAL[ctx.move.captured] || 0) - Math.max(0, see(ctx.fenAfter, ctx.move.to));
        if (net >= 2) add(74, 'wonexch', `Wins material — your ${NAME[ctx.move.piece]} nets a ${NAME[ctx.move.captured]} on ${ctx.move.to}.`);
        else if (detectRecapture(ctx)) add(72, 'recap', `Recaptures on ${ctx.move.to} to keep material even.`);
        else add(66, 'trade', `Trades on ${ctx.move.to} — an even swap that simplifies the position.`);
      }
    }
    if (detectPassedPush(ctx)) add(82, 'passed', `Pushes your passed pawn toward queening — a runner like this can decide the endgame.`);
    const threat = detectThreat(ctx);
    if (threat && !hangsSelf && !fork) add(80, 'threat', `Threatens to win the ${NAME[threat.piece]} on ${threat.square} next — they have to react.`);
    const esc = detectEscape(ctx);
    if (esc) add(78, 'escape', `Slips your ${NAME[esc.piece]} out of danger before it can be taken.`);
    const out = detectOutpost(ctx);
    if (out) add(70, 'outpost', `Your knight lands on a strong outpost at ${out.square} — pawn-defended and safe from enemy pawns.`);
    if (ctx.move.san && ctx.move.san.endsWith('+')) add(64, 'check', `A check — they must answer it right away, so you set the pace.`);
    if (ctx.move.flags && (ctx.move.flags.includes('k') || ctx.move.flags.includes('q'))) add(62, 'castle', `Castling — king safe behind its pawns, rook toward the center.`);
    const dev = detectDevelopment(ctx);
    if (dev) add(54, 'dev', `Develops your ${NAME[dev.piece]} off the back rank${dev.eyesCenter ? ', eyeing the center' : ''}.`);
    if (detectCenterPawn(ctx)) add(52, 'center', `Stakes a claim in the center, giving your pieces more room.`);
    const rook = detectOpenFileRook(ctx);
    if (rook) add(50, 'rook', `Rook to the ${rook.openness === 'open' ? 'open' : 'half-open'} ${rook.file}-file, where rooks do their best work.`);
    if (detectKingActivity(ctx)) add(48, 'kingact', `Activates your king — a real fighting piece in the endgame.`);
    if (matchedBest) add(30, 'best', `The engine's top pick — active and gives nothing away.`);
  }

  if (!reasons.length) {
    const special = {
      Brilliant: 'Brilliant! You gave up material on purpose to win something even bigger.',
      Great: 'Great find — the one move that held everything together.',
      Book: 'A standard book move — you\'re right in theory.',
    };
    if (special[ctx.label]) return { type: 'fallback', text: special[ctx.label], all: [] };
    const phase = phaseOf(ctx);
    const bucket = BAD.has(ctx.label) ? 'bad' : 'good';
    const pool = FALLBACKS[phase][bucket];
    return { type: 'fallback', text: pool[ctx.ply % pool.length], all: [] };
  }
  reasons.sort((a, b) => b.prio - a.prio);
  const detail = reasons.slice(0, 3).map((r) => r.text);
  return { ...reasons[0], all: reasons, detail };
}
