// app.js — bootstrap: shared engine, routing, settings.
import * as store from './storage.js';
import { h, clear } from './dom.js';
import { createEngine } from './engine.js';
import * as personal from './views/personal.js';
import * as openings from './views/openings.js';
import * as train from './views/train.js';
import * as learn from './views/learn.js';
import * as mates from './views/mates.js';
import * as leaderboard from './views/leaderboard.js';
import * as classroom from './views/classroom.js';
import * as tournament from './views/tournament.js';

const views = { personal, openings, train, learn, mates, leaderboard, class: classroom, tournament };

// ---- accent theme ----
const ACCENTS = {
  green: { accent: '#7dd35f', deep: '#5cb83f', ink: '#08160a' },
  blue: { accent: '#5ea0ff', deep: '#3f7fe0', ink: '#06122a' },
  teal: { accent: '#3fd1c0', deep: '#2bb0a2', ink: '#042018' },
  purple: { accent: '#b487ff', deep: '#9560e8', ink: '#160726' },
  orange: { accent: '#f0a13a', deep: '#d4842a', ink: '#1a0f02' },
  rose: { accent: '#f4709a', deep: '#e0507f', ink: '#2a0712' },
};
function applyTheme(key) {
  const a = ACCENTS[key] || ACCENTS.green;
  const r = document.documentElement.style;
  r.setProperty('--accent', a.accent);
  r.setProperty('--accent-deep', a.deep);
  r.setProperty('--accent-ink', a.ink);
}
function buildSwatches(current) {
  const wrap = document.getElementById('set-accents');
  if (!wrap) return;
  wrap.innerHTML = '';
  for (const [key, a] of Object.entries(ACCENTS)) {
    const sw = document.createElement('div');
    sw.className = 'swatch' + (key === current ? ' active' : '');
    sw.style.background = `linear-gradient(180deg, ${a.accent}, ${a.deep})`;
    sw.title = key;
    sw.onclick = () => { applyTheme(key); store.set('profile.accent', key); buildSwatches(key); };
    wrap.appendChild(sw);
  }
}

// ---- shared engine (single worker for the whole session) ----
let _engine = null;
let _enginePromise = null;
export function engineHandle() {
  if (!_engine) _engine = createEngine();
  return _engine;
}
export async function ensureEngine() {
  if (!_enginePromise) {
    const e = engineHandle();
    showEngineStatus('Loading engine… (one-time ~7 MB)');
    _enginePromise = e.init().then(() => { hideEngineStatus(); return e; })
      .catch((err) => { showEngineStatus('Engine failed to load: ' + (err.message || err)); throw err; });
  }
  return _enginePromise;
}

// ---- engine status toast ----
const statusEl = document.getElementById('engine-status');
let statusTimer = null;
export function showEngineStatus(msg, sticky = true) {
  clearTimeout(statusTimer);
  statusEl.textContent = msg;
  statusEl.hidden = false;
  if (!sticky) statusTimer = setTimeout(() => (statusEl.hidden = true), 2500);
}
export function hideEngineStatus() { statusEl.hidden = true; }

// ---- settings ----
const dlg = document.getElementById('settings-dialog');
const $ = (id) => document.getElementById(id);
function updateOwnerBadge() { document.getElementById('owner-badge').textContent = store.get('profile.ownerName', ''); }

function openSettings() {
  const p = store.get('profile', {});
  $('set-owner').value = p.ownerName || '';
  $('set-username').value = p.username || '';
  $('set-timeclass').value = p.timeClass || 'rapid';
  $('set-depth').value = p.engineDepth || 14;
  $('set-depth-val').textContent = (p.engineDepth || 14);
  $('set-llmkey').value = p.llmKey || '';
  buildSwatches(p.accent || 'green');
  dlg.showModal();
}
$('set-depth').addEventListener('input', (e) => ($('set-depth-val').textContent = e.target.value));
$('settings-btn').addEventListener('click', openSettings);
dlg.addEventListener('close', () => {
  if (dlg.returnValue !== 'save') return;
  store.set('profile.ownerName', $('set-owner').value.trim());
  store.set('profile.username', $('set-username').value.trim());
  store.set('profile.timeClass', $('set-timeclass').value);
  store.set('profile.engineDepth', parseInt($('set-depth').value, 10));
  store.set('profile.llmKey', $('set-llmkey').value.trim());
  updateOwnerBadge();
  // re-render current view to pick up new defaults
  rerender();
});

// ---- routing ----
const viewEl = document.getElementById('view');
const ctx = { store, engineHandle, ensureEngine, showEngineStatus, navigate: (r) => (location.hash = '#/' + r) };

