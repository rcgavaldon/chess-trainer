// views/classroom.js — teacher view: manage rosters of Chess.com usernames (students
// never log in — their games are public), see each student's rating + recent form,
// assign drills, and open any student in the full Personal review.
import { h, clear, pct } from '../dom.js';
import * as store from '../storage.js';
import * as cc from '../chesscom.js';
import * as personal from './personal.js';

const CS = { selected: null, forms: {} }; // forms keyed by username
let CTX = null, host = null;

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'class';

export function render(container, ctx) {
  CTX = ctx; host = container;
  draw();
}

function rosters() { return store.get('class.rosters', {}); }

function draw() {
  clear(host);
  host.append(h('h1', {}, 'Class'));
  if (CS.selected && rosters()[CS.selected]) drawRoster(rosters()[CS.selected]);
  else drawRosterList();
}

function drawRosterList() {
  const rs = rosters();
  const ids = Object.keys(rs);
  host.append(
    h('p', { class: 'hint' }, 'Group students by Chess.com username. No student logins needed — their games are public.'),
    ids.length
      ? h('div', { class: 'game-list section' }, ...ids.map((id) => h('div', { class: 'game-row', style: { gridTemplateColumns: '1fr auto auto' }, onclick: () => { CS.selected = id; draw(); } },
          h('div', {}, h('div', { class: 'opp' }, rs[id].name), h('div', { class: 'meta' }, `${rs[id].students.length} students`)),
          h('button', { class: 'btn small ghost', onclick: (e) => { e.stopPropagation(); CS.selected = id; draw(); } }, 'Open'),
          h('button', { class: 'btn small ghost', onclick: (e) => { e.stopPropagation(); if (confirm(`Delete roster “${rs[id].name}”?`)) { delete rs[id]; store.set('class.rosters', rs); draw(); } } }, '🗑'))))
      : h('div', { class: 'empty' }, 'No classes yet. Create one below.'),
    createForm(),
  );
}

function createForm() {
  const name = h('input', { type: 'text', placeholder: 'Class name, e.g. Period 3' });
  return h('div', { class: 'card section' },
    h('h2', {}, 'New class'),
    h('div', { class: 'row' }, name, h('button', { class: 'btn', onclick: () => {
      const n = name.value.trim(); if (!n) return;
      const id = slug(n);
      const rs = rosters(); rs[id] = { name: n, createdAt: Date.now(), students: [] };
      store.set('class.rosters', rs); CS.selected = id; draw();
    } }, 'Create')));
}

function drawRoster(roster) {
  host.append(
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('button', { class: 'btn ghost small', onclick: () => { CS.selected = null; draw(); } }, '← All classes'),
      h('button', { class: 'btn small', onclick: () => refreshForms(roster) }, 'Refresh ratings & form')),
    h('h2', { style: { marginTop: '14px' } }, roster.name),
    addStudentsRow(roster),
    roster.students.length ? studentTable(roster) : h('div', { class: 'empty' }, 'Add student usernames above.'),
  );
}

function addStudentsRow(roster) {
  const inp = h('input', { type: 'text', placeholder: 'usernames (comma or space separated)' });
  return h('div', { class: 'row section' }, inp, h('button', { class: 'btn', onclick: () => {
    const names = inp.value.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
    const have = new Set(roster.students.map((s) => s.username.toLowerCase()));
    for (const u of names) if (!have.has(u.toLowerCase())) roster.students.push({ username: u, alias: '', assignedDrills: [] });
    saveRoster(roster); draw();
  } }, 'Add'));
}

function saveRoster(roster) { const rs = rosters(); rs[CS.selected] = roster; store.set('class.rosters', rs); }

function studentTable(roster) {
  const tbl = h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'Student'), h('th', {}, 'Rating'), h('th', {}, 'Recent form'), h('th', {}, 'Drills'), h('th', {}, ''))),
    h('tbody', {}, ...roster.students.map((s) => studentRow(roster, s))));
  return h('div', { class: 'section' }, tbl);
}

function studentRow(roster, s) {
  const f = CS.forms[s.username.toLowerCase()];
  const formStr = f && f.form ? `${f.form.w}W ${f.form.l}L ${f.form.d}D` : '—';
  return h('tr', {},
    h('td', {}, h('b', {}, s.username), s.alias ? h('span', { class: 'hint tiny' }, ' (' + s.alias + ')') : null),
    h('td', {}, f ? (f.rating ?? '—') : h('span', { class: 'hint tiny' }, 'refresh')),
    h('td', {}, formStr),
    h('td', {}, s.assignedDrills.length ? s.assignedDrills.join(', ') : h('span', { class: 'hint tiny' }, 'none')),
    h('td', {}, h('div', { class: 'row' },
      h('button', { class: 'btn small ghost', onclick: () => openStudent(s.username) }, 'Review'),
      h('button', { class: 'btn small ghost', onclick: () => assignDrill(roster, s) }, 'Assign'),
      h('button', { class: 'btn small ghost', onclick: () => { roster.students = roster.students.filter((x) => x !== s); saveRoster(roster); draw(); } }, '🗑'))),
  );
}

async function refreshForms(roster) {
  const tc = store.get('profile.timeClass', 'rapid');
  for (const s of roster.students) {
    try { CS.forms[s.username.toLowerCase()] = await cc.fetchPlayerForm(s.username, { timeClass: tc === 'all' ? 'rapid' : tc, months: 1, limit: 15 }); }
    catch { CS.forms[s.username.toLowerCase()] = { username: s.username, rating: null, form: null }; }
    draw(); // progressive update
  }
}

function assignDrill(roster, s) {
  const d = prompt('Assign a drill theme (e.g. fork, pin, hangingPiece, backRankMate, endgame):', s.assignedDrills[0] || 'fork');
  if (d == null) return;
  s.assignedDrills = d.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  saveRoster(roster); draw();
}

function openStudent(username) {
  personal.requestImport(username);
  CTX.navigate('personal');
}
