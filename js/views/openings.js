// views/openings.js — opening explorer + trainer. Correlates the full ECO book to YOUR games:
// which openings you actually play (with results), and "you reached this exact position in N games".
import { Chess } from 'chess.js';
import { h, clear, fmtDate, pct } from '../dom.js';
import * as store from '../storage.js';
import { getGames } from '../games.js';
import { createBoard, legalDests, syncBoard, showArrow } from '../board.js';
import {
  loadOpenings, correlateGames, buildGamePositionIndex, searchOpenings, popularOpenings,
  suggestOpenings, epdOf, findOpeningMistakes, fetchExplorer, bookContinuations,
} from '../openings.js';
import { whatYouFace, scoutPeers } from '../peers.js';
import { explainMove } from '../explain.js';

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
  else if (OS.mode === 'scout') drawScout();
  else if (OS.mode === 'drill') drawDrill();
  else { if (!OS.loaded && OS.username) loadYours(); else drawYours(); }
}

function controls() {
  const user = h('input', { type: 'text', value: OS.username, placeholder: 'Chess.com username', onkeydown: (e) => { if (e.key === 'Enter') { OS.username = e.target.value.trim(); OS.loaded = false; draw(); } } });
  OS._user = user;
  const tab = (key, label) => h('a', { href: 'javascript:void 0', class: 'chip' + (OS.mode === key ? ' active-chip' : ''), onclick: () => { OS.mode = key; draw(); } }, label);
  return h('div', { class: 'controls' },
    h('div', { class: 'field username' }, h('label', {}, 'Username'), user),
    h('div', { class: 'field' }, h('label', { class: 'tiny' }, ' '), h('button', { class: 'btn', onclick: () => { OS.username = user.value.trim(); OS.loaded = false; draw(); } }, 'Load')),
    h('div', { class: 'field', style: { marginLeft: 'auto' } }, h('label', {}, 'View'), h('div', { class: 'chip-row' }, tab('yours', 'Your openings'), tab('drill', '🎯 Train lines'), tab('mistakes', 'Your mistakes'), tab('scout', 'Scout'), tab('explore', 'Explore all'))),
  );
}

async function ensureCorrelation() {
  if (OS.loaded) return;
  await loadOpenings();
  OS.games = await getGames(OS.username, { months: 8, timeClass: 'all', limit: 50 });
  OS.correlation = await correlateGames(OS.games);
  OS.posIndex = buildGamePositionIndex(OS.games);
  OS.loaded = true;
}

async function loadYours() {
  const body = document.getElementById('op-body');
  clear(body).append(h('div', { class: 'row' }, h('span', { class: 'spinner' }), ' Loading your games and matching openings…'));
  try { await ensureCorrelation(); drawYours(); }
  catch (e) { clear(body).append(h('div', { class: 'empty' }, 'Could not load. ', h('span', { class: 'tiny' }, e.message))); }
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

function openByMoves(opening) { openExplorer(opening); }

// ---- navigable opening explorer (real data from the Lichess explorer) ----
const EX = { chess: null, ground: null, opening: null };

function openExplorer(opening) {
  const chess = new Chess();
  if (opening && opening.san) for (const s of opening.san) { try { chess.move(s); } catch { break; } }
  EX.chess = chess; EX.opening = opening;
  renderExplorer();
}

function renderExplorer() {
  clear(host);
  host.append(
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('button', { class: 'btn ghost small', onclick: draw }, '← Back to openings'),
      h('div', { class: 'hint', id: 'ex-eco', style: { fontFamily: 'var(--mono)' } }, EX.opening?.eco || '')),
    h('h1', { style: { marginTop: '8px' }, id: 'ex-name' }, EX.opening?.name || 'Opening explorer'));
  const boardEl = h('div', { id: 'ex-board' });
  const coach = h('div', { class: 'explain-box', id: 'ex-coach', style: { minHeight: '70px' } });
  const movesPanel = h('div', { class: 'card', id: 'ex-moves' });
  const nav = h('div', { class: 'nav-controls' },
    h('button', { onclick: exBack, title: 'Take back a move' }, '◀ back'),
    h('button', { onclick: () => { EX.chess = new Chess(); EX.opening = null; exReload(); }, title: 'Reset to start' }, '⟲ start'));
  host.append(h('div', { class: 'trainer-grid section' },
    h('div', { class: 'trainer-coach' }, h('div', { class: 'hint tiny', style: { fontWeight: 700, color: 'var(--accent-2)', marginBottom: '6px' } }, '♟ Coach'), coach),
    h('div', { class: 'board-wrap trainer-board' }, boardEl),
    h('div', { class: 'trainer-side' }, nav, movesPanel)));
  EX.ground = createBoard(boardEl, { viewOnly: true, coordinates: true, fen: EX.chess.fen() });
  exReload();
}

