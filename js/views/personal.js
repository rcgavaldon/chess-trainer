// views/personal.js — import games, review with per-move grades & explanations,
// weakness profile, and puzzle training (own blunders + themed Lichess puzzles).
import { Chess } from 'chess.js';
import { h, clear, fmtDate, pct } from '../dom.js';
import * as store from '../storage.js';
import * as cc from '../chesscom.js';
import { analyzeGame, buildWeaknessProfile, suggestedPuzzleThemes, weaknessSnapshot } from '../review.js';
import { computeInsights, comparePeers, improvementPlan, byTimeControl } from '../insights.js';
import { computeDimensions, dailyPlan, narratives, focusAreas, superAndWeak } from '../report.js';
import { playIntro } from '../intro.js';
import { blunderQuestions } from '../coachquestions.js';
import { recordSnapshot, progressDelta, getSnapshots, growthSvg } from '../progress.js';
import { overview30, thisWeek, priorWeek, byCategory } from '../reports.js';
import { bankGames, pauseBanking, resumeBanking, cancelBanking, isBanking } from '../banker.js';
import { tiltSignals, restAdvice, tiltColor } from '../tilt.js';
import { computeBadges, newlyEarned } from '../achievements.js';
import { LESSONS } from '../lessons.js';
import { renderImprove, renderByTimeControl, renderScorecard, renderTodayPlan, renderCleanReport, renderRatingHistory, renderSkills } from '../insightsview.js';
import { BENCHMARKS } from '../benchmarks.js';
import { commentMove, coachPlan } from '../llm.js';
import { coachEnabled } from '../coach.js';
import { fetchUscfHistory, eventUrl, playerUrl, uscfAvailable, validUscfId } from '../uscf.js';
import { mountChat } from '../chatcoach.js';
import { createBoard, syncBoard, legalDests, evalToWhitePct, evalText, showArrow } from '../board.js';
import { LABELS } from '../analysis.js';
import {
  buildBlunderPuzzle, puzzleFromLichessJson, lichessApi, checkMove, toMoveObj,
  recordAttempt, difficultyForTheme, loadThemeShard,
} from '../puzzles.js';
import { cloudEnabled, upsertSnapshot, fetchStudents } from '../cloud.js';
import { requestThemes } from './train.js';

// Map a weakness (focus-area key) to the puzzle themes that train it, so "Train this" opens
// puzzles of exactly that kind. Openings train via the Openings tab, not puzzles.
const FOCUS_THEMES = {
  tactics: ['fork', 'pin', 'skewer', 'hangingPiece', 'discoveredAttack', 'deflection'],
  endgame: ['endgame', 'rookEndgame', 'pawnEndgame', 'knightEndgame', 'bishopEndgame'],
  advantage: ['hangingPiece', 'fork', 'skewer', 'promotion'],
  resource: ['defensiveMove', 'hangingPiece', 'fork'],
  time: ['mateIn1', 'fork', 'hangingPiece', 'backRankMate'],
};
const focusThemesFor = (key) => FOCUS_THEMES[key] || ['fork', 'pin', 'hangingPiece'];
function trainFocus(f) {
  if (f.dest === 'openings') { CTX.navigate('openings'); return; }
  requestThemes(focusThemesFor(f.key));
  CTX.navigate('train');
}
function trainAllWeak(focus) {
  const weak = focus.filter((f) => f.dest !== 'openings' && (f.primary || f.level !== 'strong')).slice(0, 4);
  const themes = [...new Set(weak.flatMap((f) => focusThemesFor(f.key)))];
  requestThemes(themes.length ? themes : ['fork', 'pin', 'hangingPiece', 'endgame']);
  CTX.navigate('train');
}

const S = { username: '', timeClass: null, games: [], analyses: {} }; // analyses keyed by game.url; timeClass null = auto-pick primary
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
  drawHome();
  if (pendingImport) { pendingImport = null; S._autoScanned = false; doImport(); }
  else if (S.username && !S.games.length) { doImport(); } // auto-load on open
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
  host.append(...[
    h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'baseline' } },
      h('h1', {}, owner ? `${owner}'s coach` : 'Your coach'),
      S.games.length ? h('div', { class: 'hint tiny' }, `Last ${S.games.length} games · `, h('a', { href: 'javascript:void 0', onclick: () => reSync() }, 'refresh')) : null),
    store.get('profile.welcomeSeen') ? null : welcomeCard(),
    h('div', { id: 'report-area', class: 'section' }),
  ].filter(Boolean));
  const area = document.getElementById('report-area');
  if (!S.username) { area.append(usernamePrompt()); return; }
  if (S.games.length) drawReport();
  else area.append(h('div', { class: 'row' }, h('span', { class: 'spinner' }), ' Loading your last 50 games…'));
}

function reSync() { S.games = []; S._autoScanned = false; doImport(); }

// Tilt check on the student's own recent games — a gentle, real "take a break" nudge.
function tiltBanner(games) {
  const t = tiltSignals(games, { rating: games[0]?.userRating });
  const advice = restAdvice(t);
  if (!advice) return null;
  const col = tiltColor(t.level);
  return h('div', { class: 'card section', style: { borderColor: col, boxShadow: `0 0 0 1px ${col}33` } },
    h('div', { style: { fontWeight: 800, color: col, fontSize: '16px', marginBottom: '4px' } }, advice.title),
    h('div', { class: 'hint', style: { fontSize: '13px' } }, advice.text),
    t.signals.length ? h('div', { class: 'hint tiny', style: { marginTop: '6px' } }, 'Signals: ' + t.signals.join(' · ')) : null);
}

function welcomeCard() {
  const name = store.get('profile.ownerName', '') || 'coach';
  const admin = store.get('profile.role', '') === 'admin';
  const item = (icon, title, desc) => h('div', { style: { display: 'flex', gap: '10px', marginBottom: '9px' } },
    h('div', { style: { fontSize: '18px', lineHeight: '1.3' } }, icon),
    h('div', {}, h('b', {}, title), h('div', { class: 'hint tiny' }, desc)));
  const card = h('div', { class: 'card section', style: { borderColor: 'var(--accent)', boxShadow: '0 0 0 1px rgba(125,211,95,.2), var(--shadow-sm)' } },
    h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'flex-start' } },
      h('div', { style: { fontSize: '19px', fontWeight: 800 } }, `Welcome, ${name}! 👋`),
      h('button', { class: 'btn ghost small', onclick: () => { store.set('profile.welcomeSeen', true); card.remove(); } }, 'Got it')),
    h('div', { class: 'hint', style: { margin: '4px 0 14px' } }, admin ? 'Your AI chess coach — for your own game and for your players. Here\'s the lay of the land:' : 'Your AI chess coach. Here\'s what\'s inside:'),
    item('📊', 'Personal', 'Your report — strongest/weakest skills, what to work on, and trends. Auto-loads your last 50 games.'),
    item('♟', 'Openings', 'Explore any opening with real win-rate data, see what you face most, and review your own opening mistakes.'),
    item('🎯', 'Train', 'A daily puzzle set built for your weak spots, plus Puzzle Storm and focused drills.'),
    admin ? item('👥', 'Class — your players', 'Add students by Chess.com username (no logins needed), see each one\'s form and weaknesses, and open any of them in the full review.') : null,
    admin ? item('🏆', 'Tournament', 'Build an event from a roster and auto-generate pairings (Swiss / round-robin / balanced) with live standings.') : null,
    h('div', { class: 'hint tiny', style: { marginTop: '10px' } }, 'Tip: add your Anthropic API key in ⚙ Settings to unlock the AI chat coach on moves and puzzles.'));
  return card;
}

function usernamePrompt() {
  const inp = h('input', { type: 'text', placeholder: 'Your Chess.com username', style: { maxWidth: '260px' }, onkeydown: (e) => { if (e.key === 'Enter') go(); } });
  const go = () => { const u = inp.value.trim(); if (!u) return; S.username = u; store.set('profile.username', u); doImport(); };
  return h('div', { class: 'card' }, h('div', { style: { fontWeight: 600, marginBottom: '8px' } }, 'Enter your Chess.com username to begin'), h('div', { class: 'row' }, inp, h('button', { class: 'btn', onclick: go }, 'Go')));
}

function recordOf(games) { const r = { w: 0, l: 0, d: 0 }; for (const g of games) { if (g.userResult === 'win') r.w++; else if (g.userResult === 'loss') r.l++; else r.d++; } return r; }
function last10Delta(I) {
  const accs = (I.accTrend || []).map((t) => t.acc).filter((x) => x != null);
  if (accs.length < 6) return 0;
  const recent = accs.slice(-10);
  const ra = recent.reduce((a, b) => a + b, 0) / recent.length;
  const oa = accs.reduce((a, b) => a + b, 0) / accs.length;
  return ra - oa;
}

