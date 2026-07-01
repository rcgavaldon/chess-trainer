// views/mates.js — "Advanced Mates": learn the classic NAMED checkmates (Anastasia's, Boden's,
// Arabian, hook, …). Two modes: Learn & Practice (pick a mate → it plays the pattern for you,
// then you deliver a few yourself) and Identify (deliver the mate, then name which one it was).
import { h, clear } from '../dom.js';
import { Chess } from 'chess.js';
import { loadThemeShard } from '../puzzles.js';
import { mountPuzzle } from '../puzzleplay.js';
import { createBoard, showArrow } from '../board.js';
import { ADVANCED_MATES, mateByKey } from '../checkmates.js';

const M = { mode: 'learn', pattern: null, puzzles: null, idx: 0, phase: 'demo', idList: null, idIdx: 0, solved: 0, seen: new Set() };
let CTX = null, host = null, timer = null;

export function render(container, ctx) {
  CTX = ctx; host = container;
  M.mode = 'learn'; M.pattern = null; M.puzzles = null; M.idList = null;
  draw();
}
function stopTimer() { if (timer) { clearTimeout(timer); timer = null; } }
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function draw() {
  stopTimer(); clear(host);
  if (M.pattern) return M.phase === 'demo' ? renderDemo() : renderPractice();
  if (M.mode === 'identify') return renderIdentify();
  renderList();
}

// -------- landing: mode toggle + grid of all named mates --------
function renderList() {
  const tab = (id, label) => h('button', { class: 'btn small' + (M.mode === id ? '' : ' ghost'), onclick: () => { M.mode = id; if (id === 'identify') { M.solved = 0; startIdentify(); } else draw(); } }, label);
  host.append(
    h('button', { class: 'btn ghost small', onclick: () => CTX.navigate('train') }, '← Puzzles'),
    h('h1', { style: { marginTop: '6px' } }, '♛ Advanced Mates'),
    h('p', { class: 'hint' }, 'The classic checkmating patterns every strong player knows on sight. Pick one to see it and practice it, or test yourself in Identify mode.'),
    h('div', { class: 'row', style: { gap: '8px', margin: '6px 0 14px' } }, tab('learn', '📖 Learn & Practice'), tab('identify', '🎯 Identify')),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: '12px' } },
      ...ADVANCED_MATES.map((m) => h('div', { class: 'card', style: { cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '5px' }, onclick: () => startPattern(m) },
        h('b', { style: { fontSize: '16px' } }, `${m.icon} ${m.name}`),
        h('div', { class: 'hint tiny' }, m.blurb)))));
}

// -------- Learn & Practice: load puzzles, DEMO the first, then practice the rest --------
async function startPattern(m) {
  M.pattern = m; M.puzzles = null; M.idx = 1; M.phase = 'demo'; M.solved = 0; M.seen = new Set();
  clear(host).append(h('div', { class: 'row' }, h('span', { class: 'spinner' }), ` Loading ${m.name}…`));
  const pz = await loadThemeShard(m.key, { count: 9 }).catch(() => null);
  if (!pz || !pz.length) { clear(host).append(h('div', { class: 'empty' }, 'Couldn\'t load this pattern right now.'), h('button', { class: 'btn ghost', onclick: () => { M.pattern = null; draw(); } }, '← Back')); return; }
  pz.forEach((p) => M.seen.add(p.id));
  M.puzzles = pz; draw();
}

// Endless practice: when the current batch runs out, pull a fresh one (never-seen first) and
// keep going — there are ~120 of each pattern, so it should never feel like it "ran out."
async function refillPractice() {
  const m = M.pattern;
  clear(host).append(h('div', { class: 'row' }, h('span', { class: 'spinner' }), ' Loading more…'));
  let more = await loadThemeShard(m.key, { count: 8, exclude: M.seen }).catch(() => null);
  if (!more || !more.length) { M.seen = new Set(); more = await loadThemeShard(m.key, { count: 8 }).catch(() => null); } // seen them all — recycle
  if (!more || !more.length) return finishPattern();
  more.forEach((p) => M.seen.add(p.id));
  M.puzzles = [M.puzzles[0], ...more]; M.idx = 1; renderPractice();
}

