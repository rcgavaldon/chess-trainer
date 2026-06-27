// insightsview.js — renders the deep "Improve" dashboard from a computed insights object.
// Reused for the owner's own account and for any student.
import { h, clear, pct } from './dom.js';

const accColor = (a) => (a == null ? 'var(--muted)' : a >= 85 ? 'var(--good)' : a >= 70 ? 'var(--warn)' : 'var(--bad)');

function stat(k, v, sub) {
  return h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v ?? '—'), sub ? h('div', { class: 'hint tiny' }, sub) : null);
}

function sparkline(trend) {
  if (!trend || trend.length < 2) return h('div', { class: 'hint tiny' }, 'Analyze more games to see a trend.');
  const W = 260, H = 50, pad = 4;
  const xs = trend.map((_, i) => pad + (i * (W - 2 * pad)) / (trend.length - 1));
  const ys = trend.map((t) => H - pad - ((t.acc ?? 0) / 100) * (H - 2 * pad));
  const pts = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <polyline fill="none" stroke="#7aa84f" stroke-width="2" points="${pts}"/>
    ${xs.map((x, i) => `<circle cx="${x.toFixed(1)}" cy="${ys[i].toFixed(1)}" r="2.4" fill="${trend[i].result === 'win' ? '#7aa84f' : trend[i].result === 'loss' ? '#d2483f' : '#9c9388'}"/>`).join('')}
  </svg>`;
  return h('div', { html: svg });
}

function bars(rows, fmt = (v) => v) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return h('div', { class: 'bars' }, ...rows.map((r) => h('div', { class: 'bar-row' },
    h('div', {}, r.label), h('div', { class: 'track' }, h('div', { class: 'fill', style: { width: (r.value / max) * 100 + '%', background: r.color || 'var(--warn)' } })), h('div', { class: 'tiny' }, fmt(r.value)))));
}

const TYPE_LABEL = { hang: 'Hanging pieces', missed: 'Missed tactics', kingsafety: 'King safety', opening: 'Opening errors', fork: 'Forks', freecap: 'Free captures', fallback: 'Other', other: 'Other' };

export function renderImprove(host, { insights: I, peer, plan, byTC, onTrain, onReviewBlunder }) {
  clear(host);
  if (!I || !I.games) { host.append(h('div', { class: 'empty' }, 'Run a deep scan to build your improvement profile.')); return; }

  // headline
  host.append(h('div', { class: 'stat-grid' },
    stat('Games analyzed', I.games),
    stat('Avg accuracy', I.accAvg != null ? h('span', { style: { color: accColor(I.accAvg) } }, pct(I.accAvg)) : '—'),
    stat('Blunders / game', I.rates?.blundersPerGame),
    stat('Avg rating', I.ratingAvg ?? '—'),
    stat('First blunder', I.firstBlunderMove ? 'move ' + I.firstBlunderMove : '—', 'on average')));

  renderByTimeControl(host, byTC);

  // accuracy trend
  host.append(h('div', { class: 'card section' }, h('h2', {}, 'Accuracy trend'), sparkline(I.accTrend),
    h('div', { class: 'hint tiny' }, 'Each dot is a game — green win, red loss.')));

  // peer comparison (gap metrics + reference metrics + level-up advice)
  if (peer && (peer.gaps.length || peer.references.length)) {
    const card = h('div', { class: 'card section' },
      h('h2', {}, 'You vs your peers'),
      h('p', { class: 'hint' }, `Compared with a typical ~${peer.rating} player and the level ~${peer.targetRating - peer.rating} points above (≈${peer.targetRating}) — the gap you're closing to level up.`));
    if (peer.gaps.length) {
      card.append(h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Signal'), h('th', {}, 'You'), h('th', {}, `~${peer.rating}`), h('th', {}, `~${peer.targetRating}`), h('th', {}, ''))),
        h('tbody', {}, ...peer.gaps.map((r) => h('tr', {},
          h('td', {}, r.label, r.note ? h('div', { class: 'hint tiny' }, r.note) : null),
          h('td', {}, h('b', { style: { color: r.behindTarget ? 'var(--warn)' : 'var(--good)' } }, r.you + r.unit)),
          h('td', {}, r.band + r.unit),
          h('td', {}, (r.target ?? '—') + r.unit),
          h('td', {}, r.behindTarget
            ? h('span', { class: 'pill', style: { background: 'rgba(230,162,60,.18)', color: 'var(--warn)' } }, 'gap to close')
            : h('span', { class: 'pill', style: { background: 'rgba(122,168,79,.18)', color: 'var(--good)' } }, 'ahead ✓')))))));
    }
    for (const r of peer.references) {
      card.append(h('div', { class: 'hint tiny', style: { marginTop: '8px' } },
        h('b', {}, r.label + ': '), `you ${r.you}${r.unit} · typical ~${peer.rating}: ${r.band}${r.unit}. `, r.note));
    }
    if (peer.levelUpAdvice) {
      card.append(h('div', { style: { borderTop: '1px solid var(--line)', paddingTop: '10px', marginTop: '12px' } },
        h('div', {}, h('b', {}, `Climbing ${peer.levelUpAdvice.ratingBand}: `), peer.levelUpAdvice.theGapToNextLevel),
        h('div', { class: 'why', style: { marginTop: '6px', color: 'var(--accent-2)' } }, '→ ', peer.levelUpAdvice.actionableAdvice)));
    }
    if (peer.disclaimer) card.append(h('div', { class: 'hint tiny', style: { marginTop: '12px', opacity: '.75' } }, peer.disclaimer));
    host.append(card);
  }

  // improvement plan
  if (plan && plan.length) {
    host.append(h('div', { class: 'section' }, h('h2', {}, 'Your improvement plan'),
      h('div', { class: 'bars' }),
      ...plan.map((a, i) => h('div', { class: 'card', style: { marginBottom: '10px' } },
        h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'flex-start' } },
          h('div', { style: { flex: '1' } }, h('div', {}, h('b', {}, `${i + 1}. ${a.title}`)), h('div', { class: 'hint', style: { marginTop: '4px' } }, a.detail)),
          a.drillTheme && onTrain ? h('button', { class: 'btn small', onclick: () => onTrain(a.drillTheme) }, 'Train this') : null)))));
  }

  // phase strength
  const phaseRows = (I.phaseLossRanked || []).map((p) => ({ label: cap(p.phase), value: p.weight, color: 'var(--warn)' }));
  // recurring mistakes
  const mistakeRows = (I.mistakeTypesRanked || []).slice(0, 5).map((m) => ({ label: TYPE_LABEL[m.type] || m.type, value: m.count, color: 'var(--bad)' }));

  host.append(h('div', { class: 'review section', style: { gridTemplateColumns: '1fr 1fr', gap: '14px' } },
    h('div', { class: 'card' }, h('h2', {}, 'Where you lose points'), phaseRows.length ? bars(phaseRows) : h('div', { class: 'hint' }, 'No data'), h('div', { class: 'hint tiny', style: { marginTop: '6px' } }, 'Win% lost to mistakes, by game phase.')),
    h('div', { class: 'card' }, h('h2', {}, 'Recurring mistakes'), mistakeRows.length ? bars(mistakeRows) : h('div', { class: 'hint' }, 'No data'))));

  // conversion + resilience + time
  const conv = I.conversion;
  const convRate = conv.winningReached ? Math.round((conv.winningConverted / conv.winningReached) * 100) : null;
  const saveRate = conv.losingReached ? Math.round((conv.losingSaved / conv.losingReached) * 100) : null;
  host.append(h('div', { class: 'stat-grid section' },
    stat('Convert wins', convRate != null ? convRate + '%' : '—', `won ${conv.winningConverted}/${conv.winningReached} winning positions`),
    stat('Save losses', saveRate != null ? saveRate + '%' : '—', `held ${conv.losingSaved}/${conv.losingReached} lost positions`),
    stat('Time / move', I.time.avgSecPerMove != null ? I.time.avgSecPerMove + 's' : '—', `${I.time.timeTroubleBlunders} time-trouble blunders`),
    stat('Rushed blunders', I.time.rushedBlunders, 'moved in <3s before erroring')));

  // color split
  const cs = I.resultByColor;
  host.append(h('div', { class: 'review section', style: { gridTemplateColumns: '1fr 1fr', gap: '14px' } },
    colorCard('As White', I.accByColor.white, cs.white),
    colorCard('As Black', I.accByColor.black, cs.black)));

  // openings
  const ops = (I.openings || []).filter((o) => o.name !== 'Unknown').slice(0, 8);
  if (ops.length) {
    host.append(h('div', { class: 'card section' }, h('h2', {}, 'Openings'),
      h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Opening'), h('th', {}, 'Games'), h('th', {}, 'Score'), h('th', {}, 'Accuracy'))),
        h('tbody', {}, ...ops.map((o) => h('tr', {},
          h('td', {}, o.name), h('td', {}, o.games), h('td', {}, `${o.w}-${o.l}-${o.d} (${o.scorePct}%)`),
          h('td', { style: { color: accColor(o.acc) } }, o.acc != null ? pct(o.acc) : '—')))))));
  }
}

