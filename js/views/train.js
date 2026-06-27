// views/train.js — Puzzle Storm + themed/endgame drills, off the curated shards.
import { h, clear } from '../dom.js';
import * as store from '../storage.js';
import { loadFullShard, loadThemeShard, recordAttempt } from '../puzzles.js';
import { mountPuzzle } from '../puzzleplay.js';

const TR = { _timer: null };
let CTX = null, host = null;

const STORM_THEMES = ['mateIn1', 'fork', 'pin', 'hangingPiece', 'backRankMate', 'mateIn2', 'skewer', 'discoveredAttack', 'deflection', 'sacrifice', 'mateIn3', 'trappedPiece'];
const DRILLS = [
  { theme: 'endgame', label: 'Endgames', desc: 'King & pawn, rook endings, technique.' },
  { theme: 'fork', label: 'Forks', desc: 'Hit two things at once.' },
  { theme: 'pin', label: 'Pins', desc: 'Freeze a piece to something bigger.' },
  { theme: 'hangingPiece', label: 'Hanging pieces', desc: 'Punish undefended pieces.' },
  { theme: 'backRankMate', label: 'Back-rank mates', desc: 'Mate on the home row.' },
  { theme: 'mateIn2', label: 'Mate in 2', desc: 'Forced two-move checkmates.' },
];

export function render(container, ctx) {
  CTX = ctx; host = container;
  stopTimer();
  drawHome();
}

function stopTimer() { if (TR._timer) { clearInterval(TR._timer); TR._timer = null; } }

function drawHome() {
  stopTimer();
  clear(host);
  host.append(
    h('h1', {}, 'Train'),
    h('p', { class: 'hint' }, 'Sharpen your tactics. Puzzle Storm for speed, focused drills for the patterns you miss.'),
    h('div', { class: 'section', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: '14px' } },
      bigCard('⚡ Puzzle Storm', `Solve as many as you can in 3 minutes. 3 lives. Best: ${store.get('train.stormBest', 0)}`, 'Start storm', startStorm, true),
      bigCard('🧩 Your blunders', 'Turn your own losing moves into puzzles.', 'Go to Personal', () => CTX.navigate('personal')),
    ),
    h('h2', { class: 'section' }, 'Focused drills'),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '12px' } },
      ...DRILLS.map((d) => h('div', { class: 'card', style: { cursor: 'pointer' }, onclick: () => startDrill(d.theme, d.label) },
        h('div', {}, h('b', {}, d.label), h('span', { class: 'hint tiny', style: { marginLeft: '8px', fontFamily: 'var(--mono)' } }, masteryFor(d.theme))),
        h('div', { class: 'hint tiny', style: { marginTop: '4px' } }, d.desc)))),
  );
}

function bigCard(title, desc, btn, fn, primary) {
  return h('div', { class: 'card', style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
    h('div', { style: { fontSize: '18px', fontWeight: 800 } }, title),
    h('div', { class: 'hint' }, desc),
    h('button', { class: primary ? 'btn' : 'btn ghost', style: { marginTop: 'auto', alignSelf: 'flex-start' }, onclick: fn }, btn));
}

function masteryFor(theme) { const r = store.get('puzzles.srs.themes.' + theme + '.rating', null); return r ? '★ ' + r : 'new'; }

// ---------------- Puzzle Storm ----------------
const ST = { pool: [], i: 0, score: 0, lives: 3, streak: 0, bestStreak: 0, time: 180, over: false };

async function startStorm() {
  stopTimer();
  clear(host).append(h('div', { class: 'row' }, h('span', { class: 'spinner' }), ' Loading puzzles…'));
  // ramped pool: combine themed shards, sort easy → hard
  const all = [];
  for (const t of STORM_THEMES) { try { (await loadFullShard(t)).forEach((p) => all.push(p)); } catch {} }
  if (!all.length) { clear(host).append(h('div', { class: 'empty' }, 'Puzzles unavailable right now.'), h('button', { class: 'btn ghost', onclick: drawHome }, '← Back')); return; }
  const seen = new Set();
  const uniq = all.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  uniq.sort((a, b) => (a.rating || 1500) - (b.rating || 1500));
  ST.pool = uniq; ST.i = 0; ST.score = 0; ST.lives = 3; ST.streak = 0; ST.bestStreak = 0; ST.time = 180; ST.over = false;
  renderStormFrame();
  TR._timer = setInterval(() => { if (ST.over) return; ST.time--; updateHud(); if (ST.time <= 0) endStorm(); }, 1000);
  loadStormPuzzle();
}

function renderStormFrame() {
  clear(host);
  host.append(
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('button', { class: 'btn ghost small', onclick: () => { ST.over = true; stopTimer(); drawHome(); } }, '← Quit'),
      h('div', { class: 'row', id: 'storm-hud', style: { gap: '18px', fontWeight: 700 } })),
    h('div', { class: 'review section', style: { gridTemplateColumns: '480px 1fr' } },
      h('div', { class: 'board-wrap' }, h('div', { id: 'storm-board' })),
      h('div', { class: 'sidebar' }, h('div', { class: 'puzzle-status', id: 'storm-status' }, 'Solve it — find the best move!'), h('div', { class: 'hint tiny', id: 'storm-meta' }))));
  updateHud();
}

