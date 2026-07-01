// views/train.js — the Puzzles hub: pick-your-theme puzzles, Name-the-Mate, and an
// ELO-ramped Puzzle Storm, all off the curated shards.
import { h, clear } from '../dom.js';
import * as store from '../storage.js';
import { Chess } from 'chess.js';
import { loadFullShard, loadThemeShard, loadMixedBatch, recordAttempt, buildBlunderPuzzle, toMoveObj } from '../puzzles.js';
import { mountPuzzle } from '../puzzleplay.js';
import { mountChat } from '../chatcoach.js';
import { MATE_PATTERNS, IDENTIFY_OPTIONS, correctIdentify, basicName } from '../checkmates.js';
import { getPuzzleRating, updatePuzzleRating } from '../puzzlerating.js';
import { themeLabel, themeHint, whyWrong } from '../puzzlemeta.js';
import { cloudEnabled, logAttempt } from '../cloud.js';

// Record every puzzle attempt to the shared log so coaches can review a student's misses.
function logPuzzleAttempt(p, theme, solved) {
  if (!cloudEnabled()) return;
  const u = store.get('profile.username', '');
  if (!u) return;
  logAttempt({ username: u.toLowerCase(), puzzle_id: p.id || null, fen: p.fen, moves: (p.solutionMoves || []).join(' '), theme: theme || null, solved: !!solved, rating: p.rating || null });
}

const TR = { _timer: null };
let CTX = null, host = null;

const STORM_THEMES = ['mateIn1', 'fork', 'pin', 'hangingPiece', 'backRankMate', 'mateIn2', 'skewer', 'discoveredAttack', 'deflection', 'sacrifice', 'mateIn3', 'trappedPiece', 'attraction', 'intermezzo', 'kingsideAttack', 'capturingDefender'];

// Themes offered in the "pick what you want" puzzle picker (label + shard key).
const THEME_CHOICES = [
  { t: 'fork', l: '🍴 Forks' }, { t: 'pin', l: '📌 Pins' }, { t: 'skewer', l: '🍢 Skewers' },
  { t: 'hangingPiece', l: '🎁 Hanging pieces' }, { t: 'discoveredAttack', l: '💥 Discovered attacks' },
  { t: 'deflection', l: '↩️ Deflection' }, { t: 'sacrifice', l: '⚔️ Sacrifices' }, { t: 'attraction', l: '🧲 Attraction' },
  { t: 'intermezzo', l: '⏸️ In-between moves' }, { t: 'mateIn1', l: '① Mate in 1' }, { t: 'mateIn2', l: '② Mate in 2' },
  { t: 'mateIn3', l: '③ Mate in 3' }, { t: 'backRankMate', l: '⬛ Back-rank mates' }, { t: 'promotion', l: '👑 Promotion' },
  { t: 'advancedPawn', l: '⬆️ Passed pawns' }, { t: 'endgame', l: '🏁 Endgames' }, { t: 'rookEndgame', l: '♜ Rook endgames' },
  { t: 'pawnEndgame', l: '♙ Pawn endgames' }, { t: 'queenEndgame', l: '♛ Queen endgames' }, { t: 'knightEndgame', l: '♞ Knight endgames' },
];

// The player's rating anchor for adaptive difficulty (cached; refreshed from Chess.com).
async function getBaseRating() {
  const cached = store.get('profile.peakRating', null);
  const u = store.get('profile.username', '');
  if (cached) { refreshBaseRating(u); return cached; }
  return (await refreshBaseRating(u)) || 1200;
}
async function refreshBaseRating(u) {
  if (!u) return null;
  try {
    const s = await fetch(`https://api.chess.com/pub/player/${u}/stats`).then((x) => x.json());
    const peak = Math.max(s.chess_rapid?.best?.rating || 0, s.chess_blitz?.best?.rating || 0, s.chess_rapid?.last?.rating || 0, s.chess_blitz?.last?.rating || 0);
    if (peak) { store.set('profile.peakRating', peak); return peak; }
  } catch { /* offline — fall back to cache/default */ }
  return store.get('profile.peakRating', null);
}
const DRILLS = [
  { theme: 'fork', label: 'Forks', desc: 'Hit two things at once.' },
  { theme: 'pin', label: 'Pins', desc: 'Freeze a piece to something bigger.' },
  { theme: 'hangingPiece', label: 'Hanging pieces', desc: 'Punish undefended pieces.' },
  { theme: 'backRankMate', label: 'Back-rank mates', desc: 'Mate on the home row.' },
  { theme: 'mateIn2', label: 'Mate in 2', desc: 'Forced two-move checkmates.' },
  { theme: 'discoveredAttack', label: 'Discovered attacks', desc: 'Unleash the piece behind.' },
  { theme: 'sacrifice', label: 'Sacrifices', desc: 'Give material to win more.' },
  { theme: 'deflection', label: 'Deflection', desc: 'Drag a defender away.' },
  { theme: 'endgame', label: 'Endgames', desc: 'King & pawn, rook endings, technique.' },
  { theme: 'rookEndgame', label: 'Rook endgames', desc: 'The most common ending of all.' },
  { theme: 'pawnEndgame', label: 'Pawn endgames', desc: 'Opposition, squares, breakthroughs.' },
  { theme: 'advancedPawn', label: 'Passed pawns', desc: 'Push them home.' },
];

