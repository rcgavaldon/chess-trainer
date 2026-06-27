// chesscom.js — Chess.com Published-Data API ingestion (public, no auth).
// api.chess.com sends Access-Control-Allow-Origin: * so fetch() works directly
// from a GitHub Pages origin with no proxy. Keep requests SERIAL (await each)
// to stay in the unlimited-rate lane; parallel bursts can earn a 429.

const API = 'https://api.chess.com/pub';

const DRAW_RESULTS = new Set([
  'agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient',
]);

export function classifyResult(code) {
  if (code === 'win') return 'win';
  if (DRAW_RESULTS.has(code)) return 'draw';
  return 'loss'; // checkmated, resigned, timeout, abandoned, lose, ...
}

async function fetchJSON(url) {
  // Browsers forbid setting User-Agent (a Forbidden header); the docs' UA advice
  // is for server-side callers only.
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (res.status === 404) return null; // empty/missing/future month
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 2000));
    const r2 = await fetch(url);
    if (r2.status === 404) return null;
    if (!r2.ok) throw new Error('HTTP ' + r2.status + ' ' + url);
    return r2.json();
  }
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
  return res.json();
}

export async function fetchProfile(username) {
  return fetchJSON(`${API}/player/${encodeURIComponent(String(username).toLowerCase())}`);
}

export async function fetchStats(username) {
  return fetchJSON(`${API}/player/${encodeURIComponent(String(username).toLowerCase())}/stats`);
}

// Convenience: best available rating for a time class, with a sane fallback chain.
export function ratingFromStats(stats, timeClass = 'rapid') {
  if (!stats) return null;
  const key = { rapid: 'chess_rapid', blitz: 'chess_blitz', bullet: 'chess_bullet', daily: 'chess_daily' }[timeClass];
  const order = [key, 'chess_rapid', 'chess_blitz', 'chess_bullet', 'chess_daily'].filter(Boolean);
  for (const k of order) {
    const r = stats[k]?.last?.rating;
    if (typeof r === 'number') return r;
  }
  return null;
}

// Pull the most-recent games for a user, newest first.
//   months    : how many recent monthly archives to scan
//   timeClass : 'rapid'|'blitz'|'bullet'|'daily'|'all'
//   limit     : cap on returned games
//   onProgress: ({done,total,phase}) => void
// Returns normalized game objects.
export async function fetchRecentGames(username, { months = 6, timeClass = 'all', limit = 50, onProgress } = {}) {
  const user = String(username).trim();
  const arch = await fetchJSON(`${API}/player/${encodeURIComponent(user.toLowerCase())}/games/archives`);
  if (!arch || !arch.archives || !arch.archives.length) return [];

  const recent = arch.archives.slice(-months); // chronological ascending
  const out = [];
  for (let i = recent.length - 1; i >= 0; i--) {
    onProgress && onProgress({ done: recent.length - i - 1, total: recent.length, phase: 'fetch' });
    let data;
    try { data = await fetchJSON(recent[i]); } catch { continue; } // skip a bad month
    if (!data || !data.games) continue;
    for (const g of data.games) {
      if (g.rules !== 'chess') continue; // drop chess960/variants
      if (timeClass !== 'all' && g.time_class !== timeClass) continue;
      const isWhite = g.white.username.toLowerCase() === user.toLowerCase();
      const me = isWhite ? g.white : g.black;
      const opp = isWhite ? g.black : g.white;
      out.push({
        url: g.url,
        pgn: g.pgn,
        timeClass: g.time_class,
        timeControl: g.time_control,
        rated: g.rated,
        userColor: isWhite ? 'white' : 'black',
        userResult: classifyResult(me.result),
        userResultCode: me.result,
        opponent: opp.username,
        eco: g.eco || null,
        accuracies: g.accuracies || null, // present only on Chess.com-analyzed games
        dateUTC: new Date((g.end_time || 0) * 1000).toISOString(),
        endTime: g.end_time,
        userRating: me.rating,
        oppRating: opp.rating,
      });
    }
    if (out.length >= limit) break;
  }
  out.sort((a, b) => b.endTime - a.endTime);
  return out.slice(0, limit);
}

// Per-ply seconds spent, from {[%clk H:MM:SS.s]} comments + the increment.
// Returns [{ ply, color, remaining, secondsSpent }]. Empty for daily games.
export function parseClocks(pgn, timeControl) {
  let inc = 0;
  if (typeof timeControl === 'string' && timeControl.includes('+')) inc = parseFloat(timeControl.split('+')[1]) || 0;
  const base = typeof timeControl === 'string' && !timeControl.includes('/') ? parseFloat(timeControl) : NaN;
  const toSec = (s) => {
    const p = s.split(':').map(Number);
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
  };
  const clks = [...pgn.matchAll(/\{\[%clk\s+([0-9:.]+)\]\}/g)].map((m) => toSec(m[1]));
  if (clks.length < 2) return [];
  const plies = [];
  for (let i = 0; i < clks.length; i++) {
    const color = i % 2 === 0 ? 'white' : 'black';
    const prev = i >= 2 ? clks[i - 2] : null; // same player's previous remaining
    let spent;
    if (prev === null) spent = isFinite(base) ? Math.max(0, base + inc - clks[i]) : null;
    else spent = Math.max(0, prev - clks[i] + inc);
    plies.push({
      ply: i + 1,
      color,
      remaining: clks[i],
      secondsSpent: spent === null ? null : Math.round(spent * 10) / 10,
    });
  }
  return plies;
}

// Pull a quick form snapshot for a roster member: rating + recent W/L/D.
export async function fetchPlayerForm(username, { timeClass = 'rapid', months = 1, limit = 20 } = {}) {
  const [stats, games] = [await fetchStats(username), await fetchRecentGames(username, { months, timeClass, limit })];
  const form = { w: 0, l: 0, d: 0 };
  for (const g of games) {
    if (g.userResult === 'win') form.w++;
    else if (g.userResult === 'loss') form.l++;
    else form.d++;
  }
  return { username, rating: ratingFromStats(stats, timeClass), form, recent: games };
}