function updateHud() {
  const hud = document.getElementById('storm-hud');
  if (!hud) return;
  const mm = Math.floor(ST.time / 60), ss = String(ST.time % 60).padStart(2, '0');
  clear(hud).append(
    h('span', {}, '⏱ ', h('span', { style: { fontFamily: 'var(--mono)', color: ST.time <= 20 ? 'var(--bad)' : 'var(--text)' } }, `${mm}:${ss}`)),
    h('span', {}, '✓ ', h('span', { style: { fontFamily: 'var(--mono)', color: 'var(--good)' } }, ST.score)),
    h('span', {}, '🔥 ', h('span', { style: { fontFamily: 'var(--mono)' } }, ST.streak)),
    h('span', {}, ...Array.from({ length: 3 }, (_, i) => h('span', { style: { opacity: i < ST.lives ? 1 : 0.25 } }, '♥'))));
}

function loadStormPuzzle() {
  if (ST.over) return;
  if (ST.i >= ST.pool.length) return endStorm();
  const p = ST.pool[ST.i];
  const status = document.getElementById('storm-status');
  status.textContent = 'Your move!'; status.className = 'puzzle-status';
  document.getElementById('storm-meta').textContent = `Puzzle ${ST.score + 1} · rating ${p.rating || '?'}`;
  mountPuzzle(document.getElementById('storm-board'), p, {
    autoReplyMs: 180, allowRetry: false,
    onSolved: () => { ST.score++; ST.streak++; ST.bestStreak = Math.max(ST.bestStreak, ST.streak); ST.time += 3; flash(status, '✓ +1', 'ok'); ST.i++; updateHud(); setTimeout(loadStormPuzzle, 350); },
    onWrong: () => { ST.lives--; ST.streak = 0; flash(status, '✗ missed', 'no'); updateHud(); ST.i++; if (ST.lives <= 0) { setTimeout(endStorm, 500); } else setTimeout(loadStormPuzzle, 600); },
  });
}

function flash(el, msg, cls) { el.textContent = msg; el.className = 'puzzle-status ' + cls; }

function endStorm() {
  if (ST.over) return;
  ST.over = true; stopTimer();
  const best = store.get('train.stormBest', 0);
  const isBest = ST.score > best;
  if (isBest) store.set('train.stormBest', ST.score);
  clear(host).append(h('div', { class: 'empty', style: { paddingTop: '60px' } },
    h('div', { style: { fontSize: '44px', fontWeight: 800, color: 'var(--accent)', fontFamily: 'var(--mono)' } }, ST.score),
    h('div', { style: { fontSize: '18px', marginTop: '6px' } }, 'puzzles solved'),
    h('div', { class: 'hint', style: { marginTop: '8px' } }, `Best streak: ${ST.bestStreak} · ${isBest ? '🏆 New best!' : 'Best: ' + best}`),
    h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '20px' } },
      h('button', { class: 'btn', onclick: startStorm }, 'Play again'),
      h('button', { class: 'btn ghost', onclick: drawHome }, 'Done'))));
}

// ---------------- focused drill ----------------
const DR = { list: [], i: 0, theme: '', label: '' };

async function startDrill(theme, label) {
  stopTimer();
  clear(host).append(h('div', { class: 'row' }, h('span', { class: 'spinner' }), ` Loading ${label.toLowerCase()}…`));
  const srs = store.get('puzzles.srs', { themes: {}, puzzles: {} });
  const target = srs.themes?.[theme]?.rating || 1200;
  let list = await loadThemeShard(theme, { count: 10, targetRating: target }).catch(() => null);
  if (!list || !list.length) { clear(host).append(h('div', { class: 'empty' }, 'No puzzles for this drill yet.'), h('button', { class: 'btn ghost', onclick: drawHome }, '← Back')); return; }
  DR.list = list; DR.i = 0; DR.theme = theme; DR.label = label;
  drillPuzzle();
}

function drillPuzzle() {
  const p = DR.list[DR.i];
  let recorded = false;
  clear(host);
  const status = h('div', { class: 'puzzle-status' }, 'Your move — find the best continuation.');
  const nextBtn = h('button', { class: 'btn small', disabled: true, onclick: () => { DR.i++; if (DR.i >= DR.list.length) drawHome(); else drillPuzzle(); } }, 'Next →');
  const record = (solved) => { if (recorded) return; recorded = true; const srs = store.get('puzzles.srs', { themes: {}, puzzles: {} }); recordAttempt(srs, p, { solved }); store.set('puzzles.srs', srs); };
  host.append(
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('button', { class: 'btn ghost small', onclick: drawHome }, '← Back'),
      h('div', { class: 'hint' }, `${DR.label} · ${DR.i + 1} of ${DR.list.length}${p.rating ? ' · rating ' + p.rating : ''}`)),
    h('div', { class: 'review section', style: { gridTemplateColumns: '480px 1fr' } },
      h('div', { class: 'board-wrap' }, h('div', { id: 'drill-board' })),
      h('div', { class: 'sidebar' }, status,
        h('div', { class: 'row' }, h('button', { class: 'btn ghost small', onclick: () => api.hint() }, 'Hint'), nextBtn))));
  const api = mountPuzzle(document.getElementById('drill-board'), p, {
    onSolved: () => { status.textContent = '✓ Solved!'; status.className = 'puzzle-status ok'; nextBtn.disabled = false; record(true); },
    onWrong: (_p, first) => { status.textContent = '✗ Not the move — try again.'; status.className = 'puzzle-status no'; if (first) record(false); },
  });
}
