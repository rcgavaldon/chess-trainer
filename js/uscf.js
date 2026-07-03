// uscf.js — US Chess (USCF) tournament history, via our Cloudflare Worker (/uscf/… routes proxy
// ratings-api.uschess.org, which sends no CORS headers). Cached in localStorage for 7 days per ID —
// "pulls once a week" — with a manual refresh that busts the cache.
import * as store from './storage.js';
import { COACH_PROXY } from './coach.js';

const TTL = 7 * 24 * 3600 * 1000;
const CACHE = 'uscf.cache2.'; // v2: includes per-game results (old 'uscf.cache.' entries just expire unused)
export const uscfAvailable = () => !!COACH_PROXY;
export const validUscfId = (id) => /^\d{8,9}$/.test(String(id || '').trim());

async function getJSON(path) {
  const res = await fetch(COACH_PROXY.replace(/\/$/, '') + path, { headers: { Accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('US Chess lookup failed (' + res.status + ')');
  return res.json();
}

// { member, events:[{id,name,endDate,place,record:{w,l,d},sections:[{name,system,pre,post,record,games}]}] }
// newest first. Sections carry their games: [{round?,opponent,oppRating?,color,outcome}].
export async function fetchUscfHistory(uscfId, { force = false } = {}) {
  const id = String(uscfId).trim();
  if (!validUscfId(id)) throw new Error('US Chess IDs are 8–9 digits');
  const cached = store.get(CACHE + id, null);
  if (!force && cached && Date.now() - cached.t < TTL) return cached.data;

  const [member, sections, games] = [
    await getJSON(`/uscf/${id}`),
    await getJSON(`/uscf/${id}/sections?page=1&pageSize=100`),
    await getJSON(`/uscf/${id}/games?page=1&pageSize=100`).catch(() => null), // best-effort detail
  ];
  if (!member) throw new Error('No US Chess member found for ID ' + id);

  // Per-game results, grouped by event+section, so each event can show a real W-L-D and opponents.
  const gamesBySection = new Map();
  for (const g of (games && games.items) || []) {
    const key = (g.event?.id || '') + '|' + (g.section?.number ?? '');
    if (!gamesBySection.has(key)) gamesBySection.set(key, []);
    gamesBySection.get(key).push({
      opponent: [g.opponent?.firstName, g.opponent?.lastName].filter(Boolean).join(' ') || 'Opponent',
      color: g.player?.color || '',
      outcome: g.player?.outcome || '', // Win | Loss | Draw
    });
  }
  const recordOf = (list) => list.reduce((r, g) => {
    if (g.outcome === 'Win') r.w++; else if (g.outcome === 'Loss') r.l++; else if (g.outcome) r.d++;
    return r;
  }, { w: 0, l: 0, d: 0 });

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
    const secGames = gamesBySection.get((ev.id || '') + '|' + (s.sectionNumber ?? '')) || [];
    byEvent.get(key).sections.push({
      name: s.sectionName || `Section ${s.sectionNumber || ''}`.trim(),
      system: { R: 'Regular', Q: 'Quick', B: 'Blitz', G: 'FIDE' }[s.ratingSystem] || s.ratingSystem || '',
      pre: rec.preRating ?? null, post: rec.postRating ?? null,
      games: secGames, record: secGames.length ? recordOf(secGames) : null,
    });
  }
  const events = [...byEvent.values()].sort((a, b) => (b.endDate || '').localeCompare(a.endDate || ''));
  for (const ev of events) {
    const all = ev.sections.flatMap((s) => s.games);
    ev.record = all.length ? recordOf(all) : null;
  }
  const data = {
    member: {
      name: [member.firstName, member.lastName].filter(Boolean).join(' ') || null,
      ratings: (member.ratings || []).map((r) => ({ system: r.ratingSystem, rating: r.rating })),
      state: member.stateCode || null,
    },
    events,
    fetchedAt: Date.now(),
  };
  store.set(CACHE + id, { t: Date.now(), data });
  return data;
}

// The event's page on the new US Chess site (msa.uschess.org crosstables are bot-walled/unreliable).
export const eventUrl = (eventId) => `https://ratings.uschess.org/event/${eventId}`;
export const playerUrl = (uscfId) => `https://ratings.uschess.org/player/${uscfId}`;
