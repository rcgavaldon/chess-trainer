// chatcoach.js — streaming, multi-turn AI coach chat (Anthropic Messages API, browser-direct).
// Plugs into puzzles and game review for follow-up questions. Uses the owner's API key.
import { h, clear } from './dom.js';
import { coachEndpoint, coachEnabled } from './coach.js';
import { getLang } from './i18n.js';

const CHAT_MODEL = 'claude-sonnet-4-6'; // better reasoning for a coaching conversation

// The chat bubble is plain text, but the model still tends to emit markdown (bold **…**, #
// headers, `code`) — especially on a longer whole-game review. Strip the markers so it reads
// clean. Runs on every streamed frame, so it also tidies a mid-stream unclosed ** marker.
const cleanCoach = (s) => (s || '').replace(/\*\*/g, '').replace(/`+/g, '').replace(/^#{1,6}\s+/gm, '');

// createCoachChat({ getContext }) -> { ask(text, onDelta) , history, reset() }
// getContext() returns a fresh string describing the current position/move/puzzle.
export function createCoachChat({ model = CHAT_MODEL, getContext }) {
  const history = [];
  async function ask(userText, onDelta) {
    history.push({ role: 'user', content: userText });
    const system =
      'You are a friendly, patient chess coach in a back-and-forth conversation with an improving player about the ' +
      'game or puzzle in front of them. For a question about a specific move or the current position, answer in 1-2 ' +
      'tight sentences. For a question about the WHOLE game (how they played overall, the turning points, what to ' +
      'work on), you may use up to 4-5 sentences: name the key moments from the summary, then give 1-2 concrete, ' +
      'specific things to practice. Plain language, simple enough for a beginner. Give the WHY and the plan, not just ' +
      'the move — but no filler. Write in plain text only — NO markdown, asterisks, or bold; if you list things, use ' +
      'short dashed lines. Stick to what the context below actually states — do not invent tactics, threats, or ' +
      'piece locations you cannot verify from it; if unsure, say so or stay general.' +
      (getLang() === 'es' ? ' Reply entirely in natural Spanish.' : '') +
      '\n\nCONTEXT (whole-game summary + the current position):\n' + (getContext ? getContext() : 'n/a');
    const ep = coachEndpoint();
    if (!ep.headers) { history.pop(); throw new Error('Coach unavailable'); }
    const res = await fetch(ep.url, {
      method: 'POST',
      headers: ep.headers,
      body: JSON.stringify({ model, max_tokens: 500, system, stream: true, messages: history.slice(-12) }),
    });
    if (!res.ok || !res.body) {
      history.pop();
      throw new Error(res.status === 401 ? 'Invalid API key' : res.status === 429 ? 'Rate limited — wait a moment' : 'API error ' + res.status);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', full = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]' || !data) continue;
        try {
          const ev = JSON.parse(data);
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            full += ev.delta.text;
            onDelta && onDelta(ev.delta.text, full);
          }
        } catch {}
      }
    }
    history.push({ role: 'assistant', content: full });
    return full;
  }
  return { ask, history, reset() { history.length = 0; } };
}

// mountChat(el, { getContext, starter, quickAsks }) — renders a chat box bound to the context.
// quickAsks: [{ label, text }] one-tap prompts (e.g. "Review my whole game").
export function mountChat(el, { getContext, starter, quickAsks } = {}) {
  clear(el);
  if (!coachEnabled()) {
    el.append(h('div', { class: 'hint tiny' }, '💬 Add your Anthropic API key in ⚙ Settings to chat with the coach about this position.'));
    return;
  }
  const chat = createCoachChat({ getContext });
  const log = h('div', { class: 'chatlog' });
  const input = h('input', { type: 'text', placeholder: starter || 'Ask the coach… e.g. "why is that better?"', onkeydown: (e) => { if (e.key === 'Enter') send(); } });
  const sendBtn = h('button', { class: 'btn small', onclick: () => send() }, 'Ask');
  const box = h('div', { class: 'chatbox' }, log);
  if (quickAsks && quickAsks.length) {
    box.append(h('div', { class: 'chip-row', style: { margin: '4px 0 8px' } },
      ...quickAsks.map((qa) => h('button', { class: 'chip', onclick: () => send(qa.text) }, qa.label))));
  }
  box.append(h('div', { class: 'row', style: { marginTop: '8px' } }, input, sendBtn));
  el.append(box);

  function bubble(role, text) {
    const b = h('div', { class: 'chat-msg ' + role }, text);
    log.append(b);
    log.scrollTop = log.scrollHeight;
    return b;
  }
  async function send(preset) {
    const q = (typeof preset === 'string' ? preset : input.value).trim();
    if (!q) return;
    if (typeof preset !== 'string') input.value = '';
    bubble('user', q);
    const a = bubble('coach', '…');
    sendBtn.disabled = true;
    try {
      let started = false;
      await chat.ask(q, (_d, full) => { if (!started) { a.textContent = ''; started = true; } a.textContent = cleanCoach(full); log.scrollTop = log.scrollHeight; });
    } catch (e) { a.textContent = '⚠ ' + e.message; }
    finally { sendBtn.disabled = false; input.focus(); }
  }
}
