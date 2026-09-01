// views/classroom.js — coach/admin view. The shared cloud leaderboard is the centerpiece:
// every registered student ranked, filterable by group WITHOUT a refetch, and each row expands
// in place into a digestible "how they're doing + what they need" card. Roster management
// (add/remove, links, backup) is tucked into a collapsible panel so the top stays clean.
import { h, clear } from '../dom.js';
import * as store from '../storage.js';
import * as cc from '../chesscom.js';
import * as personal from './personal.js';
import { ingestLadder } from '../ladder.js';
import { tiltSignals } from '../tilt.js';
import { cloudEnabled, upsertStudent, removeStudent, fetchStudents, fetchSnapshots, fetchAttempts, publishUscfId } from '../cloud.js';
import { focusAreas } from '../report.js';
import { Chess } from 'chess.js';
import { mountPuzzle } from '../puzzleplay.js';
import { themeLabel } from '../puzzlemeta.js';

const CS = { forms: {}, tilt: {}, group: 'ms', updating: false, lbRows: null, lbFilter: 'all', expanded: null, showManage: false, review: null };
let CTX = null, host = null;

const GROUPS = [{ id: 'ms', label: 'Middle School' }, { id: 'hs', label: 'High School' }];
const GROUP_LABEL = { ms: 'Middle School', hs: 'High School', teacher: 'Teachers' };
// Never render a null/empty/"null" identity — the source of stray "null null" rows.
const clean = (s) => (s != null && String(s).trim() && String(s).trim().toLowerCase() !== 'null') ? String(s).trim() : null;
const nameOf = (x) => clean(x && x.name) || clean(x && x.username) || clean(x && x.u) || 'Player';

export function render(container, ctx) { CTX = ctx; host = container; CS.review = null; draw(); }

function getRoster() {
  let r = store.get('class.roster', null);
  if (!r) r = { name: 'My Chess Club', coach: store.get('profile.username', ''), coachName: store.get('profile.ownerName', 'Coach'), students: [] };
  return r;
}
function saveRoster(r) { store.set('class.roster', r); }

// THE ROSTER IS THE CLOUD. That's what the leaderboard shows and what the self-enroll (?join) link
// writes to. `class.roster` is a device-local cache/backup — but it used to be the ONLY thing the
// header count, the Manage list and "↻ Update ratings" read, so: self-enrolled students were
// invisible forever, Will's device had a different roster, and Update ratings iterated an empty
// array (a total no-op). Merge cloud (authoritative) with any local-only strays.
function rosterList() {
  const local = getRoster().students || [];
  const cloud = (CS.lbRows || []).map((x) => ({ name: nameOf(x), u: x.username, g: x.group_id || 'ms' }));
  if (!cloud.length) return local;
  const have = new Set(cloud.map((s) => (s.u || '').toLowerCase()));
  return [...cloud, ...local.filter((s) => s.u && !have.has(String(s.u).toLowerCase()))];
}

// ============================ main view ============================
function draw() {
  if (CS.review) return renderPuzzleHistoryList();
  const r = getRoster();
  clear(host);
  // NOTE: native host.append(null) renders the literal text "null" (unlike our h()); filter first.
  host.append(...[
    h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' } },
      h('h1', {}, 'Students'),
      h('div', { class: 'row', style: { gap: '6px', alignItems: 'center' } },
        h('span', { class: 'hint tiny' }, `${rosterList().length} in roster · ☁ live`),
        h('button', { class: 'btn small', disabled: CS.updating, onclick: () => updateClass(r) }, CS.updating ? 'Updating…' : '↻ Update ratings'),
        h('button', { class: 'btn ghost small', onclick: () => { CS.showManage = !CS.showManage; draw(); } }, CS.showManage ? '✕ Close' : '＋ Manage roster'))),
    CS.updating ? h('div', { class: 'hint tiny', id: 'cls-progress', style: { marginTop: '4px' } }, 'Pulling each student\'s games…') : null,
    CS.showManage ? managePanel(r) : null,
    cloudEnabled() ? leaderboardSection() : h('div', { class: 'empty section' }, 'The shared leaderboard isn\'t connected on this device.'),
  ].filter(Boolean));
}

