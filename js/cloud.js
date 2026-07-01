// cloud.js — OPTIONAL shared backend (Supabase REST). Config lives in localStorage
// (cloud.url + cloud.key). When unconfigured, cloudEnabled() is false and callers fall back to
// the serverless (localStorage) behavior — the app never breaks without a backend.
//
// The Supabase anon key is public by design; access is governed by row-level policies you set
// up (see SUPABASE_SETUP.md). We only ever store first name + Chess.com username + ratings.
import * as store from './storage.js';

const cfg = () => ({ url: store.get('cloud.url', '').replace(/\/$/, ''), key: store.get('cloud.key', '') });
export const cloudEnabled = () => { const c = cfg(); return !!(c.url && c.key); };
export function setCloudConfig(url, key) { store.set('cloud.url', (url || '').trim()); store.set('cloud.key', (key || '').trim()); }

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const c = cfg();
  if (!c.url || !c.key) throw new Error('cloud not configured');
  const headers = { apikey: c.key, Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${c.url}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`cloud ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

// quick connectivity check (used by the "Connect" UI)
export async function ping() { await rest('students?select=username&limit=1'); return true; }

// ---- students (the shared roster / leaderboard) ----
export const upsertStudent = (s) => rest('students?on_conflict=username', { method: 'POST', prefer: 'resolution=merge-duplicates,return=representation', body: [normalizeStudent(s)] });
export const removeStudent = (username) => rest(`students?username=eq.${encodeURIComponent(username.toLowerCase())}`, { method: 'DELETE', prefer: 'return=minimal' });
export function fetchStudents({ coach, group } = {}) {
  let q = 'students?select=*&order=ladder_rating.desc.nullslast';
  if (coach) q += `&coach=eq.${encodeURIComponent(coach.toLowerCase())}`;
  if (group) q += `&group_id=eq.${encodeURIComponent(group)}`;
  return rest(q);
}
function normalizeStudent(s) {
  return {
    username: (s.username || s.u || '').toLowerCase(), name: s.name || s.u || '',
    group_id: s.group_id || s.g || 'ms', coach: (s.coach || '').toLowerCase(), role: s.role || 'student',
    ladder_rating: s.ladder_rating ?? null, chesscom_rating: s.chesscom_rating ?? null,
    uscf_id: s.uscf_id ?? null, uscf_rating: s.uscf_rating ?? null, updated_at: new Date().toISOString(),
  };
}

// ---- progress snapshots (shared so coaches see trends across devices) ----
export const upsertSnapshot = (snap) => rest('snapshots?on_conflict=username,d', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: [snap] });
export const fetchSnapshots = (username) => rest(`snapshots?select=*&username=eq.${encodeURIComponent(username.toLowerCase())}&order=d.asc`);

// ---- roles ----
export async function isAdmin(username) {
  if (!username) return false;
  const rows = await rest(`admins?select=username&username=eq.${encodeURIComponent(username.toLowerCase())}`).catch(() => []);
  return !!(rows && rows.length);
}
export const addAdmin = (username, addedBy) => rest('admins?on_conflict=username', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: [{ username: (username || '').toLowerCase(), added_by: (addedBy || '').toLowerCase() }] });
