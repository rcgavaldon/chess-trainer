// views/classroom.js — coach view: one class roster of Chess.com usernames grouped into
// Middle / High School. Students never log in — they get a unique magic LINK (their public
// games are pulled by username). The whole roster rides inside the coach's "class link", so
// it auto-saves locally and reloads on ANY device from that one link. No backend.
import { h, clear } from '../dom.js';
import * as store from '../storage.js';
import * as cc from '../chesscom.js';
import * as personal from './personal.js';
import { ingestLadder, standings, mostImproved } from '../ladder.js';
import { tiltSignals, tiltColor } from '../tilt.js';
import { cloudEnabled, setCloudConfig, ping, upsertStudent, fetchStudents } from '../cloud.js';

const CS = { forms: {}, tilt: {}, group: 'ms', updating: false };
let CTX = null, host = null;

const GROUPS = [{ id: 'ms', label: 'Middle School' }, { id: 'hs', label: 'High School' }];
const groupLabel = (g) => (GROUPS.find((x) => x.id === g) || GROUPS[0]).label;

export function render(container, ctx) { CTX = ctx; host = container; draw(); }

function getRoster() {
  let r = store.get('class.roster', null);
  if (!r) r = { name: 'My Chess Club', coach: store.get('profile.username', ''), coachName: store.get('profile.ownerName', 'Coach'), students: [] };
  return r;
}
function saveRoster(r) { store.set('class.roster', r); } // auto-saves on every change

// ---- shared backend (optional): connect, sync roster, live leaderboard ----
function cloudPanel(r) {
  if (!cloudEnabled()) {
    const url = h('input', { type: 'text', placeholder: 'https://xxxx.supabase.co', style: { fontFamily: 'var(--mono)', fontSize: '12px' } });
    const key = h('input', { type: 'password', placeholder: 'anon public key (eyJ…)', style: { fontFamily: 'var(--mono)', fontSize: '12px' } });
    const msg = h('div', { class: 'hint tiny' });
    const connect = async () => {
      if (!url.value.trim() || !key.value.trim()) { msg.textContent = 'Paste both the URL and the anon key.'; return; }
      setCloudConfig(url.value, key.value); msg.textContent = 'Connecting…';
      try { await ping(); msg.textContent = '✓ Connected!'; await syncToCloud(r); draw(); }
      catch (e) { setCloudConfig('', ''); msg.textContent = '✗ Could not connect: ' + e.message.slice(0, 90); }
    };
    return h('div', { class: 'card section' },
      h('div', { style: { fontWeight: 700 } }, '☁ Connect the shared leaderboard'),
      h('div', { class: 'hint tiny', style: { margin: '4px 0 8px' } }, 'One-time setup so you + Will share one live roster + leaderboard across devices. Follow SUPABASE_SETUP.md, then paste your two values.'),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '440px' } }, url, key, h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: connect }, 'Connect'), msg)));
  }
  return h('div', { class: 'card section', style: { borderColor: 'var(--good)' } },
    h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' } },
      h('div', {}, h('b', {}, '☁ Connected'), h('div', { class: 'hint tiny' }, 'Roster + leaderboard are shared live across devices.')),
      h('div', { class: 'row', style: { gap: '6px' } },
        h('button', { class: 'btn small ghost', onclick: async () => { await syncToCloud(r); draw(); } }, '↑ Sync roster'),
        h('button', { class: 'btn small ghost', onclick: () => { if (confirm('Disconnect this device from the shared leaderboard?')) { setCloudConfig('', ''); draw(); } } }, 'Disconnect'))));
}

async function syncToCloud(r) {
  if (!cloudEnabled()) return;
  for (const s of r.students) {
    const key = s.u.toLowerCase();
    const L = (r.ladder || {})[key];
    try { await upsertStudent({ username: s.u, name: s.name || s.u, group_id: s.g || 'ms', coach: r.coach, ladder_rating: L ? L.r : null, chesscom_rating: CS.forms[key]?.rating ?? null }); } catch { /* keep going */ }
  }
}