// ============================ leaderboard (the centerpiece) ============================
function leaderboardSection() {
  const wrap = h('div', { class: 'section', id: 'lb-wrap' });
  if (CS.lbRows) { renderLeaderboardInner(wrap); return wrap; }
  wrap.append(h('h2', {}, '🏆 Leaderboard'), h('div', { class: 'row' }, h('span', { class: 'spinner' }), ' Loading the class…'));
  // Full draw on FIRST load (not just the leaderboard) so the roster count + Manage list pick up the
  // cloud roster. Group filters still re-render only the leaderboard from the cache — no refetch.
  fetchStudents().then((rows) => { CS.lbRows = rows || []; draw(); })
    .catch((e) => { const w = document.getElementById('lb-wrap'); if (w) { clear(w).append(h('h2', {}, '🏆 Leaderboard'), h('div', { class: 'hint tiny' }, 'Could not load: ' + e.message.slice(0, 60))); } });
  return wrap;
}

// Re-renders ONLY the leaderboard from cached rows — group filters are instant, no refetch, no
// full-page redraw (that was the "full refresh" glitch when switching HS/MS).
function renderLeaderboardInner(wrap) {
  clear(wrap);
  const flt = CS.lbFilter;
  // Rank by Chess.com rating (kept fresh by the daily pull) — the number everyone recognizes.
  const rateOf = (x) => (x.chesscom_rating != null ? x.chesscom_rating : x.ladder_rating);
  // Show EVERYONE: rated players ranked by rating, then any not-yet-rated students at the bottom.
  // A just-added or self-enrolled student has no rating until "Update ratings" pulls their games —
  // they used to be filtered out entirely, so a coach who added a kid saw them vanish.
  const inGroup = (CS.lbRows || []).filter((x) => flt === 'all' || (x.group_id || 'ms') === flt);
  const rated = inGroup.filter((x) => rateOf(x) != null).sort((a, b) => rateOf(b) - rateOf(a));
  const unrated = inGroup.filter((x) => rateOf(x) == null).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const rows = [...rated, ...unrated];
  const chip = (id, label) => h('button', {
    class: 'chip', style: flt === id ? { background: 'var(--accent)', color: '#0a1e12', fontWeight: 700, borderColor: 'var(--accent)' } : {},
    onclick: () => { CS.lbFilter = id; renderLeaderboardInner(document.getElementById('lb-wrap')); },
  }, label);
  wrap.append(
    h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' } },
      h('h2', {}, '🏆 Leaderboard'),
      h('div', { class: 'chip-row', style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
        chip('all', 'Everyone'), chip('ms', 'Middle School'), chip('hs', 'High School'), chip('teacher', 'Teachers'))),
    h('div', { class: 'hint tiny', style: { margin: '2px 0 10px' } }, 'Tap a student to see how they\'re doing and what to work on.'),
    rows.length
      ? h('div', { class: 'card', style: { padding: '0', borderColor: 'var(--accent)', boxShadow: '0 0 0 1px rgba(125,211,95,.18), var(--shadow)' } }, ...rows.slice(0, 80).map((x, i) => lbRow(x, i, rateOf(x) == null)))
      : h('div', { class: 'empty' }, 'No students yet — add them under “＋ Manage roster.”'),
    unrated.length ? h('div', { class: 'hint tiny', style: { marginTop: '8px' } }, `⏳ ${unrated.length} not rated yet (shown as “—”). Tap “↻ Update ratings” under ＋ Manage roster to pull their games.`) : null);
}

