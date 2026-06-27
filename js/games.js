// games.js — shared in-memory cache of a player's imported games, so multiple views
// (Personal, Openings, Train) don't each re-fetch from Chess.com.
import * as cc from './chesscom.js';

const cache = new Map(); // key -> { ts, games }

export async function getGames(username, { months = 6, timeClass = 'all', limit = 50, force = false, onProgress } = {}) {
  const user = (username || '').trim();
  if (!user) return [];
  const key = `${user.toLowerCase()}|${timeClass}|${limit}|${months}`;
  if (!force && cache.has(key)) return cache.get(key).games;
  const games = await cc.fetchRecentGames(user, { months, timeClass, limit, onProgress });
  games.forEach((g) => (g.username = user));
  cache.set(key, { ts: Date.now(), games });
  return games;
}

export function cachedGames(username, timeClass = 'all', limit = 50, months = 6) {
  const key = `${(username || '').toLowerCase()}|${timeClass}|${limit}|${months}`;
  return cache.has(key) ? cache.get(key).games : null;
}
