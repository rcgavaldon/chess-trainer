// app.js — bootstrap: shared engine, routing, settings.
import * as store from './storage.js';
import { h, clear } from './dom.js';
import { createEngine } from './engine.js';
import { getLang, setLang, startI18n, translateTree } from './i18n.js';
import * as personal from './views/personal.js';
import * as games from './views/games.js';
import * as openings from './views/openings.js';
import * as train from './views/train.js';
import * as learn from './views/learn.js';
import * as mates from './views/mates.js';
import * as leaderboard from './views/leaderboard.js';
import * as classroom from './views/classroom.js';
import * as tournament from './views/tournament.js';

const views = { personal, games, openings, train, learn, mates, leaderboard, class: classroom, tournament };

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
  $('set-depth').value = p.engineDepth || 17;
  $('set-depth-val').textContent = (p.engineDepth || 17);
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
// One-time: raise the analysis depth for devices still on the old 14 default — stronger engine by
// default (near-max, not max). Guarded so a later manual change in Settings sticks.
if (!store.get('profile.depthBumped')) {
  const cur = store.get('profile.engineDepth', null);
  if (cur == null || cur <= 15) store.set('profile.engineDepth', 17);
  store.set('profile.depthBumped', true);
}
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

// A student opening a coach's join link (?join=<coach>) → self-enroll form.
const _join = _params.get('join');
if (_join) {
  // Self-enroll OWNS the page. Two bugs lived here:
  //  1) it was gated on !profile.onboarded, so any device that had already opened the app (the club
  //     Chromebook, a shared phone, the projector) silently skipped the form and dropped the student
  //     straight into the PREVIOUS user's account;
  //  2) starting the router first drew that user's report, and personal.js's async doImport() then
  //     repainted it right over the top of the join form.
  showJoin(_join.trim(), _params.get('as') === 'coach');
} else {
  store.onRouteChange(draw);
  if (!store.get('profile.username')) showOnboarding();
}
startI18n(); // translate the chrome + current view, and observe async-rendered content, when Spanish

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
// First-run walkthrough. Replaces the old bare form + the obtrusive full-screen cinematic reveal:
// a friendly, user-paced set of cards that (1) explains how it works, then (2) walks a first-timer
// through hooking up every input — Chess.com OR Lichess (with a picker so kids don't need the
// `lichess:` trick), and their US Chess ID for official ratings. Lives in the normal view (not a
// fixed dark takeover), so it doesn't feel intrusive.
function showOnboarding() {
  const v = document.getElementById('view');
  clear(v);
  const field = (t, el, hint) => h('label', { style: { display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '13px', fontWeight: 600 } }, t, el, hint ? h('div', { class: 'hint tiny', style: { fontWeight: 400 } }, hint) : null);
  const state = { source: 'chesscom', accent: store.get('profile.accent', 'green') };
  const TOTAL = 4;
  let step = 0;

  // Persistent input nodes — reused across steps so typed values survive Back/Next.
  const nameInput = h('input', { type: 'text', placeholder: 'Your name (e.g. Robert)', onkeydown: (e) => { if (e.key === 'Enter') userInput.focus(); } });
  const userInput = h('input', { type: 'text', autocapitalize: 'none', autocorrect: 'off', spellcheck: false, onkeydown: (e) => { if (e.key === 'Enter') continueConnect(); } });
  const uscfInput = h('input', { type: 'text', inputMode: 'numeric', placeholder: 'e.g. 12345678', onkeydown: (e) => { if (e.key === 'Enter') { store.set('profile.uscfId', ''); step = 3; render(); } } });
  const err = h('div', { class: 'hint tiny', style: { color: 'var(--bad)', fontWeight: 700, display: 'none' } });
  const setPlaceholder = () => { userInput.placeholder = state.source === 'lichess' ? 'Your Lichess username' : 'Your Chess.com username'; };

  // Chess.com / Lichess source picker.
  const srcWrap = h('div', { class: 'row', style: { gap: '8px' } });
  [['chesscom', '♟ Chess.com'], ['lichess', '🐴 Lichess']].forEach(([id, lab]) => {
    const b = h('button', { type: 'button', class: 'btn ghost small' + (id === state.source ? ' active' : ''), onclick: () => { state.source = id; srcWrap.querySelectorAll('button').forEach((x) => x.classList.remove('active')); b.classList.add('active'); setPlaceholder(); err.style.display = 'none'; userInput.focus(); } }, lab);
    srcWrap.append(b);
  });
  setPlaceholder();

  // Accent swatches.
  const accentWrap = h('div', { class: 'swatches' });
  const keys = Object.keys(ACCENTS);
  keys.forEach((k) => {
    const a = ACCENTS[k];
    const sw = h('div', { class: 'swatch' + (k === state.accent ? ' active' : ''), style: { background: `linear-gradient(180deg,${a.accent},${a.deep})` },
      onclick: () => { state.accent = k; applyTheme(k); accentWrap.querySelectorAll('.swatch').forEach((s, i) => s.classList.toggle('active', keys[i] === k)); } });
    accentWrap.append(sw);
  });

  const card = h('div', { class: 'card', style: { maxWidth: '480px', margin: '6vh auto', display: 'flex', flexDirection: 'column', gap: '15px' } });
  v.append(card);

  const dots = () => h('div', { style: { display: 'flex', gap: '6px', justifyContent: 'center', marginTop: '4px' } }, ...Array.from({ length: TOTAL }, (_, j) => h('span', { class: 'intro-dot' + (j === step ? ' on' : '') })));
  const btn = (label, onclick, cls = 'btn') => h('button', { class: cls, onclick }, label);
  const howRow = (n, title, sub) => h('div', { class: 'row', style: { gap: '12px', alignItems: 'flex-start' } },
    h('div', { style: { flex: '0 0 26px', width: '26px', height: '26px', borderRadius: '50%', background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' } }, String(n)),
    h('div', {}, h('div', { style: { fontWeight: 700 } }, title), h('div', { class: 'hint tiny' }, sub)));

  async function continueConnect() {
    const nm = nameInput.value.trim(), raw = userInput.value.trim();
    if (!nm) { nameInput.focus(); return; }
    if (!raw) { userInput.focus(); return; }
    const built = state.source === 'lichess' ? 'lichess:' + raw.replace(/^lichess:/i, '') : raw;
    err.style.display = 'none';
    const goBtn = document.getElementById('onb-continue');
    if (goBtn) { goBtn.disabled = true; goBtn.textContent = 'Checking…'; }
    try {
      const cc = await import('./chesscom.js');
      if (!(await cc.fetchStats(built))) {
        err.textContent = `We couldn't find “${raw}” on ${state.source === 'lichess' ? 'Lichess' : 'Chess.com'}. It's the name on your profile page — not your email.`;
        err.style.display = 'block';
        if (goBtn) { goBtn.disabled = false; goBtn.textContent = 'Continue →'; }
        userInput.focus();
        return;
      }
    } catch { /* network hiccup — let them proceed rather than block setup */ }
    store.set('profile.ownerName', nm);
    store.set('profile.username', built);
    step = 2; render();
  }

  function finish() {
    store.set('profile.accent', state.accent);
    store.set('profile.onboarded', true);
    // The connect-your-accounts walkthrough IS the intro now, so suppress the old cinematic reveal.
    store.set('profile.introSeen', true);
    const uscf = store.get('profile.uscfId', '');
    if (uscf && store.get('profile.username')) {
      import('./cloud.js').then((c) => c.publishUscfId(store.get('profile.username'), uscf)).catch(() => {});
    }
    updateOwnerBadge();
    location.hash = '#/personal';
    draw('personal');
  }

  function render() {
    clear(card);
    if (step === 0) {
      card.append(
        h('div', { style: { fontSize: '23px', fontWeight: 800 } }, '♞ Meet your chess coach'),
        h('div', { class: 'hint' }, 'It turns the games you already play online into a personal coach — no extra work.'),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', margin: '4px 0' } },
          howRow(1, 'Connect your account', 'Chess.com or Lichess — just your username.'),
          howRow(2, 'We read your real games', 'Every move analyzed by a strong engine.'),
          howRow(3, 'You get a plan', 'Your strengths, weak spots, puzzles from your own blunders, and what to work on next.')),
        btn('Let\'s set it up →', () => { step = 1; render(); }),
        dots());
    } else if (step === 1) {
      card.append(
        h('div', { style: { fontSize: '21px', fontWeight: 800 } }, 'Connect your chess account'),
        h('div', { class: 'hint tiny' }, 'Where do you play? Pick one — you can add the other later in ⚙ Settings.'),
        field('Where you play', srcWrap),
        field('Your name', nameInput),
        field('Your username', userInput, 'It\'s the name on your profile page — not your email or real name.'),
        err,
        h('div', { class: 'row', style: { gap: '8px', marginTop: '2px' } },
          btn('← Back', () => { step = 0; render(); }, 'btn ghost small'),
          h('button', { id: 'onb-continue', class: 'btn', onclick: continueConnect }, 'Continue →')),
        dots());
      setTimeout(() => (nameInput.value ? userInput : nameInput).focus(), 30);
    } else if (step === 2) {
      card.append(
        h('div', { style: { fontSize: '21px', fontWeight: 800 } }, '🏆 Play in tournaments?'),
        h('div', { class: 'hint' }, 'Optional. Add your US Chess ID to track your official USCF rating and tournament history right alongside your online games.'),
        field('US Chess ID', uscfInput, '8–9 digits from your US Chess membership (find it on uschess.org). Leave blank if you don\'t have one.'),
        err,
        h('div', { class: 'row', style: { gap: '8px', marginTop: '2px' } },
          btn('← Back', () => { err.style.display = 'none'; step = 1; render(); }, 'btn ghost small'),
          btn('Skip', () => { store.set('profile.uscfId', ''); err.style.display = 'none'; step = 3; render(); }, 'btn ghost small'),
          h('button', { class: 'btn', onclick: () => {
            const val = uscfInput.value.trim();
            if (val && !/^\d{8,9}$/.test(val)) { err.textContent = 'US Chess ID must be 8–9 digits (numbers only).'; err.style.display = 'block'; uscfInput.focus(); return; }
            store.set('profile.uscfId', val); err.style.display = 'none'; step = 3; render();
          } }, 'Continue →')),
        dots());
      setTimeout(() => { uscfInput.value = store.get('profile.uscfId', ''); }, 0);
    } else {
      card.append(
        h('div', { style: { fontSize: '21px', fontWeight: 800 } }, '🎨 Pick your color'),
        h('div', { class: 'hint tiny' }, 'Make it yours. You can change it anytime.'),
        field('Accent color', accentWrap),
        h('div', { class: 'row', style: { gap: '8px', marginTop: '2px' } },
          btn('← Back', () => { step = 2; render(); }, 'btn ghost small'),
          btn('Start coaching me →', finish)),
        h('div', { class: 'hint tiny' }, 'Everything is saved on this device, so it remembers you next time. Change any of it later in ⚙ Settings.'),
        dots());
    }
  }
  render();
}

// Student self-enrollment via a coach's join link (?join=<coach>): name + username + group →
// added to the shared roster (coach recorded) and set up on this device as a student.
function showJoin(coach, asCoach = false) {
  const v = document.getElementById('view');
  clear(v);
  const field = (t, el) => h('label', { style: { display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '13px', fontWeight: 500 } }, t, el);
  const name = h('input', { type: 'text', placeholder: 'Your name (e.g. Alex)' });
  const user = h('input', { type: 'text', placeholder: 'Chess.com username — or lichess:YourName', onkeydown: (e) => { if (e.key === 'Enter') go.click(); } });
  let group = 'ms';
  const grpWrap = h('div', { class: 'row', style: { gap: '8px' } });
  [['ms', 'Middle School'], ['hs', 'High School']].forEach(([id, lab]) => {
    const b = h('button', { type: 'button', class: 'btn ghost small' + (id === group ? ' active' : ''), onclick: () => { group = id; grpWrap.querySelectorAll('button').forEach((x) => x.classList.remove('active')); b.classList.add('active'); } }, lab);
    grpWrap.append(b);
  });
  const doneLabel = asCoach ? 'Join as coach →' : 'Join the club →';
  const err = h('div', { class: 'hint tiny', style: { color: 'var(--bad)', fontWeight: 700, display: 'none' } });
  const go = h('button', { class: 'btn', style: { marginTop: '4px', alignSelf: 'flex-start' }, onclick: async () => {
    const u = user.value.trim(), nm = name.value.trim();
    if (!nm) { name.focus(); return; }
    if (!u) { user.focus(); return; }
    err.style.display = 'none';
    go.disabled = true; go.textContent = 'Checking…';
    // Verify the account EXISTS before writing a roster row. A typo used to create a ghost student
    // the coach could never see or remove, and dropped the kid on a dead-end "No games found" page.
    try {
      const cc = await import('./chesscom.js');
      if (!(await cc.fetchStats(u))) {
        err.textContent = `We couldn't find “${u}”. Check the spelling — it's your Chess.com username, not your real name.`;
        err.style.display = 'block';
        user.focus(); go.disabled = false; go.textContent = doneLabel;
        return;
      }
    } catch { /* network hiccup — let them through rather than block enrollment */ }
    go.textContent = 'Joining…';
    // A co-coach is stored under the "Teachers" group with role=coach so (a) the club owner sees them
    // on the roster and (b) their device gets the full coach nav (Students + Tournaments).
    const g = asCoach ? 'teacher' : group;
    const role = asCoach ? 'coach' : 'student';
    try {
      const c = await import('./cloud.js');
      await c.upsertStudent({ username: u, name: nm, group_id: g, coach: coach || '', role });
    } catch (e) { /* cloud hiccup — still set them up locally; the coach's next sync catches them */ }
    store.set('profile.ownerName', nm);
    store.set('profile.username', u);
    store.set('profile.role', role);
    store.set('profile.group', g);
    if (coach) store.set('profile.coach', coach);
    store.set('profile.onboarded', true);
    store.set('profile.welcomeSeen', false);
    // Reload at the clean URL (drops ?join/?as) so the role-appropriate nav applies.
    window.location.href = location.origin + location.pathname + '#/personal';
  } }, doneLabel);
  const signedIn = store.get('profile.ownerName', '') || store.get('profile.username', '');
  v.append(h('div', { class: 'card', style: { maxWidth: '460px', margin: '7vh auto', display: 'flex', flexDirection: 'column', gap: '13px' } },
    h('div', { style: { fontSize: '23px', fontWeight: 800 } }, asCoach ? '👩‍🏫 Join as a coach' : '🏆 Join the chess club'),
    h('div', { class: 'hint' }, asCoach
      ? 'Enter your info to get the coach tools — Students and Tournaments — on this device. Your Chess.com username is used for your own games in My Chess.'
      : 'Enter your info and your coach will see you on the roster. It\'s saved on this device so it remembers you.'),
    signedIn ? h('div', { class: 'hint tiny', style: { color: 'var(--warn)', fontWeight: 700 } }, `⚠ This device is signed in as ${signedIn} — joining will switch it to you.`) : null,
    field('Your name', name),
    field('Your Chess.com username', user),
    asCoach ? null : field('Your group', grpWrap),
    err,
    go));
}