const TC_LABEL = { rapid: 'Rapid', blitz: 'Blitz', bullet: 'Bullet', daily: 'Daily', all: 'All' };

function primaryTC(games) {
  const c = {}; for (const g of games) c[g.timeClass] = (c[g.timeClass] || 0) + 1;
  const e = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
  return e ? e[0] : 'all';
}

function scopeAnalyses(myGames) {
  const urls = new Set(myGames.map((g) => g.url));
  return currentAnalyses().filter((a) => urls.has(a.game?.url));
}

// The report/assessment input: the most RECENT analyzed games, capped. Background banking keeps
// analyzing older games after the report first renders — computing over "everything analyzed so
// far" made the weakness assessment change on every load as the set grew. A recency window
// converges once the newest N are banked and then only moves when NEW games are played.
function stableAnalyses(analyses, cap = 30) {
  return analyses.slice().sort((a, b) => (b.game?.endTime || 0) - (a.game?.endTime || 0)).slice(0, cap);
}

function tcSwitcher(allMine, scope) {
  const counts = {}; for (const g of allMine) counts[g.timeClass] = (counts[g.timeClass] || 0) + 1;
  const tcs = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const tabs = h('div', { class: 'tc-tabs' });
  for (const t of [...tcs, 'all']) {
    tabs.append(h('button', { class: 'tc-tab' + (scope === t ? ' active' : ''), onclick: () => { S.timeClass = t; drawReport(); } },
      t === 'all' ? 'All' : (TC_LABEL[t] || t),
      h('span', { class: 'tc-count' }, String(t === 'all' ? allMine.length : counts[t]))));
  }
  return h('div', {}, tabs);
}

async function drawReport() {
  const area = document.getElementById('report-area');
  clear(area);
  const u = S.username.toLowerCase();
  const allMine = S.games.filter((g) => (g.username || '').toLowerCase() === u);
  const scope = S.timeClass || primaryTC(allMine);
  S.timeClass = scope;
  const scopedAll = scope === 'all' ? allMine : allMine.filter((g) => g.timeClass === scope);
  const myGames = scopedAll.slice(0, 100); // the last ~100 games in THIS category
  const scopeName = TC_LABEL[scope] || scope;

  clear(area);
  area.append(tcSwitcher(allMine, scope));
  const tilt = tiltBanner(allMine);
  if (tilt) area.append(tilt);

  const record = recordOf(myGames);
  const last10rec = recordOf(myGames.slice(0, 10));
  const eloPoints = myGames.filter((g) => g.userRating != null).slice().reverse().map((g) => ({ rating: g.userRating, date: g.dateUTC }));
  const analyses = stableAnalyses(scopeAnalyses(myGames));

  if (analyses.length) {
    const I = computeInsights(analyses, S.username);
    const dims = computeDimensions(I);
    const accDelta = last10Delta(I);
    const today = dailyPlan(dims, I, I.openings);
    const narr = narratives(dims, accDelta);
    persistFocus(analyses, today);
    recordSnapshot(S.username, { rating: myGames[0]?.userRating || I.ratingAvg, acc: I.accAvg, dims });
    publishAssessment(myGames[0]?.userRating || I.ratingAvg, I.accAvg, dims); // share the REAL dims so the coach's leaderboard digest matches this report
    startBanking(allMine); // bank the rest of the games deeply, in the background
    // ONE streamlined, kid-friendly report for everyone: a poppy hero (rating + trend + your #1
    // fix), the game plan, skills, where-you-rank, your games — with all the deep analytics tucked
    // into a "See everything" drawer. Coaches get the AI note + peer breakdown inside that drawer.
    renderReport(area, {
      student: store.get('profile.role') === 'student',
      record, last10: last10rec, dims, I, myGames, eloPoints, scope, scopeName,
      accDelta, today, narr, focus: focusAreas(dims), allMine, analyses,
    });
    // First-run reveal: the 60-second "your chess, decoded" intro, ONCE. Guard against a re-render
    // (banking / scope change re-calls drawReport before the intro finishes) replaying it: mark it
    // seen immediately, plus a session flag so it can't fire twice on the same load.
    if (!store.get('profile.introSeen') && !S._introShown) {
      S._introShown = true;
      store.set('profile.introSeen', true);
      const { superpower, weakness } = superAndWeak(dims);
      const fa = focusAreas(dims);
      const topFocus = fa.find((f) => f.primary) || fa[0];
      playIntro({
        name: store.get('profile.ownerName', ''),
        games: analyses.length, rating: myGames[0]?.userRating || I.ratingAvg,
        recordStr: `${record.w}-${record.l}-${record.d}`,
        superName: superpower && superpower.name, superBlurb: 'Your strongest area — lean on it while you shore up the rest.',
        weakName: weakness && weakness.name, weakWhy: topFocus && topFocus.why,
        focusLabel: topFocus && topFocus.label, planGame: today.game,
      }, () => {});
    }
  } else if (myGames.length) {
    // INSTANT value (no analysis needed) so a first-timer sees something in <2s, then the
    // coaching insights build in the background instead of blocking on a 90s spinner.
    area.append(nextStepsCard(), reportCard(allMine));
    renderBadges(area, badgeData(myGames, eloPoints));
    area.append(instantSnapshot(record, last10rec, myGames[0]?.userRating, scope === 'all' ? null : scopeName));
    renderRatingHistory(area, eloPoints, scope === 'all' ? null : scopeName);
    const insightArea = h('div', { id: 'insight-area', class: 'section' });
    area.append(insightArea, gamesDetails(), breakdownDetails([], myGames));
    // Auto-analyze this category in the background (no click). Each game is cached to
    // IndexedDB by analyzeGame, so future logins load it live without re-analyzing.
    S._scanned = S._scanned || new Set();
    if (!S._scanned.has(scope)) {
      S._scanned.add(scope);
      await deepScanInto(insightArea, myGames, Math.min(24, myGames.length));
      if (document.getElementById('insight-area')) drawReport(); // analyses ready → full report
    } else {
      insightArea.append(h('div', { class: 'card' }, h('div', { class: 'hint' }, 'Building your strengths & weaknesses in the background — it fills in as analysis completes and is saved for next time.')));
    }
  } else {
    area.append(h('div', { class: 'hint section' }, 'No games in this time control yet.'));
  }
}

// Next steps: review your games (the free game review) + where to actually train (Aimchess)
// + study your openings. We're the analysis + review layer; training happens elsewhere.
function nextStepsCard() {
  return h('div', { class: 'card section', style: { borderColor: 'var(--accent)', boxShadow: '0 0 0 1px rgba(125,211,95,.22)' } },
    h('div', { style: { fontWeight: 800, fontSize: '17px', marginBottom: '10px' } }, '📋 Your next steps'),
    h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' } },
      h('div', { style: { minWidth: 0 } }, h('b', {}, '🎬 Review your games'), h('div', { class: 'hint tiny' }, 'Play back what you actually played and see exactly where it turned.')),
      h('button', { class: 'btn', onclick: () => { const g = document.getElementById('games-section'); if (g) g.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, 'Review →')),
    h('div', { class: 'hint tiny', style: { fontWeight: 600, margin: '12px 0 6px', borderTop: '1px solid var(--line)', paddingTop: '10px' } }, 'To actually drill your weak spots, we point you to the best tools:'),
    h('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap' } },
      h('a', { class: 'btn ghost small', href: 'https://aimchess.com', target: '_blank', rel: 'noopener' }, '↗ Train tactics on Aimchess'),
      h('button', { class: 'btn ghost small', onclick: () => CTX.navigate('openings') }, '📖 Study your openings')),
    h('div', { class: 'hint tiny', style: { marginTop: '10px' } }, '♟ Coach\'s rule: ~3 focused games a day, and if you lose 2 in a row, call it a day — tilt costs more rating than any opening.'));
}

// Auto-refreshing report: a first-time last-30-days overview + a rolling weekly summary,
// straight from the imported games (regenerated every visit — client-side "auto-refresh").
function reportCard(games) {
  const o = overview30(games), w = thisWeek(games), pw = priorWeek(games);
  const cats = byCategory(games).slice(0, 4).map(([tc, n]) => `${n} ${tc}`).join(', ');
  const trend = (w.games && pw.games) ? w.winPct - pw.winPct : null;
  const rd = (s) => (s.ratingDelta != null ? ` · ${s.primaryTC} ${s.ratingDelta >= 0 ? '+' : ''}${s.ratingDelta}` : '');
  return h('div', { class: 'card section' },
    h('h2', {}, '📬 Your report'),
    h('div', { class: 'hint tiny', style: { marginBottom: '10px' } }, `Auto-updated from ${games.length} imported games${cats ? ` (${cats})` : ''}. Refreshes every time you open the app.`),
    h('div', { style: { marginBottom: '10px' } }, h('b', {}, '📅 Last 30 days'),
      h('div', { class: 'hint tiny' }, o.games ? `${o.games} games · ${o.w}-${o.l}-${o.d} (${o.winPct}%)${rd(o)}` : 'No games in the last 30 days.')),
    h('div', {}, h('b', {}, '🗓️ This week'),
      h('div', { class: 'hint tiny' }, w.games ? `${w.games} games · ${w.w}-${w.l}-${w.d} (${w.winPct}%)${rd(w)}${trend != null ? ` · ${trend >= 0 ? 'up' : 'down'} ${Math.abs(trend)}% vs last week` : ''}` : 'No games yet this week.')),
    h('div', { class: 'hint tiny', id: 'bank-status', style: { marginTop: '8px', color: 'var(--accent-2)' } }, isBanking() ? '🔬 Banking deeper analysis in the background…' : ''));
}

