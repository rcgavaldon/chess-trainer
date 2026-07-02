// storage.js — client-side persistence (localStorage-first) + IndexedDB analysis cache + hash router.
// localStorage holds the small "root" doc (profile, players-meta, weakness snapshots, puzzle SRS,
// class roster, tournaments). IndexedDB holds the only large/unbounded data type: per-game Stockfish
// analysis (a class of students generates thousands of analyzed games — that blows past LS's ~5MB cap).

export const NS = 'chesstrainer';
export const SCHEMA_VERSION = 3;
const ROOT_KEY = NS + ':root';

// ---- low-level localStorage: namespaced + quota guarded ----
function rawGet(key, fallback = null) {
  try {
    const s = localStorage.getItem(key);
    return s == null ? fallback : JSON.parse(s);
  } catch (e) { console.warn('[storage] get failed', key, e); return fallback; }
}
function rawSet(key, value) {
  let payload;
  try { payload = JSON.stringify(value); } catch (e) { return { ok: false, reason: 'serialize', error: e }; }
  try { localStorage.setItem(key, payload); return { ok: true, bytes: payload.length }; }
  catch (e) {
    const quota = e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
    return { ok: false, reason: quota ? 'quota' : 'unknown', error: e };
  }
}

// ---- migrations: pure (oldDb) -> newDb at each step ----
const MIGRATIONS = {
  1: (db) => { db.profile ||= { username: '', llmKey: '', engineDepth: 14, timeClass: 'rapid' }; db.players ||= {}; return db; },
  2: (db) => { db.puzzles ||= { srs: {} }; db.class ||= { rosters: {} }; return db; },
  3: (db) => { db.tournaments ||= {}; return db; },
};
function migrate(db) {
  let v = db.schemaVersion || 0;
  while (v < SCHEMA_VERSION) { v += 1; if (MIGRATIONS[v]) db = MIGRATIONS[v](db); db.schemaVersion = v; }
  return db;
}

// ---- cached root doc + load/save ----
let _root = null;
export function db() {
  if (_root) return _root;
  let d = rawGet(ROOT_KEY, null) || { schemaVersion: 0 };
  if ((d.schemaVersion || 0) < SCHEMA_VERSION) { d = migrate(d); rawSet(ROOT_KEY, d); }
  _root = d;
  return _root;
}
export function save() {
  const res = rawSet(ROOT_KEY, _root);
  if (!res.ok && res.reason === 'quota') console.error('[storage] root hit quota — heavy data leaked into LS', res.error);
  return res;
}

// dotted get/set over named buckets, e.g. get('profile.username'), set('class.rosters.p3', {...})
export function get(path, fallback) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), db()) ?? fallback;
}
export function set(path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let o = db();
  for (const k of keys) o = (o[k] ||= {});
  o[last] = value;
  return save();
}

// multi-tab: the 'storage' event fires only in OTHER tabs — rebuild the in-memory root on it.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === ROOT_KEY) { _root = null; db(); window.dispatchEvent(new Event('chesstrainer:synced')); }
  });
}

// Boot-time probe: is persistence actually available? (Safari private mode => LS quota 0.)
export function storageAvailable() {
  try {
    const k = NS + ':probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch { return false; }
}

// ============================================================
// IndexedDB analysis cache — one record per analyzed game.
// ============================================================
const DB_NAME = NS + '-analysis', STORE = 'games', IDB_VERSION = 1;
let _idb;
function idb() {
  if (_idb) return _idb;
  _idb = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, IDB_VERSION);
    r.onupgradeneeded = () => {
      const s = r.result.createObjectStore(STORE, { keyPath: 'id' });
      s.createIndex('byPlayer', 'username', { unique: false });
      s.createIndex('byAccess', 'lastAccess', { unique: false });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return _idb;
}

// Stable cache key: the last path segment of the game URL (the numeric id).
export function gameId(gameUrl) { return String(gameUrl).split('/').filter(Boolean).pop(); }

// Cached analysis, or null if absent or shallower than minDepth (a finished game is immutable,
// so the ONLY valid invalidation is "cached depth < requested depth").
export async function cacheGet(gameUrl, minDepth = 0) {
  try {
    const conn = await idb();
    const entry = await new Promise((res, rej) => {
      const req = conn.transaction(STORE, 'readonly').objectStore(STORE).get(gameId(gameUrl));
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => rej(req.error);
    });
    if (!entry) return null;
    if (entry.depth < minDepth) return null;
    entry.lastAccess = Date.now();
    cachePutRaw(entry); // touch LRU, fire-and-forget
    return entry;
  } catch (e) { console.warn('[cache] get failed; will recompute', e); return null; }
}

export async function cachePut(gameUrl, { username, depth, engine, plies, summary }) {
  return cachePutRaw({
    id: gameId(gameUrl), url: gameUrl, username, depth, engine, plies, summary,
    createdAt: Date.now(), lastAccess: Date.now(), v: 1,
  });
}
async function cachePutRaw(entry) {
  try {
    const conn = await idb();
    return await new Promise((res, rej) => {
      const tx = conn.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = () => res({ ok: true });
      tx.onerror = () => rej(tx.error);
    });
  } catch (e) { console.warn('[cache] put failed', e); return { ok: false }; }
}

// Polite LRU eviction (IDB has GBs but keep it tidy).
export async function evictLRU(keepNewest = 5000) {
  try {
    const conn = await idb();
    const keys = await new Promise((res) => {
      const out = [];
      const cur = conn.transaction(STORE, 'readonly').objectStore(STORE).index('byAccess').openCursor();
      cur.onsuccess = (e) => { const c = e.target.result; if (c) { out.push(c.primaryKey); c.continue(); } else res(out); };
    });
    if (keys.length <= keepNewest) return;
    const tx = conn.transaction(STORE, 'readwrite');
    keys.slice(0, keys.length - keepNewest).forEach((k) => tx.objectStore(STORE).delete(k));
  } catch (e) { console.warn('[cache] evict failed', e); }
}

// ============================================================
// hash router: #/personal | #/class | #/tournament
// ============================================================
export const ROUTES = ['personal', 'openings', 'learn', 'train', 'mates', 'leaderboard', 'class', 'tournament'];
export function currentRoute() {
  const r = (location.hash.replace(/^#\//, '').split('/')[0]) || 'personal';
  return ROUTES.includes(r) ? r : 'personal';
}
export function onRouteChange(render) {
  window.addEventListener('hashchange', () => render(currentRoute()));
  render(currentRoute());
}