function lbRow(x, i, unrated = false) {
  const u = (x.username || '').toLowerCase();
  const open = CS.expanded === u;
  const rating = x.chesscom_rating != null ? x.chesscom_rating : x.ladder_rating;
  const row = h('div', {
    class: 'lb-row', style: { display: 'grid', gridTemplateColumns: '30px 1fr 64px 18px', gap: '10px', alignItems: 'center', padding: '11px 14px', borderTop: i ? '1px solid var(--line)' : 'none', cursor: 'pointer', background: open ? 'var(--bg-soft)' : 'transparent' },
    onclick: () => { CS.expanded = open ? null : u; renderLeaderboardInner(document.getElementById('lb-wrap')); },
  },
    h('div', { style: { fontFamily: 'var(--mono)', fontWeight: 800, fontSize: (!unrated && i < 3) ? '18px' : '14px', textAlign: 'center', color: unrated ? 'var(--faint)' : (i < 3 ? 'var(--accent)' : 'var(--muted)') } }, unrated ? '–' : (i < 3 ? ['🥇', '🥈', '🥉'][i] : String(i + 1))),
    h('div', {}, h('b', {}, nameOf(x)), h('span', { class: 'hint tiny', style: { marginLeft: '8px' } }, GROUP_LABEL[x.group_id] || '')),
    h('div', { style: { textAlign: 'right' } }, h('b', { style: { fontFamily: 'var(--mono)', fontSize: '16px' } }, rating ?? '—'), h('div', { class: 'hint tiny' }, /^lichess:/i.test(x.username || '') ? 'lichess' : 'chess.com')),
    h('span', { class: 'hint tiny' }, open ? '▲' : '▾'));
  if (!open) return row;
  const box = h('div', { class: 'card', style: { margin: '0 14px 14px', background: 'var(--bg-soft)' } }, h('div', { class: 'row' }, h('span', { class: 'spinner' }), ` Loading ${x.name || x.username}…`));
  loadDigest(x, box);
  return h('div', {}, row, box);
}

async function loadDigest(x, box) {
  try {
    const [games, snaps, stats] = await Promise.all([
      cc.fetchRecentGames(x.username, { months: 3, timeClass: 'all', limit: 40 }),
      fetchSnapshots(x.username).catch(() => []),
      cc.fetchStats(x.username).catch(() => null),
    ]);
    const d = studentDigest(games);
    d.focus = dimsFocusFromSnapshots(snaps); // the SAME engine assessment their own report shows, if they've opened it
    d.best = cc.bestRating(stats); // headline = highest current rating, labeled with control + site
    if (box.isConnected) clear(box).append(renderDigest(x, d));
  } catch { if (box.isConnected) clear(box).append(h('div', { class: 'hint tiny' }, 'Couldn\'t pull this student\'s games right now.')); }
}

// Rebuild the report's focus areas from a student's cached skill dimensions (published to the
// cloud when they open their own report) so the coach digest and the student's report AGREE.
function dimsFocusFromSnapshots(snaps) {
  if (!snaps || !snaps.length) return null;
  const dimObj = snaps[snaps.length - 1]?.dims; // fetchSnapshots orders by date ascending → last = newest
  if (!dimObj || typeof dimObj !== 'object' || !Object.keys(dimObj).length) return null;
  const dimsArr = Object.entries(dimObj).map(([key, score]) => ({ key, score, bonus: key === 'consistency' }));
  try { return focusAreas(dimsArr); } catch { return null; }
}

// Cheap-but-real digest from public games (no engine): form, win-rate, color split, accuracy,
// and a plain-English "what they need" from those signals.
function studentDigest(games) {
  const recent = games.slice(0, 30);
  let w = 0, l = 0, d = 0, wW = 0, wN = 0, bW = 0, bN = 0, accSum = 0, accN = 0, rating = null;
  for (const g of recent) {
    const res = g.userResult;
    if (res === 'win') w++; else if (res === 'loss') l++; else d++;
    if (g.userColor === 'white') { wN++; if (res === 'win') wW++; } else { bN++; if (res === 'win') bW++; }
    const acc = g.accuracies && g.accuracies[g.userColor];
    if (acc != null) { accSum += acc; accN++; }
    if (rating == null && g.userRating != null) rating = g.userRating;
  }
  const n = recent.length || 1;
  const winRate = Math.round((100 * w) / n);
  const whiteRate = wN ? Math.round((100 * wW) / wN) : null;
  const blackRate = bN ? Math.round((100 * bW) / bN) : null;
  const avgAcc = accN ? Math.round(accSum / accN) : null;
  const recs = [];
  if (avgAcc != null && avgAcc < 75) recs.push('Drill tactics — accuracy is low, so pieces are getting dropped. Point them at the Puzzles tab.');
  if (whiteRate != null && blackRate != null && blackRate <= whiteRate - 15) recs.push('Their Black repertoire — they score a lot worse with Black. Study a solid defense in the Openings tab.');
  else if (whiteRate != null && blackRate != null && whiteRate <= blackRate - 15) recs.push('Their White openings — they score worse with White. Nail down a first move and a plan.');
  if (winRate < 38) recs.push('Confidence + fundamentals — rough recent run. Easier opponents and steady wins to rebuild.');
  if (!recs.length) recs.push(avgAcc != null && avgAcc >= 85 ? 'Sharper endgames + openings — their tactics are already clean.' : 'Keep the reps up — steady all-around, no glaring hole.');
  return { rating, w, l, d, winRate, whiteRate, blackRate, avgAcc, recs, count: recent.length };
}