// Background banking: after the report shows, quietly analyze the rest of the player's games
// (up to 100) and cache each, so next login is instant and the weakness data keeps deepening.
async function startBanking(games) {
  if (S._bankingStarted) return;
  S._bankingStarted = true;
  let engine;
  try { engine = await CTX.ensureEngine(); } catch { return; }
  await bankGames(games, engine, {
    cap: 100, depth: 12,
    onProgress: (p) => {
      const el = document.getElementById('bank-status');
      if (el) el.textContent = p.done
        ? `✓ Banked ${p.banked} games — saved on this device, so it loads instantly next time.`
        : `🔬 Banking deeper analysis in the background: ${p.banked}/${p.total} games (you can keep using the app).`;
      // when finished, quietly fold the deeper data in — only if still on the home report
      if (p.done && document.getElementById('report-area') && !document.getElementById('board')) {
        preloadCached().then(() => { if (document.getElementById('report-area') && !document.getElementById('board')) drawReport(); });
      }
    },
  });
}

const DIM_NAME = { tactics: 'Tactics', openings: 'Openings', endgame: 'Endgame', advantage: 'Converting wins', resource: 'Defending', time: 'Clock management', consistency: 'Consistency' };
const dimName = (k) => DIM_NAME[k] || k;

// Growth over time — the coach's real question: "is this player getting better?".
function progressCard(username) {
  const snaps = getSnapshots(username);
  if (snaps.length < 2) {
    return h('div', { class: 'card section' }, h('h2', {}, '📈 Progress over time'),
      h('div', { class: 'hint tiny' }, 'First snapshot saved today. This chart fills in as the player comes back and gets analyzed again — you\'ll see rating, accuracy, and each skill trend over the weeks.'));
  }
  const d = progressDelta(username, 30);
  const summary = [d.ratingDelta != null ? `rating ${d.ratingDelta >= 0 ? '+' : ''}${d.ratingDelta}` : null, d.accDelta != null ? `accuracy ${d.accDelta >= 0 ? '+' : ''}${d.accDelta}%` : null].filter(Boolean).join(' · ');
  const gain = d.mostImproved && d.mostImproved.delta > 0 ? ` Biggest gain: ${dimName(d.mostImproved.key)} +${d.mostImproved.delta}.` : '';
  const chart = growthSvg(username, 'acc');
  const deltaRows = Object.entries(d.dimDeltas || {}).sort((a, b) => b[1] - a[1]).filter(([, v]) => v !== 0);
  return h('div', { class: 'card section' }, h('h2', {}, '📈 Progress over time'),
    h('div', { class: 'hint tiny', style: { marginBottom: '8px' } }, `Across the last ${d.days} day${d.days > 1 ? 's' : ''} of tracked sessions${summary ? ': ' + summary : ''}.${gain}`),
    chart ? h('div', { html: chart }) : null,
    chart ? h('div', { class: 'hint tiny', style: { margin: '4px 0 8px' } }, 'Accuracy across analyzed sessions.') : null,
    deltaRows.length ? h('div', {}, ...deltaRows.map(([k, v]) => h('div', { class: 'row', style: { justifyContent: 'space-between', fontSize: '13px', padding: '3px 0' } },
      h('span', {}, dimName(k)), h('b', { style: { color: v >= 0 ? 'var(--good)' : 'var(--bad)', fontFamily: 'var(--mono)' } }, (v >= 0 ? '+' : '') + v)))) : null);
}

// STUDENT view: the gist + 3 clear, actionable steps (train elsewhere), review, progress —
// none of the deep analytics the coach sees.
// Publish this player's engine-computed skill dimensions to the shared backend, so a coach
// clicking them on the leaderboard sees the SAME assessment this report shows — not a second,
// contradictory read from cheap signals.
function publishAssessment(rating, acc, dims) {
  if (!cloudEnabled() || !S.username) return;
  const dimObj = {};
  for (const x of (dims || [])) if (x && x.key != null) dimObj[x.key] = x.score;
  const d = new Date().toISOString().slice(0, 10);
  upsertSnapshot({ username: S.username.toLowerCase(), d, rating: Math.round(rating) || null, acc: Math.round(acc) || null, dims: dimObj }).catch(() => { /* offline — local snapshot still saved */ });
}

// "Where you rank" — a poppy leaderboard peek: the podium (top 3 with medals) plus a little
// window around YOU, with your row lit up. Shown to everyone (kids love seeing their rank), and
// self-removes when there's nobody to compare against. The full class list lives in Students.
function leaderboardPeek() {
  if (!cloudEnabled()) return null;
  const me = (S.username || '').toLowerCase();
  const wrap = h('div', { class: 'card section', id: 'lb-peek' }, h('h2', {}, '🏆 Where you rank'), h('div', { class: 'row' }, h('span', { class: 'spinner' }), ' Loading…'));
  const medal = ['🥇', '🥈', '🥉'];
  const rowEl = (x, i) => {
    const mine = (x.username || '').toLowerCase() === me;
    return h('div', { class: 'lbp-row' + (mine ? ' me' : '') },
      h('div', { class: 'lbp-rank' }, i < 3 ? medal[i] : '#' + (i + 1)),
      h('div', { class: 'lbp-name' }, x.name || x.username || 'Player', mine ? h('span', { class: 'lbp-you' }, 'you') : null),
      h('div', { class: 'lbp-rt' }, x.ladder_rating));
  };
  fetchStudents().then((rows) => {
    if (!document.getElementById('lb-peek')) return;
    const ranked = (rows || []).filter((x) => x.ladder_rating != null).sort((a, b) => b.ladder_rating - a.ladder_rating);
    if (ranked.length < 2) { wrap.remove(); return; } // nothing motivating to show for a lone player
    const myIdx = ranked.findIndex((x) => (x.username || '').toLowerCase() === me);
    // podium (0,1,2) + a window around you (you-1, you, you+1)
    const want = [0, 1, 2];
    if (myIdx >= 0) [myIdx - 1, myIdx, myIdx + 1].forEach((i) => want.push(i));
    const idxs = [...new Set(want)].filter((i) => i >= 0 && i < ranked.length).sort((a, b) => a - b);
    const body = h('div', { class: 'lbp' });
    let prev = -1;
    for (const i of idxs) { if (prev >= 0 && i > prev + 1) body.append(h('div', { class: 'lbp-gap' }, '···')); body.append(rowEl(ranked[i], i)); prev = i; }
    clear(wrap).append(
      h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'baseline' } },
        h('h2', { style: { margin: 0 } }, '🏆 Where you rank'),
        myIdx >= 0 ? h('span', { class: 'pill', style: { background: 'rgba(125,211,95,.18)', color: 'var(--good)' } }, `#${myIdx + 1} of ${ranked.length}`) : null),
      body);
  }).catch(() => { const w = document.getElementById('lb-peek'); if (w) w.remove(); });
  return wrap;
}

// ---------------- the streamlined report (one layout for kids AND coaches) ----------------
// Meat first: a poppy hero (rating + trend + your #1 fix), your game plan, skills, where you
// rank, your games, your badges. Everything deep (peer breakdown, by-time-control, progress
// history, AI coach's note) lives one tap away in the "See everything" drawer.
function renderReport(area, R) {
  area.append(heroCard(R));
  // US Chess tournament results, up top and prominent (self-removes when the player has no ID).
  const uc = uscfCard(null, S.username); if (uc) area.append(uc);
  area.append(focusPlanCard(R));
  renderSkills(area, R.dims);
  const lb = leaderboardPeek(); if (lb) area.append(lb);
  area.append(gamesDetails());
  renderBadges(area, badgeData(R.myGames, R.eloPoints));
  area.append(everythingDrawer(R));
}