function exBack() { try { EX.chess.undo(); } catch {} exReload(); }

async function exReload() {
  const fen = EX.chess.fen();
  const last = EX.chess.history({ verbose: true }).slice(-1)[0];
  EX.ground.set({ fen, lastMove: last ? [last.from, last.to] : undefined, check: EX.chess.isCheck() });
  exCoach();
  const panel = document.getElementById('ex-moves');
  clear(panel).append(h('div', { class: 'row' }, h('span', { class: 'spinner' }), ' Loading lines…'));
  // 1) book theory (always available, offline) ; 2) live Lichess win-rates (best effort)
  const uciLine = EX.chess.history({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ''));
  const conts = await bookContinuations(uciLine).catch(() => []);
  let live = null;
  try { live = await fetchExplorer(fen); } catch {}
  if (document.getElementById('ex-moves') !== panel) return;
  renderExMoves(panel, conts, live, fen);
}

// Resulting opening name once a candidate move is played (so each row reads like theory).
function nameAfter(uci) {
  const c = new Chess(EX.chess.fen());
  try { c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch { return null; }
  return { san: c.history().slice(-1)[0], epd: epdOf(c.fen()) };
}

function exCoach() {
  const box = document.getElementById('ex-coach');
  if (!box) return;
  const refs = (OS.posIndex && OS.posIndex.get(epdOf(EX.chess.fen()))) || [];
  const moves = EX.chess.history();
  clear(box);
  box.append(h('div', { class: 'hint tiny' }, moves.length ? moves.map((m, i) => (i % 2 === 0 ? Math.floor(i / 2) + 1 + '.' : '') + m).join(' ') : 'Starting position — pick a move.'));
  if (refs.length) {
    const sample = refs.slice(0, 3).map((r) => `vs ${r.opponent} (${r.result === 'win' ? 'won' : r.result === 'loss' ? 'lost' : 'drew'})`).join(', ');
    box.append(h('div', { style: { marginTop: '8px', color: 'var(--accent-2)', fontWeight: 700, fontSize: '13px' } }, `📌 You've had this exact position in ${refs.length} of your games`),
      h('div', { class: 'hint tiny' }, sample));
  }
}

function winBar(w, dr, b) {
  const t = w + dr + b || 1;
  return `<div style="display:flex;height:13px;border-radius:4px;overflow:hidden;width:130px;border:1px solid var(--line)">
    <div style="width:${(w / t * 100).toFixed(1)}%;background:#e9ece8"></div>
    <div style="width:${(dr / t * 100).toFixed(1)}%;background:#7d8079"></div>
    <div style="width:${(b / t * 100).toFixed(1)}%;background:#2a2d28"></div></div>`;
}

function renderExMoves(panel, conts, live, fen) {
  clear(panel);
  const whiteToMove = fen.split(' ')[1] === 'w';
  const liveByUci = new Map();
  let liveTotal = 0;
  if (live && live.moves) { for (const m of live.moves) liveByUci.set(m.uci, m); liveTotal = live.white + live.draws + live.black; }
  if (live && live.opening) { const nEl = document.getElementById('ex-name'); if (nEl && EX.chess.history().length) nEl.textContent = live.opening.name; }

  // Build rows from the book theory; layer live stats on where available.
  let rows = (conts || []).map((g) => {
    const na = nameAfter(g.uci);
    if (!na) return null;
    const lv = liveByUci.get(g.uci);
    const played = OS.posIndex && OS.posIndex.get(na.epd);
    return { uci: g.uci, san: na.san, name: g.name, eco: g.eco, lineCount: g.lineCount, lv, yours: played ? played.length : 0 };
  }).filter(Boolean);

  // live-only sidelines (moves people play that aren't in our named book)
  if (live && live.moves) {
    const known = new Set(rows.map((r) => r.uci));
    for (const m of live.moves) {
      if (known.has(m.uci)) continue;
      const na = nameAfter(m.uci);
      if (!na) continue;
      const played = OS.posIndex && OS.posIndex.get(na.epd);
      rows.push({ uci: m.uci, san: na.san, name: 'Sideline', lineCount: 0, lv: m, yours: played ? played.length : 0 });
    }
  }

  if (!rows.length) {
    panel.append(h('div', { class: 'hint' }, 'End of the book here — you\'re out of known theory. From now on it\'s about understanding the position, not memorising. Use Back to step out.'));
    return;
  }

  const scoreOf = (lv) => { const t = lv.white + lv.draws + lv.black || 1; return Math.round(((whiteToMove ? lv.white : lv.black) + lv.draws * 0.5) / t * 100); };
  // sort: book main lines first (by lineCount), then live popularity
  rows.sort((a, b) => (b.lineCount - a.lineCount) || ((b.lv ? b.lv.white + b.lv.draws + b.lv.black : 0) - (a.lv ? a.lv.white + a.lv.draws + a.lv.black : 0)));
  const bestScore = Math.max(0, ...rows.filter((r) => r.lv).map((r) => scoreOf(r.lv)));

  panel.append(h('div', { class: 'hint tiny', style: { marginBottom: '8px' } },
    `${rows.length} theory move${rows.length > 1 ? 's' : ''} · ${whiteToMove ? 'White' : 'Black'} to move`,
    live ? ` · live win-rates from ${liveTotal.toLocaleString()} games` : ' · win-rates offline (showing book lines)'));

  for (const r of rows) {
    const meta = [];
    if (r.lv) { const t = r.lv.white + r.lv.draws + r.lv.black; meta.push(liveTotal ? Math.round(t / liveTotal * 100) + '% play this' : ''); meta.push(`scores ${scoreOf(r.lv)}%`); }
    const isBest = r.lv && scoreOf(r.lv) === bestScore && bestScore > 0;
    panel.append(h('div', { class: 'ex-move', onclick: () => { try { EX.chess.move(r.san); exReload(); } catch {} } },
      h('div', { class: 'ex-san' }, r.san, isBest ? h('span', { style: { color: 'var(--good)' }, title: 'best scoring move' }, ' ✓') : null),
      h('div', {},
        h('div', { style: { fontSize: '12.5px', color: 'var(--text)', lineHeight: '1.3' } }, r.name),
        r.lv ? h('div', { html: winBar(r.lv.white, r.lv.draws, r.lv.black) }) : h('div', { class: 'hint tiny' }, r.lineCount > 1 ? `${r.lineCount} known lines` : 'sideline'),
        r.yours ? h('div', { class: 'tiny', style: { color: 'var(--accent-2)', fontWeight: 700, marginTop: '2px' } }, `★ you've played this in ${r.yours}`) : null),
      h('div', { class: 'ex-meta' }, r.lv ? meta.filter(Boolean).map((x) => h('div', {}, x)) : null)));
  }
}

// ============================================================
// OPENING TRAINER — drill YOUR repertoire lines with spaced repetition
// ============================================================
const DR = { lines: null, line: null, chess: null, ground: null, ply: 0, mistakes: 0, done: 0, userColor: 'white', busy: false };

// Extend a known book line down its main line so there's enough to drill (~14 plies).
async function extendLine(baseSans, maxPlies) {
  const c = new Chess();
  for (const s of baseSans) { try { c.move(s); } catch { break; } }
  let guard = 0;
  while (c.history().length < maxPlies && guard++ < 30) {
    const uciLine = c.history({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ''));
    const conts = await bookContinuations(uciLine);
    if (!conts.length) break;
    const top = conts[0];
    try { c.move({ from: top.uci.slice(0, 2), to: top.uci.slice(2, 4), promotion: top.uci[4] }); } catch { break; }
  }
  return { sans: c.history(), uci: c.history({ verbose: true }).map((m) => m.from + m.to + (m.promotion || '')) };
}

async function buildRepertoireLines(correlation) {
  const out = [];
  for (const o of correlation.slice(0, 14)) {
    const baseSans = (o.deepest?.san || []).slice();
    if (baseSans.length < 2) continue;
    const color = o.asWhite >= o.asBlack ? 'white' : 'black';
    const ext = await extendLine(baseSans, 14);
    if (ext.sans.length < 4) continue;
    out.push({
      id: color + '|' + ext.uci.join(' '), family: o.family, name: o.deepest?.name || o.family,
      eco: o.deepest?.eco || o.eco, color, sans: ext.sans, uci: ext.uci, games: o.games, scorePct: o.scorePct,
    });
  }
  return out;
}

// --- spaced repetition (SM-2 lite), keyed by line id ---
const srsAll = () => store.get('opening.srs', {});
function gradeLine(id, correct, total) {
  const srs = srsAll();
  const s = srs[id] || { ease: 2.3, reps: 0 };
  const q = total ? correct / total : 1;
  if (q >= 0.9) { s.reps = (s.reps || 0) + 1; s.ease = Math.min(2.8, s.ease + 0.1); }
  else if (q >= 0.6) { s.reps = Math.max(1, s.reps || 0); }
  else { s.reps = 0; s.ease = Math.max(1.5, s.ease - 0.2); }
  const days = s.reps === 0 ? 0 : s.reps === 1 ? 1 : Math.round((s.reps - 1) * s.ease);
  s.due = Date.now() + days * 86400000;
  s.last = { correct, total, ts: Date.now() };
  srs[id] = s; store.set('opening.srs', srs);
  return days;
}
const isDue = (id) => { const s = srsAll()[id]; return !s || (s.due || 0) <= Date.now(); };

async function drawDrill() {
  const body = document.getElementById('op-body');
  if (!OS.username) { clear(body).append(h('div', { class: 'empty' }, 'Enter your Chess.com username above to train your lines.')); return; }
  clear(body).append(h('div', { class: 'row' }, h('span', { class: 'spinner' }), ' Building your repertoire from your games…'));
  try {
    await ensureCorrelation();
    if (!DR.lines) DR.lines = await buildRepertoireLines(OS.correlation);
  } catch (e) { clear(body).append(h('div', { class: 'empty' }, 'Could not build your lines. ', h('span', { class: 'tiny' }, e.message))); return; }
  clear(body);
  if (!DR.lines.length) { body.append(h('div', { class: 'empty' }, 'Not enough recognized openings in your games yet to build drills. Play a few more rated games and come back.')); return; }

  const srs = srsAll();
  const due = DR.lines.filter((l) => isDue(l.id));
  const learned = DR.lines.filter((l) => srs[l.id] && (srs[l.id].reps || 0) > 0).length;

  body.append(h('div', { class: 'card section', style: { borderColor: 'var(--accent)' } },
    h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' } },
      h('div', {},
        h('div', { style: { fontWeight: 800, fontSize: '17px' } }, '🎯 Train your opening lines'),
        h('div', { class: 'hint tiny' }, `Built from the openings you actually play. Play the board moves you'd make — I'll tell you when you stray from theory and why. ${learned}/${DR.lines.length} lines learned · ${due.length} due today.`)),
      due.length ? h('button', { class: 'btn', onclick: () => startLine(due[0], due) }, `Start review (${due.length}) →`) : h('span', { class: 'pill', style: { background: 'rgba(95,196,106,.18)', color: 'var(--good)' } }, '✓ all caught up'))));

  body.append(h('div', { class: 'card' }, h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'Line'), h('th', {}, 'You play'), h('th', {}, 'Score'), h('th', {}, 'Status'), h('th', {}, ''))),
    h('tbody', {}, ...DR.lines.map((l) => {
      const s = srs[l.id];
      const status = !s ? h('span', { class: 'hint tiny' }, 'new') : isDue(l.id) ? h('span', { style: { color: 'var(--warn)' } }, 'due') : h('span', { style: { color: 'var(--good)' } }, `learned ×${s.reps}`);
      return h('tr', {},
        h('td', {}, h('b', {}, l.name), h('div', { class: 'hint tiny', style: { fontFamily: 'var(--mono)' } }, l.sans.slice(0, 6).join(' ') + '…')),
        h('td', { class: 'hint tiny' }, `${l.color === 'white' ? '♔ White' : '♚ Black'} · ${l.games}×`),
        h('td', {}, scoreSpan(l.scorePct)),
        h('td', {}, status),
        h('td', {}, h('button', { class: 'btn small ghost', onclick: () => startLine(l, [l]) }, 'Drill')));
    })))));
}