function colorCard(title, acc, rec) {
  return h('div', { class: 'card' }, h('h2', {}, title),
    h('div', { class: 'accbar' }, h('div', {}, h('div', { class: 'acc', style: { color: accColor(acc) } }, pct(acc)), h('div', { class: 'who' }, 'accuracy')),
      h('div', { style: { marginLeft: 'auto' } }, h('div', { class: 'acc' }, `${rec.w}-${rec.l}-${rec.d}`), h('div', { class: 'who' }, 'W-L-D'))));
}

export function renderByTimeControl(host, byTC) {
  if (!byTC || !byTC.length) return;
  host.append(h('div', { class: 'card section' },
    h('h2', {}, 'By time control'),
    h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Time control'), h('th', {}, 'Games'), h('th', {}, 'Record'), h('th', {}, 'Win%'), h('th', {}, 'Accuracy'))),
      h('tbody', {}, ...byTC.map((r) => h('tr', {},
        h('td', {}, cap(r.tc)),
        h('td', {}, r.games),
        h('td', {}, `${r.w}-${r.l}-${r.d}`),
        h('td', {}, h('b', { style: { color: r.winPct >= 55 ? 'var(--good)' : r.winPct >= 45 ? 'var(--warn)' : 'var(--bad)', fontFamily: 'var(--mono)' } }, r.winPct + '%')),
        h('td', {}, r.accAvg != null ? h('span', { style: { color: accColor(r.accAvg) } }, r.accAvg + '%') : h('span', { class: 'hint tiny' }, 'analyze to see')))))),
    tcSuggestion(byTC)));
}

function tcSuggestion(byTC) {
  const sig = byTC.filter((r) => r.games >= 3);
  if (sig.length < 2) return null;
  const best = [...sig].sort((a, b) => b.winPct - a.winPct)[0];
  const worst = [...sig].sort((a, b) => a.winPct - b.winPct)[0];
  if (best.tc === worst.tc) return null;
  return h('div', { class: 'hint tiny', style: { marginTop: '8px' } },
    `💡 You score best in ${cap(best.tc)} (${best.winPct}%) and worst in ${cap(worst.tc)} (${worst.winPct}%). Faster controls reward fast pattern-spotting; slower ones reward calculation — lean into your strength while you shore up the weak one.`);
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function metricLabel(m) {
  return { accuracy_percent: 'Accuracy', blunders_per_game: 'Blunders / game', mistakes_per_game: 'Mistakes / game', inaccuracies_per_game: 'Inaccuracies / game', avg_centipawn_loss: 'Avg centipawn loss' }[m] || m;
}
