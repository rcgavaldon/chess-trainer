// intro.js — the 60-second "your chess, decoded" first-run reveal. A stepped, auto-advancing
// sequence that turns the cold analytics into a little story. Plays once (profile.introSeen);
// after that the Personal home shows a short "welcome back" summary instead.
import { h, clear } from './dom.js';

function step(big, lead, sub, color) {
  return h('div', { class: 'intro-step' },
    lead ? h('div', { class: 'intro-lead' }, lead) : null,
    h('div', { class: 'intro-big', style: color ? { color } : {} }, big),
    sub ? h('div', { class: 'intro-sub' }, sub) : null);
}

// data = { name, games, rating, recordStr, superName, superBlurb, weakName, weakWhy, focusLabel, planGame }
function buildSteps(d) {
  const s = [];
  s.push({ el: step(`Let's decode your chess${d.name ? ', ' + d.name : ''}.`, null, 'Sixty seconds. Here\'s what your own games say about you.'), ms: 2800 });
  s.push({ el: step(d.rating != null ? d.rating : '—', `${d.games} games analyzed · ${d.recordStr}`, 'Your current rating'), ms: 2800 });
  if (d.superName) s.push({ el: step(d.superName, 'Your superpower', d.superBlurb || '', 'var(--good)'), ms: 3000 });
  if (d.weakName) s.push({ el: step(d.weakName, 'Your biggest opportunity', d.weakWhy || 'This is where you\'ll gain the most.', 'var(--warn)'), ms: 3200 });
  s.push({ el: step(d.focusLabel || 'Train daily', 'Your plan starts here', d.planGame || 'A little every day beats a lot once in a while.', 'var(--accent)'), ms: 3200 });
  s.push({ el: step('Ready?', null, 'Your full report is right behind this.'), ms: 99999, last: true });
  return s;
}

export function playIntro(data, onDone) {
  const steps = buildSteps(data);
  let i = 0, timer = null;
  const card = h('div', { class: 'intro-card' });
  const skip = h('button', { class: 'intro-skip', onclick: finish }, 'Skip');
  const back = h('div', { class: 'intro-backdrop' }, skip, card);
  document.body.appendChild(back);

  function finish() { clearTimeout(timer); back.remove(); onDone && onDone(); }
  function advance() { clearTimeout(timer); if (i >= steps.length - 1) finish(); else { i++; render(); } }
  function render() {
    const st = steps[i];
    clear(card);
    card.append(st.el,
      h('div', { class: 'intro-dots' }, ...steps.map((_, j) => h('span', { class: 'intro-dot' + (j === i ? ' on' : '') }))),
      h('button', { class: 'btn', style: { marginTop: '20px' }, onclick: advance }, st.last ? 'Let\'s go →' : 'Next'));
    clearTimeout(timer);
    if (!st.last) timer = setTimeout(advance, st.ms);
  }
  render();
}