// Prefer the SAME engine assessment the student's report shows; fall back to cheap signals + a
// note only when they haven't opened their report yet (so the two never openly contradict).
function needBlock(d) {
  if (d.focus && d.focus.length) {
    const primary = d.focus.filter((f) => f.primary).slice(0, 2);
    const items = primary.length ? primary : d.focus.slice(0, 2);
    return h('div', {},
      h('div', { style: { fontSize: '13px', marginBottom: '6px' } }, h('b', {}, '📌 What they need '), h('span', { class: 'hint tiny' }, '(from their skill report)')),
      ...items.map((f) => h('div', { class: 'explain-box', style: { fontSize: '13px', marginBottom: '6px', minHeight: '0' } },
        h('b', {}, `${f.icon} ${f.label} `), h('span', { class: 'hint tiny', style: { fontFamily: 'var(--mono)' } }, `${f.score}/100`),
        h('div', { style: { marginTop: '2px' } }, f.why))));
  }
  return h('div', {},
    ...d.recs.map((rec, i) => h('div', { class: 'explain-box', style: { fontSize: '13px', marginBottom: '8px', minHeight: '0' } }, i === 0 ? h('b', {}, '📌 What they need: ') : h('b', {}, '• '), rec)),
    h('div', { class: 'hint tiny', style: { marginTop: '2px' } }, 'From recent games — have them open their student link once for the full engine breakdown.'));
}

function renderDigest(x, d) {
  const stat = (label, val, color) => h('div', { style: { textAlign: 'center', minWidth: '64px' } },
    h('div', { style: { fontFamily: 'var(--mono)', fontWeight: 800, fontSize: '18px', color: color || 'var(--text)' } }, val),
    h('div', { class: 'hint tiny' }, label));
  const stopped = (fn) => (e) => { e.stopPropagation(); fn(e); };
  const best = d.best;
  return h('div', {},
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '14px', justifyContent: 'space-around', marginBottom: '6px' } },
      stat(best ? best.label : 'Rating', best ? best.rating : (d.rating ?? '—')),
      x.puzzle_rating != null ? stat('⚡ Puzzles', x.puzzle_rating) : null,
      stat(`Last ${d.count}`, `${d.w}-${d.l}-${d.d}`),
      stat('Win rate', `${d.winRate}%`, d.winRate >= 50 ? 'var(--good)' : 'var(--warn)'),
      d.avgAcc != null ? stat('Accuracy', `${d.avgAcc}%`) : null,
      d.whiteRate != null ? stat('as White', `${d.whiteRate}%`) : null,
      d.blackRate != null ? stat('as Black', `${d.blackRate}%`) : null),
    best && best.all.length > 1 ? h('div', { class: 'hint tiny', style: { textAlign: 'center', marginBottom: '10px' } },
      'All ratings: ', best.all.map((r) => `${r.tc} ${r.rating}`).join(' · '), ` (${best.source})`) : null,
    needBlock(d),
    uscfSection(x),
    h('div', { class: 'row', style: { marginTop: '10px', gap: '8px', flexWrap: 'wrap' } },
      h('button', { class: 'btn small', onclick: stopped(() => reviewPuzzleHistory(x.username, nameOf(x))) }, '🧩 Puzzle history'),
      h('button', { class: 'btn ghost small', onclick: stopped(() => { personal.requestImport(x.username); CTX.navigate('personal'); }) }, 'Full report →'),
      h('button', { class: 'btn ghost small', onclick: stopped((e) => copy(studentLink({ u: x.username, name: x.name, g: x.group_id }, getRoster().coach), e.currentTarget, '✓ Link')) }, '🔗 Student link')));
}

