// uscf.js — US Chess (USCF) tournament history, via our Cloudflare Worker (/uscf/… routes proxy
// ratings-api.uschess.org, which sends no CORS headers). Cached in localStorage for 7 days per ID —
// "pulls once a week" — with a manual refresh that busts the cache.
import * as store from './storage.js';
import { COACH_PROXY } from './coach.js';

const TTL = 7 * 24 * 3600 * 1000;
export const uscfAvailable = () => !!COACH_PROXY;
export const validUscfId = (id) => /^\d{8,9}$/.test(String(id || '').trim());

async function getJSON(path) {
  const res = await fetch(COACH_PROXY.replace(/\/$/, '') + path, { headers: { Accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('US Chess lookup failed (' + res.status + ')');
  return res.json();
}

// { member, events:[{id,name,endDate,place,players,sections:[{name,system,pre,post}]}] } newest first.
export async function fetchUscfHistory(uscfId, { force = false } = {}) {
  const id = String(uscfId).trim();
  if (!validUscfId(id)) throw new Error('US Chess IDs are 8–9 digits');
  const cached = store.get('uscf.cache.' + id, null);
  if (!force && cached && Date.now() - cached.t < TTL) return cached.data;

  const [member, sections] = [await getJSON(`/uscf/${id}`), await getJSON(`/uscf/${id}/sections?page=1&pageSize=100`)];
  if (!member) throw new Error('No US Chess member found for ID ' + id);
  const byEvent = new Map();
  for (const s of (sections && sections.items) || []) {
    const ev = s.event || {};
    const key = ev.id || s.id;
    if (!byEvent.has(key)) {
      byEvent.set(key, {
        id: ev.id || null, name: ev.name || 'Event', endDate: ev.endDate || s.endDate || '',
        place: [ev.city, ev.stateCode].filter(Boolean).join(', '), sections: [],
      });
    }
    const rec = (s.ratingRecords || [])[0] || {};
    byEvent.get(key).sections.push({
      name: s.sectionName || `Section ${s.sectionNumber || ''}`.trim(),
      system: { R: 'Regular', Q: 'Quick', B: 'Blitz', G: 'FIDE' }[s.ratingSystem] || s.ratingSystem || '',
      pre: rec.preRating ?? null, post: rec.postRating ?? null,
    });
  }
  const events = [...byEvent.values()].sort((a, b) => (b.endDate || '').localeCompare(a.endDate || ''));
  const data = {
    member: {
      name: [member.firstName, member.lastName].filter(Boolean).join(' ') || null,
      ratings: (member.ratings || []).map((r) => ({ system: r.ratingSystem, rating: r.rating })),
      state: member.stateCode || null,
    },
    events,
    fetchedAt: Date.now(),
  };
  store.set('uscf.cache.' + id, { t: Date.now(), data });
  return data;
}

// The MSA crosstable is the canonical "dig in" page (fine in a real browser).
export const crosstableUrl = (eventId) => `https://msa.uschess.org/XtblMain.php?${eventId}`;
