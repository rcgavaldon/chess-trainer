// views/openings.js — opening explorer + trainer. Correlates the full ECO book to YOUR games:
// which openings you actually play (with results), and "you reached this exact position in N games".
import { Chess } from 'chess.js';
import { h, clear, fmtDate, pct } from '../dom.js';
import * as store from '../storage.js';
import { getGames } from '../games.js';
import { createBoard, legalDests, syncBoard, showArrow } from '../board.js';
import {
  loadOpenings, correlateGames, buildGamePositionIndex, searchOpenings, popularOpenings,
  suggestOpenings, epdOf, findOpeningMistakes,
} from '../openings.js';

const OS = { username: '', games: [], correlation: null, posIndex: null, mode: 'yours', loaded: false };
let CTX = null, host = null;

export function render(container, ctx) {
  CTX = ctx; host = container;
  OS.username = OS.username || store.get('profile.username', '');
  draw();
}

function draw() {
  clear(host);
  host.append(
    h('h1', {}, 'Openings'),
    h('p', { class: 'hint' }, 'See which openings you actually play and how you score, explore any opening, and find the exact positions that keep coming up in your games.'),
    controls(),
    h('div', { id: 'op-body', class: 'section' }),
  );
  if (OS.mode === 'explore') drawExplore();
  else if (OS.mode === 'mistakes') drawMistakes();
  else { if (!OS.loaded && OS.username) loadYours(); else drawYours(); }
}

function controls() {
  const user = h('input', { type: 'text', value: OS.username, placeholder: 'Chess.com username', onkeydown: (e) => { if (e.key === 'Enter') { OS.username = e.target.value.trim(); OS.loaded = false; draw(); } } });
  OS._user = user;
  const tab = (key, label) => h('a', { href: 'javascript:void 0', class: 'chip' + (OS.mode === key ? ' active-chip' : ''), onclick: () => { OS.mode = key; draw(); } }, label);
  return h('div', { class: 'controls' },
    h('div', { class: 'field username' }, h('label', {}, 'Username'), user),
    h('div', { class: 'field' }, h('label', { class: 'tiny' }, ' '), h('button', { class: 'btn', onclick: () => { OS.username = user.value.trim(); OS.loaded = false; draw(); } }, 'Load')),
    h('div', { class: 'field', style: { marginLeft: 'auto' } }, h('label', {}, 'View'), h('div', { class: 'chip-row' }, tab('yours', 'Your openings'), tab('mistakes', 'Your mistakes'), tab('explore', 'Explore all'))),
  );
}

async function loadYours() {
  const body = document.getElementById('op-body');
  clear(body).append(h('div', { class: 'row' }, h('span', { class: 'spinner' }), ' Loading your games and matching openings…'));
  try {
    await loadOpenings();
    OS.games = await getGames(OS.username, { months: 8, timeClass: 'all', limit: 50 });
    OS.correlation = await correlateGames(OS.games);
    OS.posIndex = buildGamePositionIndex(OS.games);
    OS.loaded = true;
    drawYours();
  } catch (e) { clear(body).append(h('div', { class: 'empty' }, 'Could not load. ', h('span', { class: 'tiny' }, e.message))); }
}

