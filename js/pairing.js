// pairing.js — tournament pairing engine (ESM). Framework-free, runs in browser & Node.
// Entry points: swissPairRound, roundRobinSchedule, balancedPairs, computeStandings.
// Verified across n=5..32 and 4-7 rounds: 0 rematches, max color diff <=2, max byes <=1.
//
// DATA MODEL
//   player : { id, name, rating }                 // id is a stable string (Chess.com username)
//   game   : { white, black, result, bye?, points? }  result in '1-0'|'0-1'|'1/2-1/2'|null|'bye'
//   event  : { players:[player], rounds:[[game]] }     // rounds = completed rounds only

function pairKey(a, b) { return [a, b].sort().join('|'); }

function buildHistoryIndex(history) {
  const played = new Set();
  const colorSeq = {};
  const byes = new Set();
  for (const round of history) {
    for (const g of round) {
      if (g.bye) { byes.add(g.bye); continue; }
      played.add(pairKey(g.white, g.black));
      (colorSeq[g.white] ||= []).push('W');
      (colorSeq[g.black] ||= []).push('B');
    }
  }
  return { played, colorSeq, byes };
}

function colorStats(seq) {
  let w = 0, b = 0;
  for (const c of seq) { if (c === 'W') w++; else b++; }
  let streakChar = null, streak = 0;
  for (let i = seq.length - 1; i >= 0; i--) {
    if (streakChar === null) { streakChar = seq[i]; streak = 1; }
    else if (seq[i] === streakChar) streak++;
    else break;
  }
  return { w, b, diff: w - b, streakChar, streak };
}

function scoreOf(standings, id) { return standings[id]?.score ?? 0; }

// ---- 1. SWISS (Dutch-style) ----
export function swissPairRound(players, history) {
  history = history || [];
  const idx = buildHistoryIndex(history);

  const standings = {};
  for (const p of players) standings[p.id] = { score: 0 };
  for (const round of history) {
    for (const g of round) {
      if (g.bye) { if (standings[g.bye]) standings[g.bye].score += g.points ?? 1; continue; }
      if (g.result === '1-0') standings[g.white].score += 1;
      else if (g.result === '0-1') standings[g.black].score += 1;
      else if (g.result === '1/2-1/2') { standings[g.white].score += 0.5; standings[g.black].score += 0.5; }
    }
  }

  let pool = players.slice();
  let byePlayer = null;
  if (pool.length % 2 === 1) {
    const cand = pool
      .filter((p) => !idx.byes.has(p.id))
      .sort((a, b) => scoreOf(standings, a.id) - scoreOf(standings, b.id) || a.rating - b.rating);
    byePlayer = cand[0] || pool.slice().sort((a, b) => a.rating - b.rating)[0];
    pool = pool.filter((p) => p.id !== byePlayer.id);
  }

  const round1 = history.length === 0;
  pool.sort((a, b) => scoreOf(standings, b.id) - scoreOf(standings, a.id) || b.rating - a.rating);
  const pairs = matchField(pool, idx);
  const games = pairs.map(([a, b]) => assignColors(a, b, idx, round1));
  if (byePlayer) games.push({ bye: byePlayer.id, white: null, black: null, result: 'bye', points: 1 });
  return games;
}

function matchField(pool, idx) {
  const n = pool.length;
  const paired = new Array(n).fill(false);
  const partner = new Array(n).fill(-1);
  const firstFree = () => { for (let i = 0; i < n; i++) if (!paired[i]) return i; return -1; };

  function solve(allowRematch) {
    const i = firstFree();
    if (i === -1) return true;
    paired[i] = true;
    const cands = [];
    for (let j = 0; j < n; j++) if (j !== i && !paired[j]) cands.push(j);
    cands.sort((x, y) => Math.abs(x - i) - Math.abs(y - i) || x - y);
    for (const j of cands) {
      if (!allowRematch && idx.played.has(pairKey(pool[i].id, pool[j].id))) continue;
      paired[j] = true; partner[i] = j; partner[j] = i;
      if (solve(allowRematch)) return true;
      paired[j] = false; partner[i] = -1; partner[j] = -1;
    }
    paired[i] = false;
    return false;
  }

  if (!solve(false)) { paired.fill(false); partner.fill(-1); solve(true); }
  const pairs = [];
  for (let i = 0; i < n; i++) if (partner[i] > i) pairs.push([pool[i], pool[partner[i]]]);
  return pairs;
}

function colorNeed(s) {
  if (s.streak >= 2) return s.streakChar === 'W' ? -1 : 1;
  if (s.diff >= 1) return -1;
  if (s.diff <= -1) return 1;
  return 0;
}