// Let the report's "Train this" / "Train all in 1" buttons launch a themed puzzle session here.
let pendingThemes = null;
export function requestThemes(themes) { pendingThemes = (themes || []).filter(Boolean); }

export function render(container, ctx) {
  CTX = ctx; host = container;
  stopTimer();
  if (pendingThemes && pendingThemes.length) { const t = pendingThemes; pendingThemes = null; startThemePuzzles(t); return; }
  drawHome();
}

function stopTimer() { if (TR._timer) { clearInterval(TR._timer); TR._timer = null; } }

const todayStr = () => new Date().toISOString().slice(0, 10);
function dailyDoneToday() { const d = store.get('train.dailyState', null); return d && d.date === todayStr() && d.completed; }

function drawHome() {
  stopTimer();
  clear(host);
  const streak = store.get('train.streak', { count: 0 });
  const done = dailyDoneToday();
  const bigCard3 = (icon, title, desc, btn, fn) => h('div', { class: 'card', style: { display: 'flex', flexDirection: 'column', gap: '8px', cursor: 'pointer' }, onclick: fn },
    h('div', { style: { fontSize: '30px' } }, icon),
    h('div', { style: { fontSize: '18px', fontWeight: 800 } }, title),
    h('div', { class: 'hint', style: { flex: 1 } }, desc),
    h('button', { class: 'btn', style: { marginTop: '4px', alignSelf: 'flex-start' }, onclick: fn }, btn));
  host.append(
    h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' } },
      h('h1', {}, '🧩 Puzzles'),
      h('span', { class: 'pill', style: { fontFamily: 'var(--mono)', fontWeight: 700, fontSize: '15px' } }, `⚡ Puzzle rating ${getPuzzleRating()}`)),
    h('p', { class: 'hint' }, 'Three ways to train: pick the patterns you want, learn to finish games with the classic mates, or race the clock as the difficulty ramps to your level. Your puzzle rating adapts as you go.'),
    h('div', { class: 'section', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: '14px' } },
      bigCard3('🧩', 'Puzzles', 'Choose exactly what you drill — all patterns, a few, or just one. Tuned to your rating.', 'Choose themes →', renderThemePicker),
      bigCard3('♛', 'Advanced Mates', 'Learn the classic named checkmates — Anastasia\'s, Boden\'s, Arabian… — see each one, practice it, then identify them.', 'Open Mates →', () => CTX.navigate('mates')),
      bigCard3('🌪', 'Puzzle Storm', `Race the clock as puzzles ramp from easy up past your level. Best: ${store.get('train.stormBest', 0)}`, 'Start storm →', startStorm)),
    h('h2', { class: 'section' }, 'More practice'),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '12px' } },
      h('div', { class: 'card', style: { cursor: 'pointer' }, onclick: startDaily },
        h('div', {}, h('b', {}, done ? '✓ Daily training' : '📅 Daily training'), h('span', { class: 'hint tiny', style: { marginLeft: '8px' } }, `🔥 ${streak.count || 0}`)),
        h('div', { class: 'hint tiny', style: { marginTop: '4px' } }, done ? 'Done today — come back tomorrow.' : '12 puzzles aimed at your weak spots.')),
      h('div', { class: 'card', style: { cursor: 'pointer' }, onclick: startEndless },
        h('div', {}, h('b', {}, '♾️ Endless practice')),
        h('div', { class: 'hint tiny', style: { marginTop: '4px' } }, 'Never-ending fresh puzzles at your own pace.')),
      h('div', { class: 'card', style: { cursor: 'pointer' }, onclick: startBlunders },
        h('div', {}, h('b', {}, '🎯 Your blunders')),
        h('div', { class: 'hint tiny', style: { marginTop: '4px' } }, 'Replay your own losing moves as puzzles — find what you missed.'))),
  );
}

