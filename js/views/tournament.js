// views/tournament.js — operator view: build an event from a class roster and generate
// suggested pairings (Swiss / round-robin / strength-balanced) from current ratings,
// enter results, and track live standings with tie-breaks.
import { h, clear } from '../dom.js';
import * as store from '../storage.js';
import * as cc from '../chesscom.js';
import { swissPairRound, roundRobinSchedule, balancedPairs, computeStandings, suggestedRounds } from '../pairing.js';

const TS = { selected: null };
let CTX = null, host = null;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'event';

export function render(container, ctx) { CTX = ctx; host = container; draw(); }

function events() { return store.get('tournaments', {}); }
function rosters() { return store.get('class.rosters', {}); }
function saveEvent(ev) { const e = events(); e[ev.id] = ev; store.set('tournaments', e); }
function nameOf(ev, id) { const p = ev.players.find((x) => x.id === id); return p ? p.name : id; }

function draw() {
  clear(host);
  host.append(h('h1', {}, 'Tournament'));
  if (TS.selected && events()[TS.selected]) drawEvent(events()[TS.selected]);
  else drawList();
}

function drawList() {
  const evs = events();
  const ids = Object.keys(evs);
  host.append(
    ids.length
      ? h('div', { class: 'game-list section' }, ...ids.map((id) => h('div', { class: 'game-row', style: { gridTemplateColumns: '1fr auto auto auto' }, onclick: () => { TS.selected = id; draw(); } },
          h('div', {}, h('div', { class: 'opp' }, evs[id].name), h('div', { class: 'meta' }, `${evs[id].format} · ${evs[id].players.length} players · ${evs[id].rounds.length} rounds`)),
          h('span', { class: 'meta' }, ''),
          h('button', { class: 'btn small ghost', onclick: (e) => { e.stopPropagation(); TS.selected = id; draw(); } }, 'Open'),
          h('button', { class: 'btn small ghost', onclick: (e) => { e.stopPropagation(); if (confirm('Delete event?')) { const x = events(); delete x[id]; store.set('tournaments', x); draw(); } } }, '🗑'))))
      : h('div', { class: 'empty' }, 'No events yet. Create one below.'),
    createForm(),
  );
}

function createForm() {
  const rs = rosters();
  const ids = Object.keys(rs);
  if (!ids.length) return h('div', { class: 'card section' }, h('div', { class: 'hint' }, 'Create a class roster first (Class tab), then build a tournament from it.'));
  const name = h('input', { type: 'text', placeholder: 'Event name, e.g. Spring Open' });
  const roster = h('select', {}, ...ids.map((id) => h('option', { value: id }, rs[id].name)));
  const format = h('select', {},
    h('option', { value: 'swiss' }, 'Swiss (multi-round)'),
    h('option', { value: 'roundrobin' }, 'Round robin (all play all)'),
    h('option', { value: 'balanced-fair' }, 'Single round — fair (similar strength)'),
    h('option', { value: 'balanced-mentor' }, 'Single round — mentor (strong + weak)'));
  return h('div', { class: 'card section' },
    h('h2', {}, 'New event'),
    h('div', { class: 'row' }, name, roster, format,
      h('button', { class: 'btn', onclick: () => createEvent(name.value.trim(), roster.value, format.value) }, 'Create')),
    h('div', { class: 'hint tiny section' }, 'Ratings are pulled from each student\'s Chess.com profile when the event is created.'));
}

async function createEvent(name, rosterId, format) {
  if (!name) return;
  const roster = rosters()[rosterId];
  if (!roster || !roster.students.length) { alert('That roster has no students.'); return; }
  const tc = store.get('profile.timeClass', 'rapid');
  clear(host).append(h('h1', {}, 'Tournament'), h('div', { class: 'row section' }, h('span', { class: 'spinner' }), ' Fetching player ratings…'));
  const players = [];
  for (const s of roster.students) {
    let rating = 1000;
    try { rating = cc.ratingFromStats(await cc.fetchStats(s.username), tc === 'all' ? 'rapid' : tc) || 1000; } catch {}
    players.push({ id: s.username, name: s.alias || s.username, rating });
  }
  const baseFormat = format.startsWith('balanced') ? 'balanced' : format;
  const mode = format === 'balanced-mentor' ? 'mentor' : 'fair';
  const ev = { id: slug(name) + '-' + (players.length), name, rosterId, format: baseFormat, mode, players, rounds: [], createdAt: Date.now() };

  if (format === 'roundrobin') ev.rounds = roundRobinSchedule(players);
  else if (baseFormat === 'balanced') ev.rounds = [balancedPairs(players, { mode })];
  else ev.rounds = [swissPairRound(players, [])]; // swiss round 1

  saveEvent(ev);
  TS.selected = ev.id;
  draw();
}

