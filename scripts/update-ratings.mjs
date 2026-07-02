#!/usr/bin/env node
// update-ratings.mjs — daily Chess.com ELO pull. Reads every student from Supabase, fetches their
// current Chess.com rating (rapid, then blitz), and writes it back to students.chesscom_rating.
// Run by .github/workflows/daily-ratings.yml on a cron (and manually via workflow_dispatch).
// The publishable key is public by design and writes are gated by the table's RLS policies.

const URL = (process.env.SUPABASE_URL || 'https://ukorgxlabzoslxxxhtvm.supabase.co').replace(/\/$/, '');
const KEY = process.env.SUPABASE_KEY || 'sb_publishable_BIwXxIlAGm6cjNvMUriREQ_JTSmUhmv';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function chesscomRating(username) {
  const r = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(username)}/stats`, { headers: { 'User-Agent': 'chess-trainer-daily (rgautomations)' } });
  if (!r.ok) return null;
  const s = await r.json();
  return s.chess_rapid?.last?.rating ?? s.chess_blitz?.last?.rating ?? s.chess_bullet?.last?.rating ?? null;
}

async function main() {
  const res = await fetch(`${URL}/rest/v1/students?select=username,chesscom_rating`, { headers: H });
  if (!res.ok) { console.error('Could not read students:', res.status, await res.text()); process.exit(1); }
  const students = await res.json();
  console.log(`Updating ${students.length} students…`);
  let updated = 0, unchanged = 0, failed = 0;
  for (const s of students) {
    try {
      const rating = await chesscomRating(s.username);
      if (rating == null) { console.log(`  ${s.username}: no Chess.com rating`); failed++; }
      else if (rating === s.chesscom_rating) { console.log(`  ${s.username}: ${rating} (unchanged)`); unchanged++; }
      else {
        const up = await fetch(`${URL}/rest/v1/students?username=eq.${encodeURIComponent(s.username)}`, {
          method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' },
          body: JSON.stringify({ chesscom_rating: rating, updated_at: new Date().toISOString() }),
        });
        if (up.ok) { console.log(`  ${s.username}: ${s.chesscom_rating ?? '—'} → ${rating}`); updated++; }
        else { console.log(`  ${s.username}: write failed ${up.status}`); failed++; }
      }
    } catch (e) { console.log(`  ${s.username}: error ${e.message}`); failed++; }
    await sleep(350); // be gentle with the Chess.com API
  }
  console.log(`Done. ${updated} updated, ${unchanged} unchanged, ${failed} failed.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
