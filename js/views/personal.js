// views/personal.js — import games, review with per-move grades & explanations,
// weakness profile, and puzzle training (own blunders + themed Lichess puzzles).
import { Chess } from 'chess.js';
import { h, clear, fmtDate, pct } from '../dom.js';
import * as store from '../storage.js';
import * as cc from '../chesscom.js';
import { analyzeGame, buildWeaknessProfile, suggestedPuzzleThemes, weaknessSnapshot } from '../review.js';
import { computeInsights, comparePeers, improvementPlan, byTimeControl } from '../insights.js';
import { computeDimensions, dailyPlan } from '../report.js';
import { renderImprove, renderByTimeControl, renderScorecard, renderTodayPlan } from '../insightsview.js';
import { BENCHMARKS } from '../benchmarks.js';
import { commentMove, coachPlan } from '../llm.js';
import { createBoard, syncBoard, legalDests, evalToWhitePct, evalText, showArrow } from '../board.js';
import { LABELS } from '../analysis.js';
import {
  buildBlunderPuzzle, puzzleFromLichessJson, lichessApi, checkMove, toMoveObj,
  recordAttempt, difficultyForTheme, loadThemeShard,
} from '../puzzles.js';

const S = { username: '', timeClass: 'all', games: [], analyses: {} }; // analyses keyed by game.url
let CTX = null;
let host = null; // main container
let pendingImport = null;

// Let the Class view deep-link a student into the full Personal review.
export function requestImport(username) { pendingImport = username; }

export function render(container, ctx) {
  CTX = ctx;
  host = container;
  const p = store.get('profile', {});
  S.username = pendingImport || S.username || p.username || '';
  S.timeClass = S.timeClass || 'all';
  drawHome();
  if (pendingImport) { pendingImport = null; doImport(); }
}

function depth() { return store.get('profile.engineDepth', 14); }

// Analyses belonging to the player currently loaded (owner or a student under review),
// so the Improve dashboard / training never mixes two players' games.
function currentAnalyses() {
  const u = (S.username || '').toLowerCase();
  return Object.values(S.analyses).filter((a) => (a.game?.username || '').toLowerCase() === u);
}

// ---------------- home: controls + game list ----------------
function drawHome() {
  clear(host);
  const owner = store.get('profile.ownerName', '');
  host.append(
    h('h1', {}, owner ? `${owner}'s training` : 'Personal growth'),
    h('p', { class: 'hint' }, 'Import your Chess.com games, review any game move-by-move with engine grades and plain-English explanations, deep-scan to see exactly how to improve and how you stack up against stronger players, then train the patterns you miss most.'),
    controlsBar(),
    h('div', { id: 'game-area', class: 'section' },
      S.games.length ? gameListEl() : h('div', { class: 'empty' }, 'Enter a username and import games to begin.')),
    h('div', { id: 'improve-area', class: 'section' }),
    h('div', { id: 'train-area', class: 'section' }),
  );
  if (S.games.length) drawImprove();
  if (Object.keys(S.analyses).length) drawTrainingSection();
}

// ---------------- deep scan + improve dashboard ----------------
function deepScanBar() {
  const sel = h('select', { id: 'scan-n' }, ...[5, 10, 15, 20].map((n) => h('option', { value: n, selected: n === 10 }, n + ' games')));
  return h('div', { class: 'row', style: { alignItems: 'center' } },
    h('button', { class: 'btn', id: 'scan-btn', onclick: () => deepScan(parseInt(document.getElementById('scan-n').value, 10)) }, 'Deep scan'),
    sel,
    h('span', { class: 'hint tiny' }, 'Analyzes your recent games with the engine to build your improvement profile (cached, so it\'s instant next time).'));
}

// Pull any already-cached (IndexedDB) analyses for the imported games into memory,
// so the dashboard appears instantly on return visits without re-scanning.
async function preloadCached() {
  for (const g of S.games) {
    if (S.analyses[g.url]) continue;
    try {
      const cached = await store.cacheGet(g.url, 0);
      if (cached && cached.plies) S.analyses[g.url] = { ...(cached.summary || {}), plies: cached.plies, cached: true, game: g };
    } catch {}
  }
}