// Rating "now" + how it's moving, from the chronological ELO points (oldest → newest).
function ratingTrend(eloPoints) {
  const rs = (eloPoints || []).filter((p) => p.rating != null).map((p) => p.rating);
  if (!rs.length) return { cur: null, delta: 0, word: '' };
  const cur = rs[rs.length - 1];
  const win = rs.slice(-Math.min(20, rs.length));
  const delta = cur - win[0];
  const word = delta >= 8 ? 'climbing' : delta >= 2 ? 'trending up' : delta <= -8 ? 'sliding' : delta <= -2 ? 'dipping' : 'holding steady';
  return { cur, delta, word };
}

// A tiny sparkline of the rating for the hero — pure flourish, no axes.
function miniSpark(eloPoints) {
  const data = (eloPoints || []).filter((p) => p.rating != null).map((p) => p.rating);
  if (data.length < 3) return null;
  const W = 300, H = 44, lo = Math.min(...data), hi = Math.max(...data), span = (hi - lo) || 1;
  const x = (i) => (i * W) / (data.length - 1), y = (v) => H - 3 - ((v - lo) / span) * (H - 8);
  const pts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" width="100%" height="44" style="display:block">
    <polygon points="0,${H} ${pts} ${W},${H}" fill="var(--accent)" fill-opacity=".12"/>
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linejoin="round"/></svg>`;
}

const winPctOf = (r) => { const g = r.w + r.l + r.d; return g ? Math.round(((r.w + r.d * 0.5) / g) * 100) : 0; };

// THE hero — the meat, at a glance: big rating + trend, a streak flame, record/last-10, and your
// single most important fix with a glowing Train button.
function heroCard(R) {
  const rating = R.myGames[0]?.userRating ?? R.I.ratingAvg ?? null;
  const t = ratingTrend(R.eloPoints);
  const dc = t.delta > 0 ? 'var(--good)' : t.delta < 0 ? 'var(--bad)' : 'var(--muted)';
  const arrow = t.delta > 0 ? '▲' : t.delta < 0 ? '▼' : '▬';
  let streak = 0; for (const g of R.myGames) { if (g.userResult === 'win') streak++; else break; }
  const spark = miniSpark(R.eloPoints);
  const top = R.focus.find((f) => f.primary) || R.focus[0];
  const scopeLabel = R.scope === 'all' ? 'Overall' : (R.scopeName || '');
  const chip = (k, v, sub) => h('div', { class: 'hero-chip' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), sub != null ? h('div', { class: 'hint tiny' }, sub) : null);
  return h('div', { class: 'card section hero' },
    h('div', { class: 'hero-glow' }),
    h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative' } },
      h('div', { class: 'hero-eyebrow' }, `${scopeLabel} rating`.trim()),
      streak >= 2 ? h('div', { class: 'hero-flame' }, `🔥 ${streak} win streak`) : null),
    h('div', { class: 'row', style: { alignItems: 'baseline', gap: '12px', marginTop: '2px', position: 'relative' } },
      h('div', { class: 'hero-rating' }, rating ?? '—'),
      t.delta ? h('div', { class: 'hero-delta', style: { color: dc } }, `${arrow} ${t.delta >= 0 ? '+' : ''}${t.delta}`) : null),
    t.word ? h('div', { class: 'hint tiny', style: { color: dc, fontWeight: 700, marginTop: '1px', position: 'relative' } }, `${t.word} lately`) : null,
    spark ? h('div', { html: spark, style: { margin: '10px 0 2px' } }) : null,
    h('div', { class: 'hero-chips' },
      chip('Record', `${R.record.w}-${R.record.l}-${R.record.d}`, `${winPctOf(R.record)}% win`),
      chip('Last 10', `${R.last10.w}-${R.last10.l}-${R.last10.d}`, `${winPctOf(R.last10)}% score`)),
    top ? h('div', { class: 'hero-fix' },
      h('div', { class: 'hero-eyebrow', style: { color: 'var(--accent)' } }, '🎯 Your #1 fix'),
      h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginTop: '6px' } },
        h('div', { style: { minWidth: 0 } }, h('b', {}, top.label), h('div', { class: 'hint tiny' }, focusWhy(top, R.I))),
        h('button', { class: 'btn hero-train', onclick: () => trainFocus(top) }, top.dest === 'openings' ? '📖 Study →' : '🎯 Train this →'))) : null);
}

// Sharpen an opening focus with the actual weak line, when we have it.
function focusWhy(f, I) {
  if (f.dest === 'openings' && I && I.openings) {
    const weak = I.openings.filter((o) => o.games >= 2 && o.acc != null && o.name !== 'Unknown').sort((a, b) => a.scorePct - b.scorePct)[0];
    if (weak) return `You score low in the ${weak.name} (${weak.scorePct}%). Learn its plans and you'll win more of those.`;
  }
  return f.why;
}

// "Your game plan" — the top few things to work on, each with a Train button, plus a compact
// "what's going well" so it never feels like all bad news.
function focusPlanCard(R) {
  const focus = R.focus || [];
  const goingWell = (R.narr && R.narr.goingWell) || [];
  const row = (f, i) => {
    const color = f.level === 'weak' ? 'var(--bad)' : f.level === 'ok' ? 'var(--warn)' : 'var(--good)';
    return h('div', { class: 'focus-row' },
      h('div', { class: 'focus-icon' }, f.icon),
      h('div', { style: { minWidth: 0 } },
        h('b', {}, `${i + 1}. ${f.label}`),
        h('div', { class: 'track', style: { margin: '6px 0' } }, h('div', { class: 'fill', style: { width: (f.score || 0) + '%', background: color } })),
        h('div', { class: 'hint', style: { fontSize: '13px' } }, focusWhy(f, R.I))),
      h('button', { class: 'btn small' + (i === 0 ? '' : ' ghost'), style: { alignSelf: 'center', whiteSpace: 'nowrap' }, onclick: () => trainFocus(f) }, f.dest === 'openings' ? 'Study →' : 'Train →'));
  };
  return h('div', { class: 'card section', style: { borderColor: 'var(--accent)', boxShadow: '0 0 0 1px rgba(125,211,95,.18)' } },
    h('h2', {}, '🎯 Your game plan'),
    h('div', { class: 'hint tiny', style: { marginTop: '-6px', marginBottom: '8px' } }, 'Your biggest chances to improve, in order. Start at the top — a little each day beats a lot once in a while.'),
    ...focus.slice(0, 3).map(row),
    h('div', { class: 'row', style: { marginTop: '12px', gap: '10px', flexWrap: 'wrap' } },
      h('button', { class: 'btn', onclick: () => trainAllWeak(focus) }, '🎯 Train all in one session →'),
      h('a', { class: 'btn ghost small', href: 'https://aimchess.com', target: '_blank', rel: 'noopener' }, '↗ More drills')),
    goingWell.length ? h('div', { style: { marginTop: '14px', borderTop: '1px solid var(--line)', paddingTop: '12px' } },
      h('div', { class: 'hint tiny', style: { fontWeight: 700, color: 'var(--good)', marginBottom: '6px' } }, '✅ What\'s going well'),
      ...goingWell.slice(0, 2).map((it) => h('div', { class: 'hint', style: { fontSize: '13px', marginBottom: '3px' } }, h('b', { style: { color: 'var(--text)' } }, it.title + ' '), it.detail || ''))) : null);
}

// "See everything" — the optional deep dive. Rendered lazily on first open so it costs nothing
// until a coach (or a curious kid) actually wants all the numbers.
function everythingDrawer(R) {
  const d = h('details', { class: 'more' }, h('summary', {}, '📂 See everything — all your numbers'));
  const body = h('div', {});
  d.append(body);
  d.addEventListener('toggle', () => {
    if (!d.open || d._rendered) return;
    d._rendered = true;
    if (R.eloPoints && R.eloPoints.length >= 3) renderRatingHistory(body, R.eloPoints, R.scope === 'all' ? null : R.scopeName);
    body.append(progressCard(S.username));
    body.append(reportCard(R.allMine));
    renderByTimeControl(body, byTimeControl(R.myGames, R.analyses));
    if (R.analyses.length) {
      const I = computeInsights(R.analyses, S.username);
      const rating = I.ratingAvg;
      const peer = BENCHMARKS && rating ? comparePeers(I, rating, BENCHMARKS) : null;
      renderImprove(body, { insights: I, peer, plan: improvementPlan(I, peer), byTC: null, onTrain: () => CTX.navigate('train') });
    }
    if (!R.student) maybeCoachNote(body, R);
  });
  return d;
}

