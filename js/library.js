// library.js — "Imported games": import PGN files (or paste), catalog them into folders, replay
// each one move-by-move, or hand a game to the full engine review. Lives buried inside the Puzzles
// tab (it's a low-traffic feature). Everything is saved on THIS device (localStorage).
import { h, clear } from './dom.js';
import * as store from './storage.js';
import { Chess } from 'chess.js';
import { createBoard } from './board.js';
import { coachEndpoint } from './coach.js';

const LIB_KEY = 'library';
const uid = () => 'g' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

let CTX = null, HOST = null, BACK = null;
const state = { folder: null, status: null };

// ---- storage ----
function getLib() {
  const l = store.get(LIB_KEY, null);
  if (l && Array.isArray(l.games) && Array.isArray(l.folders) && l.folders.length) return l;
  return { folders: [{ id: 'unsorted', name: 'Unsorted' }], games: [] };
}
function saveLib(l) { store.set(LIB_KEY, l); }
function homeFolder() { return getLib().folders[0].id; }

// ---- PGN parsing (multi-game, headers optional) ----
function splitGames(text) {
  const t = (text || '').replace(/\r\n?/g, '\n').trim();
  if (!t) return [];
  return t.split(/\n(?=\[Event\b)/g).map((s) => s.trim()).filter(Boolean);
}
function ok(v) { return v && v !== '?' && !/^\?+(\.\?+)*$/.test(v) && !/\?/.test(v) ? v : ''; }
function parseOne(pgn) {
  const c = new Chess();
  try { c.loadPgn(pgn); } catch { return null; }
  let hdr = {};
  try { hdr = c.getHeaders(); } catch { /* headerless */ }
  const verbose = c.history({ verbose: true });
  if (!verbose.length) return null;
  return {
    white: ok(hdr.White) || 'White', black: ok(hdr.Black) || 'Black',
    result: ['1-0', '0-1', '1/2-1/2'].includes(hdr.Result) ? hdr.Result : '',
    event: ok(hdr.Event), date: ok(hdr.Date), ply: verbose.length, pgn: c.pgn(),
  };
}
export function parsePgnText(text) { return splitGames(text).map(parseOne).filter(Boolean); }

// ---- scoresheet photo → PGN, via Claude vision through the coach proxy (beta) ----
// Downscale in-browser so the upload is small and inside the vision API's size limits.
function fileToScaledImage(file, maxEdge = 1568) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale)), hh = Math.max(1, Math.round(img.height * scale));
      const cv = document.createElement('canvas'); cv.width = w; cv.height = hh;
      cv.getContext('2d').drawImage(img, 0, 0, w, hh);
      const dataUrl = cv.toDataURL('image/jpeg', 0.85);
      const m = dataUrl.match(/^data:(.+?);base64,(.*)$/);
      return m ? resolve({ media_type: m[1], data: m[2] }) : reject(new Error('bad image'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}
async function scanScoresheet(files, onResult, onStatus) {
  const ep = coachEndpoint();
  if (!ep.headers) { onStatus('The AI reader isn\'t available on this device.', true); return; }
  onStatus('📷 Reading your scoresheet…');
  let imgs;
  try { imgs = await Promise.all([...files].slice(0, 3).map((f) => fileToScaledImage(f))); }
  catch (e) { onStatus('⚠ ' + e.message, true); return; }
  const content = imgs.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } }));
  content.push({ type: 'text', text:
    'This photo (or these photos) show a chess game scoresheet — handwritten or printed. Read the moves and output them as PGN movetext ONLY, like "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6". Include the result (1-0, 0-1, or 1/2-1/2) at the end if it is written. ' +
    'Output ONLY the moves — no headers, no commentary, no code fences, no explanation. Use standard algebraic notation (SAN). If a move is genuinely unreadable, put your best legal guess. If there are two photos, they are the two halves of the same game, in order (White column then Black, top to bottom).' });
  try {
    const res = await fetch(ep.url, { method: 'POST', headers: ep.headers,
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1500, messages: [{ role: 'user', content }] }) });
    if (!res.ok) throw new Error(res.status === 429 ? 'Busy — try again in a moment.' : res.status === 401 ? 'Reader unavailable.' : 'Scan failed (' + res.status + ').');
    const data = await res.json();
    let text = (data.content || []).map((b) => b.text || '').join('').trim();
    text = text.replace(/^```[a-z]*\n?/i, '').replace(/```$/i, '').trim(); // strip any stray code fence
    if (!text) throw new Error('Couldn\'t make out any moves — try a clearer, straight-on photo.');
    onResult(text);
    onStatus('✓ Read it — check the moves and fix any it misread, then Import.');
  } catch (e) { onStatus('⚠ ' + e.message, true); }
}