async function drawYours() {
  const body = document.getElementById('op-body');
  if (!OS.username) { clear(body).append(h('div', { class: 'empty' }, 'Enter your Chess.com username above to see your openings.')); return; }
  if (!OS.loaded) return loadYours();
  clear(body);
  if (!OS.correlation.length) { body.append(h('div', { class: 'empty' }, 'No recognized openings in your recent games yet.')); return; }

  const sug = await suggestOpenings(OS.correlation);
  if (sug.focus.length) {
    body.append(h('h2', {}, 'Work on these'),
      h('div', { class: 'chip-row section' }, ...sug.focus.map((o) => h('div', { class: 'card', style: { flex: '1 1 220px', cursor: 'pointer' }, onclick: () => openByMoves(o.deepest) },
        h('div', {}, h('b', {}, o.family)),
        h('div', { class: 'hint tiny' }, `${o.games} games · ${o.w}-${o.l}-${o.d} · `, scoreSpan(o.scorePct)),
        h('div', { class: 'hint tiny', style: { marginTop: '4px', color: 'var(--warn)' } }, o.scorePct < 45 ? 'You\'re struggling here — study the plans.' : 'Frequent — worth tightening up.')))));
  }

  body.append(h('h2', { style: { marginTop: '22px' } }, `Your openings (${OS.correlation.length})`),
    h('div', { class: 'card' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Opening'), h('th', {}, 'Games'), h('th', {}, 'Colors'), h('th', {}, 'Record'), h('th', {}, 'Score'), h('th', {}, ''))),
      h('tbody', {}, ...OS.correlation.slice(0, 24).map((o) => h('tr', {},
        h('td', {}, h('b', {}, o.family), o.topVariation && o.topVariation !== o.family ? h('div', { class: 'hint tiny' }, o.topVariation.replace(o.family + ': ', '')) : null),
        h('td', {}, o.games),
        h('td', { class: 'hint tiny' }, `${o.asWhite}W / ${o.asBlack}B`),
        h('td', {}, `${o.w}-${o.l}-${o.d}`),
        h('td', {}, scoreSpan(o.scorePct)),
        h('td', {}, h('button', { class: 'btn small ghost', onclick: () => openByMoves(o.deepest) }, 'Study'))))))));

  if (sug.tryNew.length) {
    body.append(h('h2', { style: { marginTop: '22px' } }, 'Try something new'),
      h('div', { class: 'chip-row' }, ...sug.tryNew.map((o) => h('div', { class: 'chip', onclick: () => openByMoves(o) }, o.name))));
  }
}

function scoreSpan(p) {
  const c = p >= 55 ? 'var(--good)' : p >= 45 ? 'var(--warn)' : 'var(--bad)';
  return h('b', { style: { color: c, fontFamily: 'var(--mono)' } }, p + '%');
}

async function drawExplore() {
  const body = document.getElementById('op-body');
  clear(body);
  await loadOpenings();
  const results = h('div', { id: 'op-results', class: 'section' });
  const search = h('input', { type: 'text', placeholder: 'Search openings — e.g. "Sicilian", "Ruy Lopez", "C50"…', oninput: async (e) => {
    const q = e.target.value;
    clear(results);
    const list = q.trim() ? await searchOpenings(q) : await popularOpenings();
    renderOpeningList(results, list, q.trim() ? 'Results' : 'Popular openings');
  } });
  body.append(h('div', { class: 'card' }, search), results);
  renderOpeningList(results, await popularOpenings(), 'Popular openings');
}

function renderOpeningList(el, list, title) {
  clear(el).append(h('h2', {}, title));
  if (!list.length) { el.append(h('div', { class: 'hint' }, 'No openings found.')); return; }
  const wrap = h('div', { class: 'game-list' });
  for (const o of list) {
    wrap.append(h('div', { class: 'game-row', style: { gridTemplateColumns: '64px 1fr 84px' }, onclick: () => openByMoves(o) },
      h('div', { class: 'meta', style: { fontFamily: 'var(--mono)' } }, o.eco),
      h('div', {}, h('div', { class: 'opp' }, o.name), h('div', { class: 'meta' }, o.san.slice(0, 8).join(' '))),
      h('button', { class: 'btn small ghost', onclick: (e) => { e.stopPropagation(); openByMoves(o); } }, 'Study')));
  }
  el.append(wrap);
}

// ---- line play-through with coach ----
const L = { opening: null, ply: 0, ground: null, sans: [], positions: [] };

