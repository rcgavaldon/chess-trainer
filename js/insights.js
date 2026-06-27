// insights.js — deep performance analytics aggregated across many analyzed games.
// Pure functions over the analyses produced by review.analyzeGame (each carries plies +
// the source game with pgn/eco/clocks). Feeds the "Improve" dashboard and peer comparison.

import { winPercentFromCp } from './analysis.js';
import { parseClocks } from './chesscom.js';

const BAD = ['Inaccuracy', 'Miss', 'Mistake', 'Blunder'];

function phaseOf(fen, ply) {
  let pieces = 0;
  for (const ch of fen.split(' ')[0]) if (/[nbrqNBRQ]/.test(ch)) pieces++;
  if (pieces <= 6) return 'endgame';
  if (ply <= 20) return 'opening';
  return 'middlegame';
}

function userWinPct(evalWhite, userWhite) {
  const wp = evalWhite.type === 'mate' ? (evalWhite.value > 0 ? 100 : 0) : winPercentFromCp(evalWhite.value);
  return userWhite ? wp : 100 - wp;
}

export function openingName(ecoUrl) {
  if (!ecoUrl) return 'Unknown';
  const m = String(ecoUrl).match(/openings\/([^/?#]+)/);
  if (!m) return 'Unknown';
  return decodeURIComponent(m[1]).replace(/-/g, ' ').replace(/\s*\d.*$/, '').trim() || 'Unknown';
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

// analyses: array of analyzeGame results (each has plies, accuracy, userColor, userResult, game).
export function computeInsights(analyses, username) {
  const valid = analyses.filter((a) => a && a.plies && a.plies.length);
  const out = {
    username,
    games: valid.length,
    userMoves: 0,
    counts: { Blunder: 0, Mistake: 0, Inaccuracy: 0, Miss: 0, Best: 0, Excellent: 0, Good: 0, Great: 0, Brilliant: 0, Book: 0 },
    accAvg: null,
    accByColor: { white: null, black: null },
    resultByColor: { white: { w: 0, l: 0, d: 0 }, black: { w: 0, l: 0, d: 0 } },
    phaseLoss: { opening: 0, middlegame: 0, endgame: 0 },
    mistakeTypes: {},
    openings: [],
    accTrend: [],
    firstBlunderMove: null,
    conversion: { winningReached: 0, winningConverted: 0, losingReached: 0, losingSaved: 0 },
    time: { clockGames: 0, timeTroubleBlunders: 0, rushedBlunders: 0, avgSecPerMove: null },
    ratingAvg: null,
  };
  if (!valid.length) return out;

  const accs = [], accW = [], accB = [], firstBlunders = [], secPerMove = [], ratings = [];
  const openingMap = {};

  for (const a of valid) {
    const c = a.userColor;
    const userWhite = c === 'white';
    const myAcc = a.accuracy?.[c];
    if (myAcc != null) { accs.push(myAcc); (userWhite ? accW : accB).push(myAcc); out.accTrend.push({ ts: new Date(a.dateUTC).getTime(), acc: round(myAcc), result: a.userResult }); }
    if (a.userResult === 'win') out.resultByColor[c].w++; else if (a.userResult === 'loss') out.resultByColor[c].l++; else out.resultByColor[c].d++;
    if (a.userRating) ratings.push(a.userRating);

    const op = openingName(a.game?.eco);
    const o = (openingMap[op] ||= { name: op, games: 0, w: 0, l: 0, d: 0, accSum: 0, accN: 0 });
    o.games++; if (a.userResult === 'win') o.w++; else if (a.userResult === 'loss') o.l++; else o.d++;
    if (myAcc != null) { o.accSum += myAcc; o.accN++; }

    const myPlies = a.plies.filter((p) => p.color === c);
    out.userMoves += myPlies.length;
    let firstBl = null;
    for (const p of myPlies) {
      out.counts[p.label] = (out.counts[p.label] || 0) + 1;
      if (p.label === 'Blunder' && firstBl == null) firstBl = p.moveNumber;
      if (BAD.includes(p.label)) {
        out.phaseLoss[phaseOf(p.fenBefore, p.ply)] += p.winLoss;
        const t = p.explanationType || 'other';
        out.mistakeTypes[t] = (out.mistakeTypes[t] || 0) + 1;
      }
    }
    if (firstBl != null) firstBlunders.push(firstBl);

    // conversion / resilience over the user-POV win% curve
    let everWinning = false, everLosing = false;
    for (const p of a.plies) {
      const uwp = userWinPct(p.evalWhite, userWhite);
      if (uwp >= 80) everWinning = true;
      if (uwp <= 20) everLosing = true;
    }
    if (everWinning) { out.conversion.winningReached++; if (a.userResult === 'win') out.conversion.winningConverted++; }
    if (everLosing) { out.conversion.losingReached++; if (a.userResult !== 'loss') out.conversion.losingSaved++; }

    // time management from PGN clocks
    const clocks = parseClocks(a.game?.pgn || '', a.game?.timeControl);
    if (clocks.length) {
      out.time.clockGames++;
      const byPly = {};
      for (const ck of clocks) byPly[ck.ply] = ck;
      for (const p of myPlies) {
        const ck = byPly[p.ply];
        if (!ck) continue;
        if (ck.secondsSpent != null) secPerMove.push(ck.secondsSpent);
        if (p.label === 'Blunder' || p.label === 'Mistake') {
          if (ck.remaining != null && ck.remaining < 30) out.time.timeTroubleBlunders++;
          if (ck.secondsSpent != null && ck.secondsSpent < 3) out.time.rushedBlunders++;
        }
      }
    }
  }

  out.accAvg = round(avg(accs));
  out.accByColor.white = round(avg(accW));
  out.accByColor.black = round(avg(accB));
  out.firstBlunderMove = round(avg(firstBlunders));
  out.time.avgSecPerMove = round(avg(secPerMove));
  out.ratingAvg = ratings.length ? Math.round(avg(ratings)) : null;
  out.accTrend.sort((x, y) => x.ts - y.ts);

  // per-game rates
  out.rates = {
    blundersPerGame: round(out.counts.Blunder / valid.length, 2),
    mistakesPerGame: round(out.counts.Mistake / valid.length, 2),
    inaccPerGame: round(out.counts.Inaccuracy / valid.length, 2),
  };

  // ranked openings (min 2 games), worst first by accuracy then score
  out.openings = Object.values(openingMap)
    .map((o) => ({ ...o, acc: o.accN ? round(o.accSum / o.accN) : null, score: o.w + o.d * 0.5, scorePct: round(((o.w + o.d * 0.5) / o.games) * 100) }))
    .sort((a, b) => b.games - a.games);

  out.phaseLossRanked = Object.entries(out.phaseLoss).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ phase: k, weight: Math.round(v) }));
  out.mistakeTypesRanked = Object.entries(out.mistakeTypes).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ type: k, count: v }));
  return out;
}

