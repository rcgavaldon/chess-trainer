// lichess.js — Lichess as a game/data source. A user is "on Lichess" when their username is entered
// as  lichess:TheirName  — chesscom.js dispatches here for those, and the games come back in the
// SAME normalized shape, so the whole pipeline (import → Stockfish analysis → review → reports)
// works unchanged. Lichess's public API sends Access-Control-Allow-Origin:* so no proxy is needed.

const API = 'https://lichess.org/api';

export const isLichess = (username) => /^lichess:/i.test(String(username || '').trim());
export const lichessName = (username) => String(username || '').trim().replace(/^lichess:/i, '');

// Lichess "speed" → our time-class vocabulary (tabs/scoping render unknown keys fine, so classical
// stays its own class rather than being mislabeled rapid).
const SPEED = { ultraBullet: 'bullet', bullet: 'bullet', blitz: 'blitz', rapid: 'rapid', classical: 'classical', correspondence: 'daily' };
const PERF_FOR = { bullet: 'bullet,ultraBullet', blitz: 'blitz', rapid: 'rapid', classical: 'classical', daily: 'correspondence' };

// Map lichess game status to our result-code vocabulary (gameNarrative keys off 'timeout').
const CODE = { outoftime: 'timeout', timeout: 'abandoned', mate: 'checkmated', resign: 'resigned', draw: 'agreed', stalemate: 'stalemate' };

// Current ratings, shaped like Chess.com's /stats payload so ratingFromStats() and the puzzle
// base-rating logic work on it unchanged (lichess has no separate "best", so last = best).
export async function fetchLichessStats(username) {
  const res = await fetch(`${API}/user/${encodeURIComponent(lichessName(username))}`, { headers: { Accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Lichess HTTP ' + res.status);
  const u = await res.json();
  const p = u.perfs || {};
  const shape = (perf) => (p[perf] && typeof p[perf].rating === 'number' && !p[perf].prov ? { last: { rating: p[perf].rating }, best: { rating: p[perf].rating } } : undefined);
  return {
    chess_rapid: shape('rapid'), chess_blitz: shape('blitz'), chess_bullet: shape('bullet'), chess_daily: shape('correspondence'),
    lichess: true, profile: { username: u.username },
  };
}

// Most-recent games, newest first, normalized to the chesscom.js game shape.
export async function fetchLichessGames(username, { timeClass = 'all', limit = 50, onProgress } = {}) {
  const name = lichessName(username);
  onProgress && onProgress({ done: 0, total: 1, phase: 'fetch' });
  const perf = timeClass !== 'all' && PERF_FOR[timeClass] ? `&perfType=${PERF_FOR[timeClass]}` : '';
  // One streamed NDJSON request; pgnInJson+clocks gives us PGNs with [%clk] for time-management.
  const res = await fetch(`${API}/games/user/${encodeURIComponent(name)}?max=${limit}&pgnInJson=true&clocks=true&opening=true&accuracy=true${perf}`,
    { headers: { Accept: 'application/x-ndjson' } });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error('Lichess HTTP ' + res.status);
  const text = await res.text();
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let g;
    try { g = JSON.parse(line); } catch { continue; }
    if (g.variant && g.variant !== 'standard') continue;       // drop 960/oddities (like the CC path)
    if (g.status === 'aborted' || g.status === 'noStart') continue;
    const white = g.players?.white || {}, black = g.players?.black || {};
    const nameOf = (side) => side.user?.name || (side.aiLevel ? `Stockfish level ${side.aiLevel}` : 'Anonymous');
    const isWhite = (white.user?.id || '').toLowerCase() === name.toLowerCase();
    const me = isWhite ? white : black, opp = isWhite ? black : white;
    const myColor = isWhite ? 'white' : 'black';
    const accW = white.analysis?.accuracy, accB = black.analysis?.accuracy;
    out.push({
      url: `https://lichess.org/${g.id}`,
      pgn: g.pgn,
      timeClass: SPEED[g.speed] || g.speed || 'rapid',
      timeControl: g.clock ? `${g.clock.initial}+${g.clock.increment}` : String(g.daysPerTurn || ''),
      rated: !!g.rated,
      userColor: myColor,
      userResult: g.winner ? (g.winner === myColor ? 'win' : 'loss') : 'draw',
      userResultCode: CODE[g.status] || g.status || '',
      opponent: nameOf(opp),
      eco: g.opening?.eco || null,
      accuracies: (accW != null && accB != null) ? { white: accW, black: accB } : null,
      dateUTC: new Date(g.lastMoveAt || g.createdAt || 0).toISOString(),
      endTime: Math.floor((g.lastMoveAt || g.createdAt || 0) / 1000),
      userRating: me.rating ?? null,
      oppRating: opp.rating ?? null,
    });
  }
  out.sort((a, b) => b.endTime - a.endTime);
  return out.slice(0, limit);
}
