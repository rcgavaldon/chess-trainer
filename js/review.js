// review.js — orchestration: analyze a full game (engine → grade → explanation),
// cache it, and aggregate weaknesses across games into a trainable profile.

import { Chess } from 'chess.js';
import { classifyMove, gameAccuracy } from './analysis.js';
import { explainMove, see } from './explain.js';
import * as store from './storage.js';

const BAD = ['Inaccuracy', 'Miss', 'Mistake', 'Blunder'];
const PIECE_VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

const engEval = (r) => (r.mate != null ? { type: 'mate', value: r.mate } : { type: 'cp', value: r.cp });

function sanOf(uci, fen) {
  if (!uci) return null;
  try {
    const c = new Chess(fen);
    const m = c.moves({ verbose: true }).find((x) => x.from + x.to + (x.promotion || '') === uci);
    return m ? m.san : uci;
  } catch { return uci; }
}

// Analyze one normalized game (from chesscom.fetchRecentGames). Caches by game.url.
// Returns { url, accuracy:{white,black}, userColor, plies:[...], cached, game }.
export async function analyzeGame(game, engine, { depth = 14, multipv = 2, onProgress, useCache = true } = {}) {
  if (useCache && game.url) {
    const cached = await store.cacheGet(game.url, depth);
    if (cached && cached.plies) return { ...(cached.summary || {}), plies: cached.plies, cached: true, game };
  }

  const chess = new Chess();
  try { chess.loadPgn(game.pgn); } catch (e) { throw new Error('Could not parse PGN: ' + e.message); }
  const verbose = chess.history({ verbose: true });
  const n = verbose.length;
  if (!n) throw new Error('No moves in this game');

  // Evaluate each distinct position once. positions[k] = FEN after k plies.
  const positions = [verbose[0].before, ...verbose.map((m) => m.after)];
  const posEval = [];
  for (let k = 0; k < positions.length; k++) {
    onProgress && onProgress({ done: k, total: positions.length });
    posEval.push(await engine.evaluate(positions[k], { depth, multipv }));
    await new Promise((res) => setTimeout(res, 0)); // let the UI breathe
  }

  const plies = [];
  const accMoves = [];
  for (let p = 0; p < n; p++) {
    const mv = verbose[p];
    const before = posEval[p];
    const after = posEval[p + 1];
    const evalBeforeWhite = engEval(before);
    const evalAfterWhite = engEval(after);
    accMoves.push({ evalAfterWhite });

    const mover = mv.color === 'w' ? 'white' : 'black';
    const playedUci = mv.from + mv.to + (mv.promotion || '');
    const bestUci = before.bestMove;

    let isOnlyGoodMove = false;
    if (before.lines && before.lines.length >= 2) {
      const sign = mover === 'white' ? 1 : -1;
      isOnlyGoodMove = sign * before.lines[0].cp - sign * before.lines[1].cp >= 150;
    }
    // Sacrifice for the "Brilliant" label: gave up a real piece (>=3) on net,
    // not just an even trade or a winning capture. Kept strict so it rarely fires.
    let isSacrifice = false;
    try {
      const lost = see(mv.after, mv.to);
      const captured = mv.captured ? PIECE_VAL[mv.captured] : 0;
      isSacrifice = lost >= 3 && lost > captured + 1;
    } catch {}

    const cls = classifyMove(evalBeforeWhite, evalAfterWhite, {
      mover, playedUci, bestUci, isOnlyGoodMove, isSacrifice, sacSound: true, inBook: false,
    });
    const bestSan = sanOf(bestUci, mv.before);
    const expl = explainMove({
      fenBefore: mv.before, fenAfter: mv.after, move: mv,
      bestMoveUci: bestUci, bestMoveSan: bestSan, pvSans: [],
      history: verbose.slice(0, p), ply: p + 1, label: cls.label, winLoss: cls.winLoss,
    });

    plies.push({
      ply: p + 1,
      moveNumber: Math.floor(p / 2) + 1,
      color: mover,
      san: mv.san,
      playedUci, bestUci, bestSan,
      label: cls.label,
      winLoss: Math.round(cls.winLoss * 10) / 10,
      accuracy: Math.round(cls.accuracy * 10) / 10,
      evalWhite: after.mate != null ? { type: 'mate', value: after.mate } : { type: 'cp', value: after.cp },
      fenBefore: mv.before, fenAfter: mv.after,
      explanation: expl.text, explanationType: expl.type,
    });
  }

  const startColor = verbose[0].color === 'w' ? 'white' : 'black';
  const accuracy = gameAccuracy(accMoves, startColor, engEval(posEval[0]));
  const summary = {
    url: game.url, accuracy, depth,
    userColor: game.userColor, opponent: game.opponent, userResult: game.userResult,
    timeClass: game.timeClass, dateUTC: game.dateUTC, userRating: game.userRating, oppRating: game.oppRating,
  };

  if (game.url) store.cachePut(game.url, { username: game.username || '', depth, engine: 'sf18-lite', plies, summary });
  return { ...summary, plies, cached: false, game };
}