// ---- peer comparison against researched benchmark curves ----
// benchmarks = { curves: [{ metric, unit, higherIsBetter, byRating:[{rating,value}] }], levelUpGaps:[...] }
function interp(curve, rating) {
  const pts = curve.byRating.slice().sort((a, b) => a.rating - b.rating);
  if (!pts.length) return null;
  if (rating <= pts[0].rating) return pts[0].value;
  if (rating >= pts[pts.length - 1].rating) return pts[pts.length - 1].value;
  for (let i = 1; i < pts.length; i++) {
    if (rating <= pts[i].rating) {
      const a = pts[i - 1], b = pts[i];
      const t = (rating - a.rating) / (b.rating - a.rating);
      return a.value + t * (b.value - a.value);
    }
  }
  return pts[pts.length - 1].value;
}

// Map our insight metrics to benchmark metric keys.
function actualFor(metric, insights) {
  switch (metric) {
    case 'accuracy_percent': return insights.accAvg;
    case 'blunders_per_game': return insights.rates?.blundersPerGame;
    case 'mistakes_per_game': return insights.rates?.mistakesPerGame;
    case 'inaccuracies_per_game': return insights.rates?.inaccPerGame;
    case 'move_number_of_first_blunder': return insights.firstBlunderMove;
    default: return null;
  }
}

// Compare the player against their rating band and the band ~targetDelta above.
// Curves with mode 'gap' produce a real comparison; mode 'reference' curves are shown
// for context only (their scale/method differs from this app's numbers). Also picks the
// rating-appropriate level-up advice. Returns null if benchmarks/rating are unavailable.
export function comparePeers(insights, rating, benchmarks, targetDelta = 150) {
  if (!benchmarks || !benchmarks.curves || rating == null) return null;
  const gaps = [], references = [];
  for (const curve of benchmarks.curves) {
    const you = actualFor(curve.metric, insights);
    if (you == null) continue;
    const band = interp(curve, rating);
    const target = interp(curve, rating + targetDelta);
    if (band == null) continue;
    const hib = curve.higherIsBetter !== false;
    const row = { metric: curve.metric, label: curve.label, unit: curve.unit || '', you: round(you, 2), band: round(band, 2), target: target != null ? round(target, 2) : null, higherIsBetter: hib, note: curve.note, source: curve.source };
    if (curve.mode === 'reference') references.push(row);
    else { row.behindTarget = hib ? you < target : you > target; row.gap = round(Math.abs(you - target), 2); gaps.push(row); }
  }
  const bands = (benchmarks.levelUpGaps || []).filter((g) => g.minRating != null).sort((a, b) => a.minRating - b.minRating);
  let levelUpAdvice = bands.length ? bands[0] : null;
  for (const g of bands) if (rating >= g.minRating) levelUpAdvice = g;
  return { rating, targetRating: rating + targetDelta, gaps, references, levelUpAdvice, disclaimer: benchmarks.disclaimer };
}