function openByMoves(opening) {
  L.opening = opening;
  // precompute board positions (fen + epd) after each ply
  const c = new Chess();
  L.positions = [{ fen: c.fen(), epd: epdOf(c.fen()), move: null }];
  for (const san of opening.san) { const m = c.move(san); L.positions.push({ fen: c.fen(), epd: epdOf(c.fen()), move: m }); }
  L.sans = opening.san;
  L.ply = 0;
  renderLine();
}

function renderLine() {
  clear(host);
  const o = L.opening;
  host.append(
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('button', { class: 'btn ghost small', onclick: draw }, '← Back to openings'),
      h('div', { class: 'hint', style: { fontFamily: 'var(--mono)' } }, o.eco)),
    h('h1', { style: { marginTop: '10px' } }, o.name),
  );
  const boardEl = h('div', { id: 'op-board' });
  const coach = h('div', { class: 'explain-box', id: 'op-coach', style: { minHeight: '140px' } });
  const moveRow = h('div', { class: 'movelist', id: 'op-moves' });
  const nav = h('div', { class: 'nav-controls' },
    h('button', { onclick: () => lineTo(0) }, '⏮'),
    h('button', { onclick: () => lineTo(L.ply - 1) }, '◀'),
    h('button', { onclick: () => lineTo(L.ply + 1) }, '▶'),
    h('button', { onclick: () => lineTo(L.sans.length) }, '⏭'));
  host.append(h('div', { class: 'trainer-grid section' },
    h('div', { class: 'trainer-coach' }, h('div', { class: 'hint tiny', style: { fontWeight: 700, color: 'var(--accent-2)', marginBottom: '6px' } }, '♟ Coach'), coach),
    h('div', { class: 'board-wrap trainer-board' }, boardEl),
    h('div', { class: 'trainer-side' }, nav, moveRow)));
  buildOpeningMoveList(moveRow);
  L.ground = createBoard(boardEl, { viewOnly: true, fen: L.positions[0].fen, coordinates: true });
  lineTo(0);
}

function buildOpeningMoveList(el) {
  clear(el);
  L.sans.forEach((san, i) => {
    if (i % 2 === 0) el.append(h('span', { class: 'moveno' }, (i / 2 + 1) + '.'));
    el.append(h('span', { class: 'ply', 'data-ply': i + 1, onclick: () => lineTo(i + 1) }, san), ' ');
  });
}

function lineTo(ply) {
  ply = Math.max(0, Math.min(L.sans.length, ply));
  L.ply = ply;
  const pos = L.positions[ply];
  const last = ply >= 1 ? [L.positions[ply].move.from, L.positions[ply].move.to] : undefined;
  L.ground.set({ fen: pos.fen, lastMove: last, check: new Chess(pos.fen).isCheck() });
  document.querySelectorAll('#op-moves .ply').forEach((s) => s.classList.toggle('active', +s.dataset.ply === ply));
  renderCoach(ply);
}

function moveNote(move) {
  if (!move) return '';
  if (move.flags.includes('k') || move.flags.includes('q')) return 'Castles — tucks the king away safe and brings a rook into the game.';
  if (move.captured) return `Takes a ${NAME[move.captured]}.`;
  if (move.piece === 'p') return ['d4', 'e4', 'd5', 'e5', 'c4', 'c5'].includes(move.to) ? 'Grabs space in the center — the most important real estate.' : 'A pawn move that shapes the pawn structure.';
  if (move.piece === 'n') return 'Develops a knight toward the middle, where it controls the most squares.';
  if (move.piece === 'b') return 'Develops the bishop onto a good diagonal.';
  if (move.piece === 'q') return 'Brings the queen out — useful, but watch she doesn\'t get chased around.';
  if (move.piece === 'r') return 'Activates a rook.';
  return 'A developing move.';
}
const NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

