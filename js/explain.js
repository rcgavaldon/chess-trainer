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
    good: ['Smooth opening play — you keep developing and fighting for the center, no time wasted.',
      'A healthy developing move. In the opening the goal is simple: get your pieces out and your king safe, and this does that.',
      'Solid. You\'re following the opening principles — pieces toward the center, ready to castle.'],
    bad: ['A little slow for the opening — every move here should develop a new piece or grab the center.',
      'This loosens things up early. Try to finish developing before starting an adventure.'],
  },
  middlegame: {
    good: ['Good middlegame move — your pieces stay coordinated and you\'re not giving your opponent any targets.',
      'Sensible. You keep the tension and improve your position without creating a weakness.',
      'Nice and steady — you\'re building pressure while keeping everything defended.'],
    bad: ['There was more to squeeze out of this position — look for a move that improves your worst-placed piece.',
      'A bit passive — the middlegame rewards finding active plans for your pieces.'],
  },
  endgame: {
    good: ['Clean endgame technique — every tempo matters here, and you keep your edge.',
      'Good. In the endgame, activity is king: your pieces stay busy and your pawns keep rolling.',
      'Accurate. You hold the position together and don\'t let any counterplay in.'],
    bad: ['Endgames are about precision — there was a more accurate path that kept more of your advantage.',
      'Careful here — small endgame slips swing the result. A more active try was available.'],
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
    if (op.earlyQueen) add(38, 'opening', `Bringing the queen out this early lets your opponent develop with tempo by attacking her.`);
  }

  if (!BAD.has(ctx.label)) {
    const hangsSelf = detectHanging(ctx.fenAfter, ctx.move)?.square === ctx.move.to;
    if (ctx.move.promotion) add(97, 'promo', `Promotion! Your pawn becomes a ${NAME[ctx.move.promotion]} — a massive jump in firepower.`);
    const fork = detectFork(ctx.fenAfter, ctx.move);
    if (fork && !hangsSelf) {
      const list = fork.targets.map((t) => NAME[t.piece]).join(' and ');
      add(95, 'fork', `Beautiful fork — your ${NAME[fork.forker]} hits the ${list} at the same time, so one of them is going to fall.`);
    }
    if (ctx.move.captured) {
      const cb = new Chess(ctx.fenBefore);
      const oppDefends = cb.isAttacked(ctx.move.to, cb.turn() === 'w' ? 'b' : 'w');
      if (!oppDefends) add(90, 'freecap', `You grab the ${NAME[ctx.move.captured]} for free — that's clean material in the bank.`);
      else {
        const rec = detectRecapture(ctx);
        if (rec) add(72, 'recap', `Recaptures on ${ctx.move.to} so the material stays even — no need to let your opponent get ahead.`);
        else add(66, 'trade', `Trades on ${ctx.move.to}. Swapping pieces simplifies the game and is great when you're ahead or want a calmer position.`);
      }
    }
    if (detectPassedPush(ctx)) add(82, 'passed', `Pushes your passed pawn closer to queening — in the endgame a runner like this can decide the game.`);
    const threat = detectThreat(ctx);
    if (threat && !hangsSelf && !fork) add(80, 'threat', `This builds a real threat: next move you're ready to win the ${NAME[threat.piece]} on ${threat.square}, so your opponent has to react.`);
    const esc = detectEscape(ctx);
    if (esc) add(78, 'escape', `Good awareness — you slide your ${NAME[esc.piece]} out of danger before it can be taken.`);
    const out = detectOutpost(ctx);
    if (out) add(70, 'outpost', `Your knight settles on a strong outpost at ${out.square} — propped up by a pawn and impossible for their pawns to chase away. A knight here is worth its weight in gold.`);
    if (ctx.move.san && ctx.move.san.endsWith('+')) add(64, 'check', `A check — your opponent must answer it immediately, which lets you dictate what happens next.`);
    if (ctx.move.flags && (ctx.move.flags.includes('k') || ctx.move.flags.includes('q'))) add(62, 'castle', `Castling — king tucked safely behind its pawns and a rook brought toward the center. Exactly what you want out of the opening.`);
    const dev = detectDevelopment(ctx);
    if (dev) add(54, 'dev', `Good development: your ${NAME[dev.piece]} comes off the back rank${dev.eyesCenter ? ' and points right at the center' : ''}, getting you a step closer to castling.`);
    if (detectCenterPawn(ctx)) add(52, 'center', `Stakes a claim in the center. Owning the middle squares gives every one of your pieces more room to operate.`);
    const rook = detectOpenFileRook(ctx);
    if (rook) add(50, 'rook', `Rook to the ${rook.openness === 'open' ? 'open' : 'half-open'} ${rook.file}-file. Rooks come alive on open lines — this is where they do their damage.`);
    if (detectKingActivity(ctx)) add(48, 'kingact', `Activates your king. With so few pieces left, the king turns into a fighting piece — marching it toward the center is textbook endgame play.`);
    if (matchedBest) add(30, 'best', `This is the engine's top pick — it keeps your pieces active and gives nothing away.`);
  }

  if (!reasons.length) {
    const special = {
      Brilliant: 'Brilliant! You gave up material on purpose to win something even bigger. That\'s the kind of move that wins games.',
      Great: 'Great find — this was the one move that held everything together. Not easy to spot.',
      Book: 'A standard opening move that strong players have trusted for years. You\'re right in theory.',
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