// Prioritized, concrete improvement actions from insights (+ optional peer gaps).
// Each action: { title, detail, drillTheme? (a Lichess puzzle theme to train) }.
export function improvementPlan(insights, peer) {
  const actions = [];
  const phase = insights.phaseLossRanked?.[0];
  const topMistake = insights.mistakeTypesRanked?.[0];
  const conv = insights.conversion;

  // 1) dominant mistake type
  const TYPE_ACTION = {
    hang: { title: 'Stop hanging pieces', detail: 'Your most common error is leaving pieces undefended. Before every move, ask: "Is anything I own attacked and undefended?"', drill: 'hangingPiece' },
    missed: { title: 'Catch more tactics', detail: 'You\'re missing winning tactics the engine finds. Scan for checks, captures, and threats every move.', drill: 'fork' },
    kingsafety: { title: 'Protect your king', detail: 'You weaken your king\'s shelter under pressure. Avoid needless pawn moves in front of your castled king.', drill: 'kingsideAttack' },
    opening: { title: 'Tighten your opening principles', detail: 'Develop pieces, control the center, castle early, and don\'t move the same piece twice without reason.', drill: 'opening' },
  };
  if (topMistake && TYPE_ACTION[topMistake.type]) {
    const a = TYPE_ACTION[topMistake.type];
    actions.push({ priority: 1, title: a.title, detail: `${a.detail} (${topMistake.count} times in your last ${insights.games} games.)`, drillTheme: a.drill });
  }

  // 2) phase weakness
  if (phase && phase.weight > 0) {
    const PHASE_ACTION = {
      opening: { title: 'Shore up your openings', detail: 'Most of your losses start in the opening. Pick one opening for White and one vs 1.e4 / 1.d4 and learn the first ~8 moves.', drill: 'opening' },
      middlegame: { title: 'Sharpen your middlegame', detail: 'The middlegame is where you lose the most. Train tactics daily and make a plan every move.', drill: 'fork' },
      endgame: { title: 'Learn key endgames', detail: 'You\'re leaking points in the endgame. Master king-and-pawn, opposition, and basic rook endings.', drill: 'endgame' },
    };
    const pa = PHASE_ACTION[phase.phase];
    if (pa && !actions.some((x) => x.title === pa.title)) actions.push({ priority: 2, title: pa.title, detail: pa.detail, drillTheme: pa.drill });
  }

  // 3) converting winning positions
  if (conv.winningReached >= 3) {
    const rate = conv.winningConverted / conv.winningReached;
    if (rate < 0.7) actions.push({ priority: 3, title: 'Convert winning positions', detail: `You reached a winning position in ${conv.winningReached} games but only won ${conv.winningConverted}. When ahead, simplify, trade pieces (not pawns), and stay alert.`, drillTheme: 'endgame' });
  }

  // 4) time management
  if (insights.time.timeTroubleBlunders >= 2 || insights.time.rushedBlunders >= 2) {
    actions.push({ priority: 4, title: 'Fix your clock habits', detail: `${insights.time.timeTroubleBlunders} blunders came in time trouble and ${insights.time.rushedBlunders} from moving too fast. Bank time early; slow down on critical/forcing moves.` });
  }

  // 5) worst opening
  const worstOpening = (insights.openings || []).filter((o) => o.games >= 2 && o.acc != null).sort((a, b) => a.acc - b.acc)[0];
  if (worstOpening && worstOpening.acc < (insights.accAvg ?? 100) - 5) {
    actions.push({ priority: 5, title: `Review the ${worstOpening.name}`, detail: `Your accuracy in the ${worstOpening.name} is ${worstOpening.acc}% (${worstOpening.w}-${worstOpening.l}-${worstOpening.d}), below your average. Study the typical plans.` });
  }

  // 6) peer gap: first-blunder timing (the robust level-up signal)
  if (peer && peer.gaps) {
    const fb = peer.gaps.find((r) => r.metric === 'move_number_of_first_blunder');
    if (fb && fb.behindTarget) actions.push({ priority: 6, title: 'Hold out longer before your first slip', detail: `Your first blunder tends to come around move ${fb.you}; players near ${peer.targetRating} hold on to about move ${fb.target}. Slow down and run a quick blunder-check through the early middlegame.`, drillTheme: 'hangingPiece' });
  }

  return actions.sort((a, b) => a.priority - b.priority);
}
