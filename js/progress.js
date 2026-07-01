// progress.js — track a player's growth OVER TIME (not just their current state). Each time
// we analyze a player we save a daily snapshot (rating, accuracy, per-skill scores); the trend
// across snapshots is the whole point for a coach: "is this student actually getting better?".
// Stored per player under progress.snapshots so a coach's device builds a history for each
// student they review, and a student's own device builds their own.
import * as store from './storage.js';

const KEY = 'progress.snapshots';
const today = () => new Date().toISOString().slice(0, 10);
const ms = (d) => new Date(d).getTime();

export function recordSnapshot(username, { rating, acc, dims }) {
  const u = (username || '').toLowerCase();
  if (!u) return;
  const all = store.get(KEY, {});
  const list = all[u] || [];
  const dimObj = {};
  for (const x of (dims || [])) if (x && x.key != null) dimObj[x.key] = x.score;
  const snap = { d: today(), rating: rating ?? null, acc: acc != null ? Math.round(acc) : null, dims: dimObj };
  const i = list.findIndex((s) => s.d === snap.d);
  if (i >= 0) list[i] = snap; else list.push(snap);
  all[u] = list.slice(-250); // ~months of daily history
  store.set(KEY, all);
}

export function getSnapshots(username) { return (store.get(KEY, {})[(username || '').toLowerCase()]) || []; }

// Change over a rolling window: rating, accuracy, per-skill deltas, and the biggest gain.
export function progressDelta(username, windowDays = 30) {
  const list = getSnapshots(username);
  if (list.length < 2) return null;
  const now = list[list.length - 1];
  const cutoff = ms(now.d) - windowDays * 86400000;
  let start = list[0];
  for (const s of list) if (ms(s.d) <= cutoff) start = s;
  if (start === now) start = list[0];
  const dimDeltas = {};
  for (const k of Object.keys(now.dims || {})) if (start.dims && start.dims[k] != null) dimDeltas[k] = now.dims[k] - start.dims[k];
  const gains = Object.entries(dimDeltas).sort((a, b) => b[1] - a[1]);
  return {
    ratingDelta: (now.rating != null && start.rating != null) ? now.rating - start.rating : null,
    accDelta: (now.acc != null && start.acc != null) ? now.acc - start.acc : null,
    dimDeltas, mostImproved: gains.length ? { key: gains[0][0], delta: gains[0][1] } : null,
    weakestNow: Object.entries(now.dims || {}).sort((a, b) => a[1] - b[1])[0]?.[0] || null,
    from: start.d, to: now.d, days: Math.max(1, Math.round((ms(now.d) - ms(start.d)) / 86400000)), points: list.length,
  };
}

// A simple line chart of one metric across snapshots (accuracy by default).
export function growthSvg(username, metric = 'acc') {
  const list = getSnapshots(username);
  const data = list.map((s) => (metric === 'acc' ? s.acc : metric === 'rating' ? s.rating : (s.dims || {})[metric])).map((v) => (v == null ? null : v));
  const pts = data.filter((v) => v != null);
  if (pts.length < 2) return '';
  const W = 600, H = 120, padT = 12, padB = 6, padX = 4;
  let lo = Math.min(...pts), hi = Math.max(...pts);
  if (hi - lo < 8) { const m = (hi + lo) / 2; lo = m - 4; hi = m + 4; }
  const span = hi - lo; lo -= span * 0.15; hi += span * 0.15;
  const n = data.length, x = (i) => padX + i * (W - 2 * padX) / (n - 1), y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  let line = '', first = true;
  for (let i = 0; i < n; i++) { if (data[i] == null) continue; line += `${first ? 'M' : 'L'}${x(i).toFixed(1)},${y(data[i]).toFixed(1)} `; first = false; }
  const cur = data[n - 1] != null ? data[n - 1] : pts[pts.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block"><path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/><circle cx="${x(n - 1).toFixed(1)}" cy="${y(cur).toFixed(1)}" r="3.4" fill="var(--accent)"/></svg>`;
}