// US Chess tournament history inside the coach's student digest. Auto-loads from the weekly cache
// when the student has an ID on their cloud row; otherwise the coach can set it right here.
function uscfSection(x) {
  const wrap = h('div', { style: { marginTop: '10px' }, onclick: (e) => e.stopPropagation() });
  if (/^\d{8,9}$/.test(x.uscf_id || '')) {
    // Scope the card to THIS student (x.username), so it never picks up the coach's own USCF id.
    const card = personal.uscfCard(x.uscf_id, x.username);
    if (card) { card.classList.remove('section'); card.style.marginTop = '6px'; wrap.append(card); }
    return wrap;
  }
  const input = h('input', { type: 'text', inputmode: 'numeric', placeholder: 'US Chess ID (8–9 digits)', style: { maxWidth: '210px' } });
  wrap.append(h('div', { class: 'row', style: { gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
    h('span', { class: 'hint tiny' }, '🏅 Tournaments:'),
    input,
    h('button', { class: 'btn ghost small', onclick: async (e) => {
      const id = input.value.trim();
      if (!/^\d{8,9}$/.test(id)) { input.focus(); return; }
      e.currentTarget.textContent = 'Saving…';
      await publishUscfId(x.username, id);
      x.uscf_id = id; CS.lbRows = null; draw();
    } }, 'Save ID')));
  return wrap;
}

// ============================ a student's puzzle history (solved + missed) on the board ============================
const sanOf = (fen, uci) => {
  if (!uci) return '';
  try { const c = new Chess(fen); const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined }); return m ? m.san : ''; } catch { return ''; }
};

async function reviewPuzzleHistory(username, dispName) {
  clear(host).append(h('div', { class: 'row' }, h('span', { class: 'spinner' }), ` Loading ${dispName}'s puzzle history…`));
  const rows = await fetchAttempts(username, 40);
  if (!rows || !rows.length) {
    clear(host).append(
      h('div', { class: 'empty section' }, `No puzzles logged for ${dispName} yet — they appear here once ${dispName} trains in the Puzzles tab.`),
      h('div', { class: 'hint tiny', style: { textAlign: 'center', marginTop: '8px' } }, 'Cross-device history needs the puzzle_attempts table in Supabase (see supabase_schema.sql).'),
      h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '10px' } }, h('button', { class: 'btn ghost', onclick: draw }, '← Back to students')));
    return;
  }
  CS.review = { rows, name: dispName };
  renderPuzzleHistoryList();
}

// List of every attempt (solved + missed) with the move they tried — tap one to work it on the board.
function renderPuzzleHistoryList() {
  const R = CS.review, rows = R.rows;
  const solved = rows.filter((r) => r.solved).length;
  clear(host).append(
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('button', { class: 'btn ghost small', onclick: () => { CS.review = null; draw(); } }, '← Back to students'),
      h('div', { class: 'hint tiny' }, `${solved} solved · ${rows.length - solved} missed`)),
    h('h1', { style: { marginTop: '6px', fontSize: '20px' } }, `🧩 ${R.name}'s puzzles`),
    h('p', { class: 'hint' }, 'What they solved and missed (with the move they tried). Tap any one to pull it up on the board and work through it together.'),
    h('div', { class: 'hist-list' }, ...rows.map((row, i) => {
      const ok = row.solved, sol = sanOf(row.fen, (row.moves || '').split(' ')[0]), tried = sanOf(row.fen, row.tried);
      return h('div', { class: 'hist-row' + (ok ? ' ok' : ' miss') },
        h('span', { class: 'hist-mark' }, ok ? '✓' : '✗'),
        h('div', { class: 'hist-main' },
          h('div', { class: 'hist-top' }, h('span', { class: 'hist-theme' }, themeLabel(row.theme)), row.rating ? h('span', { class: 'hint tiny' }, `lvl ${row.rating}`) : null),
          h('div', { class: 'hint tiny hist-detail' }, ok
            ? (sol ? `Best move: ${sol}` : 'Solved')
            : [h('span', {}, tried ? `Tried ${tried}` : 'Missed'), sol ? h('span', { style: { color: 'var(--accent)' } }, `  ·  best was ${sol}`) : null])),
        h('button', { class: 'btn ghost small', onclick: () => renderReviewOne(i) }, 'On board →'));
    })));
}

