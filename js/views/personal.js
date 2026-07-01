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
import { renderImprove, renderByTimeControl, renderScorecard, renderTodayPlan, renderCleanReport, renderRatingHistory } from '../insightsview.js';
import { BENCHMARKS } from '../benchmarks.js';
import { commentMove, coachPlan } from '../llm.js';
import { mountChat } from '../chatcoach.js';
import { createBoard, syncBoard, legalDests, evalToWhitePct, evalText, showArrow } from '../board.js';
import { LABELS } from '../analysis.js';
import {
  buildBlunderPuzzle, puzzleFromLichessJson, lichessApi, checkMove, toMoveObj,
  recordAttempt, difficultyForTheme, loadThemeShard,
} from '../puzzles.js';
import { cloudEnabled, upsertSnapshot, fetchStudents } from '../cloud.js';

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
  host.append(
    h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'baseline' } },
      h('h1', {}, owner ? `${owner}'s coach` : 'Your coach'),
      S.games.length ? h('div', { class: 'hint tiny' }, `Last ${S.games.length} games · `, h('a', { href: 'javascript:void 0', onclick: () => reSync() }, 'refresh')) : null),
    store.get('profile.welcomeSeen') ? null : welcomeCard(),
    h('div', { id: 'report-area', class: 'section' }),
  );
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
  const analyses = scopeAnalyses(myGames);

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
    if (store.get('profile.role') === 'student') {
      // STUDENTS get the gist + clear actions, not the deep analytics.
      renderStudentReport(area, { record, last10: last10rec, dims, I, myGames, eloPoints, scope, scopeName });
    } else {
      // COACHES (and the owner) get the full report.
      area.append(nextStepsCard(), reportCard(allMine));
      renderBadges(area, badgeData(myGames, eloPoints));
      renderCleanReport(area, {
        rating: myGames[0]?.userRating || I.ratingAvg, scope: scope === 'all' ? null : scopeName,
        record, last10: last10rec, accAvg: I.accAvg, accDelta, dims, narr, accTrend: I.accTrend,
        eloPoints, focus: focusAreas(dims),
        onTrain: () => window.open('https://aimchess.com', '_blank'),
        onGo: (f) => { if (f.dest === 'openings') CTX.navigate('openings'); else window.open('https://aimchess.com', '_blank'); },
      });
      area.append(progressCard(S.username));
      area.append(gamesDetails(), breakdownDetails(analyses, myGames));
    }
    // First-run reveal: the 60-second "your chess, decoded" intro, once.
    if (!store.get('profile.introSeen')) {
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
      }, () => store.set('profile.introSeen', true));
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

// Students should see where they stand — the class leaderboard, with themselves highlighted.
function studentLeaderboardCard() {
  if (!cloudEnabled()) return null;
  const wrap = h('div', { class: 'card section', id: 'stu-lb' }, h('h2', {}, '🏆 Class leaderboard'), h('div', { class: 'row' }, h('span', { class: 'spinner' }), ' Loading…'));
  const me = (S.username || '').toLowerCase();
  fetchStudents().then((rows) => {
    if (!document.getElementById('stu-lb')) return;
    const ranked = (rows || []).filter((x) => x.ladder_rating != null).sort((a, b) => b.ladder_rating - a.ladder_rating);
    if (!ranked.length) { clear(wrap).append(h('h2', {}, '🏆 Class leaderboard'), h('div', { class: 'hint tiny' }, 'No ranked players yet — check back once your class plays some games.')); return; }
    clear(wrap).append(h('h2', {}, '🏆 Class leaderboard'),
      h('div', {}, ...ranked.slice(0, 20).map((x, i) => {
        const mine = (x.username || '').toLowerCase() === me;
        return h('div', { class: 'row', style: { justifyContent: 'space-between', padding: '7px 10px', borderTop: i ? '1px solid var(--line)' : 'none', background: mine ? 'rgba(125,211,95,.12)' : 'transparent', borderRadius: mine ? '6px' : '0' } },
          h('div', {}, h('b', { style: { fontFamily: 'var(--mono)', color: i < 3 ? 'var(--accent)' : 'var(--muted)', marginRight: '10px' } }, i + 1), (x.name || x.username), mine ? h('span', { style: { color: 'var(--accent-2)', fontWeight: 700 } }, ' ← you') : null),
          h('b', { style: { fontFamily: 'var(--mono)' } }, x.ladder_rating));
      })));
  }).catch(() => { if (document.getElementById('stu-lb')) clear(wrap).append(h('h2', {}, '🏆 Class leaderboard'), h('div', { class: 'hint tiny' }, 'Leaderboard unavailable right now.')); });
  return wrap;
}

