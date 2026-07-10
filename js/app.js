// app.js — bootstrap: shared engine, routing, settings.
import * as store from './storage.js';
import { h, clear } from './dom.js';
import { createEngine } from './engine.js';
import { getLang, setLang, startI18n, translateTree } from './i18n.js';
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
      .catch((err) => {
        showEngineStatus('Engine failed to load: ' + (err.message || err), false);
        _enginePromise = null; _engine = null; // clear so the next attempt re-initializes instead of replaying the rejection
        throw err;
      });
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
  $('set-uscf').value = p.uscfId || '';
  // On a device that hasn't seen the ID yet, pull it from the player's cloud row so Settings
  // reflects what's already saved (enter once → shows everywhere).
  if (!p.uscfId && p.username) {
    import('./cloud.js').then((c) => c.fetchStudentRow(p.username)).then((row) => {
      if (row && /^\d{8,9}$/.test(row.uscf_id || '') && !$('set-uscf').value) {
        $('set-uscf').value = row.uscf_id;
        store.set('profile.uscfId', row.uscf_id);
      }
    }).catch(() => {});
  }
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
  const uscf = $('set-uscf').value.trim();
  if (uscf && !/^\d{8,9}$/.test(uscf)) {
    alert('US Chess ID must be 8–9 digits — left unchanged.');
  } else {
    // Save + publish (including clearing to null so the ID can actually be removed). Push to the
    // OWNER's own roster row so the Students view + other devices can read it.
    store.set('profile.uscfId', uscf);
    if (store.get('profile.username')) {
      import('./cloud.js').then((c) => c.publishUscfId(store.get('profile.username'), uscf || null)).catch(() => {});
    }
  }
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
  translateTree(viewEl); // flip the freshly-rendered view to Spanish if that's the language (no-op in English)
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
  if (/^\d{8,9}$/.test(_params.get('uscf') || '')) store.set('profile.uscfId', _params.get('uscf').trim());
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
// Self-heal: if this device knows the player's US Chess ID, make sure the cloud row has it too
// (earlier saves silently failed to publish — see cloud.js publishUscfId).
{
  const uscf = store.get('profile.uscfId', '');
  if (/^\d{8,9}$/.test(uscf) && store.get('profile.username')) {
    import('./cloud.js').then((c) => c.publishUscfId(store.get('profile.username'), uscf)).catch(() => {});
  }
}
// Students don't get coach tools — keep their app to Personal / Openings / Train.
if (store.get('profile.role') === 'student') {
  for (const a of document.querySelectorAll('.tabs a')) {
    if (a.dataset.route === 'class' || a.dataset.route === 'tournament') a.remove();
  }
}
// ---- language toggle (English ↔ Spanish; flips the whole UI + makes the AI reply in Spanish) ----
const langBtn = document.getElementById('lang-btn');
if (langBtn) {
  langBtn.textContent = getLang() === 'es' ? '🌐 EN' : '🌐 ES'; // shows the language you'll switch TO
  langBtn.title = getLang() === 'es' ? 'Switch to English' : 'Cambiar a Español';
  langBtn.addEventListener('click', () => setLang(getLang() === 'es' ? 'en' : 'es'));
}

store.onRouteChange(draw);
startI18n(); // translate the chrome + current view, and observe async-rendered content, when Spanish
if (!store.get('profile.username')) showOnboarding();

// ---- auto-update check ----
// This is a SPA: once loaded it never re-fetches code, and phones keep the tab alive for days —
// so fixes "don't arrive". Poll the deployed index.html's ETag (cache-bypassed) on focus + every
// few minutes; when it changes, offer a one-tap reload.
(function updateCheck() {
  let current = null, prompted = false;
  async function stamp() {
    try {
      const r = await fetch('./index.html', { method: 'HEAD', cache: 'no-store' });
      return r.headers.get('etag') || r.headers.get('last-modified') || null;
    } catch { return null; }
  }
  function promptReload() {
    if (prompted || document.getElementById('update-toast')) return;
    prompted = true;
    const t = document.createElement('div');
    t.id = 'update-toast';
    t.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(96px + env(safe-area-inset-bottom));z-index:300;background:var(--accent);color:#0a1e12;font-weight:800;padding:12px 18px;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.45);cursor:pointer;font-size:14px';
    t.textContent = '🔄 Update available — tap to refresh';
    t.onclick = () => location.reload();
    document.body.appendChild(t);
  }
  stamp().then((v) => { current = v; });
  const check = async () => {
    if (!current) { current = await stamp(); return; }
    const v = await stamp();
    if (v && v !== current) promptReload();
  };
  setInterval(check, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
})();

// ---- first-run onboarding (saved on this device) ----
function showOnboarding() {
  const v = document.getElementById('view');
  clear(v);
  const field = (t, el) => h('label', { style: { display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '13px', fontWeight: 500 } }, t, el);
  const name = h('input', { type: 'text', placeholder: 'Your name (e.g. Robert)' });
  const user = h('input', { type: 'text', placeholder: 'Chess.com username — or lichess:YourName', onkeydown: (e) => { if (e.key === 'Enter') go.click(); } });
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