function renderReviewOne(i) {
  const R = CS.review, row = R.rows[i];
  const p = { id: row.puzzle_id, fen: row.fen, solutionMoves: (row.moves || '').split(' ').filter(Boolean), theme: row.theme, rating: row.rating };
  const triedSan = sanOf(row.fen, row.tried);
  clear(host);
  let toMove = 'White';
  try { toMove = new Chess(p.fen).turn() === 'w' ? 'White' : 'Black'; } catch { /* bad fen */ }
  const status = h('div', { class: 'puzzle-status' }, row.solved
    ? `${R.name} solved this one — replay it together.`
    : `${toMove} to move — ${R.name} missed this${triedSan ? ` (played ${triedSan})` : ''}. Find the move together.`);
  const side = h('div', { class: 'sidebar' });
  host.append(
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('button', { class: 'btn ghost small', onclick: renderPuzzleHistoryList }, '← Back to history'),
      h('div', { class: 'hint tiny' }, `${R.name} · ${themeLabel(p.theme)}`)),
    h('h1', { style: { marginTop: '6px', fontSize: '20px' } }, `🎬 Reviewing with ${R.name}`),
    h('div', { class: 'review section', style: { gridTemplateColumns: '480px 1fr' } },
      h('div', { class: 'board-wrap' }, h('div', { id: 'miss-board' })), side));
  const ctrl = mountPuzzle(document.getElementById('miss-board'), p, {
    allowRetry: true,
    onWrong: () => { status.textContent = 'Not the move — try again, or reveal it.'; status.className = 'puzzle-status no'; },
    onSolved: () => { status.textContent = '✓ That\'s the move!'; status.className = 'puzzle-status ok'; },
  });
  clear(side).append(...[status,
    triedSan && !row.solved ? h('div', { class: 'hint tiny', style: { marginTop: '6px' } }, `They played ${triedSan} here — see why it doesn't work, then find the right one.`) : null,
    h('div', { class: 'row', style: { gap: '8px', alignItems: 'center', marginTop: '10px' } },
      h('button', { class: 'btn ghost small', onclick: () => ctrl.hint() }, '💡 Show the move'),
      h('span', { class: 'hint tiny' }, p.rating ? `level ${p.rating}` : ''))].filter(Boolean));
}

// ============================ roster management (collapsed by default) ============================
function managePanel(r) {
  return h('div', { class: 'card section' },
    h('h2', { style: { marginTop: 0 } }, 'Manage roster'),
    inviteBlock(),
    // Adding another coach is a rarer action — tuck it in a collapsible so it doesn't crowd the
    // day-to-day "add students" flow, but it's one tap away when you need to bring on a co-coach.
    h('details', { class: 'drop', style: { margin: '10px 0' } },
      h('summary', {}, '👩‍🏫 Add another coach'),
      h('div', { style: { paddingTop: '10px' } }, inviteBlock(true))),
    addStudents(r),
    r.students.length ? localRosterList(r) : h('div', { class: 'hint tiny', style: { margin: '10px 0' } }, 'No students yet. Add them above.'),
    h('div', { class: 'row', style: { marginTop: '14px', gap: '8px', flexWrap: 'wrap' } },
      h('button', { class: 'btn small', onclick: async (e) => { e.currentTarget.textContent = 'Syncing…'; await pushToCloud(r); CS.lbRows = null; draw(); } }, '↑ Sync to leaderboard'),
      h('button', { class: 'btn ghost small', onclick: (e) => copy(classLink(r), e.currentTarget, '✓ Class link') }, '💾 Class link'),
      h('button', { class: 'btn ghost small', onclick: () => exportFile(r) }, '⬇ Backup'),
      h('button', { class: 'btn ghost small', onclick: importFile }, '⬆ Import')));
}