async function deepScan(n) {
  if (!S.games.length) return;
  S._cancelScan = false;
  const area = document.getElementById('improve-area');
  const targets = S.games.slice(0, n);
  const bar = h('div', { class: 'bar' });
  const msg = h('span', {}, 'Starting…');
  clear(area).append(h('h2', {}, 'Improve'),
    h('div', { class: 'card' },
      h('div', { class: 'row', style: { justifyContent: 'space-between' } },
        h('div', { class: 'row' }, h('span', { class: 'spinner' }), msg),
        h('button', { class: 'btn ghost small', onclick: () => { S._cancelScan = true; } }, 'Stop')),
      h('div', { class: 'progress' }, bar)));
  const engine = await CTX.ensureEngine();
  const d = depth();
  let done = 0;
  for (const g of targets) {
    if (S._cancelScan) break;
    g.username = S.username;
    if (!S.analyses[g.url]) {
      msg.textContent = `Analyzing game ${done + 1} of ${targets.length} (vs ${g.opponent})…`;
      try {
        S.analyses[g.url] = await analyzeGame(g, engine, {
          depth: d, multipv: 2,
          onProgress: (p) => { bar.style.width = ((done + p.done / p.total) / targets.length) * 100 + '%'; },
        });
      } catch (e) { console.warn('scan failed for', g.url, e); }
    }
    done++;
    bar.style.width = (done / targets.length) * 100 + '%';
  }
  drawImprove();
  drawTrainingSection();
}

function drawImprove() {
  const area = document.getElementById('improve-area');
  if (!area) return;
  clear(area).append(h('h2', {}, 'Improve'), deepScanBar());
  const analyses = currentAnalyses();
  const u = (S.username || '').toLowerCase();
  const myGames = S.games.filter((g) => (g.username || '').toLowerCase() === u);

  if (!analyses.length) {
    renderByTimeControl(area, byTimeControl(myGames, analyses));
    area.append(h('div', { class: 'hint section' }, 'Deep-scan your recent games to unlock your skill scorecard, daily plan, accuracy, peer comparison, and weaknesses.'));
    return;
  }

  const I = computeInsights(analyses, S.username);
  const dims = computeDimensions(I);
  const today = dailyPlan(dims, I, I.openings);
  const rating = I.ratingAvg;
  const peer = BENCHMARKS && rating ? comparePeers(I, rating, BENCHMARKS) : null;
  const plan = improvementPlan(I, peer);

  renderTodayPlan(area, today, trainTheme);   // engagement engine — high on the page
  renderScorecard(area, dims);                 // skill radar / superpower + weakness
  renderByTimeControl(area, byTimeControl(myGames, analyses));
  const dash = h('div', { class: 'section' });
  area.append(dash);
  renderImprove(dash, { insights: I, peer, plan, byTC: null, onTrain: trainTheme });

  // optional Claude-written coach's note (owner's API key)
  const key = store.get('profile.llmKey', '');
  if (key && plan.length) {
    const note = h('div', { class: 'why', style: { color: 'var(--accent-2)', marginTop: '8px' } });
    const btn = h('button', { class: 'btn ghost small', onclick: async () => {
      btn.disabled = true; btn.textContent = 'Writing…';
      try { const txt = await coachPlan({ apiKey: key, username: S.username, insights: I, actions: plan }); note.textContent = '💬 ' + (txt || ''); btn.remove(); }
      catch (e) { note.textContent = '⚠ ' + e.message; btn.disabled = false; btn.textContent = '💬 Get a coach\'s note'; }
    } }, '💬 Get a coach\'s note');
    dash.append(h('div', { class: 'card section' }, h('h2', {}, 'Coach\'s note'), btn, note));
  }
}

function controlsBar() {
  const user = h('input', { type: 'text', value: S.username, placeholder: 'Chess.com username', onkeydown: (e) => { if (e.key === 'Enter') doImport(); } });
  const tc = h('select', {},
    ...['rapid', 'blitz', 'bullet', 'daily', 'all'].map((t) => h('option', { value: t, selected: t === S.timeClass }, t[0].toUpperCase() + t.slice(1))));
  const btn = h('button', { class: 'btn', onclick: () => doImport() }, 'Import games');
  controlsBar._user = user; controlsBar._tc = tc; controlsBar._btn = btn;
  return h('div', { class: 'controls' },
    h('div', { class: 'field username' }, h('label', {}, 'Username'), user),
    h('div', { class: 'field tc' }, h('label', {}, 'Time control'), tc),
    h('div', { class: 'field' }, h('label', { class: 'tiny' }, ' '), btn),
  );
}