function bigCard(title, desc, btn, fn, primary) {
  return h('div', { class: 'card', style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
    h('div', { style: { fontSize: '18px', fontWeight: 800 } }, title),
    h('div', { class: 'hint' }, desc),
    h('button', { class: primary ? 'btn' : 'btn ghost', style: { marginTop: 'auto', alignSelf: 'flex-start' }, onclick: fn }, btn));
}

function masteryFor(theme) { const r = store.get('puzzles.srs.themes.' + theme + '.rating', null); return r ? '★ ' + r : 'new'; }

// ---------------- pick-your-theme puzzles ----------------
const PICK = { sel: new Set() };
function renderThemePicker() {
  stopTimer(); clear(host);
  const sel = PICK.sel, count = sel.size;
  const chip = (t, l) => h('button', { class: 'chip', style: sel.has(t) ? { background: 'var(--accent)', color: '#0a1e12', fontWeight: 700, borderColor: 'var(--accent)' } : {}, onclick: () => { sel.has(t) ? sel.delete(t) : sel.add(t); renderThemePicker(); } }, l);
  host.append(
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('button', { class: 'btn ghost small', onclick: drawHome }, '← Puzzles'),
      h('div', { class: 'hint tiny' }, count ? `${count} selected` : 'pick what you want')),
    h('h1', { style: { marginTop: '6px' } }, '🧩 Pick your puzzles'),
    h('p', { class: 'hint' }, 'Choose all of them, just a few, or a single pattern — then train a set tuned to your rating.'),
    h('div', { class: 'row', style: { gap: '8px', margin: '4px 0 12px' } },
      h('button', { class: 'btn small', onclick: () => { THEME_CHOICES.forEach((c) => sel.add(c.t)); renderThemePicker(); } }, 'Select all'),
      h('button', { class: 'btn ghost small', onclick: () => { sel.clear(); renderThemePicker(); } }, 'Clear')),
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } }, ...THEME_CHOICES.map((c) => chip(c.t, c.l))),
    h('div', { class: 'section' },
      h('button', { class: 'btn', disabled: !count, onclick: () => startThemePuzzles([...sel]) },
        count === 1 ? `Start ${THEME_CHOICES.find((c) => c.t === [...sel][0]).l.replace(/^\S+\s/, '')} →` : count ? `Start ${count} themes →` : 'Select at least one')));
}

async function startThemePuzzles(themes) {
  stopTimer();
  clear(host).append(h('div', { class: 'row' }, h('span', { class: 'spinner' }), ' Loading puzzles…'));
  const base = await getBaseRating();
  const srs = store.get('puzzles.srs', { themes: {}, puzzles: {} });
  const list = themes.length === 1
    ? await loadThemeShard(themes[0], { count: 15, targetRating: base, exclude: seenSet() }).catch(() => null)
    : await loadMixedBatch(themes, { count: 15, srs, exclude: seenSet() }).catch(() => null);
  if (!list || !list.length) { clear(host).append(h('div', { class: 'empty' }, 'No puzzles for that selection right now.'), h('button', { class: 'btn ghost', onclick: renderThemePicker }, '← Back')); return; }
  markSeen(list);
  const label = themes.length === 1 ? (THEME_CHOICES.find((c) => c.t === themes[0])?.l || 'Puzzles') : `${themes.length} themes`;
  // Endless: keep pulling fresh puzzles of the chosen themes so it never stops at a small count.
  DR.list = list; DR.i = 0; DR.theme = themes.join(','); DR.label = label; DR.onDone = renderThemePicker; DR.endless = true; DR.solved = 0; DR.attempts = 0;
  DR.refill = async () => {
    const more = themes.length === 1
      ? await loadThemeShard(themes[0], { count: 15, targetRating: base, exclude: seenSet() }).catch(() => null)
      : await loadMixedBatch(themes, { count: 15, srs, exclude: seenSet() }).catch(() => null);
    if (!more || !more.length) return renderThemePicker();
    markSeen(more); DR.list = more; DR.i = 0; drillPuzzle();
  };
  drillPuzzle();
}