function renderNav(route) {
  const navRoute = route === 'mates' ? 'train' : route; // Mates lives under the Puzzles tab
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.route === navRoute));
}
let _current = null;
function rerender() { if (_current) draw(_current); }
function draw(route) {
  _current = route;
  renderNav(route);
  viewEl.innerHTML = '';
  try { views[route].render(viewEl, ctx); }
  catch (e) { viewEl.innerHTML = `<div class="empty">Something broke rendering this view.<br><span class="tiny">${e.message}</span></div>`; console.error(e); }
}

if (!store.storageAvailable()) {
  showEngineStatus('Heads up: this browser is blocking storage (private mode?) — progress won\'t be saved.');
}
// Pre-configured link support: ?u=username&name=Robert&accent=green&role=&g=&coach= sets you up instantly.
const _params = new URLSearchParams(location.search);
if (_params.get('u')) {
  store.set('profile.username', _params.get('u').trim());
  if (_params.get('name')) store.set('profile.ownerName', _params.get('name').trim());
  if (_params.get('accent')) store.set('profile.accent', _params.get('accent').trim());
  if (_params.get('role')) { store.set('profile.role', _params.get('role').trim()); store.set('profile.welcomeSeen', false); }
  if (_params.get('g')) store.set('profile.group', _params.get('g').trim());
  if (_params.get('coach')) store.set('profile.coach', _params.get('coach').trim());
  store.set('profile.onboarded', true);
}
// Coach restoring their whole class on any device — the roster rides inside the link (?class=<base64>).
const _cls = _params.get('class');
if (_cls) {
  try {
    const roster = JSON.parse(decodeURIComponent(escape(atob(_cls))));
    if (roster && Array.isArray(roster.students)) {
      store.set('class.roster', roster);
      if (!store.get('profile.role')) store.set('profile.role', 'coach');
      if (roster.coach && !store.get('profile.username')) {
        store.set('profile.username', roster.coach);
        store.set('profile.ownerName', roster.coachName || 'Coach');
        store.set('profile.onboarded', true);
      }
    }
  } catch { /* malformed class blob — ignore */ }
}

updateOwnerBadge();
applyTheme(store.get('profile.accent', 'green'));
// Students don't get coach tools — keep their app to Personal / Openings / Train.
if (store.get('profile.role') === 'student') {
  for (const a of document.querySelectorAll('.tabs a')) {
    if (a.dataset.route === 'class' || a.dataset.route === 'tournament') a.remove();
  }
}
store.onRouteChange(draw);
if (!store.get('profile.username')) showOnboarding();

// ---- first-run onboarding (saved on this device) ----
function showOnboarding() {
  const v = document.getElementById('view');
  clear(v);
  const field = (t, el) => h('label', { style: { display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '13px', fontWeight: 500 } }, t, el);
  const name = h('input', { type: 'text', placeholder: 'Your name (e.g. Robert)' });
  const user = h('input', { type: 'text', placeholder: 'Your Chess.com username (e.g. rcgavaldon)', onkeydown: (e) => { if (e.key === 'Enter') go.click(); } });
  const key = h('input', { type: 'password', placeholder: 'sk-ant-…  (optional — powers the AI coach)', autocomplete: 'off' });
  let accent = store.get('profile.accent', 'green');
  const accentWrap = h('div', { class: 'swatches' });
  const keys = Object.keys(ACCENTS);
  keys.forEach((k) => {
    const a = ACCENTS[k];
    const sw = h('div', { class: 'swatch' + (k === accent ? ' active' : ''), style: { background: `linear-gradient(180deg,${a.accent},${a.deep})` },
      onclick: () => { accent = k; applyTheme(k); accentWrap.querySelectorAll('.swatch').forEach((s, i) => s.classList.toggle('active', keys[i] === k)); } });
    accentWrap.append(sw);
  });
  const go = h('button', { class: 'btn', style: { marginTop: '6px', alignSelf: 'flex-start' }, onclick: () => {
    const u = user.value.trim();
    if (!u) { user.focus(); return; }
    store.set('profile.ownerName', name.value.trim());
    store.set('profile.username', u);
    store.set('profile.accent', accent);
    if (key.value.trim()) store.set('profile.llmKey', key.value.trim());
    store.set('profile.onboarded', true);
    updateOwnerBadge();
    location.hash = '#/personal';
    draw('personal');
  } }, 'Get started →');
  v.append(h('div', { class: 'card', style: { maxWidth: '470px', margin: '7vh auto', display: 'flex', flexDirection: 'column', gap: '14px' } },
    h('div', { style: { fontSize: '23px', fontWeight: 800 } }, '♞ Welcome to your chess coach'),
    h('div', { class: 'hint' }, 'Quick setup. It\'s saved right here on this device, so it\'ll remember you next time.'),
    field('Your name', name),
    field('Your Chess.com username', user),
    field('Accent color', accentWrap),
    field('Anthropic API key (optional)', key),
    go,
    h('div', { class: 'hint tiny' }, 'You can change any of this later in ⚙ Settings.'),
  ));
}