let DRQ = [];
function startLine(line, queue) {
  DRQ = (queue || [line]).slice();
  runLine(line);
}

function runLine(line) {
  DR.line = line; DR.ply = 0; DR.mistakes = 0; DR.done = 0; DR.tries = 0; DR.userColor = line.color; DR.busy = false;
  DR.chess = new Chess();
  renderDrillBoard();
  advance();
}

function renderDrillBoard() {
  clear(host);
  host.append(
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('button', { class: 'btn ghost small', onclick: () => { OS.mode = 'drill'; draw(); } }, '← All lines'),
      h('div', { class: 'hint', style: { fontFamily: 'var(--mono)' } }, DR.line.eco)),
    h('h1', { style: { marginTop: '6px' } }, DR.line.name),
    h('div', { class: 'hint tiny' }, `You're ${DR.userColor === 'white' ? 'White ♔' : 'Black ♚'} — play the moves you'd make. ${DR.line.sans.length} moves in this line.`));
  const boardEl = h('div', { id: 'dr-board' });
  const coach = h('div', { class: 'explain-box', id: 'dr-coach', style: { minHeight: '90px' } });
  const prog = h('div', { id: 'dr-prog', class: 'card', style: { marginTop: '10px' } });
  host.append(h('div', { class: 'trainer-grid section' },
    h('div', { class: 'trainer-coach' }, h('div', { class: 'hint tiny', style: { fontWeight: 700, color: 'var(--accent-2)', marginBottom: '6px' } }, '♟ Coach'), coach, prog),
    h('div', { class: 'board-wrap trainer-board' }, boardEl),
    h('div', { class: 'trainer-side' })));
  DR.ground = createBoard(boardEl, { orientation: DR.userColor, fen: DR.chess.fen(), movable: { free: false, color: undefined, dests: new Map() } });
  setCoach('Get ready…', DR.userColor === 'black' ? 'White moves first — watch, then it\'s your turn.' : 'You\'re White — make your first move.');
  updateProg();
}

