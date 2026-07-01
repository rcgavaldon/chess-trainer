// views/learn.js — interactive book-style lesson player. Show a position, pick a move from
// a few candidates, then every option is explained (including why the wrong ones fail).
// Partial credit, not binary. Progress saved per lesson.
import { h, clear } from '../dom.js';
import * as store from '../storage.js';
import { Chess } from 'chess.js';
import { createBoard, showArrow } from '../board.js';
import { LESSONS, bestOption } from '../lessons.js';
import { mistakesLesson } from '../coachquestions.js';
import { mountPuzzle } from '../puzzleplay.js';
import { loadThemeShard } from '../puzzles.js';
import { MATE_PATTERNS, IDENTIFY_OPTIONS, correctIdentify, basicName } from '../checkmates.js';

const LS = { lesson: null, step: 0, score: 0, ground: null, answered: false };
const MATE = { patternObj: null, puzzles: null, idx: 0 };
let LEARN_MODE = 'list', CTX = null, host = null;

export function render(container, ctx) { CTX = ctx; host = container; LS.lesson = null; MATE.patternObj = null; MATE.puzzles = null; LEARN_MODE = 'list'; draw(); }

const progress = () => store.get('lessons.done', {});

function draw() {
  clear(host);
  if (LS.lesson) return renderStep();
  if (MATE.patternObj && MATE.puzzles) return playMate();
  if (LEARN_MODE === 'mates') return renderMatePatterns();
  renderList();
}

function renderList() {
  const done = progress();
  const total = LESSONS.length, finished = LESSONS.filter((l) => done[l.id]).length;
  const myQuestions = store.get('train.questions', []);
  host.append(
    h('h1', {}, '📚 Learn'),
    h('p', { class: 'hint' }, 'Short, interactive lessons. See a position, pick a move, and find out why it works — or why it doesn\'t. ' + (finished ? `${finished}/${total} done.` : '')));
  // Bobby Fischer style: recognize + deliver checkmate patterns from real games.
  host.append(h('div', { class: 'card section', style: { borderColor: 'var(--accent-2)', boxShadow: '0 0 0 1px rgba(120,160,255,.18)', cursor: 'pointer' }, onclick: () => { LEARN_MODE = 'mates'; draw(); } },
    h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center' } },
      h('div', {}, h('div', { style: { fontWeight: 800, fontSize: '17px' } }, '♛ Checkmate patterns'),
        h('div', { class: 'hint tiny' }, 'Bobby Fischer style — see a position, deliver the mate, and learn what it\'s called.')),
      h('button', { class: 'btn', onclick: () => { LEARN_MODE = 'mates'; draw(); } }, 'Train →'))));
  // Personalized: positions from the student's OWN games where they slipped.
  if (myQuestions.length) {
    host.append(h('div', { class: 'card section', style: { borderColor: 'var(--accent)', boxShadow: '0 0 0 1px rgba(125,211,95,.2)', cursor: 'pointer' }, onclick: () => openLesson(mistakesLesson(myQuestions)) },
      h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center' } },
        h('div', {}, h('div', { style: { fontWeight: 800, fontSize: '17px' } }, '🎯 From your own games'),
          h('div', { class: 'hint tiny' }, `${Math.min(8, myQuestions.length)} positions you actually misplayed — get them right this time.`)),
        h('button', { class: 'btn', onclick: () => openLesson(mistakesLesson(myQuestions)) }, 'Start →'))));
  }
  host.append(
    h('h2', { class: 'section' }, 'Lessons'),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: '14px' } },
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

// ---------- Checkmate patterns (Bobby Fischer style) ----------
function renderMatePatterns() {
  host.append(
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('button', { class: 'btn ghost small', onclick: () => { LEARN_MODE = 'list'; draw(); } }, '← Learn'),
      h('div', { class: 'hint tiny' }, 'Bobby Fischer style')),
    h('h1', { style: { marginTop: '6px' } }, '♛ Checkmate patterns'),
    h('p', { class: 'hint' }, 'See a position, deliver the mate on the board, then name the pattern. The more you see them, the faster they jump out.'),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: '14px' } },
      ...MATE_PATTERNS.map((m) => h('div', { class: 'card', style: { cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '5px' }, onclick: () => startMate(m) },
        h('b', { style: { fontSize: '16px' } }, `${m.icon} ${m.name}`),
        h('div', { class: 'hint tiny' }, m.blurb)))));
}

async function loadMatePuzzles(m) {
  const per = Math.ceil(10 / m.shards.length) + 1;
  const all = [];
  for (const sh of m.shards) { const got = await loadThemeShard(sh, { count: per }); if (got) all.push(...got); }
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  return all.slice(0, 10);
}

async function startMate(m) {
  MATE.patternObj = m; MATE.puzzles = null; MATE.idx = 0;
  clear(host).append(h('div', { class: 'empty', style: { paddingTop: '40px' } }, h('div', { class: 'row', style: { justifyContent: 'center' } }, h('span', { class: 'spinner' }), ' Loading mates…')));
  const pz = await loadMatePuzzles(m);
  if (!pz || !pz.length) {
    clear(host).append(h('div', { class: 'card section' }, h('div', {}, 'Couldn\'t load these puzzles right now.'),
      h('button', { class: 'btn ghost small', style: { marginTop: '8px' }, onclick: () => { MATE.patternObj = null; LEARN_MODE = 'mates'; draw(); } }, '← Back')));
    return;
  }
  MATE.puzzles = pz; MATE.idx = 0; playMate();
}

