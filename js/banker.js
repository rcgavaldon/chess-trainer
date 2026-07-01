// banker.js — background analysis "banking". Works through a player's games, analyzes the
// ones we haven't cached yet, and banks each to IndexedDB (analyzeGame does the cachePut), so
// future logins load them live without re-analyzing. Runs at a lighter depth for speed
// (aggregate weakness/trends are robust to depth); on-demand game review re-analyzes deeper.
//
// THE KEY DISCIPLINE: Stockfish is a single serial-queue worker. If banking hogs it, opening a
// game review would freeze behind it. So banking YIELDS whenever paused — the review view calls
// pauseBanking() before it analyzes and resumeBanking() after, so reviews always jump the queue.
import * as store from './storage.js';
import { analyzeGame } from './review.js';

const state = { running: false, paused: false, cancelled: false };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const pauseBanking = () => { state.paused = true; };
export const resumeBanking = () => { state.paused = false; };
export const cancelBanking = () => { state.cancelled = true; };
export const isBanking = () => state.running;

// Bank up to `cap` of the most recent games. onProgress({ banked, total, done }).
export async function bankGames(games, engine, { cap = 100, depth = 12, onProgress } = {}) {
  if (state.running || !engine) return;
  state.running = true; state.cancelled = false;
  const targets = (games || []).slice(0, cap);
  let banked = 0;
  try {
    for (const g of targets) {
      if (state.cancelled) break;
      let cached = null;
      try { cached = await store.cacheGet(g.url, 0); } catch { /* ignore */ }
      if (!(cached && cached.plies)) {
        // let an on-demand review take the engine first
        while (state.paused && !state.cancelled) await sleep(400);
        if (state.cancelled) break;
        g.username = g.username || '';
        try { await analyzeGame(g, engine, { depth, multipv: 2 }); } catch { /* skip a bad game */ }
        await sleep(40); // breathe so the UI stays responsive
      }
      banked++;
      onProgress && onProgress({ banked, total: targets.length });
    }
  } finally {
    state.running = false;
    onProgress && onProgress({ banked, total: targets.length, done: true });
  }
}