// ---- entry point (called from the Puzzles hub) ----
export function renderLibrary(host, ctx, back) {
  CTX = ctx; HOST = host; BACK = back;
  drawCatalog();
}

function drawCatalog(msg) {
  const lib = getLib();
  if (!state.folder || !lib.folders.find((f) => f.id === state.folder)) state.folder = lib.folders[0].id;
  clear(HOST);
  state.status = h('div', { class: 'hint tiny', style: { marginTop: '8px', minHeight: '16px' } }, msg || '');
  HOST.append(
    h('div', { class: 'row', style: { justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' } },
      h('button', { class: 'btn ghost small', onclick: () => BACK() }, '← Puzzles'),
      h('div', { class: 'hint tiny' }, `${lib.games.length} saved on this device`)),
    h('h1', { style: { marginTop: '6px', fontSize: '22px' } }, '📁 Imported games'),
    h('p', { class: 'hint' }, 'Import a PGN file (a tournament export, a Chess.com/Lichess download, or a typed-up scoresheet), sort them into folders, and replay or fully review any game.'),
    importCard(),
    folderBar(lib),
    gamesList(lib),
  );
}

function importCard() {
  const fileInput = h('input', { type: 'file', accept: '.pgn,.txt,text/plain', multiple: true, style: { display: 'none' }, onchange: (e) => handleFiles(e.target.files) });
  const photoInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: true, style: { display: 'none' },
    onchange: (e) => { const fs = e.target.files; if (fs && fs.length) scanScoresheet(fs, (pgn) => { ta.value = pgn; pasteWrap.style.display = 'block'; }, flash); e.target.value = ''; } });
  const pasteWrap = h('div', { style: { display: 'none', marginTop: '10px' } });
  const ta = h('textarea', { rows: 5, placeholder: 'Paste PGN here — or a scanned scoresheet lands here to check…', style: { width: '100%', fontFamily: 'var(--mono)', fontSize: '12px' } });
  pasteWrap.append(ta, h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn small', onclick: () => importText(ta.value) }, 'Import these moves')));
  return h('div', { class: 'card section', style: { borderColor: 'var(--accent)', boxShadow: '0 0 0 1px rgba(125,211,95,.18)' } },
    h('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap' } },
      h('button', { class: 'btn', onclick: () => fileInput.click() }, '📄 Import PGN file'),
      h('button', { class: 'btn', onclick: () => photoInput.click() }, '📷 Scan a scoresheet'),
      h('button', { class: 'btn ghost small', onclick: () => { pasteWrap.style.display = pasteWrap.style.display === 'none' ? 'block' : 'none'; } }, '📋 Paste')),
    fileInput, photoInput, pasteWrap, state.status,
    h('div', { class: 'hint tiny', style: { marginTop: '6px' } }, '📷 Scan reads a photo of a paper scoresheet into moves (beta — best with a clear, straight-on photo; you get to fix any misreads before saving). New games land in ', h('b', {}, folderName()), '. ', h('a', { href: 'javascript:void 0', onclick: () => newFolder() }, '+ new folder')));
}

function handleFiles(files) {
  const list = [...(files || [])];
  if (!list.length) return;
  let combined = '', read = 0;
  list.forEach((f) => {
    const rd = new FileReader();
    const done = () => { if (++read === list.length) importText(combined); };
    rd.onload = () => { combined += '\n\n' + (rd.result || ''); done(); };
    rd.onerror = done;
    rd.readAsText(f);
  });
}
function importText(text) {
  const games = parsePgnText(text);
  if (!games.length) { flash('⚠ No readable games found in that PGN.', 'var(--bad)'); return; }
  const lib = getLib();
  for (const g of games) lib.games.unshift({ id: uid(), folderId: state.folder, ...g, ts: Date.now() });
  saveLib(lib);
  drawCatalog();
  flash(`✓ Imported ${games.length} game${games.length > 1 ? 's' : ''} into “${folderName()}”.`, 'var(--good)');
}
function flash(msg, color) { if (state.status) { state.status.textContent = msg; state.status.style.color = color || ''; } }

