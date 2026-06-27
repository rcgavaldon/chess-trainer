// insightsview.js — renders the deep "Improve" dashboard from a computed insights object.
// Reused for the owner's own account and for any student.
import { h, clear, pct } from './dom.js';

const accColor = (a) => (a == null ? 'var(--muted)' : a >= 85 ? 'var(--good)' : a >= 70 ? 'var(--warn)' : 'var(--bad)');

// ============================================================
// CLEAN REPORT — snapshot + radar + going-well/to-improve + trend graph
// ============================================================
const SHORT = { Tactics: 'Tactics', Openings: 'Openings', Endgame: 'Endgame', 'Advantage capitalization': 'Converting', Resourcefulness: 'Defense', 'Time management': 'Time' };
const winPctOf = (r) => { const g = r.w + r.l + r.d; return g ? Math.round(((r.w + r.d * 0.5) / g) * 100) : 0; };
const bestDim = (dims) => dims.filter((d) => !d.bonus).sort((a, b) => b.score - a.score)[0];
const worstDim = (dims) => dims.filter((d) => !d.bonus).sort((a, b) => a.score - b.score)[0];

function radarSvg(dims) {
  const core = dims.filter((d) => !d.bonus).slice(0, 6);
  const n = core.length, cx = 140, cy = 140, R = 100;
  const ang = (i) => (-90 + i * (360 / n)) * Math.PI / 180;
  const pt = (val, i) => [cx + Math.cos(ang(i)) * R * val / 100, cy + Math.sin(ang(i)) * R * val / 100];
  const ring = (r) => core.map((_, i) => pt(r, i).map((v) => v.toFixed(1)).join(',')).join(' ');
  const poly = core.map((d, i) => pt(d.score, i).map((v) => v.toFixed(1)).join(',')).join(' ');
  const grid = [40, 70, 100].map((r) => `<polygon points="${ring(r)}" fill="none" stroke="#ffffff12" stroke-width="0.7"/>`).join('');
  const axes = core.map((_, i) => { const [x, y] = pt(100, i); return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#ffffff12" stroke-width="0.7"/>`; }).join('');
  const dots = core.map((d, i) => { const [x, y] = pt(d.score, i); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="var(--accent)"/>`; }).join('');
  const labels = core.map((d, i) => { const [x, y] = pt(123, i); const a = Math.abs(x - cx) < 12 ? 'middle' : (x > cx ? 'start' : 'end'); return `<text x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" fill="#9aa7b1" font-size="10.5" font-weight="600" text-anchor="${a}">${SHORT[d.name] || d.name}</text>`; }).join('');
  return `<svg viewBox="0 0 280 270" width="100%" style="max-width:330px;display:block;margin:4px auto 0">${grid}${axes}<polygon points="${poly}" fill="var(--accent)" fill-opacity="0.18" stroke="var(--accent)" stroke-width="1.6"/>${dots}${labels}</svg>`;
}

function trendSvg(trend) {
  const data = (trend || []).map((t) => t.acc).filter((x) => x != null);
  if (data.length < 3) return '<div class="hint tiny">Analyze a few more games to see your trend.</div>';
  const W = 600, H = 130, pad = 10, n = data.length;
  const x = (i) => pad + (i * (W - 2 * pad)) / (n - 1);
  const y = (v) => H - pad - (v / 100) * (H - 2 * pad);
  const line = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const avg = data.reduce((a, b) => a + b, 0) / n;
  const last10 = Math.max(0, n - 10);
  const dots = trend.slice(0, n).map((t, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(data[i]).toFixed(1)}" r="2.2" fill="${t.result === 'win' ? '#5fc46a' : t.result === 'loss' ? '#f0625b' : '#93a1ab'}"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">
    <rect x="${x(last10).toFixed(1)}" y="0" width="${(W - x(last10)).toFixed(1)}" height="${H}" fill="#ffffff09"/>
    <line x1="0" y1="${y(avg).toFixed(1)}" x2="${W}" y2="${y(avg).toFixed(1)}" stroke="#ffffff22" stroke-width="0.6" stroke-dasharray="4 4"/>
    <polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linejoin="round"/>${dots}</svg>`;
}

const snap = (k, v, sub) => h('div', { class: 'snap' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), sub != null ? h('div', { class: 'sub' }, sub) : null);

function narrCard(title, color, items, onTrain) {
  return h('div', { class: 'card' }, h('div', { style: { fontWeight: 700, color, marginBottom: '12px', fontSize: '15px' } }, title),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, ...items.map((it) =>
      h('div', {}, h('div', { style: { fontWeight: 600 } }, it.title), it.detail ? h('div', { class: 'hint', style: { fontSize: '13px', marginTop: '2px' } }, it.detail) : null,
        onTrain && it.theme ? h('button', { class: 'btn small ghost', style: { marginTop: '7px' }, onclick: () => onTrain(it.theme) }, 'Train this') : null))));
}

// R = { rating, record, last10, accAvg, accDelta, dims, narr, accTrend, onTrain }
export function renderCleanReport(host, R) {
  const arrowColor = R.accDelta >= 2 ? 'var(--good)' : R.accDelta <= -2 ? 'var(--bad)' : 'var(--muted)';
  host.append(h('div', { class: 'card section snapshot' },
    snap('Rating', R.rating ?? '—'),
    snap('Last 50', `${R.record.w}-${R.record.l}-${R.record.d}`, `${winPctOf(R.record)}% score`),
    snap('Accuracy', R.accAvg != null ? h('span', { style: { color: accColor(R.accAvg) } }, pct(R.accAvg)) : '—', h('span', { style: { color: arrowColor } }, R.accDelta ? `${R.accDelta > 0 ? '+' : ''}${Math.round(R.accDelta)}% last 10` : 'steady')),
    snap('Last 10', R.last10 ? `${R.last10.w}-${R.last10.l}-${R.last10.d}` : '—', R.last10 ? `${winPctOf(R.last10)}% score` : '')));

  host.append(h('div', { class: 'card section' },
    h('h2', {}, 'Your skills at a glance'),
    h('div', { html: radarSvg(R.dims) }),
    h('div', { class: 'chip-row', style: { justifyContent: 'center', marginTop: '6px' } },
      h('span', { class: 'pill', style: { background: 'rgba(95,196,106,.18)', color: 'var(--good)' } }, '★ ' + bestDim(R.dims).name),
      h('span', { class: 'pill', style: { background: 'rgba(230,162,60,.18)', color: 'var(--warn)' } }, '⚑ ' + worstDim(R.dims).name))));

  host.append(h('div', { class: 'review section', style: { gridTemplateColumns: '1fr 1fr', gap: '14px' } },
    narrCard('✅ What\'s going well', 'var(--good)', R.narr.goingWell, null),
    narrCard('🎯 What to work on', 'var(--warn)', R.narr.toImprove, R.onTrain)));

  host.append(h('div', { class: 'card section' },
    h('h2', {}, 'Accuracy trend'),
    h('div', { html: trendSvg(R.accTrend) }),
    h('div', { class: 'hint tiny', style: { marginTop: '4px' } }, 'Each dot is a game — green win, red loss. Shaded band = your last 10.')));
}

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

// Aimchess-style skill scorecard (superpower / weakness + per-dimension bars).
export function renderScorecard(host, dims) {
  const core = dims.filter((d) => !d.bonus).sort((a, b) => b.score - a.score);
  const sup = core[0], weak = core[core.length - 1];
  const dimBar = (d) => {
    const color = d.score >= 65 ? 'var(--good)' : d.score >= 45 ? 'var(--warn)' : 'var(--bad)';
    return h('div', { class: 'bar-row', style: { gridTemplateColumns: '190px 1fr 58px' } },
      h('div', {}, d.name, d.bonus ? h('span', { class: 'hint tiny' }, ' bonus') : null),
      h('div', { class: 'track' }, h('div', { class: 'fill', style: { width: d.score + '%', background: color } })),
      h('div', { style: { textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700, color } }, d.score + (d.trend ? ' ' + (d.trend > 0 ? '▲' : '▼') : '')));
  };
  host.append(h('div', { class: 'card section' },
    h('h2', {}, 'Your skills'),
    h('div', { class: 'chip-row', style: { marginBottom: '14px' } },
      h('span', { class: 'pill', style: { background: 'rgba(95,196,106,.18)', color: 'var(--good)' } }, `★ Superpower: ${sup.name} ${sup.score}`),
      h('span', { class: 'pill', style: { background: 'rgba(230,162,60,.18)', color: 'var(--warn)' } }, `⚑ Work on: ${weak.name} ${weak.score}`)),
    h('div', { class: 'bars' }, ...dims.map(dimBar)),
    h('div', { class: 'hint tiny', style: { marginTop: '10px' } }, 'Scores (0–100, higher is better) rank your skills against each other — they show where to focus.')));
}

// The engagement engine: Today's Plan.
export function renderTodayPlan(host, plan, onTrain) {
  const row = (label, text) => h('div', { style: { marginBottom: '6px' } }, h('b', { style: { color: 'var(--accent-2)' } }, label + ': '), text);
  host.append(h('div', { class: 'card section', style: { borderColor: 'var(--accent)', boxShadow: '0 0 0 1px rgba(125,211,95,.2), var(--shadow-sm)' } },
    h('h2', {}, plan.rest ? '😌 Today' : '🎯 Today\'s plan'),
    plan.positive ? h('div', { style: { color: 'var(--good)', fontWeight: 600, marginBottom: '6px' } }, plan.positive) : null,
    h('div', { style: { fontWeight: 700, fontSize: '15px', marginBottom: '10px' } }, plan.headline),
    row('♟ Play', plan.game),
    row('📚 Study', plan.study),
    h('div', { class: 'row', style: { marginTop: '12px' } },
      onTrain && plan.studyTheme ? h('button', { class: 'btn small', onclick: () => onTrain(plan.studyTheme) }, 'Start training') : null),
    h('div', { class: 'hint tiny', style: { marginTop: '8px' } }, plan.sessionNote)));
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