// ---------------- Name the Mate (Bobby Fischer style) ----------------
const MATE = { patternObj: null, puzzles: null, idx: 0 };
function renderMateHome() {
  stopTimer(); clear(host);
  host.append(
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('button', { class: 'btn ghost small', onclick: drawHome }, '← Puzzles'),
      h('div', { class: 'hint tiny' }, 'Bobby Fischer style')),
    h('h1', { style: { marginTop: '6px' } }, '♛ Name the Mate'),
    h('p', { class: 'hint' }, 'A position from a real game. Deliver the checkmate on the board, then name the pattern — the more you see them, the faster they jump out in your own games.'),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: '14px' } },
      ...MATE_PATTERNS.map((m) => h('div', { class: 'card', style: { cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '5px' }, onclick: () => startMate(m) },
        h('b', { style: { fontSize: '16px' } }, `${m.icon} ${m.name}`),
        h('div', { class: 'hint tiny' }, m.blurb)))));
}

async function startMate(m) {
  MATE.patternObj = m; MATE.puzzles = null; MATE.idx = 0;
  clear(host).append(h('div', { class: 'row' }, h('span', { class: 'spinner' }), ' Loading mates…'));
  const base = await getBaseRating();
  const per = Math.ceil(10 / m.shards.length) + 1;
  const all = [];
  for (const sh of m.shards) { const got = await loadThemeShard(sh, { count: per, targetRating: base }); if (got) all.push(...got); }
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  const pz = all.slice(0, 10);
  if (!pz.length) { clear(host).append(h('div', { class: 'empty' }, 'Couldn\'t load these right now.'), h('button', { class: 'btn ghost', onclick: renderMateHome }, '← Back')); return; }
  MATE.puzzles = pz; MATE.idx = 0; playMate();
}

function playMate() {
  const p = MATE.puzzles[MATE.idx], m = MATE.patternObj;
  clear(host);
  const chess = new Chess(p.fen);
  const toMove = chess.turn() === 'w' ? 'White' : 'Black';
  const plies = p.solutionMoves.length;
  const ask = plies <= 1 ? 'deliver checkmate in one move.' : `force checkmate (mate in ${Math.ceil(plies / 2)}).`;
  const status = h('div', { class: 'puzzle-status' }, `${toMove} to move — ${ask}`);
  const side = h('div', { class: 'sidebar' });
  host.append(
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('button', { class: 'btn ghost small', onclick: renderMateHome }, '← Patterns'),
      h('div', { class: 'hint tiny' }, `${m.name} · ${MATE.idx + 1} of ${MATE.puzzles.length}`)),
    h('div', { class: 'review section', style: { gridTemplateColumns: '480px 1fr' } },
      h('div', { class: 'board-wrap' }, h('div', { id: 'mate-board' })),
      side));
  const ctrl = mountPuzzle(document.getElementById('mate-board'), p, {
    allowRetry: true,
    onWrong: (_pz, first) => { status.textContent = first ? 'Not mate — that lets the king escape. Look again.' : 'Still not mate. Try the hint.'; status.className = 'puzzle-status no'; },
    onSolved: () => onMateSolved(side, p),
  });
  clear(side).append(status, h('div', { class: 'row' }, h('button', { class: 'btn ghost small', onclick: () => ctrl.hint() }, '💡 Hint')));
}

function onMateSolved(side, p) {
  clear(side);
  if (MATE.patternObj.key === 'mix') {
    side.append(
      h('div', { class: 'puzzle-status ok' }, '✓ Checkmate!'),
      h('div', { class: 'hint', style: { margin: '8px 0' } }, 'What kind of mate did you just deliver?'),
      ...IDENTIFY_OPTIONS.map((o) => h('button', { class: 'btn ghost', style: { display: 'block', width: '100%', textAlign: 'left', marginBottom: '8px' }, onclick: () => revealIdentify(side, p, o.key) }, o.label)));
  } else revealMate(side, MATE.patternObj.name, MATE.patternObj.teach);
}

function revealIdentify(side, p, guess) {
  const correct = correctIdentify(p);
  const right = guess === correct;
  const named = MATE_PATTERNS.find((m) => m.key === correct);
  const name = correct === 'basic' ? basicName(p) : named.name;
  const teach = correct === 'basic' ? 'A clean forced mate — the bread and butter of finishing a game.' : named.teach;
  clear(side).append(
    h('div', { class: right ? 'puzzle-status ok' : 'puzzle-status no' }, right ? `✓ Right — ${name}` : `Actually — ${name}`),
    h('div', { class: 'explain-box', style: { margin: '10px 0', fontSize: '13px' } }, teach),
    h('div', { class: 'hint tiny', style: { marginBottom: '10px' } }, 'From a real game.'), nextMateBtn());
}