// The easy way to fill a roster: a self-enroll link + QR. Students open it, enter name + username
// + group, and land in the shared roster (with this coach recorded). See app.js showJoin().
// asCoach=true makes the co-coach version (?as=coach) — the same flow, but the person lands with the
// full coach nav (Students + Tournaments) and shows up under "Teachers" on the roster.
function inviteBlock(asCoach = false) {
  const coach = store.get('profile.username', '') || '';
  const url = location.origin + location.pathname + '?join=' + encodeURIComponent(coach) + (asCoach ? '&as=coach' : '');
  const linkInput = h('input', { type: 'text', readOnly: true, value: url, style: { fontFamily: 'var(--mono)', fontSize: '12px' }, onclick: (e) => e.currentTarget.select() });
  const copyBtn = h('button', { class: 'btn small', style: { flexShrink: 0 }, onclick: (e) => copy(url, e.currentTarget, '✓ Copied') }, 'Copy link');
  const qrBox = h('div', { class: 'qr-box' }, h('span', { class: 'hint tiny', style: { color: '#555' } }, 'QR…'));
  import('../qr.js').then((m) => m.qrSvg(url, { cellSize: 5 })).then((svg) => { if (svg) clear(qrBox).append(h('div', { html: svg })); else qrBox.remove(); }).catch(() => qrBox.remove());
  return h('div', { class: 'invite-block' + (asCoach ? ' coach-invite' : '') },
    h('div', { style: { fontWeight: 800, marginBottom: '3px' } }, asCoach ? '👩‍🏫 Invite a co-coach' : '📲 Invite students to join'),
    h('div', { class: 'hint tiny', style: { marginBottom: '10px' } }, asCoach
      ? 'Give this to another coach (like Will). They enter their name + Chess.com username and get the coach tools — Students + Tournaments — on their device, sharing this same roster.'
      : 'Share this link or QR code. Students enter their name + Chess.com username (or lichess:Name) and they\'re added to your roster automatically.'),
    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'nowrap' } }, linkInput, copyBtn),
    qrBox);
}

function addStudents(r) {
  const ta = h('textarea', { rows: 2, placeholder: 'One per line:  John D, jdsmith123   (or just usernames)', style: { width: '100%', fontFamily: 'var(--mono)', fontSize: '13px' } });
  const grpSel = h('select', {}, ...GROUPS.map((g) => h('option', { value: g.id, selected: g.id === CS.group }, g.label)), h('option', { value: 'teacher' }, 'Teachers'));
  grpSel.onchange = () => (CS.group = grpSel.value);
  const add = () => {
    const have = new Set(r.students.map((s) => s.u.toLowerCase()));
    for (const line of ta.value.split('\n')) {
      const parts = line.split(/[,\t]/).map((x) => x.trim()).filter(Boolean);
      if (!parts.length) continue;
      const name = parts.length >= 2 ? parts[0] : parts[0];
      const u = parts.length >= 2 ? parts[1] : parts[0];
      if (!u || have.has(u.toLowerCase())) continue;
      have.add(u.toLowerCase());
      r.students.push({ name, u, g: CS.group });
    }
    // Auto-pull each player's recent games so ratings/form/ladder populate the moment they're added.
    saveRoster(r); pushToCloud(r); CS.lbRows = null; CS.showManage = false; updateClass(r);
  };
  return h('div', {},
    ta,
    h('div', { class: 'row', style: { marginTop: '8px', gap: '10px', alignItems: 'center' } },
      h('label', { class: 'tiny' }, 'Group'), grpSel,
      h('button', { class: 'btn', onclick: add }, 'Add')));
}