// ---- weakness aggregation ----
function phaseOf(fen, ply) {
  const board = fen.split(' ')[0];
  let pieces = 0;
  for (const ch of board) if (/[nbrqNBRQ]/.test(ch)) pieces++;
  if (pieces <= 6) return 'endgame';
  if (ply <= 20) return 'opening';
  return 'middlegame';
}

const TYPE_TO_THEME = {
  hang: 'hangingPiece',
  missed: 'missedTactic',
  fork: 'fork',
  kingsafety: 'kingSafety',
  opening: 'opening',
  freecap: 'tactics',
  best: 'tactics',
  fallback: 'general',
};

const THEME_TO_LICHESS = {
  hangingPiece: 'hangingPiece',
  missedTactic: 'fork',
  fork: 'fork',
  kingSafety: 'kingsideAttack',
  opening: 'opening',
  tactics: 'fork',
  general: 'middlegame',
};

// The user's own mistakes across a set of analyses → a profile + blunder list.
export function buildWeaknessProfile(analyses, userColor) {
  const byPhase = {}, byTheme = {}, byLabel = {};
  let totalUserMoves = 0, mistakes = 0;
  const blunders = [];
  for (const a of analyses) {
    const col = userColor || a.userColor;
    for (const p of a.plies) {
      if (p.color !== col) continue;
      totalUserMoves++;
      byLabel[p.label] = (byLabel[p.label] || 0) + 1;
      if (!BAD.includes(p.label)) continue;
      mistakes++;
      const phase = phaseOf(p.fenBefore, p.ply);
      byPhase[phase] = (byPhase[phase] || 0) + p.winLoss;
      const theme = TYPE_TO_THEME[p.explanationType] || 'general';
      byTheme[theme] = (byTheme[theme] || 0) + p.winLoss;
      if (p.label === 'Blunder' || p.label === 'Mistake') {
        blunders.push({ gameUrl: a.url, fen: p.fenBefore, bestUci: p.bestUci, ply: p.ply, label: p.label, theme, winLoss: p.winLoss, san: p.san });
      }
    }
  }
  const rank = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([key, v]) => ({ key, weight: Math.round(v) }));
  return {
    games: analyses.length,
    userMoves: totalUserMoves,
    mistakes,
    phases: rank(byPhase),
    themes: rank(byTheme),
    labelCounts: byLabel,
    blunders: blunders.sort((a, b) => b.winLoss - a.winLoss),
  };
}

// Lichess puzzle theme keys to recommend, weakest-first, padded with core tactics.
export function suggestedPuzzleThemes(profile) {
  const out = [];
  for (const t of profile.themes) {
    const k = THEME_TO_LICHESS[t.key];
    if (k && !out.includes(k)) out.push(k);
  }
  for (const k of ['fork', 'pin', 'hangingPiece', 'backRankMate', 'discoveredAttack']) if (!out.includes(k)) out.push(k);
  return out.slice(0, 6);
}

// A compact snapshot for the weakness-trend history (stored per player over time).
export function weaknessSnapshot(profile, accuracyAvg, now = Date.now()) {
  const phaseShare = {};
  const total = profile.phases.reduce((s, p) => s + p.weight, 0) || 1;
  for (const p of profile.phases) phaseShare[p.key] = Math.round((p.weight / total) * 100) / 100;
  return { ts: now, byPhase: phaseShare, avgAccuracy: accuracyAvg, games: profile.games, mistakes: profile.mistakes };
}