async function doImport() {
  const username = controlsBar._user.value.trim();
  const timeClass = controlsBar._tc.value;
  if (!username) return;
  S.username = username; S.timeClass = timeClass;
  store.set('profile.username', username); store.set('profile.timeClass', timeClass);
  const area = document.getElementById('game-area');
  clear(area).append(h('div', { class: 'row' }, h('span', { class: 'spinner' }), ' Fetching recent games…'));
  controlsBar._btn.disabled = true;
  try {
    const games = await cc.fetchRecentGames(username, { months: 8, timeClass, limit: 50 });
    games.forEach((g) => (g.username = username));
    S.games = games;
    if (games.length) { await preloadCached(); drawHome(); }
    else clear(area).append(h('div', { class: 'empty' }, `No ${timeClass} games found for “${username}”.`));
  } catch (e) {
    clear(area).append(h('div', { class: 'empty' }, 'Could not fetch games. ', h('span', { class: 'tiny' }, e.message)));
  } finally {
    controlsBar._btn.disabled = false;
  }
}

function gameListEl() {
  const wrap = h('div', {});
  wrap.append(h('h2', {}, `Recent games`));
  const list = h('div', { class: 'game-list' });
  for (const g of S.games) {
    const a = S.analyses[g.url];
    const acc = a ? a.accuracy[g.userColor] : null;
    list.append(h('div', { class: 'game-row', onclick: () => openReview(g) },
      h('div', { class: 'res ' + g.userResult }, g.userResult === 'win' ? 'Win' : g.userResult === 'loss' ? 'Loss' : 'Draw'),
      h('div', {},
        h('div', { class: 'opp' }, 'vs ', g.opponent),
        h('div', { class: 'meta' }, `${g.userColor} · ${g.userRating} → ${g.oppRating} · ${fmtDate(g.dateUTC)}`)),
      h('div', { class: 'meta' }, g.timeClass),
      h('div', {}, acc != null ? h('span', { class: 'acc-badge', style: { color: accColor(acc) } }, pct(acc) + ' acc') : h('span', { class: 'hint tiny' }, 'not analyzed')),
      h('button', { class: 'btn small ghost', onclick: (e) => { e.stopPropagation(); openReview(g); } }, a ? 'Review' : 'Analyze'),
    ));
  }
  wrap.append(list);
  return wrap;
}

function accColor(a) { return a >= 85 ? 'var(--good)' : a >= 70 ? 'var(--warn)' : 'var(--bad)'; }

// ---------------- review ----------------
const R = { game: null, analysis: null, ply: 0, ground: null, orientation: 'white' };

async function openReview(game) {
  clear(host);
  const prog = h('div', { class: 'progress' }, h('div', { class: 'bar', id: 'an-bar' }));
  host.append(
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('button', { class: 'btn ghost small', onclick: drawHome }, '← Back to games'),
      h('div', { class: 'hint' }, 'vs ', game.opponent, ' · ', fmtDate(game.dateUTC))),
    h('div', { class: 'card section', id: 'review-card' },
      h('div', { class: 'row' }, h('span', { class: 'spinner' }), h('span', { id: 'an-msg' }, ' Analyzing with Stockfish…')), prog),
  );
  try {
    let analysis = S.analyses[game.url];
    if (!analysis) {
      const engine = await CTX.ensureEngine();
      analysis = await analyzeGame(game, engine, {
        depth: depth(), multipv: 2,
        onProgress: (p) => {
          const b = document.getElementById('an-bar'); if (b) b.style.width = Math.round((p.done / p.total) * 100) + '%';
          const m = document.getElementById('an-msg'); if (m) m.textContent = ` Analyzing… move ${Math.ceil(p.done / 2)} of ${Math.ceil(p.total / 2)}`;
        },
      });
      S.analyses[game.url] = analysis;
      maybeSnapshot();
    }
    renderReview(game, analysis);
  } catch (e) {
    const c = document.getElementById('review-card');
    if (c) clear(c).append(h('div', { class: 'empty' }, 'Analysis failed. ', h('span', { class: 'tiny' }, e.message)));
    console.error(e);
  }
}