function renderDemo() {
  const p = M.puzzles[0], m = M.pattern;
  clear(host);
  const boardEl = h('div', { id: 'mate-demo-board' });
  const side = h('div', { class: 'sidebar' });
  host.append(
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('button', { class: 'btn ghost small', onclick: () => { M.pattern = null; draw(); } }, '← All mates'),
      h('div', { class: 'hint tiny' }, 'Watch the pattern')),
    h('h1', { style: { marginTop: '6px', fontSize: '22px' } }, `${m.icon} ${m.name}`),
    h('div', { class: 'review section', style: { gridTemplateColumns: '480px 1fr' } },
      h('div', { class: 'board-wrap' }, boardEl), side));
  const chess = new Chess(p.fen);
  const orient = chess.turn() === 'w' ? 'white' : 'black';
  const g = createBoard(boardEl, { viewOnly: true, fen: p.fen, orientation: orient, coordinates: true });
  const status = h('div', { class: 'hint tiny', id: 'demo-status' }, 'Playing the mate…');
  clear(side).append(h('div', { class: 'explain-box', style: { fontSize: '14px', marginBottom: '12px' } }, h('b', {}, 'Watch: '), m.teach), status);
  let i = 0;
  const step = () => {
    if (i >= p.solutionMoves.length) {
      status.remove();
      side.append(
        h('div', { class: 'puzzle-status ok', style: { marginTop: '4px' } }, `Checkmate — that's ${m.name}.`),
        h('button', { class: 'btn', style: { marginTop: '12px' }, onclick: () => { M.phase = 'practice'; M.idx = 1; draw(); } }, 'Now you try →'),
        h('button', { class: 'btn ghost small', style: { marginTop: '8px' }, onclick: () => draw() }, '↻ Watch again'));
      return;
    }
    const uci = p.solutionMoves[i];
    const mv = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    if (mv) { g.set({ fen: chess.fen(), lastMove: [mv.from, mv.to] }); showArrow(g, uci, i === p.solutionMoves.length - 1 ? 'green' : 'blue'); }
    i++;
    timer = setTimeout(step, 950);
  };
  timer = setTimeout(step, 750);
}

function renderPractice() {
  const p = M.puzzles[M.idx], m = M.pattern;
  if (!p) return refillPractice();
  clear(host);
  const chess = new Chess(p.fen);
  const toMove = chess.turn() === 'w' ? 'White' : 'Black';
  const plies = p.solutionMoves.length;
  const status = h('div', { class: 'puzzle-status' }, `${toMove} to move — deliver ${m.name}${plies > 1 ? ` (mate in ${Math.ceil(plies / 2)})` : ''}.`);
  const side = h('div', { class: 'sidebar' });
  host.append(
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('button', { class: 'btn ghost small', onclick: () => { M.pattern = null; draw(); } }, '← All mates'),
      h('div', { class: 'hint tiny' }, `${m.name} · ✓ ${M.solved} solved`)),
    h('h1', { style: { marginTop: '6px', fontSize: '20px' } }, `${m.icon} ${m.name}`),
    h('div', { class: 'review section', style: { gridTemplateColumns: '480px 1fr' } },
      h('div', { class: 'board-wrap' }, h('div', { id: 'mate-practice-board' })), side));
  const ctrl = mountPuzzle(document.getElementById('mate-practice-board'), p, {
    allowRetry: true,
    onWrong: (_p, first) => { status.textContent = first ? 'Not mate — that lets the king out. Look for the pattern.' : 'Still not mate — try the hint.'; status.className = 'puzzle-status no'; },
    onSolved: () => {
      M.solved++;
      clear(side).append(
        h('div', { class: 'puzzle-status ok' }, `✓ ${m.name}!`),
        h('div', { class: 'explain-box', style: { fontSize: '13px', margin: '10px 0' } }, m.teach),
        h('div', { class: 'row', style: { gap: '8px' } },
          h('button', { class: 'btn', onclick: () => { M.idx++; renderPractice(); } }, 'Next mate →'),
          h('button', { class: 'btn ghost', onclick: finishPattern }, 'Finish')));
    },
  });
  clear(side).append(status, h('div', { class: 'row' }, h('button', { class: 'btn ghost small', onclick: () => ctrl.hint() }, '💡 Hint')));
}

function finishPattern() {
  const m = M.pattern;
  clear(host).append(h('div', { class: 'empty', style: { paddingTop: '40px' } },
    h('div', { style: { fontSize: '44px' } }, m.icon),
    h('div', { style: { fontSize: '20px', fontWeight: 800, marginTop: '8px' } }, `${m.name} — ${M.solved} solved!`),
    h('div', { class: 'hint', style: { marginTop: '6px' } }, 'You\'ll start spotting this one in your own games now.'),
    h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '18px', gap: '10px' } },
      h('button', { class: 'btn', onclick: () => startPattern(m) }, '↻ Again'),
      h('button', { class: 'btn ghost', onclick: () => { M.pattern = null; draw(); } }, 'All mates'))));
}

