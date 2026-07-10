// views/tournament.js — operator view: build an event from a class roster and generate
// suggested pairings (Swiss / round-robin / strength-balanced) from current ratings,
// enter results, and track live standings with tie-breaks.
import { h, clear } from '../dom.js';
import * as store from '../storage.js';
import * as cc from '../chesscom.js';
import { swissPairRound, roundRobinSchedule, balancedPairs, randomPairRound, knockoutBracket, nextBracketRound, computeStandings, suggestedRounds } from '../pairing.js';

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
  const field = (label, el) => h('label', { style: { display: 'block', marginBottom: '12px', fontSize: '13px', fontWeight: 600 } }, label, el);
  const name = h('input', { type: 'text', placeholder: 'e.g. Friday Blitz' });
  const names = h('textarea', { rows: 5, placeholder: 'One player per line — just names for an unrated event:\n  Ana\n  Beto\n  Carlos\nOptional rating: "Diana, 1200"', style: { width: '100%', fontFamily: 'inherit', resize: 'vertical' } });
  const roster = ids.length ? h('select', {}, h('option', { value: '' }, '— or pull a class roster —'), ...ids.map((id) => h('option', { value: id }, rs[id].name))) : null;
  const format = h('select', {},
    h('option', { value: 'random' }, 'Random pairing (unrated-friendly)'),
    h('option', { value: 'knockout' }, 'Knockout bracket (single elimination)'),
    h('option', { value: 'swiss' }, 'Swiss (multi-round, rating-seeded)'),
    h('option', { value: 'roundrobin' }, 'Round robin (all play all)'),
    h('option', { value: 'balanced-fair' }, 'Single round — fair (similar strength)'),
    h('option', { value: 'balanced-mentor' }, 'Single round — mentor (strong + weak)'));
  return h('div', { class: 'card section' },
    h('h2', {}, 'New event'),
    field('Event name', name),
    field('Players — type names, one per line', names),
    roster ? field('…or pull a class roster (uses Chess.com ratings)', roster) : null,
    field('Format', format),
    h('button', { class: 'btn', onclick: () => createEvent(name.value.trim(), roster && roster.value, format.value, names.value) }, 'Create event'),
    h('div', { class: 'hint tiny', style: { marginTop: '8px' } }, 'For a casual unrated event, just type the names and keep Random pairing. Ratings are optional (add ", 1200" after a name); rating-seeded formats use them when present.'));
}

async function createEvent(name, rosterId, format, namesText) {
  if (!name) { alert('Give the event a name.'); return; }
  let players = [];
  const typed = (namesText || '').split('\n').map((s) => s.trim()).filter(Boolean);
  if (typed.length) {
    // Type-in players — names only (unrated) or "Name, 1200".
    players = typed.map((line, i) => {
      const comma = line.lastIndexOf(',');
      const rt = comma >= 0 ? parseInt(line.slice(comma + 1), 10) : NaN;
      const nm = (comma >= 0 && Number.isFinite(rt) ? line.slice(0, comma) : line).trim();
      return { id: 'p' + (i + 1) + '-' + slug(nm), name: nm, rating: Number.isFinite(rt) ? rt : null, unrated: !Number.isFinite(rt) };
    }).filter((p) => p.name);
  } else if (rosterId) {
    const roster = rosters()[rosterId];
    if (!roster || !roster.students.length) { alert('That roster has no students.'); return; }
    const tc = store.get('profile.timeClass', 'rapid');
    clear(host).append(h('h1', {}, 'Tournament'), h('div', { class: 'row section' }, h('span', { class: 'spinner' }), ' Fetching player ratings…'));
    for (const s of roster.students) {
      let rating = null;
      try { rating = cc.ratingFromStats(await cc.fetchStats(s.username), tc === 'all' ? 'rapid' : tc) || null; } catch { /* offline / no profile */ }
      players.push({ id: s.username, name: s.alias || s.username, rating, unrated: rating == null });
    }
  }
  if (players.length < 2) { alert('Add at least 2 players (one name per line).'); return; }
  // Pairing engines need a number; unrated players get a neutral seed (matters only for rating-seeded formats).
  players = players.map((p) => ({ ...p, rating: p.rating == null ? 1000 : p.rating }));
  const baseFormat = format.startsWith('balanced') ? 'balanced' : format;
  const mode = format === 'balanced-mentor' ? 'mentor' : 'fair';
  // Unique id — a deterministic name+count id silently overwrote an existing event with the same
  // name/size. Suffix with time + a free counter so two "Friday Blitz" events never collide.
  const now = Date.now();
  let id = slug(name) + '-' + now.toString(36);
  const existing = events();
  while (existing[id]) id += '-' + Math.floor(now % 1000);
  const ev = { id, name, rosterId: rosterId || null, format: baseFormat, mode, players, rounds: [], createdAt: now };

  if (format === 'knockout') ev.bracket = knockoutBracket(players);
  else if (format === 'random') ev.rounds = [randomPairRound(players, [])];
  else if (format === 'roundrobin') ev.rounds = roundRobinSchedule(players);
  else if (baseFormat === 'balanced') ev.rounds = [balancedPairs(players, { mode })];
  else ev.rounds = [swissPairRound(players, [])];

  saveEvent(ev);
  TS.selected = ev.id;
  draw();
}

