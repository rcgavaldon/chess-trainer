// views/classroom.js — coach view: one class roster of Chess.com usernames grouped into
// Middle / High School. Students never log in — they get a unique magic LINK (their public
// games are pulled by username). The whole roster rides inside the coach's "class link", so
// it auto-saves locally and reloads on ANY device from that one link. No backend.
import { h, clear } from '../dom.js';
import * as store from '../storage.js';
import * as cc from '../chesscom.js';
import * as personal from './personal.js';

const CS = { forms: {}, group: 'ms' };
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
    saveBar(r),
    addStudents(r),
    r.students.length ? rosterTable(r) : h('div', { class: 'empty section' }, 'Add students above. Each gets a personal link you can text or hand out — no logins.'),
  );
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
  wrap.append(h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
    h('button', { class: 'btn small', onclick: () => refreshForms(r) }, '↻ Refresh ratings & form')));
  for (const g of GROUPS) {
    const studs = r.students.filter((s) => (s.g || 'ms') === g.id);
    if (!studs.length) continue;
    wrap.append(h('h2', { style: { marginTop: '16px' } }, `${groupLabel(g.id)} (${studs.length})`),
      h('div', { class: 'card' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Student'), h('th', {}, 'Chess.com'), h('th', {}, 'Rating'), h('th', {}, 'Recent form'), h('th', {}, ''))),
        h('tbody', {}, ...studs.map((s) => studentRow(r, s))))));
  }
  return wrap;
}

function studentRow(r, s) {
  const f = CS.forms[s.u.toLowerCase()];
  const formStr = f && f.form ? `${f.form.w}W ${f.form.l}L ${f.form.d}D` : '—';
  const linkBtn = h('button', { class: 'btn small ghost', title: 'Copy this student\'s personal link', onclick: () => copy(studentLink(s, r.coach), linkBtn, '✓ Link') }, '🔗 Link');
  return h('tr', {},
    h('td', {}, h('b', {}, s.name || s.u)),
    h('td', { class: 'hint tiny', style: { fontFamily: 'var(--mono)' } }, s.u),
    h('td', {}, f ? (f.rating ?? '—') : h('span', { class: 'hint tiny' }, '—')),
    h('td', {}, formStr),
    h('td', {}, h('div', { class: 'row', style: { gap: '4px', justifyContent: 'flex-end' } },
      linkBtn,
      h('button', { class: 'btn small ghost', onclick: () => { personal.requestImport(s.u); CTX.navigate('personal'); } }, 'Review'),
      h('button', { class: 'btn small ghost', title: 'Remove', onclick: () => { r.students = r.students.filter((x) => x !== s); saveRoster(r); draw(); } }, '🗑'))),
  );
}

async function refreshForms(r) {
  const tc = store.get('profile.timeClass', 'rapid');
  for (const s of r.students) {
    try { CS.forms[s.u.toLowerCase()] = await cc.fetchPlayerForm(s.u, { timeClass: tc && tc !== 'all' ? tc : 'rapid', months: 1, limit: 15 }); }
    catch { CS.forms[s.u.toLowerCase()] = { username: s.u, rating: null, form: null }; }
    draw();
  }
}