// -------- Identify: deliver the mate, then name which one it was --------
async function startIdentify() {
  M.mode = 'identify'; M.idList = null; M.idIdx = 0;
  clear(host).append(h('div', { class: 'row' }, h('span', { class: 'spinner' }), ' Building an identify set…'));
  const picks = shuffle(ADVANCED_MATES.slice()).slice(0, 8);
  const list = [];
  for (const m of picks) { try { const got = await loadThemeShard(m.key, { count: 1 }); if (got && got[0]) { got[0]._mateKey = m.key; list.push(got[0]); } } catch { /* skip */ } }
  if (!list.length) { clear(host).append(h('div', { class: 'empty' }, 'Couldn\'t build a set right now.'), h('button', { class: 'btn ghost', onclick: () => { M.mode = 'learn'; draw(); } }, '← Back')); return; }
  M.idList = shuffle(list); M.idIdx = 0; draw();
}

function renderIdentify() {
  if (!M.idList) { startIdentify(); return; }
  const p = M.idList[M.idIdx];
  if (!p) { startIdentify(); return; } // exhausted this set → pull a fresh one, keep going
  clear(host);
  const chess = new Chess(p.fen);
  const toMove = chess.turn() === 'w' ? 'White' : 'Black';
  const status = h('div', { class: 'puzzle-status' }, `${toMove} to move — find the checkmate.`);
  const side = h('div', { class: 'sidebar' });
  host.append(
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('button', { class: 'btn ghost small', onclick: () => { M.mode = 'learn'; M.idList = null; draw(); } }, '← Back'),
      h('div', { class: 'hint tiny' }, `Identify · ✓ ${M.solved} solved`)),
    h('h1', { style: { marginTop: '6px', fontSize: '20px' } }, '🎯 Which mate is it?'),
    h('div', { class: 'review section', style: { gridTemplateColumns: '480px 1fr' } },
      h('div', { class: 'board-wrap' }, h('div', { id: 'mate-id-board' })), side));
  const ctrl = mountPuzzle(document.getElementById('mate-id-board'), p, {
    allowRetry: true,
    onWrong: (_p, first) => { status.textContent = first ? 'Not mate yet — keep looking.' : 'Still not mate — try the hint.'; status.className = 'puzzle-status no'; },
    onSolved: () => askIdentify(side, p),
  });
  clear(side).append(status, h('div', { class: 'row' }, h('button', { class: 'btn ghost small', onclick: () => ctrl.hint() }, '💡 Hint')));
}

function askIdentify(side, p) {
  M.solved++;
  const correct = mateByKey(p._mateKey);
  const distractors = shuffle(ADVANCED_MATES.filter((m) => m.key !== p._mateKey)).slice(0, 3);
  const opts = shuffle([correct, ...distractors]);
  clear(side).append(
    h('div', { class: 'puzzle-status ok' }, '✓ Checkmate!'),
    h('div', { class: 'hint', style: { margin: '8px 0' } }, 'Which pattern did you just play?'),
    ...opts.map((m) => h('button', { class: 'btn ghost', style: { display: 'block', width: '100%', textAlign: 'left', marginBottom: '8px' }, onclick: () => revealIdentify(side, correct, m) }, `${m.icon} ${m.name}`)));
}

function revealIdentify(side, correct, picked) {
  const right = picked.key === correct.key;
  clear(side).append(
    h('div', { class: right ? 'puzzle-status ok' : 'puzzle-status no' }, right ? `✓ Right — ${correct.name}` : `Actually — ${correct.name}`),
    h('div', { class: 'explain-box', style: { fontSize: '13px', margin: '10px 0' } }, correct.teach),
    h('button', { class: 'btn', onclick: () => { M.idIdx++; draw(); } }, M.idIdx >= M.idList.length - 1 ? 'Done ✓' : 'Next →'));
}

function finishIdentify() {
  clear(host).append(h('div', { class: 'empty', style: { paddingTop: '40px' } },
    h('div', { style: { fontSize: '44px' } }, '🎯'),
    h('div', { style: { fontSize: '20px', fontWeight: 800, marginTop: '8px' } }, 'Identify round complete!'),
    h('div', { class: 'hint', style: { marginTop: '6px' } }, 'Naming the pattern is how it sticks — the mate jumps out the next time you see the shape.'),
    h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '18px', gap: '10px' } },
      h('button', { class: 'btn', onclick: startIdentify }, '↻ Another round'),
      h('button', { class: 'btn ghost', onclick: () => { M.mode = 'learn'; draw(); } }, 'All mates'))));
}