function setCoach(title, body, color) {
  const box = document.getElementById('dr-coach'); if (!box) return;
  clear(box).append(h('div', { style: { fontWeight: 700, color: color || 'var(--text)', marginBottom: '4px' } }, title),
    h('div', { class: 'hint', style: { fontSize: '13px' } }, body));
}
function updateProg() {
  const el = document.getElementById('dr-prog'); if (!el) return;
  const moves = DR.chess.history();
  clear(el).append(
    h('div', { class: 'hint tiny' }, `Move ${Math.min(DR.ply + 1, DR.line.sans.length)} of ${DR.line.sans.length} · ${DR.done} right · ${DR.mistakes} slip${DR.mistakes === 1 ? '' : 's'}`),
    h('div', { class: 'hint tiny', style: { fontFamily: 'var(--mono)', marginTop: '4px' } }, moves.map((m, i) => (i % 2 === 0 ? Math.floor(i / 2) + 1 + '.' : '') + m).join(' ')));
}

function boardState(movable) {
  const last = DR.chess.history({ verbose: true }).slice(-1)[0];
  DR.ground.set({
    fen: DR.chess.fen(), turnColor: DR.chess.turn() === 'w' ? 'white' : 'black',
    lastMove: last ? [last.from, last.to] : undefined, check: DR.chess.isCheck(), orientation: DR.userColor,
    movable: { free: false, color: movable ? DR.userColor : undefined, dests: movable ? legalDests(DR.chess) : new Map(), events: { after: onUserMove } },
  });
}