function fmtFormat(ev) {
  return ev.format === 'knockout' ? 'knockout bracket' : ev.format === 'random' ? 'random pairing'
    : ev.format === 'balanced' ? `single round (${ev.mode})` : ev.format;
}

function drawEvent(ev) {
  const isKO = ev.format === 'knockout';
  host.append(
    h('div', { class: 'row', style: { justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' } },
      h('button', { class: 'btn ghost small', onclick: () => { TS.selected = null; draw(); } }, '← All events'),
      h('div', { class: 'row', style: { gap: '8px' } },
        h('button', { class: 'btn small', onclick: () => presentEvent(ev) }, '📽 Present'),
        h('button', { class: 'btn ghost small', onclick: () => window.print() }, '🖨 Print'))),
    h('h2', { style: { marginTop: '12px' } }, ev.name, ' ', h('span', { class: 'hint' }, `· ${fmtFormat(ev)} · ${ev.players.length} players`)),
    isKO
      ? bracketView(ev, false)
      : h('div', {}, standingsTable(ev), ...ev.rounds.map((round, ri) => roundCard(ev, round, ri)), nextRoundControls(ev)),
  );
}

// ============================ knockout bracket ============================
function koRounds(ev) { return Math.round(Math.log2(Math.max(1, ev.bracket[0].length))) + 1; }
function koRoundName(ri, total) {
  const fromEnd = total - ri;
  return fromEnd === 1 ? 'Final' : fromEnd === 2 ? 'Semifinals' : fromEnd === 3 ? 'Quarterfinals' : `Round ${ri + 1}`;
}
// Generate as many further rounds as the results so far allow (byes auto-advance).
function ensureBracketRounds(ev) {
  let guard = 0;
  while (guard++ < 20) { const next = nextBracketRound(ev.bracket); if (!next) break; ev.bracket.push(next); }
}
function setKOWinner(ev, m, id) {
  if (m.result === 'bye') return;
  m.winner = id; m.result = 'decided';
  // a changed result invalidates later rounds — rebuild them from this round forward
  const ri = ev.bracket.findIndex((round) => round.includes(m));
  if (ri >= 0) ev.bracket = ev.bracket.slice(0, ri + 1);
  ensureBracketRounds(ev);
  saveEvent(ev); draw();
}
function koSlot(ev, m, id, readOnly) {
  const isWin = m.winner && m.winner === id;
  return h('div', {
    class: 'ko-slot' + (isWin ? ' win' : '') + (!id ? ' tbd' : '') + (m.winner && !isWin ? ' out' : ''),
    onclick: (!readOnly && id && m.result !== 'bye') ? () => setKOWinner(ev, m, id) : undefined,
  }, id ? nameOf(ev, id) : (m.result === 'bye' ? '— bye —' : 'TBD'));
}
function bracketView(ev, readOnly) {
  if (!ev.bracket) ev.bracket = [[]];
  ensureBracketRounds(ev);
  const total = koRounds(ev);
  const last = ev.bracket[ev.bracket.length - 1];
  const champ = (last.length === 1 && last[0].winner) ? last[0].winner : null;
  const cols = ev.bracket.map((round, ri) => h('div', { class: 'ko-col' },
    h('div', { class: 'ko-round-name' }, koRoundName(ri, total)),
    h('div', { class: 'ko-col-body' }, ...round.map((m) => h('div', { class: 'ko-match' }, koSlot(ev, m, m.a, readOnly), koSlot(ev, m, m.b, readOnly))))));
  return h('div', {},
    champ ? h('div', { class: 'ko-champ' }, '🏆 ', h('b', {}, nameOf(ev, champ)), ' wins the bracket!') : (readOnly ? null : h('div', { class: 'hint tiny', style: { marginBottom: '8px' } }, 'Tap the winner of each match — they advance automatically.')),
    h('div', { class: 'ko-bracket' }, ...cols));
}

// ============================ Present / projector mode ============================
function presentEvent(ev) {
  const overlay = h('div', { class: 'present-overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.append(
    h('div', { class: 'present-bar' },
      h('div', { class: 'present-title' }, ev.name),
      h('button', { class: 'btn small ghost', onclick: close }, '✕ Close')),
    h('div', { class: 'present-body' }, ev.format === 'knockout' ? bracketView(ev, true) : presentPairings(ev)));
  document.body.append(overlay);
  if (overlay.requestFullscreen) overlay.requestFullscreen().catch(() => {});
}
function presentPairings(ev) {
  const ri = ev.rounds.length;
  const last = ev.rounds[ri - 1] || [];
  return h('div', { class: 'present-cols' },
    h('div', {}, h('div', { class: 'present-h' }, `Round ${ri} — pairings`),
      ...last.map((g, i) => g.bye
        ? h('div', { class: 'present-pair bye' }, h('b', {}, nameOf(ev, g.bye)), h('span', { class: 'present-vs' }, 'bye'))
        : h('div', { class: 'present-pair' }, h('span', { class: 'present-bd' }, i + 1), h('b', {}, nameOf(ev, g.white)), h('span', { class: 'present-vs' }, 'vs'), h('b', {}, nameOf(ev, g.black))))),
    h('div', {}, h('div', { class: 'present-h' }, 'Standings'),
      ...computeStandings(ev).slice(0, 20).map((p, i) => h('div', { class: 'present-rank' }, h('span', {}, `${i + 1}. ${p.name}`), h('b', {}, p.score)))));
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
  if (ev.format !== 'swiss' && ev.format !== 'random') return h('div', {});
  const last = ev.rounds[ev.rounds.length - 1];
  const canPair = roundComplete(last) && ev.rounds.length < ev.players.length - 1;
  const pairFn = ev.format === 'random' ? randomPairRound : swissPairRound;
  const rec = suggestedRounds(ev.players.length);
  return h('div', { class: 'section' },
    h('button', { class: 'btn', disabled: !canPair, onclick: () => {
      ev.rounds.push(pairFn(ev.players, ev.rounds)); saveEvent(ev); draw();
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
        h('td', {}, i + 1), h('td', {}, h('b', {}, p.name)), h('td', {}, ev.players.find((x) => x.id === p.id)?.unrated ? '—' : p.rating),
        h('td', {}, h('b', {}, p.score)), h('td', {}, round1(p.buchholzCut1)), h('td', {}, round1(p.sonnebornBerger)))))));
}

function round1(x) { return Math.round((x || 0) * 10) / 10; }