function localRosterList(r) {
  const wrap = h('div', { class: 'section', style: { marginTop: '8px' } });
  const all = rosterList(); // cloud ∪ local — self-enrolled students used to be invisible here
  for (const g of [...GROUPS, { id: 'teacher', label: 'Teachers' }]) {
    const studs = all.filter((s) => (s.g || 'ms') === g.id);
    if (!studs.length) continue;
    wrap.append(h('div', { class: 'hint tiny', style: { fontWeight: 700, margin: '10px 0 4px' } }, `${g.label} (${studs.length})`));
    for (const s of studs) {
      wrap.append(h('div', { class: 'row', style: { justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--line)' } },
        h('div', {}, h('b', {}, nameOf(s)), h('span', { class: 'hint tiny', style: { marginLeft: '8px', fontFamily: 'var(--mono)' } }, s.u || '')),
        h('div', { class: 'row', style: { gap: '4px' } },
          h('button', { class: 'btn small ghost', title: 'Copy student link', onclick: (e) => copy(studentLink(s, r.coach), e.currentTarget, '✓') }, '🔗'),
          h('button', { class: 'btn small ghost', title: 'Remove', onclick: async (e) => {
            if (!confirm(`Remove ${nameOf(s)} from the club? They'll come off the leaderboard.`)) return;
            e.currentTarget.textContent = '…';
            // Also DELETE from the cloud — this only filtered the local list, so removed students
            // stayed ranked on every device forever (removeStudent existed but was never called).
            r.students = (r.students || []).filter((x) => String(x.u || '').toLowerCase() !== String(s.u || '').toLowerCase());
            saveRoster(r);
            try { await removeStudent(s.u); } catch { /* offline — they'll linger until next try */ }
            CS.lbRows = null; draw();
          } }, '🗑'))));
    }
  }
  return wrap;
}

// ============================ update ratings / sync ============================
async function updateClass(r) {
  if (CS.updating) return;
  // Iterate the REAL roster (cloud ∪ local). This used to walk r.students — the device-local list —
  // which is empty on a coach whose students all self-enrolled, so the button did nothing at all.
  const students = rosterList();
  if (!students.length) { alert('No students yet — share your join link under “＋ Manage roster,” or add them by hand.'); return; }
  r.students = students; // keep the local cache/backup in step with the cloud
  CS.updating = true; draw();
  const tc = store.get('profile.timeClass', 'rapid');
  const useTc = tc && tc !== 'all' ? tc : 'rapid';
  const gamesByUser = {};
  let done = 0;
  for (const s of students) {
    const key = s.u.toLowerCase();
    try {
      const games = await cc.fetchRecentGames(s.u, { months: 4, timeClass: 'all', limit: 100 });
      gamesByUser[key] = games;
      const tcg = games.filter((g) => g.timeClass === useTc);
      const form = { w: 0, l: 0, d: 0 };
      for (const g of tcg.slice(0, 15)) { if (g.userResult === 'win') form.w++; else if (g.userResult === 'loss') form.l++; else form.d++; }
      // The published rating is the player's HIGHEST current rating (same number the digest +
      // leaderboard show), not whatever control they happened to play last.
      const best = cc.bestRating(await cc.fetchStats(s.u).catch(() => null));
      CS.forms[key] = { rating: best?.rating ?? (tcg[0] || games[0])?.userRating ?? null, form };
      CS.tilt[key] = tiltSignals(games, { rating: (tcg[0] || games[0])?.userRating });
    } catch { CS.forms[key] = { rating: null, form: null }; }
    if (!CS.updating) return;
    done++;
    const pr = document.getElementById('cls-progress'); if (pr) pr.textContent = `Pulling games… ${done}/${students.length}`;
  }
  ingestLadder(r, gamesByUser);
  saveRoster(r);
  await pushToCloud(r);
  CS.lbRows = null; // force the leaderboard to refetch the fresh ratings
  CS.updating = false;
  draw();
}

async function pushToCloud(r) {
  if (!cloudEnabled()) return;
  for (const s of r.students) {
    const key = s.u.toLowerCase();
    const L = (r.ladder || {})[key];
    try { await upsertStudent({ username: s.u, name: s.name || s.u, group_id: s.g || 'ms', coach: r.coach, ladder_rating: L ? L.r : null, chesscom_rating: CS.forms[key]?.rating ?? null }); } catch { /* keep going */ }
  }
}

// ============================ portable links + file backup ============================
const appBase = () => location.origin + location.pathname;
function classLink(r) {
  const blob = encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(r)))));
  return `${appBase()}?class=${blob}&role=coach#/class`;
}
function studentLink(s, coach) {
  const p = new URLSearchParams({ u: s.u, name: s.name || s.u, role: 'student', g: s.g || 'ms' });
  if (coach) p.set('coach', coach);
  return `${appBase()}?${p.toString()}#/personal`;
}
function copy(text, btn, okLabel = '✓ Copied') {
  const done = () => { if (!btn) return; const o = btn.textContent; btn.textContent = okLabel; setTimeout(() => (btn.textContent = o), 1400); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => prompt('Copy this link:', text));
  else prompt('Copy this link:', text);
}
function exportFile(r) {
  const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `chess-class-${(r.name || 'club').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json` });
  document.body.appendChild(a); a.click(); a.remove();
}
function importFile() {
  const inp = h('input', { type: 'file', accept: 'application/json', style: { display: 'none' } });
  inp.onchange = () => { const f = inp.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { try { const r = JSON.parse(rd.result); if (r && Array.isArray(r.students)) { saveRoster(r); CS.lbRows = null; draw(); } } catch { alert('That file isn\'t a valid class backup.'); } }; rd.readAsText(f); };
  document.body.appendChild(inp); inp.click(); inp.remove();
}