const GROUP_LABEL = { ms: 'Middle School', hs: 'High School', teacher: 'Teachers' };
function cloudLeaderboard() {
  const wrap = h('div', { class: 'section', id: 'cloud-lb' }, h('h2', {}, '🏆 Live leaderboard'), h('div', { class: 'row' }, h('span', { class: 'spinner' }), ' Loading…'));
  fetchStudents().then((rows) => { if (document.getElementById('cloud-lb') === wrap) { clear(wrap).append(h('h2', {}, '🏆 Live leaderboard'), leaderboardTable(rows || [])); } })
    .catch((e) => { if (document.getElementById('cloud-lb') === wrap) clear(wrap).append(h('h2', {}, '🏆 Live leaderboard'), h('div', { class: 'hint tiny' }, 'Could not load: ' + e.message.slice(0, 70))); });
  return wrap;
}
function leaderboardTable(rows) {
  const flt = CS.lbFilter || 'all';
  const filtered = rows.filter((x) => flt === 'all' || (x.group_id || 'ms') === flt).filter((x) => x.ladder_rating != null).sort((a, b) => b.ladder_rating - a.ladder_rating);
  const chip = (id, label) => h('button', { class: 'chip' + (flt === id ? ' active-chip' : ''), onclick: () => { CS.lbFilter = id; draw(); } }, label);
  return h('div', {},
    h('div', { class: 'chip-row', style: { marginBottom: '8px' } }, chip('all', 'Everyone'), chip('ms', 'Middle School'), chip('hs', 'High School'), chip('teacher', 'Teachers')),
    filtered.length ? h('div', { class: 'card' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Player'), h('th', {}, 'Group'), h('th', {}, 'Ladder'), h('th', {}, 'Chess.com'))),
      h('tbody', {}, ...filtered.slice(0, 50).map((x, i) => h('tr', {},
        h('td', {}, h('b', {}, i + 1)),
        h('td', {}, x.name || x.username),
        h('td', { class: 'hint tiny' }, GROUP_LABEL[x.group_id] || x.group_id || '—'),
        h('td', {}, h('b', { style: { fontFamily: 'var(--mono)' } }, x.ladder_rating)),
        h('td', { class: 'hint tiny' }, x.chesscom_rating ?? '—'))))))
      : h('div', { class: 'hint tiny' }, 'No ranked players yet — run "Update class" so ladder ratings sync up.'));
}

// ---- portable links (the roster lives inside the link — no server) ----
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

function draw() {
  const r = getRoster();
  clear(host);
  host.append(
    h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'baseline' } },
      h('h1', {}, 'Class'),
      h('div', { class: 'hint tiny' }, `${r.students.length} students`)),
    cloudPanel(r),
    saveBar(r),
    addStudents(r),
    r.students.length ? rosterTable(r) : h('div', { class: 'empty section' }, 'Add students above. Each gets a personal link you can text or hand out — no logins.'),
    r.students.length ? ladderSection(r) : null,
    r.students.length ? improvedSection(r) : null,
    cloudEnabled() ? cloudLeaderboard() : null,
  );
}

function ladderSection(r) {
  const wrap = h('div', { class: 'section' });
  let any = false;
  for (const g of GROUPS) {
    const rows = standings(r, g.id);
    if (!rows.length) continue;
    any = true;
    wrap.append(h('h2', { style: { marginTop: '18px' } }, `🏆 ${groupLabel(g.id)} ladder`),
      h('div', { class: 'card' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Student'), h('th', {}, 'Ladder rating'), h('th', {}, 'Games'))),
        h('tbody', {}, ...rows.map((x) => h('tr', {},
          h('td', {}, h('b', {}, x.rank)),
          h('td', {}, x.name),
          h('td', {}, h('b', { style: { fontFamily: 'var(--mono)' } }, x.L.r), x.provisional ? h('span', { class: 'hint tiny' }, ' provisional') : null),
          h('td', { class: 'hint tiny' }, x.L.games)))))));
  }
  return any ? wrap : h('div', { class: 'hint tiny section' }, 'The class ladder fills in automatically once your students play rated games against each other — hit “Update class” after they do.');
}