function renderReview(game, analysis) {
  R.game = game; R.analysis = analysis; R.ply = 0; R.orientation = game.userColor;
  const card = document.getElementById('review-card');
  clear(card);

  const boardEl = h('div', { id: 'board' });
  const evalWhite = h('div', { class: 'white' });
  const evalNum = h('div', { class: 'num' });
  const evalbar = h('div', { class: 'evalbar' }, evalWhite, evalNum);

  const accW = analysis.accuracy.white, accB = analysis.accuracy.black;
  const accBar = h('div', { class: 'accbar card', style: { padding: '12px 16px' } },
    accSide('White', accW), accSide('Black', accB),
    h('div', { class: 'hint', style: { marginLeft: 'auto' } }, `depth ${analysis.depth}`));

  const explainBox = h('div', { class: 'explain-box', id: 'explain' });
  const moveList = h('div', { class: 'movelist', id: 'movelist' });
  const nav = h('div', { class: 'nav-controls' },
    h('button', { onclick: () => stepTo(0), title: 'Start' }, '⏮'),
    h('button', { onclick: () => stepTo(R.ply - 1), title: 'Previous' }, '◀'),
    h('button', { onclick: () => stepTo(R.ply + 1), title: 'Next' }, '▶'),
    h('button', { onclick: () => stepTo(analysis.plies.length), title: 'End' }, '⏭'),
    h('button', { onclick: jumpToNextMistake, title: 'Jump to next mistake', style: { flex: '1.6' } }, '⚠ next slip'),
    h('button', { onclick: flipBoard, title: 'Flip board' }, '⇅'));

  const summaryChips = reviewSummary(game, analysis);

  card.append(
    accBar,
    summaryChips,
    h('div', { class: 'review section' },
      evalbar,
      h('div', { class: 'board-wrap' }, boardEl),
      h('div', { class: 'sidebar' }, nav, explainBox, moveList)),
    buildEvalGraph(analysis),
  );

  R.ground = createBoard(boardEl, { viewOnly: true, orientation: R.orientation, coordinates: true, fen: analysis.plies[0]?.fenBefore });
  R._eval = { white: evalWhite, num: evalNum };
  buildMoveList(moveList, analysis);
  stepTo(0);
  attachKeys();
}

function accSide(name, v) {
  return h('div', {}, h('div', { class: 'acc', style: { color: v == null ? 'var(--muted)' : accColor(v) } }, pct(v)), h('div', { class: 'who' }, name + ' accuracy'));
}

function plural(lbl, n) {
  if (n === 1) return lbl;
  if (lbl === 'Miss') return 'Misses';
  if (lbl.endsWith('y')) return lbl.slice(0, -1) + 'ies';
  return lbl + 's';
}
function reviewSummary(game, analysis) {
  const mine = analysis.plies.filter((p) => p.color === game.userColor);
  const count = (lbl) => mine.filter((p) => p.label === lbl).length;
  const chip = (lbl) => { const n = count(lbl); return n ? h('span', { class: 'chip' }, h('span', { class: 'glyph', style: { color: LABELS[lbl]?.color } }, LABELS[lbl]?.glyph || ''), ' ', `${n} ${plural(lbl, n)}`) : null; };
  return h('div', { class: 'chip-row section' },
    ['Brilliant', 'Great', 'Best', 'Excellent', 'Good', 'Inaccuracy', 'Miss', 'Mistake', 'Blunder'].map(chip));
}

function buildMoveList(el, analysis) {
  clear(el);
  let line = null;
  analysis.plies.forEach((p, i) => {
    if (p.color === 'white') { line = h('span'); el.append(h('span', { class: 'moveno' }, p.moveNumber + '.'), line, ' '); }
    const span = h('span', { class: 'ply', 'data-ply': i + 1, onclick: () => stepTo(i + 1) },
      p.san, h('span', { class: 'glyph', style: { color: LABELS[p.label]?.color } }, LABELS[p.label]?.glyph || ''));
    if (p.color === 'white') line.append(span);
    else el.append(span, ' ');
  });
}

