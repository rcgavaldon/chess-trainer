// app.js — bootstrap: shared engine, routing, settings.
import * as store from './storage.js';
import { createEngine } from './engine.js';
import * as personal from './views/personal.js';
import * as classroom from './views/classroom.js';
import * as tournament from './views/tournament.js';

const views = { personal, class: classroom, tournament };

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
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.route === route));
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
updateOwnerBadge();
store.onRouteChange(draw);