function revealMate(side, name, teach) {
  clear(side).append(
    h('div', { class: 'puzzle-status ok' }, `✓ ${name}!`),
    h('div', { class: 'explain-box', style: { margin: '10px 0', fontSize: '13px' } }, teach),
    h('div', { class: 'hint tiny', style: { marginBottom: '10px' } }, 'From a real game.'), nextMateBtn());
}

function nextMateBtn() {
  const last = MATE.idx >= MATE.puzzles.length - 1;
  return h('button', { class: 'btn', onclick: () => { if (last) finishMates(); else { MATE.idx++; playMate(); } } }, last ? 'Done ✓' : 'Next mate →');
}

function finishMates() {
  const m = MATE.patternObj, n = MATE.puzzles.length;
  clear(host).append(h('div', { class: 'empty', style: { paddingTop: '40px' } },
    h('div', { style: { fontSize: '44px' } }, '♚'),
    h('div', { style: { fontSize: '20px', fontWeight: 800, marginTop: '8px' } }, `${n} checkmates delivered!`),
    h('div', { class: 'hint', style: { marginTop: '6px' } }, 'Pattern recognition is pure repetition — the more mates you see, the faster they appear in your own games.'),
    h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '18px', gap: '10px' } },
      h('button', { class: 'btn', onclick: () => startMate(m) }, `↻ More ${m.name.toLowerCase()}`),
      h('button', { class: 'btn ghost', onclick: renderMateHome }, 'All patterns'))));
}

// ---------------- Puzzle Storm ----------------
const ST = { pool: [], i: 0, score: 0, lives: 3, streak: 0, bestStreak: 0, time: 180, over: false };

async function startStorm() {
  stopTimer();
  clear(host).append(h('div', { class: 'row' }, h('span', { class: 'spinner' }), ' Loading puzzles…'));
  const base = await getBaseRating();
  const all = [];
  for (const t of STORM_THEMES) { try { (await loadFullShard(t)).forEach((p) => all.push(p)); } catch {} }
  if (!all.length) { clear(host).append(h('div', { class: 'empty' }, 'Puzzles unavailable right now.'), h('button', { class: 'btn ghost', onclick: drawHome }, '← Back')); return; }
  const dedup = new Set();
  let uniq = all.filter((p) => (dedup.has(p.id) ? false : (dedup.add(p.id), true)));
  // prefer puzzles you haven't seen recently, so every storm is fresh
  const recent = seenSet();
  const fresh = uniq.filter((p) => !recent.has(p.id));
  if (fresh.length > 300) uniq = fresh;
  ST.pool = buildRamp(uniq, base); ST.base = base;
  ST.i = 0; ST.score = 0; ST.lives = 3; ST.streak = 0; ST.bestStreak = 0; ST.time = 180; ST.over = false;
  renderStormFrame();
  TR._timer = setInterval(() => { if (ST.over) return; ST.time--; updateHud(); if (ST.time <= 0) endStorm(); }, 1000);
  loadStormPuzzle();
}

