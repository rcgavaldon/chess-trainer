// puzzles.js — puzzle sourcing + spaced-repetition progression.
// Two sources unify behind one object:
//   { id, fen, solutionMoves:[uci...], theme, themes?, sourceGameUrl, rating, source }
//   fen           = position SHOWN to the solver (already their move to make)
//   solutionMoves = UCI moves the SOLVER must play, in order
//
// PERSONAL puzzles: built from the user's own blunders (engine best line from the
//   blundered position) — solver plays from index 0 (no opponent setup move).
// LICHESS puzzles: from the open puzzle DB / unauth API — their FEN is BEFORE the
//   opponent's setup move, so we apply solution[0] first and the solver starts at [1].

import { Chess } from 'chess.js';

export const toMoveObj = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

// ---- (a) build a solvable puzzle from a user blunder ----
function inferTheme(fen, solutionMoves) {
  const tmp = new Chess(fen);
  let captures = 0, mates = false;
  for (const uci of solutionMoves) {
    const mv = tmp.move(toMoveObj(uci));
    if (!mv) break;
    if (mv.captured) captures++;
    if (tmp.isCheckmate()) { mates = true; break; }
  }
  if (mates) return solutionMoves.length <= 1 ? 'mateIn1' : solutionMoves.length <= 3 ? 'mateIn2' : 'mate';
  if (captures >= 1) return 'crushing';
  return 'advantage';
}

// engine: our engine.js wrapper exposing evaluate(fen,{depth}) -> { pv:[uci...] }
export async function buildBlunderPuzzle(fenAtBlunder, sourceGameUrl, engine, { maxPlies = 5, depth = 16 } = {}) {
  const { pv } = await engine.evaluate(fenAtBlunder, { depth });
  const board = new Chess(fenAtBlunder);
  const solutionMoves = [];
  for (const uci of (pv || []).slice(0, maxPlies)) {
    const mv = board.move(toMoveObj(uci));
    if (!mv) break;
    solutionMoves.push(uci);
    if (board.isCheckmate()) break;
  }
  if (!solutionMoves.length) throw new Error('No legal engine line from FEN');
  return {
    id: 'blunder-' + (sourceGameUrl || '').split('/').pop() + '-' + fenAtBlunder.split(' ')[5],
    fen: fenAtBlunder,
    solutionMoves,
    theme: inferTheme(fenAtBlunder, solutionMoves),
    themes: [],
    sourceGameUrl,
    rating: null,
    source: 'personal',
  };
}

// ---- (b) load/validate puzzles from Lichess ----
export function puzzleFromLichessJson(data) {
  const p = data.puzzle, g = data.game || {};
  if (!p || !p.fen || !Array.isArray(p.solution) || p.solution.length < 2) throw new Error('Malformed Lichess puzzle JSON');
  const board = new Chess(p.fen);
  if (!board.move(toMoveObj(p.solution[0]))) throw new Error('Illegal setup move ' + p.solution[0]);
  return {
    id: p.id,
    fen: board.fen(),
    solutionMoves: p.solution.slice(1),
    theme: (p.themes && p.themes[0]) || 'mix',
    themes: p.themes || [],
    sourceGameUrl: g.id ? `https://lichess.org/${g.id}` : null,
    rating: p.rating ?? null,
    source: 'lichess',
  };
}

// One CSV row of lichess_db_puzzle.csv (or a hosted shard row).
// Columns: PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
export function puzzleFromCsvRow(row) {
  const get = (i, k) => (Array.isArray(row) ? row[i] : row[k]);
  const id = get(0, 'PuzzleId'), fen = get(1, 'FEN'), movesStr = get(2, 'Moves');
  const rating = +get(3, 'Rating') || null;
  const themes = (get(7, 'Themes') || '').trim().split(/\s+/).filter(Boolean);
  const gameUrl = get(8, 'GameUrl') || null;
  const moves = (movesStr || '').trim().split(/\s+/).filter(Boolean);
  if (!fen || moves.length < 2) throw new Error('Bad CSV puzzle row ' + id);
  const board = new Chess(fen);
  if (!board.move(toMoveObj(moves[0]))) throw new Error('Illegal setup move in ' + id);
  return { id, fen: board.fen(), solutionMoves: moves.slice(1), theme: themes[0] || 'mix', themes, sourceGameUrl: gameUrl, rating, source: 'lichess' };
}

// Did the solver's UCI move match the expected solution move? (tolerant of auto-queen)
export function checkMove(puzzle, plyIndex, userUci) {
  const want = (puzzle.solutionMoves[plyIndex] || '').toLowerCase();
  const got = userUci.toLowerCase();
  if (got === want) return true;
  if (want.length === 5 && want[4] === 'q' && got === want.slice(0, 4)) return true;
  return false;
}