// Optional Claude-written coach's note (owner/coach only) — inside the drawer, on demand.
function maybeCoachNote(host, R) {
  if (!coachEnabled()) return;
  const I = R.I;
  const peer = BENCHMARKS && I.ratingAvg ? comparePeers(I, I.ratingAvg, BENCHMARKS) : null;
  const plan = improvementPlan(I, peer);
  if (!plan.length) return;
  const note = h('div', { class: 'why', style: { color: 'var(--accent-2)', marginTop: '8px' } });
  const btn = h('button', { class: 'btn ghost small', onclick: async () => {
    btn.disabled = true; btn.textContent = 'Writing…';
    try { const txt = await coachPlan({ username: S.username, insights: I, actions: plan }); note.textContent = '💬 ' + (txt || ''); btn.remove(); }
    catch (e) { note.textContent = '⚠ ' + e.message; btn.disabled = false; btn.textContent = '💬 Get a coach\'s note'; }
  } }, '💬 Get a coach\'s note');
  host.append(h('div', { class: 'card section' }, h('h2', {}, 'Coach\'s note'), btn, note));
}

function badgeData(myGames, eloPoints) {
  const streak = store.get('train.streak', { count: 0 }).count || 0;
  const puzzles = Object.keys(store.get('puzzles.srs', { puzzles: {} }).puzzles || {}).length;
  const lessons = Object.keys(store.get('lessons.done', {})).length;
  let winStreak = 0;
  for (const g of myGames) { if (g.userResult === 'win') winStreak++; else break; }
  let ratingGain = 0;
  if (eloPoints.length >= 2) ratingGain = eloPoints[eloPoints.length - 1].rating - eloPoints[Math.max(0, eloPoints.length - 20)].rating;
  return { streak, puzzles, lessons, lessonsTotal: LESSONS.length, winStreak, ratingGain };
}

function renderBadges(area, data) {
  const badges = computeBadges(data);
  const earned = badges.filter((b) => b.earned);
  const seen = store.get('achievements.seen', []);
  const fresh = newlyEarned(badges, seen);
  if (fresh.length) {
    store.set('achievements.seen', [...seen, ...fresh.map((b) => b.id)]);
    area.append(h('div', { class: 'card section', style: { borderColor: 'var(--accent)', background: 'rgba(125,211,95,.06)' } },
      h('div', { style: { fontWeight: 800, fontSize: '16px', color: 'var(--accent-2)' } }, `🎉 New achievement${fresh.length > 1 ? 's' : ''}!`),
      h('div', { class: 'row', style: { gap: '18px', marginTop: '10px', flexWrap: 'wrap' } }, ...fresh.map((b) =>
        h('div', { style: { textAlign: 'center' } }, h('div', { style: { fontSize: '32px' } }, b.icon), h('div', { style: { fontWeight: 700, fontSize: '13px' } }, b.name), h('div', { class: 'hint tiny' }, b.desc))))));
  }
  if (earned.length) {
    area.append(h('div', { class: 'card section' },
      h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'baseline' } }, h('b', {}, '🏅 Your badges'), h('span', { class: 'hint tiny' }, `${earned.length} of ${badges.length}`)),
      h('div', { class: 'row', style: { gap: '18px', marginTop: '10px', flexWrap: 'wrap' } }, ...earned.map((b) =>
        h('div', { title: b.desc, style: { textAlign: 'center', minWidth: '58px' } }, h('div', { style: { fontSize: '26px' } }, b.icon), h('div', { class: 'hint tiny', style: { fontWeight: 700 } }, b.name))))));
  }
}

function instantSnapshot(record, last10, rating, scopeName) {
  const winPct = (r) => { const g = r.w + r.l + r.d; return g ? Math.round(((r.w + r.d * 0.5) / g) * 100) : 0; };
  const snap = (k, v, sub) => h('div', { class: 'snap' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), sub != null ? h('div', { class: 'sub' }, sub) : null);
  const n = record.w + record.l + record.d;
  return h('div', { class: 'card section snapshot' },
    snap('Rating', rating ?? '—', scopeName),
    snap('Record', `${record.w}-${record.l}-${record.d}`, `${winPct(record)}% over ${n}`),
    snap('Last 10', `${last10.w}-${last10.l}-${last10.d}`, `${winPct(last10)}% score`));
}

async function deepScanInto(area, games, n) {
  const targets = games.slice(0, n);
  const bar = h('div', { class: 'bar' });
  const msg = h('span', {}, 'Analyzing your games…');
  clear(area).append(h('div', { class: 'card' },
    h('div', { class: 'row' }, h('span', { class: 'spinner' }), msg),
    h('div', { class: 'hint tiny', style: { marginTop: '4px' } }, 'First-time setup — building your report from your games. It\'s saved, so next time is instant.'),
    h('div', { class: 'progress' }, bar)));
  const engine = await CTX.ensureEngine();
  const d = depth();
  let done = 0;
  for (const g of targets) {
    g.username = S.username;
    if (!S.analyses[g.url]) {
      msg.textContent = `Analyzing game ${done + 1} of ${targets.length}…`;
      try { S.analyses[g.url] = await analyzeGame(g, engine, { depth: d, multipv: 2, onProgress: (p) => { bar.style.width = ((done + p.done / p.total) / targets.length) * 100 + '%'; } }); } catch {}
    }
    done++;
    bar.style.width = (done / targets.length) * 100 + '%';
  }
}

function persistFocus(analyses, today) {
  const profile = buildWeaknessProfile(analyses, analyses[0]?.userColor);
  store.set('train.focus', { themes: suggestedPuzzleThemes(profile), blunders: profile.blunders.slice(0, 8).map((b) => ({ fen: b.fen, theme: b.theme, bestUci: b.bestUci, san: b.san })), ts: Date.now() });
  store.set('train.plan', { game: today.game, study: today.study, headline: today.headline, rest: today.rest, focus: today.focus?.name });
  store.set('train.questions', blunderQuestions(analyses, 12)); // "from your own games" drill
}

function gamesDetails() {
  return h('div', { id: 'games-section', class: 'card section' },
    h('h2', {}, '🎬 Review your games'),
    h('div', { class: 'hint tiny', style: { marginTop: '-4px', marginBottom: '10px' } }, 'Tap a game to replay it move by move and see exactly where it turned.'),
    gameListEl());
}

