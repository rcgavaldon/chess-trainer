// report.js — Aimchess-style skill dimensions + a daily plan, from the insights object.
// Scores are 0-100 (higher = better), derived from the player's own Stockfish/clock/result
// signals. They rank the player's skills against EACH OTHER (superpower vs weakness) and drive
// the daily plan. Peer context comes from the separate, data-backed peer comparison.

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const r0 = (x) => Math.round(x);

// Build the six core + two bonus dimensions from a computeInsights() result.
export function computeDimensions(I) {
  const g = Math.max(1, I.games);
  const moves = Math.max(1, I.userMoves);
  const c = I.counts;

  // Tactics: weighted error rate per 100 of your moves (+ middlegame leakage).
  const errPer100 = ((c.Blunder * 3 + c.Mistake * 2 + c.Inaccuracy) / moves) * 100;
  const tactics = clamp(100 - errPer100 * 1.5, 4, 99);

  // Openings: win% bled in the opening phase, per game.
  const openings = clamp(96 - (I.phaseLoss.opening / g) * 1.4, 4, 99);

  // Endgame: win% bled in the endgame phase, per game.
  const endgame = clamp(94 - (I.phaseLoss.endgame / g) * 1.6, 4, 99);

  // Advantage Capitalization: convert winning positions.
  const conv = I.conversion.winningReached ? I.conversion.winningConverted / I.conversion.winningReached : null;
  const advantage = conv == null ? 50 : clamp(8 + conv * 90, 4, 99);

  // Resourcefulness: save lost positions (rare — scale generously).
  const save = I.conversion.losingReached ? I.conversion.losingSaved / I.conversion.losingReached : null;
  const resource = save == null ? 50 : clamp(28 + save * 120, 4, 99);

  // Time Management: time-trouble + rushed blunders per game.
  const ttRate = (I.time.timeTroubleBlunders + I.time.rushedBlunders) / g;
  const time = clamp(94 - ttRate * 26, 4, 99);

  // Consistency (bonus): inverse spread of per-game accuracy.
  const accs = (I.accTrend || []).map((t) => t.acc).filter((x) => x != null);
  let consistency = 55;
  if (accs.length >= 3) {
    const m = accs.reduce((a, b) => a + b, 0) / accs.length;
    const sd = Math.sqrt(accs.reduce((a, b) => a + (b - m) * (b - m), 0) / accs.length);
    consistency = clamp(100 - sd * 2.4, 4, 99);
  }

  const dims = [
    { key: 'tactics', name: 'Tactics', score: r0(tactics), blurb: 'Spotting shots and not hanging pieces.' },
    { key: 'openings', name: 'Openings', score: r0(openings), blurb: 'Coming out of the opening in good shape.' },
    { key: 'endgame', name: 'Endgame', score: r0(endgame), blurb: 'Technique when few pieces remain.' },
    { key: 'advantage', name: 'Advantage capitalization', score: r0(advantage), blurb: 'Converting winning positions.' },
    { key: 'resource', name: 'Resourcefulness', score: r0(resource), blurb: 'Fighting back from worse positions.' },
    { key: 'time', name: 'Time management', score: r0(time), blurb: 'Using the clock to keep your quality up.' },
    { key: 'consistency', name: 'Consistency', score: r0(consistency), blurb: 'Steady play, game to game.', bonus: true },
  ];
  // trend per dimension: compare recent vs older accuracy halves (proxy)
  if (accs.length >= 6) {
    const half = Math.floor(accs.length / 2);
    const older = accs.slice(0, half), recent = accs.slice(half);
    const delta = (recent.reduce((a, b) => a + b, 0) / recent.length) - (older.reduce((a, b) => a + b, 0) / older.length);
    for (const d of dims) d.trend = Math.round(delta); // shared accuracy trend as a light signal
  }
  return dims;
}