function stepTo(ply) {
  const a = R.analysis;
  ply = Math.max(0, Math.min(a.plies.length, ply));
  R.ply = ply;
  const fen = ply === 0 ? a.plies[0].fenBefore : a.plies[ply - 1].fenAfter;
  const lastMove = ply >= 1 ? uciPair(a.plies[ply - 1].playedUci) : undefined;
  const chess = new Chess(fen);
  R.ground.set({ fen, lastMove, check: chess.isCheck(), turnColor: chess.turn() === 'w' ? 'white' : 'black' });
  // arrow: best move available in the CURRENT position (what to play next)
  const nextBest = ply < a.plies.length ? a.plies[ply].bestUci : null;
  showArrow(R.ground, nextBest);
  // eval bar from eval after current ply (or ~initial at ply 0)
  const ev = ply === 0 ? { type: 'cp', value: 20 } : a.plies[ply - 1].evalWhite;
  R._eval.white.style.height = evalToWhitePct(ev) + '%';
  R._eval.num.textContent = evalText(ev);
  // explanation of the move just played
  renderExplain(ply >= 1 ? a.plies[ply - 1] : null);
  // active in move list
  document.querySelectorAll('#movelist .ply').forEach((s) => s.classList.toggle('active', +s.dataset.ply === ply));
  const active = document.querySelector('#movelist .ply.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
  if (R._eg) R._eg.marker.style.left = (R._eg.n ? (ply / R._eg.n) * 100 : 0) + '%';
}

function renderExplain(p) {
  const box = document.getElementById('explain');
  if (!box) return;
  if (!p) { clear(box).append(h('div', { class: 'hint' }, 'Starting position. Step forward to review each move.')); return; }
  const lab = LABELS[p.label] || {};
  clear(box).append(
    h('span', { class: 'label-chip', style: { background: (lab.color || '#888') + '22', color: lab.color } }, `${lab.glyph || ''} ${p.label}`),
    h('div', {}, h('span', { class: 'move-san' }, `${p.moveNumber}${p.color === 'white' ? '.' : '…'} ${p.san}`),
      p.winLoss >= 1 ? h('span', { class: 'hint' }, `  (−${p.winLoss}% win chance)`) : null),
    h('div', { class: 'why' }, p.explanation),
    p.bestUci && p.playedUci !== p.bestUci ? h('div', { class: 'best' }, 'Engine\'s choice: ', h('b', {}, p.bestSan || '—')) : null,
  );
  // optional richer commentary from Claude (owner's API key)
  const key = store.get('profile.llmKey', '');
  if (key) {
    const coachLine = h('div', { class: 'why', style: { marginTop: '8px', color: 'var(--accent-2)' } });
    const btn = h('button', { class: 'btn ghost small', style: { marginTop: '8px' }, onclick: async () => {
      btn.disabled = true; btn.textContent = 'Coaching…';
      try {
        const txt = await commentMove({ apiKey: key, fen: p.fenBefore, color: p.color, playedSan: p.san, bestSan: p.bestSan, label: p.label, winLoss: p.winLoss, heuristic: p.explanation });
        coachLine.textContent = '💬 ' + (txt || '(no comment)');
        btn.remove();
      } catch (e) { coachLine.textContent = '⚠ ' + e.message; btn.disabled = false; btn.textContent = '💬 Ask the coach'; }
    } }, '💬 Ask the coach');
    box.append(btn, coachLine);
  }
}

function buildEvalGraph(analysis) {
  const plies = analysis.plies;
  const n = plies.length;
  const W = 100, H = 40;
  const xs = (i) => (n <= 1 ? 0 : (i / n) * W);
  const yOf = (wp) => H - (wp / 100) * H;
  let path = `M 0 ${yOf(50).toFixed(2)}`;
  const dots = [];
  plies.forEach((p, i) => {
    const wp = evalToWhitePct(p.evalWhite);
    const x = xs(i + 1);
    path += ` L ${x.toFixed(2)} ${yOf(wp).toFixed(2)}`;
    if (p.label === 'Blunder' || p.label === 'Mistake') dots.push(`<circle cx="${x.toFixed(2)}" cy="${yOf(wp).toFixed(2)}" r="0.7" fill="${LABELS[p.label].color}"/>`);
  });
  const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:56px;display:block;border-radius:6px;background:#2b2620">
    <rect x="0" y="0" width="${W}" height="${(H / 2).toFixed(1)}" fill="#ffffff14"/>
    <line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="#ffffff33" stroke-width="0.2"/>
    <path d="${path}" fill="none" stroke="#7aa84f" stroke-width="0.5"/>${dots.join('')}
  </svg>`;
  const marker = h('div', { style: { position: 'absolute', top: '0', bottom: '0', width: '2px', background: 'var(--accent-2)', left: '0', pointerEvents: 'none' } });
  const container = h('div', {
    style: { position: 'relative', cursor: 'pointer' },
    onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); stepTo(Math.round(((e.clientX - r.left) / r.width) * n)); },
  }, h('div', { html: svg }), marker);
  R._eg = { marker, n };
  return h('div', { class: 'card section' }, h('div', { class: 'hint tiny', style: { marginBottom: '4px' } }, 'Game evaluation (white’s win chance) — click to jump; dots mark mistakes & blunders.'), container);
}

function jumpToNextMistake() {
  const a = R.analysis;
  const bad = ['Inaccuracy', 'Miss', 'Mistake', 'Blunder'];
  for (let i = R.ply; i < a.plies.length; i++) if (bad.includes(a.plies[i].label)) return stepTo(i + 1);
  for (let i = 0; i < a.plies.length; i++) if (bad.includes(a.plies[i].label)) return stepTo(i + 1); // wrap around
}

function flipBoard() { R.orientation = R.orientation === 'white' ? 'black' : 'white'; R.ground.set({ orientation: R.orientation }); }
function uciPair(uci) { return [uci.slice(0, 2), uci.slice(2, 4)]; }

let keyHandler = null;
function attachKeys() {
  detachKeys();
  keyHandler = (e) => {
    if (e.key === 'ArrowRight') { stepTo(R.ply + 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { stepTo(R.ply - 1); e.preventDefault(); }
    else if (e.key === 'f') flipBoard();
  };
  document.addEventListener('keydown', keyHandler);
}
function detachKeys() { if (keyHandler) document.removeEventListener('keydown', keyHandler); keyHandler = null; }

// ---------------- training (weaknesses + puzzles) ----------------
function drawTrainingSection() {
  const area = document.getElementById('train-area');
  if (!area) return;
  const analyses = currentAnalyses();
  if (!analyses.length) return clear(area);
  const userColor = analyses[0]?.userColor;
  const profile = buildWeaknessProfile(analyses, userColor);
  S._profile = profile;
  persistSnapshot();

  clear(area).append(
    h('h2', {}, 'Weaknesses & training'),
    h('p', { class: 'hint' }, `Based on ${profile.games} analyzed game${profile.games > 1 ? 's' : ''} (${profile.mistakes} mistakes across ${profile.userMoves} of your moves).`),
    h('div', { class: 'stat-grid section' },
      ...['opening', 'middlegame', 'endgame'].map((ph) => {
        const w = profile.phases.find((x) => x.key === ph)?.weight || 0;
        return h('div', { class: 'stat' }, h('div', { class: 'k' }, ph), h('div', { class: 'v' }, w), h('div', { class: 'hint tiny' }, 'win% lost to mistakes'));
      })),
    profile.blunders.length
      ? h('div', { class: 'card section' },
          h('div', { class: 'row', style: { justifyContent: 'space-between' } },
            h('div', {}, h('b', {}, `${profile.blunders.length} blunders & mistakes`), h('div', { class: 'hint tiny' }, 'Turn your own losing moves into puzzles — find what you missed.')),
            h('button', { class: 'btn', onclick: () => trainBlunders(profile) }, 'Train my blunders')))
      : h('div', { class: 'hint' }, 'No clear blunders found yet — analyze more games to surface patterns.'),
    h('div', { class: 'section' },
      h('div', { class: 'hint', style: { marginBottom: '8px' } }, 'Or drill themed puzzles for the patterns you miss most:'),
      h('div', { class: 'chip-row' }, ...suggestedPuzzleThemes(profile).map((t) =>
        h('div', { class: 'chip', onclick: () => trainTheme(t) }, themeLabel(t),
          h('span', { class: 'w' }, masteryFor(t))))),
    ),
  );
}

function masteryFor(theme) {
  const r = store.get('puzzles.srs.themes.' + theme + '.rating', null);
  return r ? '★ ' + r : 'new';
}
const THEME_LABELS = { fork: 'Forks', pin: 'Pins', hangingPiece: 'Hanging pieces', backRankMate: 'Back-rank', discoveredAttack: 'Discovered attacks', kingsideAttack: 'King attacks', skewer: 'Skewers', opening: 'Openings', middlegame: 'Middlegame', endgame: 'Endgames', mateIn2: 'Mate in 2' };
function themeLabel(t) { return THEME_LABELS[t] || t; }

async function trainBlunders(profile) {
  clear(host).append(
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('button', { class: 'btn ghost small', onclick: drawHome }, '← Back'),
      h('div', { class: 'hint' }, 'Building puzzles from your blunders…')),
    h('div', { class: 'card section', id: 'puz-host' }, h('div', { class: 'row' }, h('span', { class: 'spinner' }), ' Preparing puzzles…')));
  const engine = await CTX.ensureEngine();
  const picks = profile.blunders.slice(0, 8);
  const puzzles = [];
  for (const b of picks) {
    try { puzzles.push(await buildBlunderPuzzle(b.fen, b.gameUrl, engine, { maxPlies: 4, depth: depth() })); } catch {}
  }
  if (!puzzles.length) { document.getElementById('puz-host').textContent = 'Could not build puzzles from these positions.'; return; }
  runPuzzles(puzzles, 'Your blunders');
}

async function trainTheme(theme) {
  clear(host).append(
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('button', { class: 'btn ghost small', onclick: drawHome }, '← Back'),
      h('div', { class: 'hint' }, themeLabel(theme), ' puzzles')),
    h('div', { class: 'card section', id: 'puz-host' }, h('div', { class: 'row' }, h('span', { class: 'spinner' }), ' Loading puzzles from Lichess…')));
  const srs = store.get('puzzles.srs', { themes: {}, puzzles: {} });
  const targetRating = srs.themes?.[theme]?.rating || 1200;
  // 1) curated shard hosted in the repo — reliable and works offline
  let puzzles = await loadThemeShard(theme, { count: 6, targetRating }).catch(() => null);
  // 2) fallback: live Lichess API (may be blocked or rate-limited on some networks)
  if (!puzzles || !puzzles.length) {
    const diff = difficultyForTheme(srs, theme);
    puzzles = [];
    for (let i = 0; i < 6; i++) {
      try { puzzles.push(puzzleFromLichessJson(await lichessApi.next(theme, diff))); }
      catch { if (i === 0) break; } // first call failed → host unreachable, stop retrying
    }
  }
  if (!puzzles.length) {
    document.getElementById('puz-host').textContent = 'Couldn\'t load themed puzzles here (the puzzle source may be offline on this network). “Train my blunders” works fully offline from your own games.';
    return;
  }
  runPuzzles(puzzles, themeLabel(theme));
}

// ---------------- puzzle solver ----------------
const PZ = { list: [], i: 0, title: '', puzzle: null, chess: null, ground: null, idx: 0, side: 'white', done: false, recorded: false };

function runPuzzles(list, title) {
  PZ.list = list; PZ.i = 0; PZ.title = title;
  loadPuzzle();
}

function loadPuzzle() {
  const title = PZ.title;
  const p = PZ.list[PZ.i];
  PZ.puzzle = p; PZ.chess = new Chess(p.fen); PZ.idx = 0; PZ.done = false; PZ.recorded = false;
  PZ.side = PZ.chess.turn() === 'w' ? 'white' : 'black';

  const hostCard = document.getElementById('puz-host');
  clear(hostCard);
  const boardEl = h('div', { id: 'pz-board' });
  const status = h('div', { class: 'puzzle-status', id: 'pz-status' }, 'Your move — find the best continuation.');
  const meta = h('div', { class: 'hint' }, `${title} · puzzle ${PZ.i + 1} of ${PZ.list.length}`, p.rating ? ` · rating ${p.rating}` : '', p.source === 'personal' ? ' · from your game' : '');
  const controls = h('div', { class: 'row section' },
    h('button', { class: 'btn ghost small', id: 'pz-hint', onclick: showHint }, 'Hint'),
    h('button', { class: 'btn ghost small', onclick: solveOut }, 'Show solution'),
    h('button', { class: 'btn small', id: 'pz-next', onclick: nextPuzzle, disabled: true }, 'Next →'),
    p.sourceGameUrl ? h('a', { href: p.sourceGameUrl, target: '_blank', class: 'hint tiny', style: { marginLeft: 'auto' } }, 'view source game') : null);

  hostCard.append(meta, h('div', { class: 'review section', style: { gridTemplateColumns: '480px 1fr' } },
    h('div', { class: 'board-wrap' }, boardEl),
    h('div', { class: 'sidebar' }, status, controls)));

  PZ.ground = createBoard(boardEl, {
    fen: p.fen, orientation: PZ.side, turnColor: PZ.side, coordinates: true,
    movable: { free: false, color: PZ.side, dests: legalDests(PZ.chess), showDests: true, events: { after: onPuzzleMove } },
  });
}

function onPuzzleMove(orig, dest) {
  const piece = PZ.chess.get(orig);
  const isProm = piece && piece.type === 'p' && (dest[1] === '8' || dest[1] === '1');
  const uci = orig + dest + (isProm ? 'q' : '');
  const status = document.getElementById('pz-status');
  if (checkMove(PZ.puzzle, PZ.idx, uci)) {
    PZ.chess.move({ from: orig, to: dest, promotion: isProm ? 'q' : undefined });
    PZ.idx++;
    syncBoard(PZ.ground, PZ.chess, [orig, dest], PZ.side);
    if (PZ.idx >= PZ.puzzle.solutionMoves.length) return puzzleSolved();
    status.textContent = 'Correct — keep going.'; status.className = 'puzzle-status ok';
    // auto-play opponent reply
    const reply = PZ.puzzle.solutionMoves[PZ.idx];
    setTimeout(() => {
      PZ.chess.move(toMoveObj(reply));
      PZ.idx++;
      syncBoard(PZ.ground, PZ.chess, uciPair(reply), PZ.side);
      PZ.ground.set({ movable: { color: PZ.side, dests: legalDests(PZ.chess) } });
    }, 350);
  } else {
    // wrong: record a lapse once, snap back
    if (!PZ.recorded) { record(false); }
    status.textContent = '✗ Not the move — try again.'; status.className = 'puzzle-status no';
    PZ.ground.set({ fen: PZ.chess.fen(), movable: { color: PZ.side, dests: legalDests(PZ.chess) } });
  }
}

function puzzleSolved() {
  const status = document.getElementById('pz-status');
  status.textContent = '✓ Solved!'; status.className = 'puzzle-status ok';
  document.getElementById('pz-next').disabled = false;
  if (!PZ.recorded) record(true);
}

function solveOut() {
  // play out remaining solution for the user
  const status = document.getElementById('pz-status');
  if (!PZ.recorded) record(false);
  let i = PZ.idx;
  const step = () => {
    if (i >= PZ.puzzle.solutionMoves.length) { status.textContent = 'Solution shown.'; document.getElementById('pz-next').disabled = false; return; }
    const m = PZ.puzzle.solutionMoves[i];
    PZ.chess.move(toMoveObj(m));
    syncBoard(PZ.ground, PZ.chess, uciPair(m), PZ.side);
    i++; setTimeout(step, 400);
  };
  step();
}

function showHint() {
  const next = PZ.puzzle.solutionMoves[PZ.idx];
  if (!next) return;
  showArrow(PZ.ground, next, 'blue');
  setTimeout(() => PZ.ground.setAutoShapes([]), 1200);
}

function record(solved) {
  PZ.recorded = true;
  const srs = store.get('puzzles.srs', { themes: {}, puzzles: {} });
  recordAttempt(srs, PZ.puzzle, { solved });
  store.set('puzzles.srs', srs);
}

function nextPuzzle() {
  PZ.i++;
  if (PZ.i >= PZ.list.length) { drawHome(); return; }
  loadPuzzle();
}

// ---------------- weakness trend snapshot ----------------
function maybeSnapshot() {
  drawTrainingIfHome();
}
function drawTrainingIfHome() {
  if (document.getElementById('train-area')) drawTrainingSection();
}

function persistSnapshot() {
  if (!S._profile || !S.username) return;
  const analyses = currentAnalyses();
  const accs = analyses.map((a) => a.accuracy[a.userColor]).filter((x) => x != null);
  const avg = accs.length ? accs.reduce((s, x) => s + x, 0) / accs.length : null;
  const snap = weaknessSnapshot(S._profile, avg);
  const key = 'players.' + S.username + '.weaknessTrend';
  const trend = store.get(key, []);
  trend.push(snap);
  store.set(key, trend.slice(-30));
}
