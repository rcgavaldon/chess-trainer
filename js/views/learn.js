// views/learn.js — interactive book-style lesson player. Show a position, pick a move from
// a few candidates, then every option is explained (including why the wrong ones fail).
// Partial credit, not binary. Progress saved per lesson.
import { h, clear } from '../dom.js';
import * as store from '../storage.js';
import { Chess } from 'chess.js';
import { createBoard, showArrow } from '../board.js';
import { LESSONS, bestOption } from '../lessons.js';

const LS = { lesson: null, step: 0, score: 0, ground: null, answered: false };
let CTX = null, host = null;

export function render(container, ctx) { CTX = ctx; host = container; LS.lesson = null; draw(); }

const progress = () => store.get('lessons.done', {});

function draw() { clear(host); if (LS.lesson) renderStep(); else renderList(); }

function renderList() {
  const done = progress();
  const total = LESSONS.length, finished = LESSONS.filter((l) => done[l.id]).length;
  host.append(
    h('h1', {}, '📚 Learn'),
    h('p', { class: 'hint' }, 'Short, interactive lessons. See a position, pick a move, and find out why it works — or why it doesn\'t. ' + (finished ? `${finished}/${total} done.` : '')),
    h('div', { class: 'section', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: '14px' } },
      ...LESSONS.map((l) => {
        const d = done[l.id];
        return h('div', { class: 'card', style: { cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '5px' }, onclick: () => openLesson(l) },
          h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' } },
            h('b', { style: { fontSize: '16px' } }, `${l.icon} ${l.title}`),
            d ? h('span', { class: 'pill', style: { background: 'rgba(95,196,106,.18)', color: 'var(--good)' } }, `✓ ${Math.round(d.best * 100)}%`) : h('span', { class: 'hint tiny' }, l.theme)),
          h('div', { class: 'hint tiny' }, l.blurb));
      })));
}

function openLesson(l) { LS.lesson = l; LS.step = 0; LS.score = 0; LS.answered = false; draw(); }

function renderStep() {
  const l = LS.lesson, st = l.steps[LS.step];
  clear(host);
  host.append(
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('button', { class: 'btn ghost small', onclick: () => { LS.lesson = null; draw(); } }, '← All lessons'),
      h('div', { class: 'hint tiny' }, `${l.theme} · Step ${LS.step + 1} of ${l.steps.length}`)),
    h('h1', { style: { marginTop: '6px', fontSize: '21px' } }, `${l.icon} ${l.title}`));
  const boardEl = h('div', { id: 'lesson-board' });
  const panel = h('div', { class: 'trainer-side', id: 'lesson-panel' });
  const chess = new Chess(st.fen);
  host.append(h('div', { class: 'trainer-grid section' },
    h('div', { class: 'trainer-coach' },
      h('div', { class: 'hint tiny', style: { fontWeight: 700, color: 'var(--accent-2)', marginBottom: '6px' } }, `♟ ${chess.turn() === 'w' ? 'White' : 'Black'} to move`),
      h('div', { class: 'explain-box', style: { fontSize: '14px' } }, st.ask)),
    h('div', { class: 'board-wrap trainer-board' }, boardEl),
    panel));
  LS.ground = createBoard(boardEl, { viewOnly: true, fen: st.fen, coordinates: true, orientation: chess.turn() === 'w' ? 'white' : 'black' });
  LS.answered = false;
  renderOptions(panel, st);
}

function renderOptions(panel, st) {
  clear(panel);
  panel.append(h('div', { class: 'hint tiny', style: { fontWeight: 700, marginBottom: '8px' } }, 'Pick a move:'));
  for (const o of st.options) {
    panel.append(h('button', { class: 'btn ghost', style: { display: 'block', width: '100%', textAlign: 'left', marginBottom: '8px', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: '15px' }, onclick: () => onPick(st, o) }, o.san));
  }
}

function onPick(st, picked) {
  if (LS.answered) return;
  LS.answered = true;
  LS.score += picked.credit;
  const best = bestOption(st);
  const c = new Chess(st.fen);
  const bm = c.move(best.san);
  if (bm) showArrow(LS.ground, bm.from + bm.to, 'green');
  const panel = document.getElementById('lesson-panel');
  clear(panel);
  const verdict = picked.credit >= 1 ? { t: '✓ Correct!', c: 'var(--good)' } : picked.credit > 0 ? { t: '◐ Close — partial credit', c: 'var(--warn)' } : { t: '✗ Not the best move', c: 'var(--bad)' };
  panel.append(h('div', { style: { fontWeight: 800, color: verdict.c, fontSize: '16px', marginBottom: '12px' } }, verdict.t));
  const topCredit = Math.max(...st.options.map((x) => x.credit));
  for (const o of st.options) {
    const isBest = o.credit >= topCredit && o.credit > 0;
    const col = o.credit >= 1 ? 'var(--good)' : o.credit > 0 ? 'var(--warn)' : 'var(--muted)';
    panel.append(h('div', { style: { borderLeft: `3px solid ${col}`, paddingLeft: '10px', marginBottom: '11px', opacity: (o === picked || isBest) ? 1 : 0.7 } },
      h('div', { style: { fontWeight: 700, fontFamily: 'var(--mono)' } }, o.san, isBest ? h('span', { style: { color: 'var(--good)' } }, '  ✓ best') : null, o === picked ? h('span', { class: 'hint tiny' }, '   ← your pick') : null),
      h('div', { class: 'hint', style: { fontSize: '13px', marginTop: '2px' } }, o.why)));
  }
  const last = LS.step >= LS.lesson.steps.length - 1;
  panel.append(h('button', { class: 'btn', style: { marginTop: '4px' }, onclick: () => (last ? finishLesson() : (LS.step++, draw())) }, last ? 'Finish ✓' : 'Next →'));
}

function finishLesson() {
  const l = LS.lesson;
  const frac = LS.score / l.steps.length;
  const done = progress();
  done[l.id] = { best: Math.max(done[l.id]?.best || 0, frac), completedAt: Date.now() };
  store.set('lessons.done', done);
  clear(host).append(h('div', { class: 'empty', style: { paddingTop: '40px' } },
    h('div', { style: { fontSize: '44px' } }, frac >= 1 ? '🎉' : frac >= 0.5 ? '👍' : '📘'),
    h('div', { style: { fontSize: '20px', fontWeight: 800, marginTop: '8px' } }, `${l.title} — ${Math.round(frac * 100)}%`),
    h('div', { class: 'hint', style: { marginTop: '6px' } }, frac >= 1 ? 'Perfect — you nailed every move!' : 'Nice work. Replay it to lock the ideas in.'),
    h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '18px', gap: '10px' } },
      h('button', { class: 'btn', onclick: () => openLesson(l) }, '↻ Replay'),
      h('button', { class: 'btn ghost', onclick: () => { LS.lesson = null; draw(); } }, 'All lessons'))));
}
