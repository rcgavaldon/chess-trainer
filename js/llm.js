// llm.js — OPTIONAL richer move commentary written by Claude. Routes through coach.js, which
// either uses a server-side proxy (shared key, safe for all users) or the user's own key.

import { coachEndpoint, coachEnabled } from './coach.js';

// Cheap+fast default for short per-move comments; configurable from settings later.
export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

export const hasKey = coachEnabled; // true when a proxy is configured OR the user has their own key

// commentMove -> a 1-2 sentence coach comment string (or throws on a hard error).
export async function commentMove({ model = DEFAULT_MODEL, fen, color, playedSan, bestSan, label, winLoss, heuristic }) {
  const ep = coachEndpoint();
  if (!ep.headers) return null;
  // Keep the coach's take CONSISTENT with the move grade: affirm a good move (don't undercut it by
  // calling a different engine pick "stronger"); only prescribe a better move for a weak one.
  const GOOD = ['Brilliant', 'Great', 'Best', 'Excellent', 'Good', 'Book'];
  const isGood = GOOD.includes(label);
  const altMove = bestSan && bestSan !== playedSan ? bestSan : null;
  const system = isGood
    ? 'You are a warm, encouraging chess coach. In 1-2 short sentences, affirm WHY this move is good — the key idea ' +
      'it achieves in THIS position (name the squares/pieces). If the engine had a slightly different top pick you ' +
      'MAY mention it as an equally-strong or marginally-sharper alternative, but NEVER call the played move a ' +
      'mistake or say the other move is "better" or "stronger" — the player did well. Plain language, no jargon, no ' +
      'variations, no FEN, no filler. Keep it tight.'
    : 'You are a warm, encouraging chess coach. In 1-2 short sentences (a third ONLY if truly needed), say WHY this ' +
      'move is weak — what it gives away — and what the stronger move does better (the plan or threat behind it). Be ' +
      'specific to THIS position: name the squares/pieces. Plain language, no jargon, no variations, no FEN, no filler.';
  const user =
    `Position FEN: ${fen}\n` +
    `${color} played ${playedSan}, graded "${label}"${winLoss ? ` (win chance changed about ${winLoss}%)` : ''}.\n` +
    (altMove
      ? (isGood ? `Engine's top pick was ${altMove} — usually just an equally good alternative here.\n` : `The stronger move was ${altMove}.\n`)
      : 'This WAS the engine\'s own top move.\n') +
    `Heuristic note: ${heuristic || 'none'}.\n` +
    'Give your short coach comment.';

  const res = await fetch(ep.url, {
    method: 'POST',
    headers: ep.headers,
    body: JSON.stringify({ model, max_tokens: 170, temperature: 0.4, system, messages: [{ role: 'user', content: user }] }),
  });
  if (res.status === 401) throw new Error('Invalid Anthropic API key');
  if (res.status === 429) throw new Error('Rate limited — wait a moment and retry');
  if (!res.ok) {
    let msg = 'API error ' + res.status;
    try { const e = await res.json(); if (e?.error?.message) msg = e.error.message; } catch {}
    throw new Error(msg);
  }
  const data = await res.json();
  return (data.content || []).map((b) => b.text || '').join('').trim() || null;
}

// A short "study plan" paragraph from the improvement-plan actions (optional, owner-key).
export async function coachPlan({ model = DEFAULT_MODEL, username, insights, actions }) {
  const ep = coachEndpoint();
  if (!ep.headers) return null;
  const system =
    'You are a chess coach writing a brief, motivating weekly study note for a student. 2 short sentences. ' +
    'Name the single most important thing to fix first (tie it to one concrete number), then one specific encouragement. No lists.';
  const user =
    `Student: ${username}. Avg accuracy ${insights.accAvg}%, ${insights.rates?.blundersPerGame} blunders/game, ` +
    `weakest phase: ${insights.phaseLossRanked?.[0]?.phase}. Top recommended actions: ` +
    actions.slice(0, 3).map((a) => a.title).join('; ') + '. Write the note.';
  const res = await fetch(ep.url, {
    method: 'POST',
    headers: ep.headers,
    body: JSON.stringify({ model, max_tokens: 140, temperature: 0.5, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error('API error ' + res.status);
  const data = await res.json();
  return (data.content || []).map((b) => b.text || '').join('').trim() || null;
}