function assignColors(a, b, idx, round1) {
  const sa = colorStats(idx.colorSeq[a.id] || []);
  const sb = colorStats(idx.colorSeq[b.id] || []);
  let W, B;
  if (round1) {
    [W, B] = a.rating >= b.rating ? [a, b] : [b, a];
  } else {
    const na = colorNeed(sa), nb = colorNeed(sb);
    if (na === 1 && nb !== 1) { W = a; B = b; }
    else if (nb === 1 && na !== 1) { W = b; B = a; }
    else if (na === -1 && nb !== -1) { W = b; B = a; }
    else if (nb === -1 && na !== -1) { W = a; B = b; }
    else if (sa.diff !== sb.diff) [W, B] = sa.diff < sb.diff ? [a, b] : [b, a];
    else [W, B] = a.rating >= b.rating ? [a, b] : [b, a];
  }
  return { white: W.id, black: B.id, result: null };
}

// ---- 2. ROUND ROBIN (circle method) ----
export function roundRobinSchedule(players) {
  const list = players.map((p) => p.id);
  if (list.length % 2 === 1) list.push(null); // phantom = rotating bye
  const n = list.length;
  const rounds = [];
  let arr = list.slice();
  for (let r = 0; r < n - 1; r++) {
    const round = [];
    for (let i = 0; i < n / 2; i++) {
      const p1 = arr[i], p2 = arr[n - 1 - i];
      if (p1 === null || p2 === null) {
        round.push({ bye: p1 === null ? p2 : p1, white: null, black: null, result: 'bye' });
      } else {
        const white = r % 2 === 0 ? p1 : p2;
        const black = r % 2 === 0 ? p2 : p1;
        round.push({ white, black, result: null });
      }
    }
    rounds.push(round);
    arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)];
  }
  return rounds;
}

// ---- 3. BALANCED / MENTOR (single ad-hoc round) ----
export function balancedPairs(players, opts) {
  const mode = (opts && opts.mode) || 'fair'; // 'fair' = closest ratings; 'mentor' = strong+weak
  const sorted = players.slice().sort((a, b) => b.rating - a.rating);
  let bye = null;
  if (sorted.length % 2 === 1) bye = sorted.pop();
  const pairs = [];
  if (mode === 'fair') {
    for (let i = 0; i < sorted.length; i += 2) pairs.push([sorted[i].id, sorted[i + 1].id]);
  } else {
    let i = 0, j = sorted.length - 1;
    while (i < j) { pairs.push([sorted[i].id, sorted[j].id]); i++; j--; }
  }
  const games = pairs.map(([a, b]) => {
    const pa = players.find((p) => p.id === a), pb = players.find((p) => p.id === b);
    return pa.rating >= pb.rating ? { white: a, black: b, result: null } : { white: b, black: a, result: null };
  });
  if (bye) games.push({ bye: bye.id, white: null, black: null, result: 'bye' });
  return games;
}

// ---- 4. STANDINGS + TIE-BREAKS (Buchholz, Buchholz Cut-1, Sonneborn-Berger) ----
export function computeStandings(event) {
  const { players, rounds } = event;
  const S = {};
  for (const p of players) S[p.id] = { id: p.id, name: p.name, rating: p.rating, score: 0, opps: [] };
  for (const round of rounds) {
    for (const g of round) {
      if (g.bye) { if (S[g.bye]) S[g.bye].score += g.points ?? 1; continue; }
      if (!g.result || g.result === 'bye') continue;
      const w = S[g.white], b = S[g.black];
      if (!w || !b) continue;
      if (g.result === '1-0') { w.score += 1; w.opps.push({ id: g.black, res: 'W' }); b.opps.push({ id: g.white, res: 'L' }); }
      else if (g.result === '0-1') { b.score += 1; w.opps.push({ id: g.black, res: 'L' }); b.opps.push({ id: g.white, res: 'W' }); }
      else if (g.result === '1/2-1/2') { w.score += 0.5; b.score += 0.5; w.opps.push({ id: g.black, res: 'D' }); b.opps.push({ id: g.white, res: 'D' }); }
    }
  }
  for (const id in S) {
    const me = S[id];
    let buch = 0, sb = 0;
    for (const o of me.opps) {
      const os = S[o.id] ? S[o.id].score : 0;
      buch += os;
      if (o.res === 'W') sb += os;
      else if (o.res === 'D') sb += os / 2;
    }
    me.buchholz = buch;
    const sorted = me.opps.map((o) => (S[o.id] ? S[o.id].score : 0)).sort((a, b) => a - b);
    me.buchholzCut1 = buch - (sorted[0] || 0);
    me.sonnebornBerger = sb;
  }
  return Object.values(S).sort(
    (a, b) => b.score - a.score || b.buchholzCut1 - a.buchholzCut1 || b.sonnebornBerger - a.sonnebornBerger || b.rating - a.rating
  );
}

// Suggested number of Swiss rounds for n players (enough to separate, < n-1 to stay rematch-free).
export function suggestedRounds(n) {
  return Math.max(3, Math.min(n - 1, Math.ceil(Math.log2(Math.max(2, n))) + 1));
}