function renderCoach(ply) {
  const box = document.getElementById('op-coach');
  const o = L.opening;
  const refs = (OS.posIndex && OS.posIndex.get(L.positions[ply].epd)) || [];
  clear(box);
  box.append(h('div', { style: { fontWeight: 700, marginBottom: '6px' } }, `${o.name} `, h('span', { class: 'hint tiny' }, o.eco)));
  if (ply === 0) {
    box.append(h('div', { class: 'why' }, 'Step through the moves. I\'ll point out the idea behind each one — and flag the exact positions that have shown up in your own games.'));
  } else {
    const m = L.positions[ply].move;
    box.append(h('div', {}, h('b', {}, `${Math.ceil(ply / 2)}${ply % 2 ? '.' : '…'} ${L.sans[ply - 1]}`)),
      h('div', { class: 'why', style: { marginTop: '4px' } }, moveNote(m)));
  }
  if (refs.length) {
    const sample = refs.slice(0, 3).map((r) => `vs ${r.opponent} (${r.result === 'win' ? 'won' : r.result === 'loss' ? 'lost' : 'drew'}, as ${r.color})`).join(', ');
    box.append(h('div', { style: { marginTop: '10px', padding: '8px 10px', background: 'rgba(108,168,255,.1)', borderRadius: '8px', border: '1px solid rgba(108,168,255,.25)' } },
      h('div', { style: { color: 'var(--accent-2)', fontWeight: 700, fontSize: '13px' } }, `📌 You've reached this exact position in ${refs.length} of your game${refs.length > 1 ? 's' : ''}`),
      h('div', { class: 'hint tiny', style: { marginTop: '3px' } }, sample)));
  } else if (ply > 0) {
    box.append(h('div', { class: 'hint tiny', style: { marginTop: '8px' } }, OS.posIndex ? 'This exact position hasn\'t come up in your recent games.' : 'Load your games (Your openings tab) to see where this matches your play.'));
  }
}

// ---- opening-mistake trainer ----
async function loadCachedAnalyses(games) {
  const out = [];
  for (const g of games) {
    try { const c = await store.cacheGet(g.url, 0); if (c && c.plies) out.push({ url: g.url, plies: c.plies, userColor: c.summary?.userColor || g.userColor, game: g }); } catch {}
  }
  return out;
}

async function drawMistakes() {
  const body = document.getElementById('op-body');
  if (!OS.username) { clear(body).append(h('div', { class: 'empty' }, 'Enter your username above first.')); return; }
  clear(body).append(h('div', { class: 'row' }, h('span', { class: 'spinner' }), ' Finding your opening slip-ups…'));
  let games = [];
  try { games = await getGames(OS.username, { months: 8, timeClass: 'all', limit: 50 }); } catch {}
  const analyses = await loadCachedAnalyses(games);
  if (!analyses.length) { clear(body).append(h('div', { class: 'empty' }, 'Deep-scan some games in the Personal tab first — then I\'ll show exactly where your openings go wrong and how to fix them.')); return; }
  const lessons = findOpeningMistakes(analyses);
  clear(body);
  if (!lessons.length) { body.append(h('div', { class: 'empty' }, 'No clear opening mistakes in your analyzed games — nicely done!')); return; }
  body.append(
    h('h2', {}, `Your opening mistakes (${lessons.length})`),
    h('p', { class: 'hint' }, 'Each is a real moment your opening went wrong. Open it to find the better move and feel the difference.'),
    h('div', { class: 'game-list section' }, ...lessons.map((L) => h('div', { class: 'game-row', style: { gridTemplateColumns: '1fr auto' }, onclick: () => openLesson(L) },
      h('div', {}, h('div', { class: 'opp' }, `Move ${L.moveNumber}: ${L.playedSan} `, h('span', { class: 'glyph', style: { color: 'var(--bad)' } }, L.label === 'Blunder' ? '??' : '?')),
        h('div', { class: 'meta' }, `vs ${L.opponent} · −${L.winLoss}% · ${L.reason}`)),
      h('button', { class: 'btn small ghost' }, 'Learn')))),
  );
}

const ML = { L: null, chess: null, ground: null };
const PV_WALK = { pv: [], i: 0, base: null, color: 'white' };