// Plain-language "what's going well" + "what to work on" from the dimensions.
const STRENGTH = {
  tactics: 'You rarely hang pieces and you spot tactics.',
  openings: 'You come out of the opening in good shape.',
  endgame: 'Your endgame technique is solid.',
  advantage: 'When you\'re winning, you bring it home.',
  resource: 'You fight back well from worse positions.',
  time: 'You manage your clock well and stay calm.',
  consistency: 'You play at a steady level, game to game.',
};
const IMPROVE = {
  tactics: { detail: 'Drill tactics daily and blunder-check every move before you play it.', theme: 'fork' },
  openings: { detail: 'Tighten one opening for White and one vs 1.e4/1.d4 — learn the first ~8 moves.', theme: 'opening' },
  endgame: { detail: 'Learn key endgames: king & pawn, opposition, and basic rook endings.', theme: 'endgame' },
  advantage: { detail: 'When ahead, simplify and check threats — stop letting won games slip.', theme: 'endgame' },
  resource: { detail: 'Practice defensive resources — keep setting problems when you\'re worse.', theme: 'fork' },
  time: { detail: 'Bank time early and slow down on the critical moves to avoid time-trouble blunders.', theme: 'fork' },
  consistency: { detail: 'Shorter, focused sessions raise your floor — avoid long tilting streaks.', theme: 'hangingPiece' },
};

export function narratives(dims, trendDelta) {
  const core = dims.filter((d) => !d.bonus).sort((a, b) => b.score - a.score);
  const goingWell = [];
  for (const d of core) { if (d.score >= 58 && goingWell.length < 3) goingWell.push({ title: d.name, detail: STRENGTH[d.key] || '' }); }
  if (!goingWell.length) goingWell.push({ title: core[0].name, detail: (STRENGTH[core[0].key] || '') + ' (your relative strength).' });
  if (trendDelta != null && trendDelta >= 2) goingWell.unshift({ title: 'Improving', detail: `Your accuracy is up about ${Math.round(trendDelta)}% lately — keep it going.` });

  const toImprove = [];
  for (let i = core.length - 1; i >= 0 && toImprove.length < 3; i--) {
    const d = core[i];
    if (d.score <= 55 || toImprove.length < 2) { const m = IMPROVE[d.key]; toImprove.push({ title: d.name, detail: m.detail, theme: m.theme, score: d.score }); }
  }
  return { goingWell: goingWell.slice(0, 3), toImprove };
}

// Aimchess-style prioritised, labelled "where to focus" list — kid-simple language,
// worst area first, each tied to a concrete action. Phases (openings/middlegame/endgame)
// lead; skills (tactics, clock, converting, defending) are interspersed.
const AREA = {
  openings: { label: 'Openings', icon: '📖', dest: 'openings',
    why: (s) => s < 60 ? 'You\'re coming out of the opening worse than you should. Learning your first ~8 moves is the fastest fix.' : 'Solid starts — tighten one line for White and one for Black.' },
  tactics: { label: 'Middlegame tactics', icon: '⚔️', dest: 'train', theme: 'fork',
    why: (s) => s < 60 ? 'This is where most games are decided. You\'re dropping pieces or missing shots — daily tactics fixes the most points.' : 'Keep your tactics sharp so you don\'t miss the winning shot.' },
  endgame: { label: 'Endgames', icon: '♟️', dest: 'train', theme: 'endgame',
    why: (s) => s < 60 ? 'When few pieces are left, your technique slips. Learn king-and-pawn, the opposition, and basic rook endings.' : 'Good endings — keep drilling rook endgames, the most common of all.' },
  advantage: { label: 'Closing out wins', icon: '🏁', dest: 'train', theme: 'endgame',
    why: (s) => s < 60 ? 'You reach winning positions but let some slip. When ahead: trade pieces and check every threat.' : 'You bring home most of your winning games — nice.' },
  resource: { label: 'Defending tough spots', icon: '🛡️', dest: 'train', theme: 'fork',
    why: (s) => s < 60 ? 'When you\'re worse, the game often ends fast. Practice making your opponent work for the win.' : 'You scrap well when worse — keep setting problems.' },
  time: { label: 'Clock management', icon: '⏱️', dest: 'train', theme: 'fork',
    why: (s) => s < 60 ? 'The clock is hurting you — you rush the key moments. Slow down on the 2–3 critical moves each game.' : 'You handle the clock well; keep banking time early.' },
};