function drawEvent(ev) {
  host.append(
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('button', { class: 'btn ghost small', onclick: () => { TS.selected = null; draw(); } }, '← All events'),
      h('button', { class: 'btn ghost small', onclick: () => window.print() }, '🖨 Print')),
    h('h2', { style: { marginTop: '12px' } }, ev.name, ' ', h('span', { class: 'hint' }, `· ${ev.format}${ev.format === 'balanced' ? ' (' + ev.mode + ')' : ''}`)),
    standingsTable(ev),
    ...ev.rounds.map((round, ri) => roundCard(ev, round, ri)),
    nextRoundControls(ev),
  );
}

function roundComplete(round) { return round.every((g) => g.bye || (g.result && g.result !== 'bye')); }

function roundCard(ev, round, ri) {
  const rows = round.map((g, gi) => {
    if (g.bye) return h('tr', {}, h('td', { colspan: 4 }, h('b', {}, nameOf(ev, g.bye)), ' — bye ', h('span', { class: 'pill', style: { background: 'rgba(156,147,136,.2)' } }, '+1')));
    const sel = h('select', { onchange: (e) => { g.result = e.target.value || null; saveEvent(ev); draw(); } },
      h('option', { value: '', selected: !g.result }, '— result —'),
      h('option', { value: '1-0', selected: g.result === '1-0' }, '1–0 (White wins)'),
      h('option', { value: '1/2-1/2', selected: g.result === '1/2-1/2' }, '½–½ (draw)'),
      h('option', { value: '0-1', selected: g.result === '0-1' }, '0–1 (Black wins)'));
    return h('tr', {},
      h('td', {}, `Board ${gi + 1}`),
      h('td', {}, h('b', {}, nameOf(ev, g.white)), h('span', { class: 'hint tiny' }, ' (W)')),
      h('td', {}, h('b', {}, nameOf(ev, g.black)), h('span', { class: 'hint tiny' }, ' (B)')),
      h('td', {}, sel));
  });
  return h('div', { class: 'card section' },
    h('h2', {}, `Round ${ri + 1}`, roundComplete(round) ? h('span', { class: 'pill', style: { background: 'rgba(122,168,79,.2)', color: 'var(--good)', marginLeft: '8px' } }, 'complete') : null),
    h('table', {}, h('tbody', {}, ...rows)));
}

function nextRoundControls(ev) {
  if (ev.format !== 'swiss') return h('div', {});
  const last = ev.rounds[ev.rounds.length - 1];
  const canPair = roundComplete(last) && ev.rounds.length < ev.players.length - 1;
  const rec = suggestedRounds(ev.players.length);
  return h('div', { class: 'section' },
    h('button', { class: 'btn', disabled: !canPair, onclick: () => {
      const games = swissPairRound(ev.players, ev.rounds);
      ev.rounds.push(games); saveEvent(ev); draw();
    } }, `Generate round ${ev.rounds.length + 1}`),
    h('span', { class: 'hint tiny', style: { marginLeft: '10px' } }, !roundComplete(last) ? 'Enter all results to pair the next round.' : `Suggested length: ${rec} rounds.`));
}

function standingsTable(ev) {
  const st = computeStandings(ev);
  return h('div', { class: 'card section' },
    h('h2', {}, 'Standings'),
    h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Player'), h('th', {}, 'Rating'), h('th', {}, 'Score'), h('th', {}, 'Buch (C1)'), h('th', {}, 'SB'))),
      h('tbody', {}, ...st.map((p, i) => h('tr', {},
        h('td', {}, i + 1), h('td', {}, h('b', {}, p.name)), h('td', {}, p.rating),
        h('td', {}, h('b', {}, p.score)), h('td', {}, round1(p.buchholzCut1)), h('td', {}, round1(p.sonnebornBerger)))))));
}

function round1(x) { return Math.round((x || 0) * 10) / 10; }
