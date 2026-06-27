// llm.js — OPTIONAL richer move commentary written by Claude, using the user's own
// Anthropic API key (entered in Settings). Calls the Messages API directly from the
// browser via the anthropic-dangerous-direct-browser-access header.
//
// SECURITY: a browser-direct call exposes the API key in-page. This is acceptable for
// the owner's personal use on their own machine. A hosted, multi-user deployment must
// proxy this server-side instead — never ship a shared key to the client.

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

// Cheap+fast default for short per-move comments; configurable from settings later.
export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

export function hasKey() {
  try { return !!localStorage.getItem('chesstrainer:root') && JSON.parse(localStorage.getItem('chesstrainer:root'))?.profile?.llmKey; }
  catch { return false; }
}

// commentMove -> a 1-2 sentence coach comment string (or throws on a hard error).
export async function commentMove({ apiKey, model = DEFAULT_MODEL, fen, color, playedSan, bestSan, label, winLoss, heuristic }) {
  if (!apiKey) return null;
  const system =
    'You are a warm, encouraging chess coach for an improving club player. In ONE or TWO short, specific sentences, ' +
    'explain why their move earned the grade given, building on the engine facts. Be concrete about THIS position ' +
    '(the idea, the threat, the better plan). No long variations, no move-by-move lists, no restating the FEN, no fluff.';
  const user =
    `Position FEN: ${fen}\n` +
    `${color} played ${playedSan}, graded "${label}"${winLoss ? ` (it dropped about ${winLoss}% win chance)` : ''}.\n` +
    `Engine's preferred move: ${bestSan || 'n/a'}.\n` +
    `Heuristic note: ${heuristic || 'none'}.\n` +
    'Give your short coach comment.';

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model, max_tokens: 150, temperature: 0.4, system, messages: [{ role: 'user', content: user }] }),
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
export async function coachPlan({ apiKey, model = DEFAULT_MODEL, username, insights, actions }) {
  if (!apiKey) return null;
  const system =
    'You are a chess coach writing a brief, motivating weekly study note for a student. 3-4 sentences. ' +
    'Reference their concrete numbers, name the single most important thing to fix first, and end with one specific encouragement. No lists.';
  const user =
    `Student: ${username}. Avg accuracy ${insights.accAvg}%, ${insights.rates?.blundersPerGame} blunders/game, ` +
    `weakest phase: ${insights.phaseLossRanked?.[0]?.phase}. Top recommended actions: ` +
    actions.slice(0, 3).map((a) => a.title).join('; ') + '. Write the note.';
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model, max_tokens: 250, temperature: 0.5, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error('API error ' + res.status);
  const data = await res.json();
  return (data.content || []).map((b) => b.text || '').join('').trim() || null;
}
