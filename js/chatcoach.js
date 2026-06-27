// chatcoach.js — streaming, multi-turn AI coach chat (Anthropic Messages API, browser-direct).
// Plugs into puzzles and game review for follow-up questions. Uses the owner's API key.
import { h, clear } from './dom.js';
import * as store from './storage.js';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const CHAT_MODEL = 'claude-sonnet-4-6'; // better reasoning for a coaching conversation

// createCoachChat({ apiKey, getContext }) -> { ask(text, onDelta) , history, reset() }
// getContext() returns a fresh string describing the current position/move/puzzle.
export function createCoachChat({ apiKey, model = CHAT_MODEL, getContext }) {
  const history = [];
  async function ask(userText, onDelta) {
    history.push({ role: 'user', content: userText });
    const system =
      'You are a friendly, patient chess coach in a back-and-forth conversation with an improving player. ' +
      'Answer their question clearly and encouragingly in plain language (simple enough for a beginner), a few ' +
      'sentences, specific to the position. Explain the WHY and the plan, not just the move. If they go off-topic, ' +
      'gently steer back to the chess in front of you.\n\nCURRENT POSITION CONTEXT:\n' + (getContext ? getContext() : 'n/a');
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model, max_tokens: 600, system, stream: true, messages: history.slice(-12) }),
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

// mountChat(el, { getContext, starter }) — renders a chat box bound to the position context.
export function mountChat(el, { getContext, starter } = {}) {
  clear(el);
  const key = store.get('profile.llmKey', '');
  if (!key) {
    el.append(h('div', { class: 'hint tiny' }, '💬 Add your Anthropic API key in ⚙ Settings to chat with the coach about this position.'));
    return;
  }
  const chat = createCoachChat({ apiKey: key, getContext });
  const log = h('div', { class: 'chatlog' });
  const input = h('input', { type: 'text', placeholder: starter || 'Ask the coach… e.g. "why is that better?"', onkeydown: (e) => { if (e.key === 'Enter') send(); } });
  const sendBtn = h('button', { class: 'btn small', onclick: () => send() }, 'Ask');
  el.append(h('div', { class: 'chatbox' }, log, h('div', { class: 'row', style: { marginTop: '8px' } }, input, sendBtn)));

  function bubble(role, text) {
    const b = h('div', { class: 'chat-msg ' + role }, text);
    log.append(b);
    log.scrollTop = log.scrollHeight;
    return b;
  }
  async function send() {
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    bubble('user', q);
    const a = bubble('coach', '…');
    sendBtn.disabled = true;
    try {
      let started = false;
      await chat.ask(q, (_d, full) => { if (!started) { a.textContent = ''; started = true; } a.textContent = full; log.scrollTop = log.scrollHeight; });
    } catch (e) { a.textContent = '⚠ ' + e.message; }
    finally { sendBtn.disabled = false; input.focus(); }
  }
}