function playMate() {
  const p = MATE.puzzles[MATE.idx], m = MATE.patternObj;
  clear(host);
  const chess = new Chess(p.fen);
  const toMove = chess.turn() === 'w' ? 'White' : 'Black';
  const plies = p.solutionMoves.length;
  const ask = plies <= 1 ? 'Deliver checkmate in one.' : `Force checkmate (mate in ${Math.ceil(plies / 2)}).`;
  const boardEl = h('div', { id: 'mate-board' });
  const panel = h('div', { class: 'trainer-side', id: 'mate-panel' });
  host.append(
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('button', { class: 'btn ghost small', onclick: () => { MATE.patternObj = null; MATE.puzzles = null; LEARN_MODE = 'mates'; draw(); } }, '← Patterns'),
      h('div', { class: 'hint tiny' }, `${m.name} · ${MATE.idx + 1} of ${MATE.puzzles.length}`)),
    h('h1', { style: { marginTop: '6px', fontSize: '21px' } }, `${m.icon} ${m.name}`),
    h('div', { class: 'trainer-grid section' },
      h('div', { class: 'trainer-coach' },
        h('div', { class: 'hint tiny', style: { fontWeight: 700, color: 'var(--accent-2)', marginBottom: '6px' } }, `♟ ${toMove} to move`),
        h('div', { class: 'explain-box', style: { fontSize: '14px' } }, ask)),
      h('div', { class: 'board-wrap trainer-board' }, boardEl),
      panel));
  const ctrl = mountPuzzle(boardEl, p, {
    allowRetry: true,
    onWrong: (pz, first) => {
      if (document.getElementById('mate-wrong')) return;
      panel.append(h('div', { id: 'mate-wrong', class: 'hint', style: { color: 'var(--warn)', marginTop: '10px' } }, first ? 'Not mate — that lets the king out. Look again.' : 'Still not mate. Try the hint.'));
    },
    onSolved: () => onMateSolved(panel, p),
  });
  clear(panel).append(
    h('div', { class: 'hint tiny', style: { fontWeight: 700, marginBottom: '8px' } }, 'Play the mating move on the board.'),
    h('button', { class: 'btn ghost small', onclick: () => ctrl.hint() }, '💡 Hint'));
}

function onMateSolved(panel, p) {
  clear(panel);
  if (MATE.patternObj.key === 'mix') {
    panel.append(
      h('div', { style: { fontWeight: 800, color: 'var(--good)', fontSize: '16px', marginBottom: '6px' } }, '✓ Checkmate!'),
      h('div', { class: 'hint', style: { marginBottom: '10px' } }, 'What kind of mate did you just deliver?'));
    for (const opt of IDENTIFY_OPTIONS) {
      panel.append(h('button', { class: 'btn ghost', style: { display: 'block', width: '100%', textAlign: 'left', marginBottom: '8px' }, onclick: () => revealIdentify(panel, p, opt.key) }, opt.label));
    }
  } else {
    revealMate(panel, MATE.patternObj.name, MATE.patternObj.teach, true);
  }
}

function revealIdentify(panel, p, guess) {
  const correct = correctIdentify(p);
  const right = guess === correct;
  const named = MATE_PATTERNS.find((m) => m.key === correct);
  const name = correct === 'basic' ? basicName(p) : named.name;
  const teach = correct === 'basic' ? 'A clean forced mate — the bread and butter of finishing a game.' : named.teach;
  clear(panel).append(
    h('div', { style: { fontWeight: 800, color: right ? 'var(--good)' : 'var(--warn)', fontSize: '16px', marginBottom: '8px' } }, right ? `✓ Right — ${name}` : `Actually — ${name}`),
    h('div', { class: 'explain-box', style: { fontSize: '13px', marginBottom: '12px' } }, teach),
    nextMateBtn());
}

function revealMate(panel, name, teach) {
  clear(panel).append(
    h('div', { style: { fontWeight: 800, color: 'var(--good)', fontSize: '16px', marginBottom: '8px' } }, `✓ ${name}!`),
    h('div', { class: 'explain-box', style: { fontSize: '13px', marginBottom: '12px' } }, teach),
    nextMateBtn());
}

function nextMateBtn() {
  const last = MATE.idx >= MATE.puzzles.length - 1;
  return h('button', { class: 'btn', onclick: () => { if (last) finishMates(); else { MATE.idx++; playMate(); } } }, last ? 'Done ✓' : 'Next mate →');
}

function finishMates() {
  const m = MATE.patternObj, n = MATE.puzzles.length;
  clear(host).append(h('div', { class: 'empty', style: { paddingTop: '40px' } },
    h('div', { style: { fontSize: '44px' } }, '♚'),
    h('div', { style: { fontSize: '20px', fontWeight: 800, marginTop: '8px' } }, `${n} checkmates delivered!`),
    h('div', { class: 'hint', style: { marginTop: '6px' } }, 'Pattern recognition is pure repetition — the more mates you see, the faster they jump out in your own games.'),
    h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '18px', gap: '10px' } },
      h('button', { class: 'btn', onclick: () => startMate(m) }, `↻ More ${m.name.toLowerCase()}`),
      h('button', { class: 'btn ghost', onclick: () => { MATE.patternObj = null; MATE.puzzles = null; LEARN_MODE = 'mates'; draw(); } }, 'All patterns'))));
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