export function focusAreas(dims) {
  const core = dims.filter((d) => !d.bonus).sort((a, b) => a.score - b.score); // worst first
  return core.map((d, i) => {
    const a = AREA[d.key] || { label: d.name, icon: '•', dest: 'train', why: () => d.blurb };
    const level = d.score < 45 ? 'weak' : d.score < 60 ? 'ok' : 'strong';
    let why = a.why(d.score), badge, tone;
    if (i < 2 && level !== 'strong') { badge = 'Focus here'; tone = 'focus'; }
    else if (i === 0) { // always give a clear starting point, even for a strong all-rounder
      badge = 'Start here'; tone = 'focus';
      if (level === 'strong') why = `${a.label} is already a strength — and it's your lowest area, so sharpening it is the quickest path to your next level.`;
    } else if (level === 'strong') { badge = '✓ strength'; tone = 'strength'; }
    else { badge = 'keep sharp'; tone = 'keep'; }
    return { key: d.key, label: a.label, icon: a.icon, score: d.score, dest: a.dest, theme: a.theme, level, why, badge, tone, primary: tone === 'focus' };
  });
}

export function superAndWeak(dims) {
  const core = dims.filter((d) => !d.bonus);
  const sorted = [...core].sort((a, b) => b.score - a.score);
  return { superpower: sorted[0], weakness: sorted[sorted.length - 1] };
}

// Detect "tilt": a cluster of recent games well below the player's mean accuracy.
function tiltDetected(I) {
  const accs = (I.accTrend || []).map((t) => t.acc).filter((x) => x != null);
  if (accs.length < 6) return false;
  const m = accs.reduce((a, b) => a + b, 0) / accs.length;
  const last4 = accs.slice(-4);
  const lowLast4 = last4.filter((a) => a < m - 8).length >= 3;
  return lowLast4 && (I.time.timeTroubleBlunders + I.time.rushedBlunders) >= 2;
}

// Build today's plan off the weakest dimension (+ openings + tilt).
export function dailyPlan(dims, I, openings) {
  const { superpower, weakness } = superAndWeak(dims);
  const rest = tiltDetected(I);

  // game prescription by weakness
  let game;
  if (weakness.key === 'time') game = 'Play 2–3 rapid games (15|10). Longer time controls let you practice clock discipline.';
  else if (weakness.key === 'tactics') game = 'Play 2 rapid + a couple of blitz games — blitz drills pattern speed, rapid keeps quality up.';
  else if (weakness.key === 'openings') {
    const worst = (openings || []).filter((o) => o.games >= 2 && o.acc != null).sort((a, b) => a.scorePct - b.scorePct)[0];
    game = worst ? `Play 2 games and steer toward the ${worst.family} (your weak spot — ${worst.scorePct}%).` : 'Play 2 rapid games, focusing on a clean opening.';
  } else if (weakness.key === 'endgame') game = 'Play 2 rapid games and aim to reach (and grind out) the endgame.';
  else game = 'Play 2–3 rapid games, focusing on your weakest area below.';

  // study prescription by weakness
  const STUDY = {
    tactics: { theme: 'fork', text: 'Do 12–15 tactics puzzles weighted to hanging pieces and missed shots — drawn from your own games.' },
    openings: { theme: 'opening', text: 'Run the Opening trainer on the lines where you slip, and study the first ~8 moves of one repertoire.' },
    endgame: { theme: 'endgame', text: 'Drill 10 endgame puzzles — king & pawn, opposition, basic rook endings.' },
    advantage: { theme: 'endgame', text: 'Replay 2–3 games you lost from a winning position and find where it slipped.' },
    resource: { theme: 'fork', text: 'Practice defensive/counterattack puzzles — finding resources when worse.' },
    time: { theme: 'fork', text: 'Do a Puzzle Storm to build fast, confident pattern recognition for time scrambles.' },
    consistency: { theme: 'hangingPiece', text: 'Short daily set to raise your floor — 10 mixed puzzles, no marathon sessions.' },
  };
  const study = STUDY[weakness.key] || STUDY.tactics;

  const trend = dims[0]?.trend;
  const positive = trend != null && trend > 1
    ? `Your accuracy is trending up (+${trend}% lately) — keep it going.`
    : superpower ? `Your superpower is ${superpower.name.toLowerCase()} (${superpower.score}/100) — lean on it.` : '';

  return {
    rest,
    focus: weakness,
    superpower,
    headline: rest
      ? 'You look like you might be tilting — take a lighter day.'
      : `Today: sharpen your ${weakness.name.toLowerCase()}.`,
    positive,
    game: rest ? 'Skip the grind today — one calm game at most. Rest is part of improving.' : game,
    study: rest ? 'A short, easy puzzle set is fine — keep your streak without pushing.' : study.text,
    studyTheme: study.theme,
    sessionNote: 'Aim for a focused ~10–15 minute session — small and daily beats long and rare.',
  };
}