function improvedSection(r) {
  const rows = mostImproved(r, { windowDays: 30, minGames: 5 });
  if (!rows.length) return null;
  return h('div', { class: 'section' },
    h('h2', {}, '📈 Most improved (last 30 days)'),
    h('div', { class: 'card' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Student'), h('th', {}, 'Gain'), h('th', {}, 'Now'), h('th', {}, 'Games'))),
      h('tbody', {}, ...rows.slice(0, 8).map((m) => h('tr', {},
        h('td', {}, h('b', {}, m.name), h('span', { class: 'hint tiny' }, ' · ' + groupLabel(m.g))),
        h('td', {}, h('b', { style: { color: m.delta >= 0 ? 'var(--good)' : 'var(--bad)', fontFamily: 'var(--mono)' } }, (m.delta >= 0 ? '+' : '') + m.delta)),
        h('td', { class: 'hint tiny' }, m.to),
        h('td', { class: 'hint tiny' }, m.games)))))));
}

// Save & share the whole class as one link (+ file backup).
function saveBar(r) {
  const nameInp = h('input', { type: 'text', value: r.name, style: { maxWidth: '220px' }, onchange: (e) => { r.name = e.target.value.trim() || 'My Chess Club'; saveRoster(r); } });
  const linkBtn = h('button', { class: 'btn', onclick: () => copy(classLink(r), linkBtn, '✓ Class link copied') }, '💾 Save & copy class link');
  return h('div', { class: 'card section' },
    h('div', { class: 'row', style: { justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' } },
      h('div', { class: 'field' }, h('label', { class: 'tiny' }, 'Class name'), nameInp),
      h('div', { class: 'row', style: { gap: '8px', alignItems: 'flex-end' } },
        linkBtn,
        h('button', { class: 'btn ghost', onclick: () => exportFile(r) }, '⬇ Backup file'),
        h('button', { class: 'btn ghost', onclick: importFile }, '⬆ Import'))),
    h('div', { class: 'hint tiny', style: { marginTop: '8px' } }, 'Your whole class is saved inside the class link — bookmark it and open it on any device to load everyone. It updates every time you hit Save.'));
}

function exportFile(r) {
  const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `chess-class-${(r.name || 'club').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json` });
  document.body.appendChild(a); a.click(); a.remove();
}
function importFile() {
  const inp = h('input', { type: 'file', accept: 'application/json', style: { display: 'none' } });
  inp.onchange = () => { const f = inp.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { try { const r = JSON.parse(rd.result); if (r && Array.isArray(r.students)) { saveRoster(r); draw(); } } catch { alert('That file isn\'t a valid class backup.'); } }; rd.readAsText(f); };
  document.body.appendChild(inp); inp.click(); inp.remove();
}

// Bulk add — paste "Name, username" per line, or just usernames; pick the group.
function addStudents(r) {
  const ta = h('textarea', { rows: 3, placeholder: 'One per line:\nJohn D, jdsmith123\nAmy R, amychess\n…or just usernames', style: { width: '100%', fontFamily: 'var(--mono)', fontSize: '13px' } });
  const grpSel = h('select', {}, ...GROUPS.map((g) => h('option', { value: g.id, selected: g.id === CS.group }, g.label)));
  grpSel.onchange = () => (CS.group = grpSel.value);
  const add = () => {
    const have = new Set(r.students.map((s) => s.u.toLowerCase()));
    for (const line of ta.value.split('\n')) {
      const parts = line.split(/[,\t]/).map((x) => x.trim()).filter(Boolean);
      if (!parts.length) continue;
      let name, u;
      if (parts.length >= 2) { name = parts[0]; u = parts[1]; }
      else { u = parts[0]; name = parts[0]; }
      if (!u || have.has(u.toLowerCase())) continue;
      have.add(u.toLowerCase());
      r.students.push({ name, u, g: CS.group });
    }
    saveRoster(r); draw();
  };
  return h('div', { class: 'card section' },
    h('h2', {}, 'Add students'),
    ta,
    h('div', { class: 'row', style: { marginTop: '8px', gap: '10px', alignItems: 'center' } },
      h('label', { class: 'tiny' }, 'Group'), grpSel,
      h('button', { class: 'btn', onclick: add }, 'Add to class')));
}