function advance() {
  if (DR.ply >= DR.line.sans.length) return finishLine();
  const turnColor = DR.chess.turn() === 'w' ? 'white' : 'black';
  if (turnColor !== DR.userColor) {
    DR.busy = true; boardState(false);
    setTimeout(() => {
      try { DR.chess.move(DR.line.sans[DR.ply]); } catch {}
      DR.ply++; updateProg();
      DR.busy = false; advance();
    }, 520);
  } else {
    boardState(true);
    setCoach('Your move', 'Play the move you think is theory here.', 'var(--accent-2)');
  }
}

function onUserMove(orig, dest) {
  if (DR.busy) return;
  const expected = DR.line.sans[DR.ply];
  const fenBefore = DR.chess.fen();
  const clone = new Chess(fenBefore);
  let mv; try { mv = clone.move({ from: orig, to: dest, promotion: 'q' }); } catch { mv = null; }
  if (!mv) { boardState(true); return; }

  if (mv.san === expected) {
    DR.chess.move({ from: orig, to: dest, promotion: 'q' }); DR.done++; DR.ply++; DR.tries = 0;
    const why = explainMove({ fenBefore, fenAfter: DR.chess.fen(), move: mv, label: 'Best', ply: DR.ply, history: DR.chess.history({ verbose: true }), bestMoveUci: null }).text;
    setCoach(`✓ ${mv.san} — correct!`, why, 'var(--good)');
    updateProg(); advance();
    return;
  }

  // wrong move — let them try again; reveal the book move after the 2nd miss
  DR.tries = (DR.tries || 0) + 1;
  if (DR.tries === 1) DR.mistakes++; // one slip per move, no matter how many tries
  if (DR.tries < 2) {
    setCoach(`Not ${mv.san} — try again`, `That's legal, but not the main line of the ${DR.line.name.split(':')[0]}. Think about the most natural developing move and have another go.`, 'var(--warn)');
    boardState(true); updateProg(); // re-sync (undoes the wrong move on the board); still your turn
    return;
  }
  DR.busy = true;
  const exp = new Chess(fenBefore); const em = exp.move(expected);
  const why = explainMove({ fenBefore, fenAfter: exp.fen(), move: em, label: 'Best', ply: DR.ply + 1, history: exp.history({ verbose: true }), bestMoveUci: null }).text;
  setCoach(`The move here is ${expected}`, why, 'var(--accent-2)');
  DR.chess.move(expected); DR.ply++; DR.tries = 0;
  boardState(false); showArrow(DR.ground, em.from + em.to, 'green');
  setTimeout(() => { clearArrows(DR.ground); updateProg(); DR.busy = false; advance(); }, 1500);
}

