// analysis.js — chess evaluation math.
// Formulas verified against Lichess's open-source lila (AccuracyPercent.scala,
// WinPercent) and Chess.com's published move-classification model.
//
// CONVENTION: every eval passed in here is normalized to WHITE's point of view.
// An eval is an object { type: 'cp' | 'mate', value: number }.
//   - cp:   centipawns, positive = good for White
//   - mate: signed mate-in-N, positive = White mates
// The engine wrapper (engine.js) is responsible for negating Stockfish's
// side-to-move score so everything downstream is White-POV.

export const MATE_CP = 100000; // finite sentinel so Win% saturates but math stays defined

export function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

// Collapse a {type,value} eval to a single White-POV centipawn number.
export function cpFromEval(ev) {
  if (!ev) return 0;
  if (ev.type === 'mate') return ev.value > 0 ? MATE_CP : -MATE_CP;
  return ev.value;
}

// Lichess Win% from centipawns. Win% = 50 + 50*(2/(1+exp(-0.00368208*cp)) - 1).
// Returns White's expected score in [0,100].
export function winPercentFromCp(cp) {
  const w = 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
  return clamp(w, 0, 100);
}
export function winPercentWhite(ev) { return winPercentFromCp(cpFromEval(ev)); }

// Lichess per-move accuracy from the MOVER's Win% before/after their move.
// 100 if the move didn't lose Win%; otherwise the exponential-decay curve.
export function accuracyFromWinPercents(before, after) {
  if (after >= before) return 100;
  const winDiff = before - after;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * winDiff) - 3.166924740191411;
  return clamp(raw + 1, 0, 100); // +1 = Lichess "uncertainty" bonus
}

// Display metadata for each move label (color + glyph for the move list / badges).
export const LABELS = {
  Brilliant:  { color: '#1aada6', glyph: '!!',  tone: 'great'  },
  Great:      { color: '#5b8baf', glyph: '!',   tone: 'great'  },
  Best:       { color: '#7aa84f', glyph: '★',   tone: 'good'   },
  Excellent:  { color: '#7aa84f', glyph: '✓',   tone: 'good'   },
  Good:       { color: '#9bbf6b', glyph: '·',   tone: 'good'   },
  Book:       { color: '#a88a64', glyph: '📖',  tone: 'neutral'},
  Inaccuracy: { color: '#e6a23c', glyph: '?!',  tone: 'soft'   },
  Miss:       { color: '#e07a2f', glyph: '✗',   tone: 'bad'    },
  Mistake:    { color: '#e0682f', glyph: '?',   tone: 'bad'    },
  Blunder:    { color: '#d2483f', glyph: '??',  tone: 'bad'    },
};

// Classify one played move into a Chess.com-style label.
//
// evalBeforeWhite : engine eval of the position the mover FACED (before moving)
// evalAfterWhite  : engine eval of the position AFTER the move was played
// ctx = {
//   mover: 'white' | 'black',
//   playedUci, bestUci,                 // played move vs engine top move (UCI)
//   isOnlyGoodMove,                     // 2nd-best line is far worse (=> Great)
//   isSacrifice, sacSound,              // gave material that isn't recaptured, still sound
//   inBook,                             // matched opening book
// }
// returns { label, accuracy, winLoss, before, after }
export function classifyMove(evalBeforeWhite, evalAfterWhite, ctx = {}) {
  const white = ctx.mover === 'white';
  const wBefore = winPercentWhite(evalBeforeWhite);
  const wAfter = winPercentWhite(evalAfterWhite);
  const before = white ? wBefore : 100 - wBefore; // mover POV
  const after = white ? wAfter : 100 - wAfter;

  const winLoss = Math.max(0, before - after);
  const accuracy = accuracyFromWinPercents(before, after);
  const matchedBest = !!ctx.bestUci && ctx.playedUci === ctx.bestUci;
  const nearBest = winLoss <= 2;
  const out = (label) => ({ label, accuracy, winLoss, before, after });

  if (ctx.inBook) return out('Book');

  // Sound sacrifice, near the engine's best, not already winning trivially,
  // and the position is still fine afterwards.
  if (ctx.isSacrifice && ctx.sacSound && nearBest && before < 97 && after >= 50)
    return out('Brilliant');

  // The only move that holds — others lose materially.
  if (ctx.isOnlyGoodMove && nearBest) return out('Great');

  if (matchedBest && nearBest) return out('Best');

  // Were clearly better and let a big chunk slip without fully collapsing.
  if (before >= 60 && winLoss >= 10 && winLoss < 30 && after < 55) return out('Miss');

  // Win%-drop bands. Lichess thresholds: >=10 inaccuracy, >=20 mistake, >=30 blunder.
  // The Best/Excellent/Good split subdivides the "fine" zone for Chess.com feel.
  if (winLoss < 2) return out('Best');
  if (winLoss < 5) return out('Excellent');
  if (winLoss < 10) return out('Good');
  if (winLoss < 20) return out('Inaccuracy');
  if (winLoss < 30) return out('Mistake');
  return out('Blunder');
}