function rosterTable(r) {
  const wrap = h('div', { class: 'section' });
  wrap.append(h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center' } },
    h('div', { class: 'hint tiny', id: 'cls-status' }, CS.updating ? 'Updating…' : 'Pulls each student\'s public games to update ratings, the ladder, and tilt.'),
    h('button', { class: 'btn small', disabled: CS.updating, onclick: () => updateClass(r) }, CS.updating ? 'Updating…' : '↻ Update class')));
  for (const g of GROUPS) {
    const studs = r.students.filter((s) => (s.g || 'ms') === g.id);
    if (!studs.length) continue;
    wrap.append(h('h2', { style: { marginTop: '16px' } }, `${groupLabel(g.id)} (${studs.length})`),
      h('div', { class: 'card' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Student'), h('th', {}, 'Chess.com'), h('th', {}, 'Ladder'), h('th', {}, 'Form'), h('th', {}, 'Tilt'), h('th', {}, ''))),
        h('tbody', {}, ...studs.map((s) => studentRow(r, s))))));
  }
  return wrap;
}

function studentRow(r, s) {
  const key = s.u.toLowerCase();
  const f = CS.forms[key];
  const L = (r.ladder || {})[key];
  const t = CS.tilt[key];
  const formStr = f && f.form ? `${f.form.w}-${f.form.l}-${f.form.d}` : '—';
  const linkBtn = h('button', { class: 'btn small ghost', title: 'Copy this student\'s personal link', onclick: () => copy(studentLink(s, r.coach), linkBtn, '✓ Link') }, '🔗');
  return h('tr', {},
    h('td', {}, h('b', {}, s.name || s.u), h('div', { class: 'hint tiny', style: { fontFamily: 'var(--mono)' } }, s.u)),
    h('td', {}, f ? (f.rating ?? '—') : h('span', { class: 'hint tiny' }, '—')),
    h('td', {}, L ? h('b', { style: { fontFamily: 'var(--mono)' } }, L.r) : h('span', { class: 'hint tiny' }, '—')),
    h('td', { class: 'hint tiny' }, formStr),
    h('td', {}, t && t.level !== 'clear'
      ? h('span', { class: 'pill', style: { background: 'rgba(0,0,0,.001)', color: tiltColor(t.level), border: `1px solid ${tiltColor(t.level)}`, fontSize: '11px' }, title: t.signals.join('; ') }, t.level === 'red' ? '🛑 tilting' : '⚠️ watch')
      : (t ? h('span', { class: 'hint tiny', style: { color: 'var(--good)' } }, '✓') : h('span', { class: 'hint tiny' }, '—'))),
    h('td', {}, h('div', { class: 'row', style: { gap: '4px', justifyContent: 'flex-end' } },
      linkBtn,
      h('button', { class: 'btn small ghost', onclick: () => { personal.requestImport(s.u); CTX.navigate('personal'); } }, 'Review'),
      h('button', { class: 'btn small ghost', title: 'Remove', onclick: () => { r.students = r.students.filter((x) => x !== s); saveRoster(r); draw(); } }, '🗑'))),
  );
}

// Pull each student's public games → refresh rating/form, ingest roster-vs-roster games into
// the ladder, and compute a live tilt read. One button; everything else cascades off it.
async function updateClass(r) {
  if (CS.updating) return;
  CS.updating = true; draw();
  const tc = store.get('profile.timeClass', 'rapid');
  const useTc = tc && tc !== 'all' ? tc : 'rapid';
  const gamesByUser = {};
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
    if (!CS.updating) return; // user navigated away
    draw();
  }
  ingestLadder(r, gamesByUser);
  saveRoster(r);
  CS.updating = false;
  draw();
}