function renderStudentReport(area, { record, last10, dims, I, myGames, eloPoints, scope, scopeName }) {
  const focus = focusAreas(dims);
  const name = store.get('profile.ownerName', '') || 'there';
  area.append(h('div', { class: 'card section' },
    h('div', { style: { fontSize: '19px', fontWeight: 800 } }, `Hey ${name} 👋`),
    h('div', { class: 'hint' }, `You're rated ${myGames[0]?.userRating ?? '—'}. Recent form: ${last10.w}-${last10.l}-${last10.d}. Here's your plan.`)));
  area.append(instantSnapshot(record, last10, myGames[0]?.userRating, scope === 'all' ? null : scopeName));
  renderRatingHistory(area, eloPoints, scope === 'all' ? null : scopeName);
  area.append(h('div', { class: 'card section', style: { borderColor: 'var(--accent)', boxShadow: '0 0 0 1px rgba(125,211,95,.2)' } },
    h('h2', {}, '🎯 Your 3 things to work on'),
    h('div', { class: 'hint tiny', style: { marginTop: '-4px', marginBottom: '8px' } }, 'Start at the top. A little each day beats a lot once in a while.'),
    ...focus.slice(0, 3).map((f, i) => studentActionRow(f, i, I))));
  area.append(h('div', { class: 'card section' },
    h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' } },
      h('div', {}, h('b', {}, '🎬 Review your games'), h('div', { class: 'hint tiny' }, 'Play back your recent games and see what happened.')),
      h('button', { class: 'btn', onclick: () => { const g = document.getElementById('games-section'); if (g) g.scrollIntoView({ behavior: 'smooth' }); } }, 'Review →'))));
  const pd = progressDelta(S.username, 30);
  if (pd && pd.mostImproved && pd.mostImproved.delta > 0) {
    area.append(h('div', { class: 'card section', style: { background: 'rgba(125,211,95,.06)' } },
      h('b', {}, '📈 You\'re improving!'),
      h('div', { class: 'hint' }, `Your ${dimName(pd.mostImproved.key)} is up +${pd.mostImproved.delta} lately${pd.ratingDelta != null ? `, and your rating ${pd.ratingDelta >= 0 ? '+' : ''}${pd.ratingDelta}` : ''}. Keep it going!`)));
  }
  const lb = studentLeaderboardCard();
  if (lb) area.append(lb);
  renderBadges(area, badgeData(myGames, eloPoints));
  area.append(gamesDetails());
}

