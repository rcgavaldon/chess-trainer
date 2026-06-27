// peers.js — scouting: what you face most (from your games) + what stronger players play
// (sampled from your higher-rated opponents, since Chess.com leaderboards are top-50 only).
import * as cc from './chesscom.js';

function ecoNameFromUrl(u) {
  if (!u) return null;
  const m = String(u).match(/openings\/([^/?#]+)/);
  if (!m) return null;
  return decodeURIComponent(m[1]).replace(/-/g, ' ').replace(/\s*\d.*$/, '').trim() || null;
}
function ecoFromPgn(pgn) {
  const m = pgn && pgn.match(/\[ECOUrl "[^"]*\/openings\/([^"]+)"\]/);
  if (m) return decodeURIComponent(m[1]).replace(/-/g, ' ').replace(/\s*\d.*$/, '').trim();
  const e = pgn && pgn.match(/\[ECO "([^"]+)"\]/);
  return e ? e[1] : null;
}
const family = (n) => n.split(':')[0].trim();

// What you face most, split by your color, with your results — instant from your games.
export function whatYouFace(games) {
  const buckets = { white: {}, black: {} };
  for (const g of games) {
    const name = ecoNameFromUrl(g.eco);
    if (!name) continue;
    const fam = family(name);
    const b = buckets[g.userColor];
    if (!b) continue;
    const r = (b[fam] ||= { name: fam, games: 0, w: 0, l: 0, d: 0 });
    r.games++;
    if (g.userResult === 'win') r.w++; else if (g.userResult === 'loss') r.l++; else r.d++;
  }
  const rank = (o) => Object.values(o).map((r) => ({ ...r, scorePct: Math.round(((r.w + r.d * 0.5) / r.games) * 100) })).sort((a, b) => b.games - a.games);
  return { asWhite: rank(buckets.white), asBlack: rank(buckets.black) };
}

// Sample openings played by your higher-rated opponents — a proxy for "the level above you."
export async function scoutPeers(games, username, { sampleOpponents = 8, gamesPerOpponent = 12, onProgress } = {}) {
  const me = (username || '').toLowerCase();
  const oppMap = {};
  for (const g of games) {
    if (!g.opponent || g.opponent.toLowerCase() === me) continue;
    const delta = (g.oppRating || 0) - (g.userRating || 0);
    if (delta > 25) {
      const o = (oppMap[g.opponent] ||= { name: g.opponent, delta, lost: false });
      o.delta = Math.max(o.delta, delta);
      if (g.userResult === 'loss') o.lost = true;
    }
  }
  // prefer opponents you LOST to and who are clearly higher
  const opps = Object.values(oppMap).sort((a, b) => (b.lost ? 1 : 0) - (a.lost ? 1 : 0) || b.delta - a.delta).slice(0, sampleOpponents);
  const tally = {};
  let gamesSampled = 0;
  for (let i = 0; i < opps.length; i++) {
    onProgress && onProgress({ done: i, total: opps.length });
    try {
      const og = await cc.fetchRecentGames(opps[i].name, { months: 3, timeClass: 'all', limit: gamesPerOpponent });
      for (const g of og) {
        const name = ecoFromPgn(g.pgn);
        if (!name) continue;
        const fam = family(name);
        tally[fam] = (tally[fam] || 0) + 1;
        gamesSampled++;
      }
    } catch {}
  }
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([name, count]) => ({ name, count, pct: gamesSampled ? Math.round((count / gamesSampled) * 100) : 0 }));
  return { opponentsSampled: opps.length, avgDelta: opps.length ? Math.round(opps.reduce((s, o) => s + o.delta, 0) / opps.length) : 0, gamesSampled, topOpenings: top };
}
