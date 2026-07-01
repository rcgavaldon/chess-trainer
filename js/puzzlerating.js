// puzzlerating.js — a single adaptive puzzle rating per player (ELO-style). It starts near their
// Chess.com rating and gains/loses points as they solve or miss puzzles of a given difficulty.
import * as store from './storage.js';
import { cloudEnabled, publishPuzzleRating } from './cloud.js';

let _lastPublish = 0;
function syncRating(rating) {
  if (!cloudEnabled()) return;
  const u = store.get('profile.username', '');
  if (!u) return;
  const now = Date.now();
  if (now - _lastPublish < 4000) return; // throttle rapid solving to a write every few seconds
  _lastPublish = now;
  publishPuzzleRating(u, rating);
}

const DEFAULT = 1200;
export function getPuzzleRating() {
  const saved = store.get('puzzles.rating', null);
  if (saved != null) return saved;
  return store.get('profile.peakRating', DEFAULT) || DEFAULT;
}
export function setPuzzleRating(r) { store.set('puzzles.rating', Math.round(r)); }

// Update after an attempt. puzzleRating = the puzzle's difficulty; solved = solved on the FIRST try.
export function updatePuzzleRating(puzzleRating, solved) {
  const R = getPuzzleRating();
  const Rp = puzzleRating || R;
  const expected = 1 / (1 + Math.pow(10, (Rp - R) / 400));
  const K = R < 1500 ? 40 : 24; // move faster while the rating is still finding its level
  const next = Math.max(400, Math.min(2900, R + K * ((solved ? 1 : 0) - expected)));
  setPuzzleRating(next);
  syncRating(next);
  return { before: Math.round(R), after: Math.round(next), delta: Math.round(next - R) };
}
