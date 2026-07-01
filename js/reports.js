// reports.js — period summaries straight from a player's imported games (results + ratings,
// no analysis needed). Powers the first-time "last 30 days" overview and the rolling weekly
// report, both regenerated every time the app is opened (client-side "auto-refresh").
const DAY = 86400000;
const t = (g) => new Date(g.dateUTC).getTime();

// Summarize the games in [sinceMs, untilMs): record, win%, and the rating swing in the
// player's most-played control over that window.
export function periodSummary(games, sinceMs, untilMs = Date.now()) {
  const inP = (games || []).filter((g) => { const gt = t(g); return gt >= sinceMs && gt < untilMs; });
  const rec = { w: 0, l: 0, d: 0 };
  for (const g of inP) { if (g.userResult === 'win') rec.w++; else if (g.userResult === 'loss') rec.l++; else rec.d++; }
  const n = rec.w + rec.l + rec.d;
  const byTC = {};
  for (const g of inP) (byTC[g.timeClass] = byTC[g.timeClass] || []).push(g);
  const primary = Object.entries(byTC).sort((a, b) => b[1].length - a[1].length)[0];
  const pg = primary ? primary[1].slice().sort((a, b) => a.endTime - b.endTime) : [];
  const ratingStart = pg[0]?.userRating, ratingEnd = pg[pg.length - 1]?.userRating;
  return {
    games: n, ...rec, winPct: n ? Math.round(((rec.w + rec.d * 0.5) / n) * 100) : 0,
    primaryTC: primary ? primary[0] : null,
    ratingStart, ratingEnd, ratingDelta: (ratingStart != null && ratingEnd != null) ? ratingEnd - ratingStart : null,
  };
}

export const overview30 = (games) => periodSummary(games, Date.now() - 30 * DAY);
export const thisWeek = (games) => periodSummary(games, Date.now() - 7 * DAY);
export const priorWeek = (games) => periodSummary(games, Date.now() - 14 * DAY, Date.now() - 7 * DAY);

// Games per time control across the whole import — so we can show "we pulled N rapid, M blitz…".
export function byCategory(games) {
  const c = {};
  for (const g of (games || [])) c[g.timeClass] = (c[g.timeClass] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1]);
}
