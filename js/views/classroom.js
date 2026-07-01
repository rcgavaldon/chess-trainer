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
import { cloudEnabled, upsertStudent, fetchStudents } from '../cloud.js';

const CS = { forms: {}, tilt: {}, group: 'ms', updating: false, lbRows: null, lbFilter: 'all', expanded: null, showManage: false };
let CTX = null, host = null;

const GROUPS = [{ id: 'ms', label: 'Middle School' }, { id: 'hs', label: 'High School' }];
const GROUP_LABEL = { ms: 'Middle School', hs: 'High School', teacher: 'Teachers' };

export function render(container, ctx) { CTX = ctx; host = container; draw(); }

function getRoster() {
  let r = store.get('class.roster', null);
  if (!r) r = { name: 'My Chess Club', coach: store.get('profile.username', ''), coachName: store.get('profile.ownerName', 'Coach'), students: [] };
  return r;
}
function saveRoster(r) { store.set('class.roster', r); }

// ============================ main view ============================
function draw() {
  const r = getRoster();
  clear(host);
  host.append(
    h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' } },
      h('h1', {}, 'Students'),
      h('div', { class: 'row', style: { gap: '6px', alignItems: 'center' } },
        h('span', { class: 'hint tiny' }, `${r.students.length} in roster · ☁ live`),
        h('button', { class: 'btn small', disabled: CS.updating, onclick: () => updateClass(r) }, CS.updating ? 'Updating…' : '↻ Update ratings'),
        h('button', { class: 'btn ghost small', onclick: () => { CS.showManage = !CS.showManage; draw(); } }, CS.showManage ? '✕ Close' : '＋ Manage roster'))),
    CS.updating ? h('div', { class: 'hint tiny', id: 'cls-progress', style: { marginTop: '4px' } }, 'Pulling each student\'s games…') : null,
    CS.showManage ? managePanel(r) : null,
    cloudEnabled() ? leaderboardSection() : h('div', { class: 'empty section' }, 'The shared leaderboard isn\'t connected on this device.'),
  );
}

// ============================ leaderboard (the centerpiece) ============================
function leaderboardSection() {
  const wrap = h('div', { class: 'section', id: 'lb-wrap' });
  if (CS.lbRows) { renderLeaderboardInner(wrap); return wrap; }
  wrap.append(h('h2', {}, '🏆 Leaderboard'), h('div', { class: 'row' }, h('span', { class: 'spinner' }), ' Loading the class…'));
  fetchStudents().then((rows) => { CS.lbRows = rows || []; const w = document.getElementById('lb-wrap'); if (w) renderLeaderboardInner(w); })
    .catch((e) => { const w = document.getElementById('lb-wrap'); if (w) { clear(w).append(h('h2', {}, '🏆 Leaderboard'), h('div', { class: 'hint tiny' }, 'Could not load: ' + e.message.slice(0, 60))); } });
  return wrap;
}

// Re-renders ONLY the leaderboard from cached rows — group filters are instant, no refetch, no
// full-page redraw (that was the "full refresh" glitch when switching HS/MS).
function renderLeaderboardInner(wrap) {
  clear(wrap);
  const flt = CS.lbFilter;
  const rows = (CS.lbRows || [])
    .filter((x) => flt === 'all' || (x.group_id || 'ms') === flt)
    .filter((x) => x.ladder_rating != null)
    .sort((a, b) => b.ladder_rating - a.ladder_rating);
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
      ? h('div', { class: 'card', style: { padding: '0' } }, ...rows.slice(0, 80).map((x, i) => lbRow(x, i)))
      : h('div', { class: 'empty' }, CS.lbRows && CS.lbRows.length ? 'No ranked players in this group yet.' : 'No students yet — add them under “Manage roster,” then hit “Update ratings.”'));
}