function breakdownDetails(analyses, myGames) {
  const d = h('details', { class: 'more' }, h('summary', {}, 'Full breakdown — all the numbers'));
  const body = h('div', {});
  d.append(body);
  d.addEventListener('toggle', () => {
    if (!d.open || d._rendered) return;
    d._rendered = true;
    renderByTimeControl(body, byTimeControl(myGames, analyses));
    if (analyses.length) {
      const I = computeInsights(analyses, S.username);
      const rating = I.ratingAvg;
      const peer = BENCHMARKS && rating ? comparePeers(I, rating, BENCHMARKS) : null;
      renderImprove(body, { insights: I, peer, plan: improvementPlan(I, peer), byTC: null, onTrain: () => CTX.navigate('train') });
    }
  });
  return d;
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
  const analyses = stableAnalyses(currentAnalyses()); // same stable window as the main report
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

  // optional Claude-written coach's note (via the shared proxy, or the user's own key)
  if (coachEnabled() && plan.length) {
    const note = h('div', { class: 'why', style: { color: 'var(--accent-2)', marginTop: '8px' } });
    const btn = h('button', { class: 'btn ghost small', onclick: async () => {
      btn.disabled = true; btn.textContent = 'Writing…';
      try { const txt = await coachPlan({ username: S.username, insights: I, actions: plan }); note.textContent = '💬 ' + (txt || ''); btn.remove(); }
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
  const username = (S.username || '').trim();
  if (!username) return;
  cancelBanking(); S._bankingStarted = false; S._scanned = null; // new player/refresh — reset background work
  // Only persist the DEVICE OWNER's own identity. A coach opening a student's "Full report" loads
  // that student into S.username — writing it to profile.username here corrupted the coach's account.
  const owner = String(store.get('profile.username', '') || '').trim();
  if (!owner || username.toLowerCase() === owner.toLowerCase()) store.set('profile.username', username);
  const area = document.getElementById('report-area');
  if (area) clear(area).append(h('div', { class: 'row' }, h('span', { class: 'spinner' }), ' Loading your games…'));
  try {
    const games = await cc.fetchRecentGames(username, { months: 18, timeClass: 'all', limit: 320 });
    games.forEach((g) => (g.username = username));
    S.games = games;
    S.timeClass = null; // re-pick the primary time control for this player
    if (games.length) { await preloadCached(); drawHome(); }
    else if (area) clear(area).append(h('div', { class: 'empty' }, `No games found for “${username}”.`));
  } catch (e) {
    if (area) clear(area).append(h('div', { class: 'empty' }, 'Could not load games. ', h('span', { class: 'tiny' }, e.message)));
  }
}

function gameListEl() {
  const wrap = h('div', {});
  const list = h('div', { class: 'game-list reviews' }); // .reviews scopes the mobile 4-col layout
  const _games = S.games.slice(0, 25);
  _games.forEach((g, i) => {
    const a = S.analyses[g.url];
    const ccAcc = g.accuracies && g.accuracies[g.userColor] != null ? Math.round(g.accuracies[g.userColor]) : null;
    const acc = a ? a.accuracy[g.userColor] : ccAcc;
    list.append(h('div', { class: 'game-row' + (i >= 8 ? ' gr-hidden' : ''), onclick: () => openReview(g) },
      h('div', { class: 'res ' + g.userResult }, g.userResult === 'win' ? 'Win' : g.userResult === 'loss' ? 'Loss' : 'Draw'),
      h('div', {},
        h('div', { class: 'opp' }, 'vs ', g.opponent),
        h('div', { class: 'meta' }, `${g.userColor} · ${g.userRating} → ${g.oppRating} · ${fmtDate(g.dateUTC)}`)),
      h('div', { class: 'meta' }, g.timeClass),
      h('div', {}, acc != null ? h('span', { class: 'acc-badge', style: { color: accColor(acc) } }, pct(acc) + ' acc') : h('span', { class: 'hint tiny' }, 'not analyzed')),
      h('button', { class: 'btn small ghost', onclick: (e) => { e.stopPropagation(); openReview(g); } }, a ? 'Review' : 'Analyze'),
    ));
  });
  wrap.append(list);
  if (_games.length > 8) {
    const more = h('button', { class: 'btn ghost small', style: { marginTop: '10px' }, onclick: () => { list.querySelectorAll('.gr-hidden').forEach((r) => r.classList.remove('gr-hidden')); more.remove(); } }, `Show all ${_games.length} games →`);
    wrap.append(more);
  }
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
  pauseBanking(); // this review jumps the engine queue ahead of background banking
  try {
    let analysis = S.analyses[game.url];
    if (!analysis) { // already banked to the on-device cache? use it — instant, no re-analysis
      try { const c = await store.cacheGet(game.url, 0); if (c && c.plies) analysis = { ...(c.summary || {}), plies: c.plies, cached: true, game }; } catch { /* ignore */ }
      if (analysis) S.analyses[game.url] = analysis;
    }
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
  } finally {
    resumeBanking(); // review loaded — let background banking continue
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

  // Prefer Chess.com's own accuracy (the number students recognize) when the game was reviewed;
  // fall back to our engine's. Our move-by-move grades add the detail Chess.com's free tier limits.
  const cc = game.accuracies;
  const useCC = cc && cc.white != null && cc.black != null;
  const accW = useCC ? Math.round(cc.white) : analysis.accuracy.white;
  const accB = useCC ? Math.round(cc.black) : analysis.accuracy.black;
  const accBar = h('div', { class: 'accbar card', style: { padding: '12px 16px' } },
    accSide('White', accW, estRatingFromAcc(accW)), accSide('Black', accB, estRatingFromAcc(accB)),
    h('div', { class: 'hint', style: { marginLeft: 'auto', textAlign: 'right' } }, useCC ? 'Chess.com accuracy · est. level' : `engine accuracy · depth ${analysis.depth} · est. level`));

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

  // Top "entrance" card: a one-sentence recap + tap-to-jump key moments. On mobile it sits above
  // the board (scroll down to the board view); on desktop it leads the review.
  const km = keyMoments(analysis);
  const keyPlies = new Set(km.map((m) => m.ply));
  const jumpToPly = (ply) => { stepTo(ply); document.getElementById('board')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  const introCard = h('div', { class: 'card section review-intro' },
    h('div', { class: 'hint tiny intro-eyebrow' }, '📖 What happened'),
    h('div', { class: 'intro-line' }, gameNarrative(game, analysis)),
    km.length ? h('div', { class: 'key-moments' },
      h('div', { class: 'hint tiny', style: { marginBottom: '7px' } }, '⭐ Key moments — tap to jump'),
      h('div', { class: 'km-row' }, km.map((m) => h('button', {
        class: 'km-chip', title: `${m.label} · move ${m.moveNumber}`, onclick: () => jumpToPly(m.ply) },
        h('span', { class: 'km-glyph', style: { color: LABELS[m.label]?.color } }, LABELS[m.label]?.glyph || '•'),
        ` ${m.moveNumber}${m.color === 'white' ? '.' : '…'} ${m.san}`))),
    ) : null,
  );

  // Mobile: a small toggle between the move explanation and the chat, so each gets the room it
  // needs. Tapping "Chat" minimizes the explanation and turns the board + chat into their own
  // focused view — and the coach still sees whatever position you've stepped to. Desktop shows both
  // (the tabs are hidden by CSS there).
  const expTab = h('button', { class: 'panel-tab active' }, '📖 Explanation');
  const chatTab = h('button', { class: 'panel-tab chat-tab' }, '💬 Chat');
  const panelTabs = h('div', { class: 'panel-tabs' }, expTab, chatTab);
  const chatSection = h('div', { class: 'section rc-chat' },
    h('div', { class: 'hint tiny', style: { fontWeight: 700, marginBottom: '6px', color: 'var(--accent-2)' } }, '💬 Ask the coach — it sees the position you\'re on'),
    h('div', { id: 'review-chat' }));
  const sidebar = h('div', { class: 'sidebar', 'data-panel': 'explain' }, nav, panelTabs, explainBox, chatSection, moveList);
  const setPanel = (which) => {
    sidebar.dataset.panel = which; card.dataset.panel = which;
    expTab.classList.toggle('active', which === 'explain');
    chatTab.classList.toggle('active', which === 'chat');
    requestAnimationFrame(() => R._evalResize && R._evalResize()); // board size changes → re-sync eval bar
    if (which === 'chat') setTimeout(() => document.querySelector('#review-chat input')?.focus(), 40);
  };
  expTab.onclick = () => setPanel('explain');
  chatTab.onclick = () => setPanel('chat');
  card.dataset.panel = 'explain';

  card.append(
    introCard,
    accBar,
    summaryChips,
    h('div', { class: 'review section' },
      evalbar,
      h('div', { class: 'board-wrap' }, boardEl),
      sidebar),
    buildEvalGraph(analysis),
  );

  R.ground = createBoard(boardEl, { viewOnly: true, orientation: R.orientation, coordinates: true, fen: analysis.plies[0]?.fenBefore });
  R._eval = { white: evalWhite, num: evalNum };
  // Keep the eval bar exactly as tall as the board (the board shrinks on mobile; a fixed-height
  // bar looked broken next to it).
  const syncEvalHeight = () => { const bw = boardEl.closest('.board-wrap'); if (bw && evalbar) { const hpx = Math.round(bw.getBoundingClientRect().height); if (hpx > 40) evalbar.style.height = hpx + 'px'; } };
  requestAnimationFrame(() => { syncEvalHeight(); requestAnimationFrame(syncEvalHeight); });
  if (R._evalResize) window.removeEventListener('resize', R._evalResize);
  R._evalResize = syncEvalHeight; window.addEventListener('resize', syncEvalHeight);
  buildMoveList(moveList, analysis, keyPlies);
  stepTo(0);
  attachKeys();
  mountChat(document.getElementById('review-chat'), {
    getContext: reviewContext,
    starter: 'Ask about this move — or the whole game…',
    quickAsks: [{ label: '🧠 Review my whole game', text: 'Give me an overall coach\'s review of my whole game — how I played, the turning points, and the top 1-2 things I should work on from this game.' }],
  });
}

// ---------------- US Chess tournament history (optional, via profile.uscfId) ----------------
function fmtUscfDate(d) { try { return new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' }); } catch { return d; } }
function uscfDelta(s) { return (s.pre != null && s.post != null) ? s.post - s.pre : null; }

export function uscfCard(uscfId, username) {
  if (!uscfAvailable()) return null;
  // ALWAYS scope to a specific player. `username` is who this card is FOR (a coach viewing a
  // student passes the student). Only fall back to / cache into the device profile when the card
  // is the OWNER's own — otherwise a coach's ID would render on a student's report (and worse, get
  // written into the coach's profile + cloud row).
  const player = String(username || S.username || '').toLowerCase();
  const isOwner = !!player && player === String(store.get('profile.username', '') || '').toLowerCase();
  let id = String(uscfId || (isOwner ? store.get('profile.uscfId', '') : '')).trim();
  const body = h('div', { class: 'hint tiny' }, 'Loading tournaments…');
  const refresh = h('button', { class: 'btn ghost small', onclick: () => load(true) }, '↻ Refresh');
  const card = h('div', { class: 'card section uscf-card' },
    h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center' } },
      h('h2', { style: { margin: 0 } }, '🏅 US Chess tournaments'), refresh),
    body);
  if (!validUscfId(id)) {
    if (!player) { card.remove(); return card; }
    // Resolve from THIS player's cloud roster row (not the device profile of whoever's logged in).
    import('../cloud.js').then((c) => c.fetchStudentRow(player)).then((row) => {
      if (row && validUscfId(row.uscf_id)) {
        id = String(row.uscf_id).trim();
        if (isOwner) store.set('profile.uscfId', id); // cache only the owner's own id, locally
        load(false);
      } else card.remove();
    }).catch(() => card.remove());
    return card;
  }

  const fmtRec = (r) => r ? `${r.w}W–${r.l}L${r.d ? `–${r.d}D` : ''}` : null;
  function eventRow(ev) {
    const main = ev.sections[0] || {};
    const d = uscfDelta(main);
    const chips = h('div', { class: 'row', style: { gap: '6px', flexShrink: 0 } },
      ev.record ? h('span', { class: 'pill', style: { fontFamily: 'var(--mono)', fontWeight: 700 } }, fmtRec(ev.record)) : null,
      d != null ? h('span', { class: 'pill', style: { fontFamily: 'var(--mono)', fontWeight: 700, color: d >= 0 ? 'var(--good)' : 'var(--bad)' } }, (d >= 0 ? '+' : '') + d)
        : main.post != null ? h('span', { class: 'pill', style: { fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--accent-2)' } }, '→ ' + main.post) : null);
    const gameLine = (g) => h('div', { style: { padding: '2px 0 2px 12px' } },
      h('span', { style: { fontWeight: 800, color: g.outcome === 'Win' ? 'var(--good)' : g.outcome === 'Loss' ? 'var(--bad)' : 'var(--muted)' } },
        g.outcome === 'Win' ? '✓ W' : g.outcome === 'Loss' ? '✗ L' : '½ D'),
      ` vs ${g.opponent}${g.color ? ` (as ${g.color})` : ''}`);
    const detail = h('div', { class: 'hint tiny', style: { display: 'none', marginTop: '8px', paddingLeft: '2px' } },
      ...ev.sections.map((s) => h('div', { style: { padding: '4px 0' } },
        h('div', {},
          h('b', {}, `${s.name || 'Section'}${s.system ? ' · ' + s.system : ''}`),
          s.record ? h('span', {}, `  ${fmtRec(s.record)}`) : null,
          s.pre != null ? h('span', {}, '  · rating ', h('b', {}, `${s.pre} → ${s.post}`)) :
            s.post != null ? h('span', {}, '  · new rating ', h('b', {}, String(s.post)), h('span', { class: 'hint tiny' }, ' (first rated event)')) : null,
          uscfDelta(s) != null ? h('span', { style: { color: uscfDelta(s) >= 0 ? 'var(--good)' : 'var(--bad)', fontWeight: 700 } }, ` ${uscfDelta(s) >= 0 ? '+' : ''}${uscfDelta(s)}`) : null),
        ...s.games.map(gameLine))),
      ev.id ? h('div', { style: { marginTop: '6px' } }, h('a', { href: eventUrl(ev.id), target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, 'View event on US Chess ↗')) : null);
    return h('div', { style: { padding: '10px 0', borderTop: '1px solid var(--line)', cursor: 'pointer' },
      onclick: () => { detail.style.display = detail.style.display === 'none' ? 'block' : 'none'; } },
      h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'baseline', gap: '10px' } },
        h('div', { style: { minWidth: 0 } },
          h('b', {}, ev.name),
          h('div', { class: 'hint tiny' }, [fmtUscfDate(ev.endDate), ev.place].filter(Boolean).join(' · '))),
        chips),
      detail);
  }

  async function load(force) {
    refresh.disabled = true;
    clear(body).append(h('span', { class: 'spinner' }), ' Loading tournaments…');
    try {
      const data = await fetchUscfHistory(id, { force });
      clear(body);
      if (!data.events.length) { body.append(h('div', { class: 'hint' }, 'No rated tournaments on record yet — they\'ll show up here after your first one.')); return; }
      const reg = data.member.ratings.find((r) => r.system === 'R' && r.rating != null);
      const ageMin = Math.round((Date.now() - (data.fetchedAt || Date.now())) / 60000);
      const age = ageMin < 2 ? 'just now' : ageMin < 90 ? `${ageMin} min ago` : ageMin < 48 * 60 ? `${Math.round(ageMin / 60)}h ago` : `${Math.round(ageMin / 1440)}d ago`;
      body.append(h('div', { class: 'hint tiny', style: { marginBottom: '4px' } },
        `${data.events.length} events${reg ? ` · regular rating ${reg.rating}` : ''} · updated ${age} · tap an event for games · `,
        h('a', { href: playerUrl(id), target: '_blank', rel: 'noopener' }, 'US Chess profile ↗')));
      const list = h('div', {});
      const renderN = (n) => {
        clear(list).append(...data.events.slice(0, n).map(eventRow));
        if (data.events.length > n) list.append(h('button', { class: 'btn ghost small', style: { marginTop: '8px' }, onclick: () => renderN(data.events.length) }, `Show all ${data.events.length} →`));
      };
      renderN(8);
      body.append(list);
    } catch (e) { clear(body).append(h('div', { class: 'hint' }, '⚠ ' + e.message)); }
    finally { refresh.disabled = false; }
  }
  load(false);
  return card;
}

// Estimate the Elo "level" a given accuracy was played at — a monotonic, transparent map
// calibrated to typical Chess.com accuracy→club-rating. It's an ESTIMATE (accuracy runs high in
// quiet games, low in sharp ones), so it's always labelled "≈ … level".
function estRatingFromAcc(acc) {
  if (acc == null) return null;
  const pts = [[50, 400], [60, 700], [65, 900], [70, 1050], [75, 1250], [80, 1450], [84, 1650], [88, 1850], [92, 2050], [95, 2250], [98, 2500], [100, 2700]];
  if (acc <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (acc <= pts[i][0]) { const [a0, r0] = pts[i - 1], [a1, r1] = pts[i]; return Math.round(r0 + (r1 - r0) * (acc - a0) / (a1 - a0)); }
  }
  return pts[pts.length - 1][1];
}

function accSide(name, v, est) {
  return h('div', {},
    h('div', { class: 'acc', style: { color: v == null ? 'var(--muted)' : accColor(v) } }, pct(v)),
    h('div', { class: 'who' }, name + ' accuracy'),
    est != null ? h('div', { class: 'est-rating', title: 'Estimated playing level for this game, from accuracy' }, `≈ ${est} level`) : null);
}

function plural(lbl, n) {
  if (n === 1) return lbl;
  if (lbl === 'Miss') return 'Misses';
  if (lbl.endsWith('y')) return lbl.slice(0, -1) + 'ies';
  return lbl + 's';
}
// One-sentence "what happened" recap — heuristic (no API). Anchored on the real result so it can
// never contradict the score, then names the single turning point (who slipped, and when).
function gameNarrative(game, analysis) {
  const plies = analysis.plies || [];
  const opp = game.opponent || 'your opponent';
  const res = game.userResult, code = game.userResultCode || '';
  if (!plies.length) return res === 'win' ? `A win over ${opp}.` : res === 'loss' ? `A loss to ${opp}.` : `A draw with ${opp}.`;
  const uc = game.userColor;
  const uwp = (p) => uc === 'white' ? evalToWhitePct(p.evalWhite) : 100 - evalToWhitePct(p.evalWhite);
  const tagged = plies.map((p, i) => ({ p, i }));
  const worst = (side) => tagged.filter((x) => (x.p.color === uc) === side)
    .reduce((a, b) => (b.p.winLoss || 0) > (a ? a.p.winLoss || 0 : 0) ? b : a, null);
  const myWorst = worst(true), oppWorst = worst(false);
  const isBig = (x) => x && ['Blunder', 'Mistake'].includes(x.p.label) && (x.p.winLoss || 0) >= 12;
  const standBefore = (x) => { const wp = x.i === 0 ? 50 : uwp(plies[x.i - 1]); return wp >= 62 ? 'ahead' : wp <= 38 ? 'behind' : 'even'; };
  const wps = plies.map(uwp), peak = Math.max(...wps), trough = Math.min(...wps);

  if (code === 'timeout') return res === 'loss'
    ? `The clock, not the board, decided this one — you ran out of time.`
    : `You won on time when ${opp}'s clock ran out.`;
  if (res === 'draw') return ((myWorst?.p.winLoss || 0) >= 15 || (oppWorst?.p.winLoss || 0) >= 15)
    ? `A back-and-forth fight with chances both ways that settled into a draw.`
    : `A balanced, even game that ended in a draw with no decisive mistakes.`;
  if (res === 'loss') {
    if (isBig(myWorst)) {
      const s = standBefore(myWorst), word = myWorst.p.label.toLowerCase(), n = myWorst.p.moveNumber;
      return s === 'ahead' ? `You were winning until your ${word} on move ${n} handed ${opp} the game.`
        : s === 'behind' ? `Already under pressure, your ${word} on move ${n} ended the comeback.`
        : `You were right in it until your ${word} on move ${n} handed ${opp} the game.`;
    }
    return peak >= 60 ? `You had your chances, but ${opp} slowly outplayed you and ground it out.`
      : `${opp} took charge early and never let go — a tough one.`;
  }
  // win
  if (isBig(oppWorst)) return `You stayed patient and pounced when ${opp} slipped on move ${oppWorst.p.moveNumber}, converting the lead to win.`;
  return trough <= 40 ? `A hard-fought win — you weathered real pressure and turned it around at the end.`
    : `A clean, controlled win — you built an edge early and never let ${opp} back in.`;
}

// The handful of moves that decided (or defined) the game — biggest win-chance swings plus any
// standout finds — in move order, each tappable to jump there.
function keyMoments(analysis) {
  const NOTE = new Set(['Blunder', 'Mistake', 'Brilliant', 'Great', 'Miss']);
  const bonus = (l) => l === 'Brilliant' ? 45 : l === 'Great' ? 35 : l === 'Blunder' ? 10 : l === 'Mistake' ? 4 : 0;
  return (analysis.plies || []).map((p, i) => ({ ...p, ply: i + 1 })).filter((p) => NOTE.has(p.label))
    .sort((a, b) => ((b.winLoss || 0) + bonus(b.label)) - ((a.winLoss || 0) + bonus(a.label)))
    .slice(0, 5).sort((a, b) => a.ply - b.ply);
}

function reviewSummary(game, analysis) {
  const mine = analysis.plies.filter((p) => p.color === game.userColor);
  const count = (lbl) => mine.filter((p) => p.label === lbl).length;
  const chip = (lbl) => { const n = count(lbl); return n ? h('span', { class: 'chip' }, h('span', { class: 'glyph', style: { color: LABELS[lbl]?.color } }, LABELS[lbl]?.glyph || ''), ' ', `${n} ${plural(lbl, n)}`) : null; };
  return h('div', { class: 'chip-row section' },
    ['Brilliant', 'Great', 'Best', 'Excellent', 'Good', 'Inaccuracy', 'Miss', 'Mistake', 'Blunder'].map(chip));
}

function buildMoveList(el, analysis, keyPlies) {
  clear(el);
  let line = null;
  analysis.plies.forEach((p, i) => {
    if (p.color === 'white') { line = h('span'); el.append(h('span', { class: 'moveno' }, p.moveNumber + '.'), line, ' '); }
    const isKey = keyPlies && keyPlies.has(i + 1);
    const span = h('span', { class: 'ply' + (isKey ? ' key' : ''), 'data-ply': i + 1, onclick: () => stepTo(i + 1) },
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
  // active in move list — scroll ONLY the move list, never the page (scrollIntoView was jumping
  // the whole page on every click on mobile).
  const ml = document.getElementById('movelist');
  if (ml) {
    ml.querySelectorAll('.ply').forEach((s) => s.classList.toggle('active', +s.dataset.ply === ply));
    const active = ml.querySelector('.ply.active');
    if (active) {
      const aTop = active.offsetTop, aBot = aTop + active.offsetHeight;
      if (aTop < ml.scrollTop) ml.scrollTop = aTop - 8;
      else if (aBot > ml.scrollTop + ml.clientHeight) ml.scrollTop = aBot - ml.clientHeight + 8;
    }
  }
  if (R._eg) R._eg.marker.style.left = (R._eg.n ? (ply / R._eg.n) * 100 : 0) + '%';
}

function renderExplain(p) {
  const box = document.getElementById('explain');
  if (!box) return;
  if (!p) { clear(box).append(h('div', { class: 'hint' }, 'Starting position. Step forward to review each move.')); return; }
  const lab = LABELS[p.label] || {};
  // Frame the engine line to match the grade: for a good move it's an alternative ("Engine's top
  // pick"), for a weak move it's the correction ("Better was"). Never contradicts the grade.
  const GOODLBL = new Set(['Brilliant', 'Great', 'Best', 'Excellent', 'Good', 'Book']);
  const bestPrefix = GOODLBL.has(p.label) ? 'Engine\'s top pick: ' : 'Better was: ';
  // NOTE: clear(box).append(...) is the NATIVE Element.append — it renders a null child as the
  // literal text "null" (unlike our h() helper, which skips nulls). So filter nulls out here; the
  // engine line is null on best/matched moves and was printing a stray "null".
  clear(box).append(...[
    h('span', { class: 'label-chip', style: { background: (lab.color || '#888') + '22', color: lab.color } }, `${lab.glyph || ''} ${p.label}`),
    h('div', {}, h('span', { class: 'move-san' }, `${p.moveNumber}${p.color === 'white' ? '.' : '…'} ${p.san}`),
      p.winLoss >= 1 ? h('span', { class: 'hint' }, `  (−${p.winLoss}% win chance)`) : null),
    h('div', { class: 'why' }, p.explanation),
    p.bestUci && p.playedUci !== p.bestUci ? h('div', { class: 'best' }, bestPrefix, h('b', {}, p.bestSan || '—')) : null,
  ].filter(Boolean));
  // optional richer commentary from Claude (via the shared proxy, or the user's own key)
  if (coachEnabled()) {
    const coachLine = h('div', { class: 'why', style: { marginTop: '8px', color: 'var(--accent-2)' } });
    const btn = h('button', { class: 'btn small coach-cta', style: { marginTop: '8px' }, onclick: async () => {
      btn.disabled = true; btn.textContent = 'Coaching…';
      try {
        const txt = await commentMove({ fen: p.fenBefore, color: p.color, playedSan: p.san, bestSan: p.bestSan, label: p.label, winLoss: p.winLoss, heuristic: p.explanation });
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

// A stable whole-game summary so the coach can answer questions about the ENTIRE game — how they
// played, the turning points, what to work on — not just the move under the cursor.
function gameOverviewContext() {
  const a = R.analysis, g = R.game;
  if (!a || !a.plies || !a.plies.length) return '';
  const mine = g.userColor;
  const cc = g.accuracies;
  const useCC = cc && cc.white != null && cc.black != null;
  const accW = useCC ? Math.round(cc.white) : a.accuracy.white;
  const accB = useCC ? Math.round(cc.black) : a.accuracy.black;
  const myAcc = mine === 'white' ? accW : accB, oppAcc = mine === 'white' ? accB : accW;
  const count = (isMine, lbl) => a.plies.filter((p) => (p.color === mine) === isMine && p.label === lbl).length;
  const myQuality = ['Blunder', 'Mistake', 'Inaccuracy', 'Miss', 'Great', 'Brilliant']
    .map((l) => { const n = count(true, l); return n ? `${n} ${l.toLowerCase()}${n === 1 ? '' : 's'}` : null; }).filter(Boolean).join(', ') || 'nothing notably good or bad';
  const km = keyMoments(a).map((m) => `${m.moveNumber}${m.color === 'white' ? '.' : '…'} ${m.san} (${m.label})`).join('; ');
  const result = g.userResult === 'win' ? 'won' : g.userResult === 'loss' ? 'lost' : 'drew';
  const est = estRatingFromAcc(myAcc);
  return 'WHOLE-GAME SUMMARY (use this for any question about the game overall):\n' +
    `The player is ${mine} and ${result} vs ${g.opponent}. ${gameNarrative(g, a)}\n` +
    `Accuracy — player ${pct(myAcc)}${est ? ` (played around a ${est} level)` : ''}, opponent ${pct(oppAcc)}.\n` +
    `The player's move quality this game: ${myQuality}.\n` +
    (km ? `Turning points / key moves: ${km}.\n` : '') +
    `The game lasted about ${Math.ceil(a.plies.length / 2)} moves.\n`;
}

function reviewContext() {
  const a = R.analysis, ply = R.ply, g = R.game;
  if (!a) return 'No game loaded.';
  const overview = gameOverviewContext();
  const pos = ply === 0
    ? 'CURRENT POSITION: the starting position, before any moves.'
    : (() => {
        const p = a.plies[ply - 1];
        return `CURRENT POSITION: after ${p.moveNumber}${p.color === 'white' ? '.' : '…'} ${p.san} (FEN: ${p.fenAfter}). ` +
          `That move was graded "${p.label}"${p.winLoss >= 1 ? ` (lost ~${p.winLoss}% win chance)` : ''}. The engine preferred ${p.bestSan || 'n/a'}. Coach note: ${p.explanation}`;
      })();
  return `The player is ${g.userColor} vs ${g.opponent}.\n${overview}\n${pos}`;
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
  // persist focus areas so the Train tab can build a personalized daily set
  store.set('train.focus', { themes: suggestedPuzzleThemes(profile), blunders: profile.blunders.slice(0, 8).map((b) => ({ fen: b.fen, theme: b.theme, bestUci: b.bestUci, san: b.san })), ts: Date.now() });

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