function openLesson(L) {
  clear(host);
  host.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } },
    h('button', { class: 'btn ghost small', onclick: () => { OS.mode = 'mistakes'; draw(); } }, '← Back to mistakes'),
    h('div', { class: 'hint' }, `vs ${L.opponent}`)));
  const boardEl = h('div', { id: 'lesson-board' });
  const coach = h('div', { class: 'explain-box', id: 'lesson-coach', style: { minHeight: '150px' } });
  host.append(h('div', { class: 'trainer-grid section' },
    h('div', { class: 'trainer-coach' }, h('div', { class: 'hint tiny', style: { fontWeight: 700, color: 'var(--accent-2)', marginBottom: '6px' } }, '♟ Coach'), coach),
    h('div', { class: 'board-wrap trainer-board' }, boardEl),
    h('div', { class: 'trainer-side', id: 'lesson-controls' })));
  ML.L = L;
  ML.chess = new Chess(L.fenBefore);
  ML.ground = createBoard(boardEl, { fen: L.fenBefore, orientation: L.color, turnColor: L.color, coordinates: true, movable: { free: false, color: L.color, dests: legalDests(ML.chess), showDests: true, events: { after: onGuess } } });
  stageGuess();
}

function stageGuess() {
  const L = ML.L;
  clear(document.getElementById('lesson-coach')).append(
    h('div', { style: { fontWeight: 700, marginBottom: '6px' } }, `Move ${L.moveNumber}: you played ${L.playedSan}`),
    h('div', { class: 'why' }, `In your game vs ${L.opponent}, this was ${/^[aeiou]/i.test(L.label) ? 'an' : 'a'} ${L.label.toLowerCase()}. ${L.reason}`),
    h('div', { class: 'why', style: { marginTop: '8px', fontWeight: 600 } }, 'Your turn — can you find a stronger move?'));
  clear(document.getElementById('lesson-controls')).append(h('button', { class: 'btn ghost small', onclick: () => revealBest(false) }, 'Show me the better move'));
}

function onGuess(orig, dest) {
  const piece = ML.chess.get(orig);
  const promo = piece && piece.type === 'p' && (dest[1] === '8' || dest[1] === '1') ? 'q' : undefined;
  const uci = orig + dest + (promo || '');
  if (uci === ML.L.bestUci || uci === (ML.L.bestUci || '').slice(0, 4)) { revealBest(true); return; }
  ML.ground.set({ fen: ML.chess.fen(), movable: { color: ML.L.color, dests: legalDests(ML.chess) } });
  const c = document.getElementById('lesson-coach');
  let note = c.querySelector('.guess-note');
  if (!note) { note = h('div', { class: 'why guess-note', style: { marginTop: '6px', color: 'var(--warn)' } }); c.append(note); }
  note.textContent = 'Not the strongest — try again, or hit "Show me".';
}

async function revealBest(found) {
  const L = ML.L;
  ML.ground.set({ fen: L.fenBefore, movable: { color: undefined, dests: new Map() } });
  showArrow(ML.ground, L.bestUci, 'green');
  clear(document.getElementById('lesson-coach')).append(
    h('div', { style: { fontWeight: 700, marginBottom: '6px' } }, found ? `Yes — ${L.bestSan} is the move! ✓` : `The stronger move was ${L.bestSan}.`),
    h('div', { class: 'why' }, betterWhy(L)));
  clear(document.getElementById('lesson-controls')).append(h('div', { class: 'row' }, h('span', { class: 'spinner' }), ' Comparing the two lines…'));
  let r = null;
  try { const engine = await CTX.ensureEngine(); r = await engine.evaluate(L.fenBefore, { depth: 14, multipv: 1 }); } catch {}
  renderCompare(L, r);
}