function lbRow(x, i) {
  const u = (x.username || '').toLowerCase();
  const open = CS.expanded === u;
  const row = h('div', {
    class: 'lb-row', style: { display: 'grid', gridTemplateColumns: '30px 1fr auto 74px 18px', gap: '10px', alignItems: 'center', padding: '11px 14px', borderTop: i ? '1px solid var(--line)' : 'none', cursor: 'pointer', background: open ? 'var(--bg-soft)' : 'transparent' },
    onclick: () => { CS.expanded = open ? null : u; renderLeaderboardInner(document.getElementById('lb-wrap')); },
  },
    h('b', { style: { fontFamily: 'var(--mono)', color: i < 3 ? 'var(--accent)' : 'var(--muted)' } }, i + 1),
    h('div', {}, h('b', {}, x.name || x.username), h('span', { class: 'hint tiny', style: { marginLeft: '8px' } }, GROUP_LABEL[x.group_id] || '')),
    h('div', { class: 'hint tiny', style: { textAlign: 'right' } }, x.chesscom_rating != null ? `${x.chesscom_rating} cc` : ''),
    h('div', { style: { textAlign: 'right' } }, h('b', { style: { fontFamily: 'var(--mono)', fontSize: '16px' } }, x.ladder_rating)),
    h('span', { class: 'hint tiny' }, open ? '▲' : '▾'));
  if (!open) return row;
  const box = h('div', { class: 'card', style: { margin: '0 14px 14px', background: 'var(--bg-soft)' } }, h('div', { class: 'row' }, h('span', { class: 'spinner' }), ` Loading ${x.name || x.username}…`));
  loadDigest(x, box);
  return h('div', {}, row, box);
}

async function loadDigest(x, box) {
  try {
    const games = await cc.fetchRecentGames(x.username, { months: 3, timeClass: 'all', limit: 40 });
    const d = studentDigest(games);
    if (box.isConnected) clear(box).append(renderDigest(x, d));
  } catch { if (box.isConnected) clear(box).append(h('div', { class: 'hint tiny' }, 'Couldn\'t pull this student\'s games right now.')); }
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

function renderDigest(x, d) {
  const stat = (label, val, color) => h('div', { style: { textAlign: 'center', minWidth: '64px' } },
    h('div', { style: { fontFamily: 'var(--mono)', fontWeight: 800, fontSize: '18px', color: color || 'var(--text)' } }, val),
    h('div', { class: 'hint tiny' }, label));
  const stopped = (fn) => (e) => { e.stopPropagation(); fn(e); };
  return h('div', {},
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '14px', justifyContent: 'space-around', marginBottom: '12px' } },
      stat('Rating', d.rating ?? '—'),
      stat(`Last ${d.count}`, `${d.w}-${d.l}-${d.d}`),
      stat('Win rate', `${d.winRate}%`, d.winRate >= 50 ? 'var(--good)' : 'var(--warn)'),
      d.avgAcc != null ? stat('Accuracy', `${d.avgAcc}%`) : null,
      d.whiteRate != null ? stat('as White', `${d.whiteRate}%`) : null,
      d.blackRate != null ? stat('as Black', `${d.blackRate}%`) : null),
    ...d.recs.map((rec, i) => h('div', { class: 'explain-box', style: { fontSize: '13px', marginBottom: '8px' } }, i === 0 ? h('b', {}, '📌 What they need: ') : h('b', {}, '• '), rec)),
    h('div', { class: 'row', style: { marginTop: '10px', gap: '8px', flexWrap: 'wrap' } },
      h('button', { class: 'btn small', onclick: stopped(() => { personal.requestImport(x.username); CTX.navigate('personal'); }) }, 'Open full report →'),
      h('button', { class: 'btn ghost small', onclick: stopped((e) => copy(studentLink({ u: x.username, name: x.name, g: x.group_id }, getRoster().coach), e.currentTarget, '✓ Link')) }, '🔗 Student link')));
}

