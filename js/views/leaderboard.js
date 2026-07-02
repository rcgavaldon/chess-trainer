// views/leaderboard.js — the shared class leaderboard as its own tab (students + coaches).
// Read-only, ranked by our ladder rating when available else Chess.com rating, with the viewer
// highlighted. Filters by group with no refetch.
import { h, clear } from '../dom.js';
import * as store from '../storage.js';
import { cloudEnabled, fetchStudents } from '../cloud.js';

const LB = { filter: 'all', rows: null };
let CTX = null, host = null;

const GROUP_LABEL = { ms: 'Middle School', hs: 'High School', teacher: 'Teachers' };
const clean = (s) => (s != null && String(s).trim() && String(s).trim().toLowerCase() !== 'null') ? String(s).trim() : null;
const nameOf = (x) => clean(x && x.name) || clean(x && x.username) || 'Player';
const rateOf = (x) => (x.ladder_rating != null ? x.ladder_rating : x.chesscom_rating);

export function render(container, ctx) {
  CTX = ctx; host = container; clear(host);
  if (!cloudEnabled()) { host.append(h('h1', {}, '🏆 Leaderboard'), h('div', { class: 'empty' }, 'The shared leaderboard isn\'t connected on this device.')); return; }
  if (LB.rows) { drawTable(); return; }
  host.append(h('h1', {}, '🏆 Leaderboard'), h('div', { class: 'row', style: { marginTop: '12px' } }, h('span', { class: 'spinner' }), ' Loading the class…'));
  fetchStudents().then((rows) => { LB.rows = rows || []; drawTable(); })
    .catch((e) => { clear(host).append(h('h1', {}, '🏆 Leaderboard'), h('div', { class: 'hint tiny' }, 'Could not load: ' + e.message.slice(0, 70))); });
}

function drawTable() {
  clear(host);
  const me = (store.get('profile.username', '') || '').toLowerCase();
  const flt = LB.filter;
  const rows = (LB.rows || [])
    .filter((x) => flt === 'all' || (x.group_id || 'ms') === flt)
    .filter((x) => rateOf(x) != null)
    .sort((a, b) => rateOf(b) - rateOf(a));
  const myRank = rows.findIndex((x) => (x.username || '').toLowerCase() === me);
  const chip = (id, label) => h('button', { class: 'chip', style: flt === id ? { background: 'var(--accent)', color: '#0a1e12', fontWeight: 700, borderColor: 'var(--accent)' } : {}, onclick: () => { LB.filter = id; drawTable(); } }, label);
  host.append(
    h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' } },
      h('h1', {}, '🏆 Leaderboard'),
      myRank >= 0 ? h('span', { class: 'pill', style: { fontWeight: 700, fontFamily: 'var(--mono)' } }, `You're #${myRank + 1}`) : null),
    h('div', { class: 'chip-row', style: { display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '4px 0 12px' } },
      chip('all', 'Everyone'), chip('ms', 'Middle School'), chip('hs', 'High School'), chip('teacher', 'Teachers')),
    rows.length
      ? h('div', { class: 'card', style: { padding: '0' } }, ...rows.slice(0, 100).map((x, i) => lbRow(x, i, me)))
      : h('div', { class: 'empty' }, 'No ranked players in this group yet.'));
}

function lbRow(x, i, me) {
  const mine = (x.username || '').toLowerCase() === me;
  const isLadder = x.ladder_rating != null;
  const rating = isLadder ? x.ladder_rating : x.chesscom_rating;
  return h('div', { style: { display: 'grid', gridTemplateColumns: '34px 1fr auto', gap: '10px', alignItems: 'center', padding: '12px 14px', borderTop: i ? '1px solid var(--line)' : 'none', background: mine ? 'rgba(125, 211, 95, .12)' : 'transparent' } },
    h('b', { style: { fontFamily: 'var(--mono)', color: i < 3 ? 'var(--accent)' : 'var(--muted)' } }, i + 1),
    h('div', {}, h('b', {}, nameOf(x)), mine ? h('span', { style: { color: 'var(--accent-2)', fontWeight: 700 } }, ' ← you') : null, h('div', { class: 'hint tiny' }, GROUP_LABEL[x.group_id] || '')),
    h('div', { style: { textAlign: 'right' } }, h('b', { style: { fontFamily: 'var(--mono)', fontSize: '16px' } }, rating ?? '—'), h('div', { class: 'hint tiny' }, isLadder ? 'ladder' : 'chess.com')));
}