function studentActionRow(f, i, I) {
  const isOpening = f.dest === 'openings';
  let why = f.why;
  if (isOpening && I && I.openings) {
    const weak = I.openings.filter((o) => o.games >= 2 && o.acc != null && o.name !== 'Unknown').sort((a, b) => a.scorePct - b.scorePct)[0];
    if (weak) why = `You score low in the ${weak.name} (${weak.scorePct}%). Learn its plans and you'll win more of those.`;
  }
  const url = isOpening ? 'https://listudy.org/en/studies' : 'https://aimchess.com';
  const label = isOpening ? 'Study on Listudy ↗' : 'Drill on Aimchess ↗';
  return h('div', { class: 'focus-row' },
    h('div', { class: 'focus-icon' }, f.icon),
    h('div', { style: { minWidth: 0 } }, h('b', {}, `${i + 1}. ${f.label}`), h('div', { class: 'hint', style: { fontSize: '13px' } }, why)),
    h('a', { class: 'btn small' + (i === 0 ? '' : ' ghost'), href: url, target: '_blank', rel: 'noopener', style: { alignSelf: 'center', whiteSpace: 'nowrap' } }, label));
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
  store.set('train.focus', { themes: suggestedPuzzleThemes(profile), blunders: profile.blunders.slice(0, 8).map((b) => ({ fen: b.fen, theme: b.theme })), ts: Date.now() });
  store.set('train.plan', { game: today.game, study: today.study, headline: today.headline, rest: today.rest, focus: today.focus?.name });
  store.set('train.questions', blunderQuestions(analyses, 12)); // "from your own games" drill
}

function gamesDetails() {
  return h('div', { id: 'games-section', class: 'card section' },
    h('h2', {}, '🎬 Review your games'),
    h('div', { class: 'hint tiny', style: { marginTop: '-4px', marginBottom: '10px' } }, 'Click any game to play it back move by move — accuracy, the key moments, and exactly where it turned. This is your free game review.'),
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
  const username = (S.username || '').trim();
  if (!username) return;
  cancelBanking(); S._bankingStarted = false; S._scanned = null; // new player/refresh — reset background work
  store.set('profile.username', username);
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
  const list = h('div', { class: 'game-list' });
  for (const g of S.games.slice(0, 25)) {
    const a = S.analyses[g.url];
    const ccAcc = g.accuracies && g.accuracies[g.userColor] != null ? Math.round(g.accuracies[g.userColor]) : null;
    const acc = a ? a.accuracy[g.userColor] : ccAcc;
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
    accSide('White', accW), accSide('Black', accB),
    h('div', { class: 'hint', style: { marginLeft: 'auto', textAlign: 'right' } }, useCC ? 'Chess.com accuracy' : `engine accuracy · depth ${analysis.depth}`));

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
      h('div', { class: 'sidebar' }, nav, explainBox, moveList,
        h('div', { class: 'section' },
          h('div', { class: 'hint tiny', style: { fontWeight: 700, marginBottom: '6px', color: 'var(--accent-2)' } }, '💬 Ask the coach'),
          h('div', { id: 'review-chat' })))),
    buildEvalGraph(analysis),
  );

  R.ground = createBoard(boardEl, { viewOnly: true, orientation: R.orientation, coordinates: true, fen: analysis.plies[0]?.fenBefore });
  R._eval = { white: evalWhite, num: evalNum };
  buildMoveList(moveList, analysis);
  stepTo(0);
  attachKeys();
  mountChat(document.getElementById('review-chat'), { getContext: reviewContext, starter: 'Ask about this move…' });
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

function reviewContext() {
  const a = R.analysis, ply = R.ply, g = R.game;
  if (!a) return 'No game loaded.';
  if (ply === 0) return `Game: ${g.userColor} (the player) vs ${g.opponent}. Starting position.`;
  const p = a.plies[ply - 1];
  return `The player is ${g.userColor}. Position after ${p.moveNumber}${p.color === 'white' ? '.' : '…'} ${p.san} (FEN: ${p.fenAfter}). ` +
    `That move was graded "${p.label}"${p.winLoss >= 1 ? ` (lost ~${p.winLoss}% win chance)` : ''}. The engine preferred ${p.bestSan || 'n/a'}. Coach note: ${p.explanation}`;
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
  store.set('train.focus', { themes: suggestedPuzzleThemes(profile), blunders: profile.blunders.slice(0, 8).map((b) => ({ fen: b.fen, theme: b.theme })), ts: Date.now() });

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