// fetch with a hard timeout so a blocked/slow host can't hang the UI.
async function fetchTimeout(url, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

// Unauthenticated Lichess puzzle endpoints (work without auth, but the host may be
// unreachable/rate-limited from some networks — callers should prefer local shards).
export const lichessApi = {
  daily: () => fetchTimeout('https://lichess.org/api/puzzle/daily'),
  byId: (id) => fetchTimeout('https://lichess.org/api/puzzle/' + id),
  next: (angle, difficulty = 'normal') =>
    fetchTimeout(`https://lichess.org/api/puzzle/next?angle=${encodeURIComponent(angle)}&difficulty=${difficulty}`),
};

// One row of a curated shard (puzzles/<theme>.json): { id, fen, moves:[uci...], rating, themes }.
// Same convention as the Lichess DB: moves[0] is the opponent's setup move.
export function puzzleFromShard(row) {
  const moves = Array.isArray(row.moves) ? row.moves.slice() : String(row.moves || '').trim().split(/\s+/).filter(Boolean);
  if (!row.fen || moves.length < 2) throw new Error('Bad shard row ' + row.id);
  const board = new Chess(row.fen);
  if (!board.move(toMoveObj(moves[0]))) throw new Error('Illegal setup move in ' + row.id);
  return { id: row.id, fen: board.fen(), solutionMoves: moves.slice(1), theme: (row.themes && row.themes[0]) || 'mix', themes: row.themes || [], sourceGameUrl: row.gameUrl || null, rating: row.rating ?? null, source: 'shard' };
}

// Load curated puzzles for a theme from a repo-hosted shard. Returns up to `count`
// puzzles near `targetRating` (if given), or null if no shard is hosted for the theme.
export async function loadThemeShard(theme, { count = 6, targetRating = null } = {}) {
  let rows;
  try { rows = await fetchTimeout('puzzles/' + theme + '.json', 8000); }
  catch { return null; } // no shard hosted (404) or unreadable
  if (!Array.isArray(rows) || !rows.length) return null;
  let pool = rows;
  if (targetRating) pool = rows.slice().sort((a, b) => Math.abs((a.rating || 1500) - targetRating) - Math.abs((b.rating || 1500) - targetRating)).slice(0, count * 4);
  // shuffle (deterministic-free) and take `count`, building puzzle objects defensively
  const picked = [];
  const order = pool.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = (i * 2654435761) % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  for (const idx of order) {
    if (picked.length >= count) break;
    try { picked.push(puzzleFromShard(pool[idx])); } catch {}
  }
  return picked.length ? picked : null;
}

// ============================================================
// (c) SRS progression — stored in the localStorage root under puzzles.srs.
// Per-theme Glicko-lite mastery rating + per-puzzle SM-2 scheduling.
// ============================================================
const DAY = 86400000;

// theme rating + per-puzzle schedule live in the storage root; these helpers operate
// on a plain object you pass in (the caller persists it via storage.set).
export function recordAttempt(srs, puzzle, { solved, quality = solved ? 4 : 1, puzzleRating = puzzle.rating ?? 1500, now = Date.now() } = {}) {
  srs.themes ||= {};
  srs.puzzles ||= {};
  const theme = puzzle.theme || 'mix';

  const t = (srs.themes[theme] ||= { rating: 1200, attempts: 0, correct: 0, streak: 0, lastSeen: 0, nextDue: now });
  const expected = 1 / (1 + Math.pow(10, (puzzleRating - t.rating) / 400));
  const K = t.attempts < 20 ? 40 : 20;
  t.rating = Math.round(t.rating + K * ((solved ? 1 : 0) - expected));
  t.attempts++;
  if (solved) t.correct++;
  t.streak = solved ? t.streak + 1 : 0;
  t.lastSeen = now;
  t.nextDue = now + (solved ? Math.min(7, 1 + t.streak) : 0) * DAY;

  const p = (srs.puzzles[puzzle.id] ||= { theme, ef: 2.5, intervalDays: 0, reps: 0, lapses: 0, due: now, lastResult: null });
  if (quality < 3) { p.reps = 0; p.intervalDays = 1; p.lapses++; }
  else {
    p.reps++;
    p.intervalDays = p.reps === 1 ? 1 : p.reps === 2 ? 6 : Math.round(p.intervalDays * p.ef);
    p.ef = Math.max(1.3, p.ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  }
  p.due = now + p.intervalDays * DAY;
  p.lastResult = solved;
  return srs;
}

// Pick the weakest theme that is due (or weakest overall if none due).
export function nextThemeToTrain(srs, candidateThemes, now = Date.now()) {
  const scored = candidateThemes.map((k) => {
    const t = srs.themes?.[k];
    return { k, rating: t?.rating ?? 1000, due: (t?.nextDue ?? 0) <= now };
  });
  const due = scored.filter((s) => s.due);
  return (due.length ? due : scored).sort((a, b) => a.rating - b.rating)[0]?.k;
}

// Map a theme's mastery rating to a /api/puzzle/next difficulty token (one band above mastery).
export function difficultyForTheme(srs, theme) {
  const r = srs.themes?.[theme]?.rating ?? 1200;
  return r < 1000 ? 'easiest' : r < 1300 ? 'easier' : r < 1700 ? 'normal' : r < 2000 ? 'harder' : 'hardest';
}