function finishLine() {
  boardState(false);
  const total = DR.done + DR.mistakes;
  const days = gradeLine(DR.line.id, DR.done, total);
  const pctRight = total ? Math.round(DR.done / total * 100) : 100;
  const nextDue = days === 0 ? 'today (keep at it)' : days === 1 ? 'tomorrow' : `in ${days} days`;
  DRQ.shift();
  const more = DRQ.length ? DRQ[0] : null;
  setCoach(DR.mistakes === 0 ? '🎉 Perfect line!' : `Line complete — ${pctRight}% theory`,
    `${DR.done}/${total} moves matched the main line. ${DR.mistakes === 0 ? 'You know this one cold.' : 'The slips are where to focus.'} Next review: ${nextDue}.`, DR.mistakes === 0 ? 'var(--good)' : 'var(--warn)');
  const el = document.getElementById('dr-prog'); if (!el) return;
  clear(el).append(h('div', { class: 'row', style: { gap: '8px' } },
    h('button', { class: 'btn', onclick: () => runLine(DR.line) }, '↻ Again'),
    more ? h('button', { class: 'btn', onclick: () => runLine(more) }, 'Next line →') : null,
    h('button', { class: 'btn ghost', onclick: () => { OS.mode = 'drill'; draw(); } }, 'Done')));
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

// ---- scouting ----
const scoreColor = (p) => (p >= 55 ? 'var(--good)' : p >= 45 ? 'var(--warn)' : 'var(--bad)');

async function drawScout() {
  const body = document.getElementById('op-body');
  if (!OS.username) { clear(body).append(h('div', { class: 'empty' }, 'Enter your username above first.')); return; }
  clear(body).append(h('div', { class: 'row' }, h('span', { class: 'spinner' }), ' Loading your games…'));
  let games = [];
  try { games = await getGames(OS.username, { months: 8, timeClass: 'all', limit: 50 }); } catch {}
  const face = whatYouFace(games);
  clear(body);
  body.append(
    h('h2', {}, 'What you face most'),
    h('p', { class: 'hint' }, 'The openings that show up most in your games and how you score in them — so you know what to prepare.'),
    faceTable('As White', face.asWhite),
    faceTable('As Black', face.asBlack),
    h('div', { class: 'card section' },
      h('h2', {}, 'What stronger players play'),
      h('p', { class: 'hint' }, 'Sample the openings your higher-rated opponents favor — a peek at the level you\'re chasing.'),
      h('button', { class: 'btn', id: 'scout-btn', onclick: () => runScout(games) }, 'Scout players above me')),
  );
}

function faceTable(title, list) {
  if (!list.length) return h('div', { class: 'hint tiny section' }, `${title}: not enough games yet.`);
  return h('div', { class: 'card section' }, h('h2', {}, title),
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Opening'), h('th', {}, 'Games'), h('th', {}, 'Your score'))),
      h('tbody', {}, ...list.slice(0, 8).map((o) => h('tr', {}, h('td', {}, o.name), h('td', {}, o.games),
        h('td', {}, h('b', { style: { color: scoreColor(o.scorePct), fontFamily: 'var(--mono)' } }, o.scorePct + '%')))))));
}

async function runScout(games) {
  const btn = document.getElementById('scout-btn');
  btn.disabled = true; btn.textContent = 'Scouting…';
  let res;
  try { res = await scoutPeers(games, OS.username, { onProgress: (p) => { btn.textContent = `Scouting… ${p.done}/${p.total}`; } }); }
  catch { res = null; }
  if (!res || !res.gamesSampled) { btn.replaceWith(h('div', { class: 'hint' }, 'Couldn\'t sample peer games right now (try again shortly).')); return; }
  btn.replaceWith(h('div', {},
    h('div', { class: 'hint tiny', style: { marginBottom: '10px' } }, `From ${res.gamesSampled} games of ${res.opponentsSampled} opponents ~${res.avgDelta} points above you, the most common openings:`),
    h('div', { class: 'chip-row' }, ...res.topOpenings.map((o) => h('span', { class: 'chip' }, o.name, h('span', { class: 'w' }, o.pct + '%'))))));
}