// ---- whole-game accuracy: faithful port of lila gameAccuracy ----
function stdDev(xs) {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length; // population variance
  return Math.sqrt(v);
}
function weightedMean(pairs) {
  let sw = 0, swv = 0;
  for (const [v, w] of pairs) { sw += w; swv += v * w; }
  return sw === 0 ? null : swv / sw;
}
function harmonicMean(xs) {
  if (!xs.length) return null;
  let s = 0;
  for (const x of xs) { if (x <= 0) return 0; s += 1 / x; }
  return xs.length / s;
}

// moves: array in play order, each = { evalAfterWhite: {type,value} } (White POV after that ply).
// startColor: who moved first ('white'). startEvalWhite: eval of the initial position.
// Returns { white, black } accuracy in [0,100] (or null for a side with no moves).
export function gameAccuracy(moves, startColor = 'white', startEvalWhite = { type: 'cp', value: 15 }) {
  const n = moves.length;
  if (n < 1) return { white: null, black: null };

  const evalsWhite = [startEvalWhite, ...moves.map((m) => m.evalAfterWhite)];
  const allWhiteWin = evalsWhite.map(winPercentWhite); // White POV per position

  const windowSize = clamp(Math.floor(n / 10), 2, 8);
  const eff = Math.min(windowSize, allWhiteWin.length);
  const windows = [];
  for (let i = 0; i < eff - 2; i++) windows.push(allWhiteWin.slice(0, windowSize));
  for (let i = 0; i + windowSize <= allWhiteWin.length; i++) windows.push(allWhiteWin.slice(i, i + windowSize));
  const weights = windows.map((xs) => clamp(stdDev(xs), 0.5, 12));

  const startWhite = startColor === 'white';
  const perColor = { white: [], black: [] };
  for (let i = 0; i + 1 < allWhiteWin.length; i++) {
    const prevW = allWhiteWin[i], nextW = allWhiteWin[i + 1];
    const moverWhite = (i % 2 === 0) === startWhite;
    const before = moverWhite ? prevW : 100 - prevW;
    const after = moverWhite ? nextW : 100 - nextW;
    const acc = accuracyFromWinPercents(before, after);
    const weight = weights[i] !== undefined ? weights[i] : weights[weights.length - 1];
    perColor[moverWhite ? 'white' : 'black'].push({ acc, weight });
  }

  const colorAcc = (c) => {
    const arr = perColor[c];
    if (!arr.length) return null;
    const wm = weightedMean(arr.map((e) => [e.acc, e.weight]));
    const hm = harmonicMean(arr.map((e) => e.acc));
    if (wm == null || hm == null) return null;
    return (wm + hm) / 2;
  };
  return { white: colorAcc('white'), black: colorAcc('black') };
}