// Difficulty ramp centered on the player's rating: begin ~300 below, climb to their level over
// the first stretch, then nudge a little past it (and hold there) so it keeps getting harder —
// but only slightly — to keep them in flow rather than slamming into a wall.
function buildRamp(pool, base) {
  const start = base - 300, top = base + 150, N = 80;
  const sorted = pool.slice().sort((a, b) => (a.rating || 1500) - (b.rating || 1500));
  const used = new Set();
  const ramp = [];
  for (let i = 0; i < N; i++) {
    const target = i < 25 ? start + (base - start) * (i / 25) : base + (top - base) * Math.min(1, (i - 25) / 20);
    let best = null, bestD = 1e9;
    for (const p of sorted) {
      if (used.has(p.id)) continue;
      const d = Math.abs((p.rating || 1500) - target);
      if (d < bestD) { bestD = d; best = p; }
      if ((p.rating || 1500) > target + 400) break; // sorted → nothing closer past here
    }
    if (best) { used.add(best.id); ramp.push(best); } else break;
  }
  return ramp;
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
  markSeen([p]);
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

// ---------------- daily training ----------------
const THEME_SHORT = { fork: 'forks', pin: 'pins', hangingPiece: 'hanging pieces', backRankMate: 'back-rank', discoveredAttack: 'discovered attacks', skewer: 'skewers', mateIn2: 'mate in 2', endgame: 'endgames', opening: 'openings', middlegame: 'middlegame', kingsideAttack: 'king attacks', tactics: 'tactics', general: 'tactics' };
function themeLabelShort(t) { return THEME_SHORT[t] || t; }

const shuffleArr = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// never-repeat: remember recently-served puzzle ids so each set feels fresh.
function seenSet() { return new Set(store.get('puzzles.seen', [])); }
function markSeen(puzzles) {
  if (!puzzles || !puzzles.length) return;
  const ids = puzzles.map((p) => p.id).filter(Boolean);
  store.set('puzzles.seen', [...store.get('puzzles.seen', []), ...ids].slice(-1500)); // keep the most recent ~1500
}

async function buildDailySet(size = 12) {
  const focus = store.get('train.focus', null);
  let themes = focus && focus.themes && focus.themes.length ? focus.themes.slice() : ['fork', 'hangingPiece', 'pin', 'backRankMate', 'endgame', 'mateIn2'];
  // mix in a couple of fresh themes for variety beyond the top weaknesses
  for (const t of ['skewer', 'discoveredAttack', 'rookEndgame', 'deflection', 'mateIn2']) if (!themes.includes(t)) themes.push(t);
  themes = themes.slice(0, 8);
  const srs = store.get('puzzles.srs', { themes: {}, puzzles: {} });
  const seen = seenSet();
  const weights = [4, 3, 2, 2, 1, 1, 1, 1]; // most weight to the top weaknesses
  const set = [];
  for (let i = 0; i < themes.length && set.length < size; i++) {
    const th = themes[i];
    const target = (srs.themes?.[th]?.rating || 1200) + 40; // a small stretch above your level
    try { (await loadThemeShard(th, { count: weights[i] || 1, targetRating: target, exclude: seen }) || []).forEach((p) => set.push(p)); } catch {}
  }
  if (focus?.blunders?.length) {
    try { const engine = await CTX.ensureEngine(); for (const b of focus.blunders.slice(0, 2)) { try { set.push(await buildBlunderPuzzle(b.fen, '', engine, { maxPlies: 4, depth: 14 })); } catch {} } } catch {}
  }
  shuffleArr(set);
  const final = set.slice(0, size);
  markSeen(final);
  return final;
}

async function startDaily() {
  stopTimer();
  clear(host).append(h('div', { class: 'row' }, h('span', { class: 'spinner' }), ' Building your daily set…'));
  const set = await buildDailySet();
  if (!set.length) { clear(host).append(h('div', { class: 'empty' }, 'Could not build a set right now.'), h('button', { class: 'btn ghost', onclick: drawHome }, '← Back')); return; }
  DR.list = set; DR.i = 0; DR.theme = 'daily'; DR.label = 'Daily training'; DR.onDone = markDailyComplete; DR.endless = false; DR.solved = 0; DR.attempts = 0; DR.refill = null;
  drillPuzzle();
}

function markDailyComplete() {
  const t = todayStr();
  store.set('train.dailyState', { date: t, completed: true });
  const s = store.get('train.streak', { count: 0, lastDate: null });
  if (s.lastDate !== t) {
    const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    s.count = s.lastDate === yest ? (s.count || 0) + 1 : 1;
    s.lastDate = t;
    store.set('train.streak', s);
  }
  clear(host).append(h('div', { class: 'empty', style: { paddingTop: '50px' } },
    h('div', { style: { fontSize: '44px' } }, '✅'),
    h('div', { style: { fontSize: '18px', fontWeight: 700, marginTop: '8px' } }, 'Daily training complete!'),
    h('div', { class: 'hint', style: { marginTop: '6px' } }, `🔥 ${store.get('train.streak', { count: 0 }).count} day streak`),
    h('button', { class: 'btn', style: { marginTop: '18px' }, onclick: drawHome }, 'Done')));
}

// ---------------- focused drill / endless practice ----------------
const DR = { list: [], i: 0, theme: '', label: '', onDone: null, endless: false, solved: 0, attempts: 0, refill: null };

async function startDrill(theme, label) {
  stopTimer();
  clear(host).append(h('div', { class: 'row' }, h('span', { class: 'spinner' }), ` Loading ${label.toLowerCase()}…`));
  const srs = store.get('puzzles.srs', { themes: {}, puzzles: {} });
  const target = srs.themes?.[theme]?.rating || 1200;
  let list = await loadThemeShard(theme, { count: 12, targetRating: target, exclude: seenSet() }).catch(() => null);
  if (!list || !list.length) { clear(host).append(h('div', { class: 'empty' }, 'No puzzles for this drill yet.'), h('button', { class: 'btn ghost', onclick: drawHome }, '← Back')); return; }
  markSeen(list);
  DR.list = list; DR.i = 0; DR.theme = theme; DR.label = label; DR.onDone = null; DR.endless = false; DR.solved = 0; DR.attempts = 0;
  drillPuzzle();
}

async function buildEndlessBatch() {
  const focus = store.get('train.focus', null);
  let themes = focus && focus.themes && focus.themes.length ? focus.themes.slice() : ['fork', 'pin', 'hangingPiece', 'endgame', 'mateIn2'];
  for (const t of ['skewer', 'discoveredAttack', 'rookEndgame', 'deflection', 'backRankMate']) if (!themes.includes(t)) themes.push(t);
  const srs = store.get('puzzles.srs', { themes: {}, puzzles: {} });
  const batch = await loadMixedBatch(themes.slice(0, 8), { count: 15, srs, exclude: seenSet() });
  markSeen(batch);
  return batch;
}

// Turn the player's OWN recent blunders (captured on their My Chess report) into puzzles: from
// each losing position, find the move they should have played.
async function startBlunders() {
  stopTimer();
  const focus = store.get('train.focus', null);
  const blunders = (focus && focus.blunders) || [];
  if (!blunders.length) {
    clear(host).append(
      h('div', { class: 'empty section' }, 'No blunders captured yet. Open the My Chess tab once so I can scan your recent games — your worst moments then show up here as puzzles to fix.'),
      h('div', { class: 'row', style: { justifyContent: 'center' } }, h('button', { class: 'btn', onclick: () => CTX.navigate('personal') }, 'Go to My Chess →')));
    return;
  }
  clear(host).append(h('div', { class: 'row' }, h('span', { class: 'spinner' }), ' Building puzzles from your blunders…'));
  let engine = null;
  try { engine = await CTX.ensureEngine(); } catch { /* no engine */ }
  if (!engine) { clear(host).append(h('div', { class: 'empty' }, 'The engine couldn\'t start — try again in a moment.'), h('button', { class: 'btn ghost', onclick: drawHome }, '← Back')); return; }
  const puzzles = [];
  for (const b of blunders.slice(0, 8)) {
    try { const p = await buildBlunderPuzzle(b.fen, b.gameUrl || '', engine, { maxPlies: 4, depth: 14 }); if (p) puzzles.push(p); } catch { /* skip this one */ }
  }
  if (!puzzles.length) { clear(host).append(h('div', { class: 'empty' }, 'Couldn\'t build blunder puzzles right now — try again after your next game scan.'), h('button', { class: 'btn ghost', onclick: drawHome }, '← Back')); return; }
  DR.list = puzzles; DR.i = 0; DR.theme = 'blunders'; DR.label = 'Your blunders'; DR.onDone = drawHome; DR.endless = false; DR.solved = 0; DR.attempts = 0; DR.refill = null;
  drillPuzzle();
}

async function startEndless() {
  stopTimer();
  clear(host).append(h('div', { class: 'row' }, h('span', { class: 'spinner' }), ' Loading puzzles…'));
  const list = await buildEndlessBatch();
  if (!list.length) { clear(host).append(h('div', { class: 'empty' }, 'Puzzles unavailable right now.'), h('button', { class: 'btn ghost', onclick: drawHome }, '← Back')); return; }
  DR.list = list; DR.i = 0; DR.theme = 'endless'; DR.label = 'Endless practice'; DR.onDone = null; DR.endless = true; DR.solved = 0; DR.attempts = 0; DR.refill = null;
  drillPuzzle();
}

async function endlessRefill() {
  clear(host).append(h('div', { class: 'row' }, h('span', { class: 'spinner' }), ' Loading more puzzles…'));
  const more = await buildEndlessBatch();
  if (!more.length) return drawHome();
  DR.list = more; DR.i = 0;
  drillPuzzle();
}

function drillPuzzle() {
  const p = DR.list[DR.i];
  const theme = p.theme || (p.themes && p.themes[0]);
  let recorded = false, ratingDelta = null;
  clear(host);
  const status = h('div', { class: 'puzzle-status' }, 'Your move — find the best continuation.');
  const explain = h('div', { id: 'drill-explain' });
  const ratingBadge = h('span', { class: 'pill', id: 'pz-rating', style: { fontFamily: 'var(--mono)', fontWeight: 700 } }, `⚡ ${getPuzzleRating()}`);
  const nextBtn = h('button', { class: 'btn small', disabled: true, onclick: () => { DR.i++; if (DR.i >= DR.list.length) { if (DR.endless) return (DR.refill || endlessRefill)(); return (DR.onDone || drawHome)(); } drillPuzzle(); } }, 'Next →');
  const record = (solved) => {
    if (recorded) return; recorded = true;
    DR.attempts++; if (solved) DR.solved++;
    const srs = store.get('puzzles.srs', { themes: {}, puzzles: {} }); recordAttempt(srs, p, { solved }); store.set('puzzles.srs', srs);
    ratingDelta = updatePuzzleRating(p.rating || 1500, solved);
    logPuzzleAttempt(p, theme, solved);
    const b = document.getElementById('pz-rating'); if (b) b.textContent = `⚡ ${getPuzzleRating()}`;
  };
  const progressLabel = DR.endless ? `${DR.label} · ${DR.solved}/${DR.attempts} solved` : `${DR.label} · ${DR.i + 1} of ${DR.list.length}`;
  host.append(
    h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' } },
      h('button', { class: 'btn ghost small', onclick: drawHome }, '← Back'),
      h('div', { class: 'row', style: { gap: '10px', alignItems: 'center' } },
        h('span', { class: 'hint tiny' }, `${progressLabel}${p.rating ? ' · lvl ' + p.rating : ''}`), ratingBadge)),
    h('div', { class: 'hint tiny', style: { margin: '2px 0 6px', fontWeight: 700, color: 'var(--accent-2)' } }, `Type: ${themeLabel(theme)}`),
    h('div', { class: 'review section', style: { gridTemplateColumns: '480px 1fr' } },
      h('div', { class: 'board-wrap' }, h('div', { id: 'drill-board' })),
      h('div', { class: 'sidebar' }, status, explain,
        h('div', { class: 'row' }, h('button', { class: 'btn ghost small', onclick: () => api.hint() }, 'Hint'), nextBtn),
        h('div', { class: 'section' },
          h('div', { class: 'hint tiny', style: { fontWeight: 700, marginBottom: '6px', color: 'var(--accent-2)' } }, '💬 Ask the coach'),
          h('div', { id: 'drill-chat' })))));
  mountChat(document.getElementById('drill-chat'), {
    getContext: () => `Tactics puzzle, player to move. FEN: ${p.fen}. The correct solution moves (UCI) are: ${p.solutionMoves.join(' ')}. Theme: ${theme}. Help the player understand WHY this works; don't just give the moves unless they ask.`,
    starter: 'Ask about this puzzle…',
  });
  const api = mountPuzzle(document.getElementById('drill-board'), p, {
    onSolved: () => {
      record(true);
      status.className = 'puzzle-status ok';
      status.textContent = `✓ Solved!${ratingDelta ? `  ${ratingDelta.delta >= 0 ? '+' : ''}${ratingDelta.delta} → ${ratingDelta.after}` : ''}`;
      let keySan = '';
      try { const c = new Chess(p.fen); const m = c.move(toMoveObj(p.solutionMoves[0])); if (m) keySan = m.san; } catch { /* */ }
      clear(explain).append(h('div', { class: 'explain-box', style: { fontSize: '13px', marginTop: '8px' } },
        h('b', {}, `${themeLabel(theme)}. `), `${keySan ? `The key move was ${keySan}. ` : ''}${themeHint(theme)}`));
      nextBtn.disabled = false;
    },
    onWrong: (_p, first, mv) => {
      if (first) record(false);
      const why = (mv && whyWrong(mv.fen, mv.uci, theme)) || `That's not it — ${themeHint(theme).charAt(0).toLowerCase() + themeHint(theme).slice(1)}`;
      status.className = 'puzzle-status no';
      status.textContent = `✗ ${why} Try again.`;
    },
  });
}