const fmtEval = (cp) => { const v = cp / 100; return (v >= 0 ? '+' : '') + v.toFixed(1); };
function userCp(ev, userWhite) {
  const cp = ev.type === 'mate' ? (ev.value > 0 ? 2000 : -2000) : ev.value;
  return userWhite ? cp : -cp;
}
function betterWhy(L) {
  const reason = (L.reason || '').toLowerCase();
  if (reason.includes('queen')) return 'It develops a piece and keeps your queen safe, instead of letting her get chased around and losing time.';
  if (reason.includes('hang') || reason.includes('drops') || reason.includes('free')) return 'It keeps all your pieces protected — your move let your opponent win material.';
  if (reason.includes('king') || reason.includes('shelter') || reason.includes('castl')) return 'It keeps your king safe behind its pawns, instead of opening it up to attack.';
  if (reason.includes('center')) return 'It fights for the center — the most important squares — instead of giving it up.';
  if (reason.includes('same piece') || reason.includes('development')) return 'It develops a NEW piece instead of falling behind in development.';
  return 'It keeps your position solid and your pieces working together — exactly what your move gave up.';
}

function renderCompare(L, r) {
  const userWhite = L.color === 'white';
  const playedUser = userCp(L.plies[L.ply - 1].evalWhite, userWhite);
  const idealUser = r ? (r.mate != null ? (userWhite ? (r.mate > 0 ? 2000 : -2000) : (r.mate > 0 ? -2000 : 2000)) : (userWhite ? r.cp : -r.cp)) : playedUser;
  const delta = (idealUser - playedUser) / 100;
  clear(document.getElementById('lesson-controls')).append(
    h('div', { class: 'card' },
      h('div', { style: { fontWeight: 700, marginBottom: '6px' } }, 'Your move vs the better move'),
      h('div', { class: 'why' }, `After ${L.playedSan}, the engine rated your position about `, h('b', { style: { fontFamily: 'var(--mono)', color: 'var(--bad)' } }, fmtEval(playedUser)), `. The better move ${L.bestSan} keeps it around `, h('b', { style: { fontFamily: 'var(--mono)', color: 'var(--good)' } }, fmtEval(idealUser)), '.'),
      h('div', { class: 'why', style: { marginTop: '6px', color: 'var(--accent-2)' } }, delta >= 0.4 ? `That's about ${delta.toFixed(1)} pawns better — a real difference this early in the game.` : 'Even a small edge in the opening adds up over the game.')),
    r && r.pv && r.pv.length ? h('button', { class: 'btn small', style: { marginTop: '10px' }, onclick: () => startPvWalk(L, r.pv) }, 'Play the better line ▶') : null);
}

function startPvWalk(L, pv) {
  PV_WALK.pv = pv.slice(0, 6); PV_WALK.i = 0; PV_WALK.base = L.fenBefore; PV_WALK.color = L.color;
  showArrow(ML.ground, null);
  const ctrl = document.getElementById('lesson-controls');
  clear(ctrl).append(
    h('div', { class: 'hint tiny', style: { marginBottom: '6px' } }, 'The engine\'s line — step through it to see the plan.'),
    h('div', { class: 'nav-controls' }, h('button', { onclick: () => pvStep(-1) }, '◀'), h('button', { onclick: () => pvStep(1) }, '▶ next move')),
    h('button', { class: 'btn ghost small', style: { marginTop: '10px' }, onclick: () => { OS.mode = 'mistakes'; draw(); } }, 'Done — back to mistakes'));
  pvRender();
}
function pvStep(d) { PV_WALK.i = Math.max(0, Math.min(PV_WALK.pv.length, PV_WALK.i + d)); pvRender(); }
function pvRender() {
  const c = new Chess(PV_WALK.base);
  let last = null;
  for (let k = 0; k < PV_WALK.i; k++) { const u = PV_WALK.pv[k]; const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); if (m) last = [m.from, m.to]; }
  ML.ground.set({ fen: c.fen(), lastMove: last, orientation: PV_WALK.color });
}
