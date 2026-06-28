// ladder.js — a class rating ladder, separate from each student's Chess.com rating.
// Glicko-1 (gives a rating deviation we reuse for "provisional" handling and pairings).
// Seeded by group; updated only from games BETWEEN two roster members (auto-ingested from
// their public Chess.com archives). Two numbers, never merged: Chess.com rating is shown
// as-is; the ladder rating is our own and reflects how students do against EACH OTHER.

const Q = Math.LN10 / 400; // 0.0057565
const PI2 = Math.PI * Math.PI;
const gRD = (rd) => 1 / Math.sqrt(1 + (3 * Q * Q * rd * rd) / PI2);
const expectedScore = (r, rj, rdj) => 1 / (1 + Math.pow(10, (-gRD(rdj) * (r - rj)) / 400));

// Update a player {r, rd} against matches [{ r, rd, s }] (s = 1 win / 0.5 draw / 0 loss).
export function glickoUpdate(player, matches) {
  if (!matches.length) return { r: player.r, rd: player.rd };
  let dInv = 0, sum = 0;
  for (const m of matches) {
    const gj = gRD(m.rd), e = expectedScore(player.r, m.r, m.rd);
    dInv += Q * Q * gj * gj * e * (1 - e);
    sum += gj * (m.s - e);
  }
  const denom = 1 / (player.rd * player.rd) + dInv;
  return { r: Math.round(player.r + (Q / denom) * sum), rd: Math.max(40, Math.round(Math.sqrt(1 / denom))) };
}

export function seedRating(group) {
  return group === 'hs' ? 900 : 700; // scholastic-style: HS starts above MS; provisional RD 350
}

function seedIfNeeded(roster, u) {
  roster.ladder = roster.ladder || {};
  if (roster.ladder[u]) return;
  const s = roster.students.find((x) => x.u.toLowerCase() === u);
  const seed = seedRating(s ? s.g : 'ms');
  roster.ladder[u] = { r: seed, rd: 350, games: 0, seed, history: [] };
}

// Ingest new roster-vs-roster games. gamesByUser = { lowercaseUsername: [games newest-first] }.
// Each ingest call is treated as ONE Glicko rating PERIOD: a player's new games are scored
// together against their opponents' start-of-period ratings, so winning a series nets a gain
// (per-game updates over-weight the last game and read as unfair on a school ladder).
// Mutates roster.ladder + roster.ingested. Returns the count of newly-applied games.
export function ingestLadder(roster, gamesByUser) {
  roster.ladder = roster.ladder || {};
  roster.ingested = roster.ingested || [];
  const seen = new Set(roster.ingested);
  const inRoster = new Set(roster.students.map((s) => s.u.toLowerCase()));
  const byUrl = new Map();
  for (const s of roster.students) {
    for (const gm of (gamesByUser[s.u.toLowerCase()] || [])) {
      if (gm.rated === false) continue;
      const opp = (gm.opponent || '').toLowerCase();
      if (!inRoster.has(opp) || seen.has(gm.url) || byUrl.has(gm.url)) continue;
      byUrl.set(gm.url, { url: gm.url, endTime: gm.endTime, date: gm.dateUTC, a: s.u.toLowerCase(), b: opp, aResult: gm.userResult });
    }
  }
  const fresh = [...byUrl.values()].sort((x, y) => x.endTime - y.endTime); // chronological
  if (!fresh.length) return 0;

  const involved = new Set();
  for (const gm of fresh) { involved.add(gm.a); involved.add(gm.b); }
  involved.forEach((u) => seedIfNeeded(roster, u));
  const pre = {}; involved.forEach((u) => (pre[u] = { r: roster.ladder[u].r, rd: roster.ladder[u].rd }));

  const matches = {}; involved.forEach((u) => (matches[u] = []));
  for (const gm of fresh) {
    const sA = gm.aResult === 'win' ? 1 : gm.aResult === 'loss' ? 0 : 0.5;
    matches[gm.a].push({ r: pre[gm.b].r, rd: pre[gm.b].rd, s: sA, date: gm.date, opp: gm.b });
    matches[gm.b].push({ r: pre[gm.a].r, rd: pre[gm.a].rd, s: 1 - sA, date: gm.date, opp: gm.a });
    roster.ingested.push(gm.url);
  }

  for (const u of involved) {
    const ms = matches[u];
    if (!ms.length) continue;
    const upd = glickoUpdate(pre[u], ms.map((m) => ({ r: m.r, rd: m.rd, s: m.s })));
    const L = roster.ladder[u];
    L.r = upd.r; L.rd = upd.rd; L.games += ms.length;
    for (const m of ms) L.history.push({ date: m.date, r: L.r, opp: m.opp, s: m.s });
  }
  return fresh.length; // number of new games applied
}

// Standings within a group (or all), ranked by ladder rating; provisional flagged via rd.
export function standings(roster, group) {
  const ladder = roster.ladder || {};
  return roster.students
    .filter((s) => !group || (s.g || 'ms') === group)
    .map((s) => ({ name: s.name || s.u, u: s.u, g: s.g || 'ms', L: ladder[s.u.toLowerCase()] || null }))
    .filter((x) => x.L && x.L.games > 0)
    .sort((a, b) => b.L.r - a.L.r)
    .map((x, i) => ({ ...x, rank: i + 1, provisional: x.L.rd > 110 }));
}

// Most-improved over a rolling window: Δ ladder rating, gated by a minimum game count so a
// couple of lucky games can't top the board. Computed per group so beginners aren't buried.
export function mostImproved(roster, { windowDays = 30, minGames = 6, nowMs = Date.now() } = {}) {
  const ladder = roster.ladder || {};
  const cutoff = nowMs - windowDays * 86400000;
  const rows = [];
  for (const s of roster.students) {
    const L = ladder[s.u.toLowerCase()];
    if (!L || !L.history || !L.history.length) continue;
    const before = L.history.filter((h) => new Date(h.date).getTime() < cutoff);
    const within = L.history.filter((h) => new Date(h.date).getTime() >= cutoff);
    if (within.length < minGames) continue;
    const startR = before.length ? before[before.length - 1].r : L.seed;
    rows.push({ name: s.name || s.u, u: s.u, g: s.g || 'ms', delta: L.r - startR, games: within.length, from: startR, to: L.r });
  }
  return rows.sort((a, b) => b.delta - a.delta);
}