// ============================ roster management (collapsed by default) ============================
function managePanel(r) {
  return h('div', { class: 'card section' },
    h('h2', { style: { marginTop: 0 } }, 'Manage roster'),
    addStudents(r),
    r.students.length ? localRosterList(r) : h('div', { class: 'hint tiny', style: { margin: '10px 0' } }, 'No students yet. Add them above.'),
    h('div', { class: 'row', style: { marginTop: '14px', gap: '8px', flexWrap: 'wrap' } },
      h('button', { class: 'btn small', onclick: async (e) => { e.currentTarget.textContent = 'Syncing…'; await pushToCloud(r); CS.lbRows = null; draw(); } }, '↑ Sync to leaderboard'),
      h('button', { class: 'btn ghost small', onclick: (e) => copy(classLink(r), e.currentTarget, '✓ Class link') }, '💾 Class link'),
      h('button', { class: 'btn ghost small', onclick: () => exportFile(r) }, '⬇ Backup'),
      h('button', { class: 'btn ghost small', onclick: importFile }, '⬆ Import')));
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
    saveRoster(r); pushToCloud(r); CS.lbRows = null; draw();
  };
  return h('div', {},
    ta,
    h('div', { class: 'row', style: { marginTop: '8px', gap: '10px', alignItems: 'center' } },
      h('label', { class: 'tiny' }, 'Group'), grpSel,
      h('button', { class: 'btn', onclick: add }, 'Add')));
}

function localRosterList(r) {
  const wrap = h('div', { class: 'section', style: { marginTop: '8px' } });
  for (const g of [...GROUPS, { id: 'teacher', label: 'Teachers' }]) {
    const studs = r.students.filter((s) => (s.g || 'ms') === g.id);
    if (!studs.length) continue;
    wrap.append(h('div', { class: 'hint tiny', style: { fontWeight: 700, margin: '10px 0 4px' } }, `${g.label} (${studs.length})`));
    for (const s of studs) {
      wrap.append(h('div', { class: 'row', style: { justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--line)' } },
        h('div', {}, h('b', {}, s.name || s.u), h('span', { class: 'hint tiny', style: { marginLeft: '8px', fontFamily: 'var(--mono)' } }, s.u)),
        h('div', { class: 'row', style: { gap: '4px' } },
          h('button', { class: 'btn small ghost', title: 'Copy student link', onclick: (e) => copy(studentLink(s, r.coach), e.currentTarget, '✓') }, '🔗'),
          h('button', { class: 'btn small ghost', title: 'Remove', onclick: () => { r.students = r.students.filter((x) => x !== s); saveRoster(r); pushToCloud(r); CS.lbRows = null; draw(); } }, '🗑'))));
    }
  }
  return wrap;
}

// ============================ update ratings / sync ============================
async function updateClass(r) {
  if (CS.updating) return;
  CS.updating = true; draw();
  const tc = store.get('profile.timeClass', 'rapid');
  const useTc = tc && tc !== 'all' ? tc : 'rapid';
  const gamesByUser = {};
  let done = 0;
  for (const s of r.students) {
    const key = s.u.toLowerCase();
    try {
      const games = await cc.fetchRecentGames(s.u, { months: 2, timeClass: 'all', limit: 40 });
      gamesByUser[key] = games;
      const tcg = games.filter((g) => g.timeClass === useTc);
      const form = { w: 0, l: 0, d: 0 };
      for (const g of tcg.slice(0, 15)) { if (g.userResult === 'win') form.w++; else if (g.userResult === 'loss') form.l++; else form.d++; }
      CS.forms[key] = { rating: (tcg[0] || games[0])?.userRating ?? null, form };
      CS.tilt[key] = tiltSignals(games, { rating: (tcg[0] || games[0])?.userRating });
    } catch { CS.forms[key] = { rating: null, form: null }; }
    if (!CS.updating) return;
    done++;
    const pr = document.getElementById('cls-progress'); if (pr) pr.textContent = `Pulling games… ${done}/${r.students.length}`;
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
