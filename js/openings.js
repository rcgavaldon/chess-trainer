// openings.js — full ECO opening book (~3,700 lines) + correlation to your own games.
import { Chess } from 'chess.js';

let _book = null;
let _prefixMap = null;

export async function loadOpenings() {
  if (_book) return _book;
  const rows = await fetch('data/openings.json').then((r) => r.json());
  _book = rows.map((o) => ({ eco: o.eco, name: o.name, uci: o.u.split(' '), san: o.s.split(' '), epd: o.e, ply: o.p }));
  return _book;
}

async function prefixMap() {
  if (_prefixMap) return _prefixMap;
  const book = await loadOpenings();
  _prefixMap = new Map();
  for (const o of book) _prefixMap.set(o.uci.join(' '), o);
  return _prefixMap;
}

// position key (placement + turn + castling + ep) for matching positions across games/book.
export function epdOf(fen) { return fen.split(' ').slice(0, 4).join(' '); }

// All legal-move UCI of a game's PGN, in order.
export function pgnToUci(pgn) {
  try {
    const c = new Chess();
    c.loadPgn(pgn);
    return c.history({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ''));
  } catch { return []; }
}

// Deepest named opening that is a prefix of the given uci move list.
export async function identifyOpening(uciMoves) {
  const map = await prefixMap();
  let best = null;
  const acc = [];
  for (let i = 0; i < Math.min(uciMoves.length, 30); i++) {
    acc.push(uciMoves[i]);
    const o = map.get(acc.join(' '));
    if (o) best = o;
  }
  return best;
}

const family = (name) => name.split(':')[0].trim();

// Find each game's worst OPENING-phase mistake (first ~16 plies) by the user — the raw
// material for the opening-mistake lessons. analyses = [{url, plies, userColor, game}].
export function findOpeningMistakes(analyses) {
  const BAD = new Set(['Inaccuracy', 'Miss', 'Mistake', 'Blunder']);
  const lessons = [];
  for (const a of analyses) {
    const col = a.userColor;
    let worst = null;
    for (const p of a.plies) {
      if (p.ply > 16) break;
      if (p.color !== col || !BAD.has(p.label)) continue;
      if (!worst || p.winLoss > worst.winLoss) worst = p;
    }
    if (worst && worst.winLoss >= 6) {
      lessons.push({
        gameUrl: a.url, opponent: a.game?.opponent, color: col,
        ply: worst.ply, moveNumber: worst.moveNumber, playedSan: worst.san,
        bestSan: worst.bestSan, bestUci: worst.bestUci, reason: worst.explanation,
        label: worst.label, winLoss: worst.winLoss, fenBefore: worst.fenBefore, fenAfter: worst.fenAfter,
        plies: a.plies,
      });
    }
  }
  return lessons.sort((a, b) => b.winLoss - a.winLoss);
}

// Aggregate the user's openings from their games (grouped by family), with results.
export async function correlateGames(games) {
  const map = await prefixMap();
  const byFam = {};
  for (const g of games) {
    const uci = pgnToUci(g.pgn);
    let best = null; const acc = [];
    for (let i = 0; i < Math.min(uci.length, 30); i++) { acc.push(uci[i]); const o = map.get(acc.join(' ')); if (o) best = o; }
    if (!best) continue;
    const fam = family(best.name);
    const rec = (byFam[fam] ||= { family: fam, eco: best.eco, games: 0, w: 0, l: 0, d: 0, asWhite: 0, asBlack: 0, variations: {}, deepest: best, refs: [] });
    rec.games++;
    if (g.userResult === 'win') rec.w++; else if (g.userResult === 'loss') rec.l++; else rec.d++;
    if (g.userColor === 'white') rec.asWhite++; else rec.asBlack++;
    rec.variations[best.name] = (rec.variations[best.name] || 0) + 1;
    if (best.ply > rec.deepest.ply) rec.deepest = best;
    rec.refs.push({ url: g.url, opponent: g.opponent, result: g.userResult, color: g.userColor, date: g.dateUTC, timeClass: g.timeClass });
  }
  const list = Object.values(byFam).map((r) => ({
    ...r,
    score: r.w + r.d * 0.5,
    scorePct: Math.round(((r.w + r.d * 0.5) / r.games) * 100),
    topVariation: Object.entries(r.variations).sort((a, b) => b[1] - a[1])[0]?.[0],
  }));
  return list.sort((a, b) => b.games - a.games);
}

// Index every position reached in the user's games (first ~28 plies) -> game refs,
// so the opening trainer can say "you reached this exact position in N of your games."
export function buildGamePositionIndex(games) {
  const idx = new Map();
  for (const g of games) {
    try {
      const c = new Chess();
      c.loadPgn(g.pgn);
      const hist = c.history({ verbose: true });
      const board = new Chess();
      for (let i = 0; i < Math.min(hist.length, 28); i++) {
        board.move(hist[i].san);
        const key = epdOf(board.fen());
        if (!idx.has(key)) idx.set(key, []);
        idx.get(key).push({ url: g.url, opponent: g.opponent, result: g.userResult, color: g.userColor, ply: i + 1, date: g.dateUTC });
      }
    } catch {}
  }
  return idx;
}

// Search the book by name or ECO. Returns up to `limit`, preferring shorter (mainline) names.
export async function searchOpenings(query, limit = 40) {
  const book = await loadOpenings();
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits = book.filter((o) => o.name.toLowerCase().includes(q) || o.eco.toLowerCase() === q);
  hits.sort((a, b) => a.name.length - b.name.length || a.ply - b.ply);
  return hits.slice(0, limit);
}

// A curated set of mainline openings for the explorer's default browse view.
const POPULAR = [
  'Italian Game', 'Ruy Lopez', 'Sicilian Defense', 'French Defense', 'Caro-Kann Defense',
  'Queen\'s Gambit Declined', 'Queen\'s Gambit Accepted', 'Slav Defense', 'King\'s Indian Defense',
  'Nimzo-Indian Defense', 'English Opening', 'London System', 'Scandinavian Defense',
  'Vienna Game', 'Scotch Game', 'Pirc Defense', 'Grünfeld Defense', 'Catalan Opening',
  'Four Knights Game', 'Petrov\'s Defense', 'Bishop\'s Opening', 'Dutch Defense',
];
export async function popularOpenings() {
  const book = await loadOpenings();
  const out = [];
  for (const name of POPULAR) {
    const o = book.find((x) => x.name === name) || book.find((x) => x.name.startsWith(name));
    if (o) out.push(o);
  }
  return out;
}

// Suggestions: which of your openings to work on (frequent but low-scoring), and a couple
// of solid mainlines you rarely play, for variety.
export async function suggestOpenings(correlation) {
  const focus = correlation
    .filter((o) => o.games >= 2)
    .map((o) => ({ ...o, priority: o.games * (60 - Math.min(60, o.scorePct)) }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 3);
  const played = new Set(correlation.map((o) => o.family));
  const book = await popularOpenings();
  const tryNew = book.filter((o) => !played.has(family(o.name))).slice(0, 3);
  return { focus, tryNew };
}
