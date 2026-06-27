// views/openings.js — opening explorer + trainer. Correlates the full ECO book to YOUR games:
// which openings you actually play (with results), and "you reached this exact position in N games".
import { Chess } from 'chess.js';
import { h, clear, fmtDate, pct } from '../dom.js';
import * as store from '../storage.js';
import { getGames } from '../games.js';
import { createBoard } from '../board.js';
import {
  loadOpenings, correlateGames, buildGamePositionIndex, searchOpenings, popularOpenings,
  suggestOpenings, epdOf,
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
  else { if (!OS.loaded && OS.username) loadYours(); else drawYours(); }
}

function controls() {
  const user = h('input', { type: 'text', value: OS.username, placeholder: 'Chess.com username', onkeydown: (e) => { if (e.key === 'Enter') { OS.username = e.target.value.trim(); OS.loaded = false; draw(); } } });
  OS._user = user;
  const tab = (key, label) => h('a', { href: 'javascript:void 0', class: 'chip' + (OS.mode === key ? ' active-chip' : ''), onclick: () => { OS.mode = key; draw(); } }, label);
  return h('div', { class: 'controls' },
    h('div', { class: 'field username' }, h('label', {}, 'Username'), user),
    h('div', { class: 'field' }, h('label', { class: 'tiny' }, ' '), h('button', { class: 'btn', onclick: () => { OS.username = user.value.trim(); OS.loaded = false; draw(); } }, 'Load')),
    h('div', { class: 'field', style: { marginLeft: 'auto' } }, h('label', {}, 'View'), h('div', { class: 'chip-row' }, tab('yours', 'Your openings'), tab('explore', 'Explore all'))),
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