// ---- folders ----
function folderName() { const lib = getLib(); return (lib.folders.find((f) => f.id === state.folder) || {}).name || 'Unsorted'; }
function folderBar(lib) {
  const chips = lib.folders.map((f) => {
    const n = lib.games.filter((g) => g.folderId === f.id).length;
    return h('button', { class: 'chip' + (f.id === state.folder ? ' active-chip' : ''), onclick: () => { state.folder = f.id; drawCatalog(); } }, `${f.name} (${n})`);
  });
  const notHome = state.folder !== lib.folders[0].id;
  return h('div', { class: 'row section', style: { gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
    ...chips,
    h('button', { class: 'chip', onclick: () => newFolder() }, '+ folder'),
    notHome ? h('button', { class: 'chip', title: 'Rename folder', onclick: () => renameFolder() }, '✎') : null,
    notHome ? h('button', { class: 'chip', title: 'Delete folder (its games move to Unsorted)', onclick: () => deleteFolder() }, '🗑') : null);
}
function newFolder() {
  const name = (prompt('Folder name — e.g. “Regionals 2026”:') || '').trim();
  if (!name) return;
  const lib = getLib(); const id = 'f' + Date.now().toString(36);
  lib.folders.push({ id, name }); saveLib(lib); state.folder = id; drawCatalog();
}
function renameFolder() {
  const lib = getLib(); const f = lib.folders.find((x) => x.id === state.folder); if (!f) return;
  const name = (prompt('Rename folder:', f.name) || '').trim(); if (!name) return;
  f.name = name; saveLib(lib); drawCatalog();
}
function deleteFolder() {
  const lib = getLib();
  if (state.folder === lib.folders[0].id) return;
  if (!confirm('Delete this folder? Its games move to Unsorted.')) return;
  const home = lib.folders[0].id;
  lib.games.forEach((g) => { if (g.folderId === state.folder) g.folderId = home; });
  lib.folders = lib.folders.filter((f) => f.id !== state.folder);
  saveLib(lib); state.folder = home; drawCatalog();
}
function moveGame(g) {
  const lib = getLib();
  const choice = prompt('Move to which folder?\n' + lib.folders.map((f, i) => `${i + 1}. ${f.name}`).join('\n'), '1');
  const idx = parseInt(choice, 10) - 1;
  if (!(idx >= 0 && idx < lib.folders.length)) return;
  const gg = lib.games.find((x) => x.id === g.id); if (gg) gg.folderId = lib.folders[idx].id;
  saveLib(lib); drawCatalog();
}
function delGame(g) {
  if (!confirm(`Delete ${g.white} vs ${g.black}?`)) return;
  const lib = getLib(); lib.games = lib.games.filter((x) => x.id !== g.id); saveLib(lib); drawCatalog();
}

// ---- games list ----
const resultLabel = (g) => g.result === '1-0' ? 'White won' : g.result === '0-1' ? 'Black won' : g.result === '1/2-1/2' ? 'Draw' : 'no result';
function gamesList(lib) {
  const games = lib.games.filter((g) => g.folderId === state.folder);
  if (!games.length) return h('div', { class: 'empty section' }, 'No games in this folder yet — import a PGN above.');
  return h('div', { class: 'section', style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, ...games.map(gameRow));
}
function gameRow(g) {
  return h('div', { class: 'card big-card', style: { padding: '12px 14px' } },
    h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' } },
      h('div', { style: { minWidth: 0 } },
        h('b', {}, `${g.white} vs ${g.black}`),
        h('div', { class: 'hint tiny' }, [resultLabel(g), g.event, g.date, `${Math.ceil(g.ply / 2)} moves`].filter(Boolean).join(' · '))),
      h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
        h('button', { class: 'btn small', onclick: () => openReplay(g) }, '▶ Replay'),
        h('button', { class: 'btn ghost small', onclick: () => reviewWithEngine(g) }, '🔬 Review'),
        h('button', { class: 'btn ghost small', title: 'Move to a folder', onclick: () => moveGame(g) }, '📁'),
        h('button', { class: 'btn ghost small', title: 'Delete', onclick: () => delGame(g) }, '🗑'))));
}

// ---- self-contained replay (no engine) ----
function openReplay(g) {
  const c = new Chess();
  try { c.loadPgn(g.pgn); } catch { alert('Could not read this game.'); return; }
  const moves = c.history({ verbose: true }); // each: { san, from, to, after (fen) }
  const startFen = new Chess().fen();
  const R = { ply: 0, orient: 'white' };
  clear(HOST);
  const boardEl = h('div', { id: 'lib-board' });
  const status = h('div', { class: 'puzzle-status' }, `${g.white} vs ${g.black} — start`);
  const moveList = h('div', { class: 'movelist' });
  const nav = h('div', { class: 'nav-controls' },
    h('button', { title: 'Start', onclick: () => go(0) }, '⏮'),
    h('button', { title: 'Previous', onclick: () => go(R.ply - 1) }, '◀'),
    h('button', { title: 'Next', onclick: () => go(R.ply + 1) }, '▶'),
    h('button', { title: 'End', onclick: () => go(moves.length) }, '⏭'),
    h('button', { title: 'Flip', onclick: () => { R.orient = R.orient === 'white' ? 'black' : 'white'; ground.set({ orientation: R.orient }); } }, '⇅'));
  HOST.append(
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('button', { class: 'btn ghost small', onclick: () => drawCatalog() }, '← Imported games'),
      h('div', { class: 'hint tiny' }, [g.event, g.date].filter(Boolean).join(' · '))),
    h('h1', { style: { marginTop: '6px', fontSize: '20px' } }, `${g.white} vs ${g.black}`),
    h('div', { class: 'review section', style: { gridTemplateColumns: '480px 1fr' } },
      h('div', { class: 'board-wrap' }, boardEl),
      h('div', { class: 'sidebar' }, nav, status, moveList)));
  moves.forEach((m, i) => {
    if (i % 2 === 0) moveList.append(h('span', { class: 'moveno' }, (i / 2 + 1) + '.'));
    moveList.append(h('span', { class: 'ply', 'data-i': String(i + 1), onclick: () => go(i + 1) }, m.san), ' ');
  });
  const ground = createBoard(boardEl, { viewOnly: true, orientation: R.orient, coordinates: true, fen: startFen });
  function go(ply) {
    ply = Math.max(0, Math.min(moves.length, ply));
    R.ply = ply;
    const fen = ply === 0 ? startFen : moves[ply - 1].after;
    const last = ply >= 1 ? [moves[ply - 1].from, moves[ply - 1].to] : undefined;
    const chess = new Chess(fen);
    ground.set({ fen, lastMove: last, check: chess.isCheck(), turnColor: chess.turn() === 'w' ? 'white' : 'black' });
    status.textContent = ply === 0 ? `${g.white} vs ${g.black} — start` : `${Math.ceil(ply / 2)}${ply % 2 ? '.' : '…'} ${moves[ply - 1].san}`;
    moveList.querySelectorAll('.ply').forEach((s) => s.classList.toggle('active', +s.dataset.i === ply));
    const active = moveList.querySelector('.ply.active');
    if (active) { const t = active.offsetTop; if (t < moveList.scrollTop || t > moveList.scrollTop + moveList.clientHeight) moveList.scrollTop = t - 40; }
  }
  go(0);
}

// ---- hand a game to the full engine review (in My Chess) ----
async function reviewWithEngine(g) {
  const me = (store.get('profile.username', '') || '').toLowerCase();
  const nm = (store.get('profile.ownerName', '') || '').toLowerCase();
  const w = (g.white || '').toLowerCase(), b = (g.black || '').toLowerCase();
  const match = (side) => (me && side.includes(me)) || (nm && side.includes(nm));
  const userColor = match(b) && !match(w) ? 'black' : 'white';
  const won = (userColor === 'white' && g.result === '1-0') || (userColor === 'black' && g.result === '0-1');
  const lost = (userColor === 'white' && g.result === '0-1') || (userColor === 'black' && g.result === '1-0');
  const gameObj = {
    url: 'imported:' + g.id, pgn: g.pgn, timeClass: 'imported',
    userColor, userResult: won ? 'win' : lost ? 'loss' : 'draw', userResultCode: '',
    opponent: userColor === 'white' ? g.black : g.white, eco: null, accuracies: null,
    dateUTC: g.date ? g.date.replace(/\./g, '-') : new Date().toISOString(),
    endTime: Math.floor(Date.now() / 1000), userRating: null, oppRating: null,
    username: store.get('profile.username', ''),
  };
  try {
    const p = await import('./views/personal.js');
    p.requestReviewGame(gameObj);
    CTX.navigate('personal');
  } catch { alert('Could not open the review.'); }
}
