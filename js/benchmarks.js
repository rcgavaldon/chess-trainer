// benchmarks.js — researched chess performance benchmarks by rating, for peer comparison.
// All numbers are cited public data. IMPORTANT honesty notes baked into the framing:
//  - Accuracy/rating scales differ by platform and by analysis method. This app computes
//    accuracy with the Lichess Win% method at a modest engine depth, which reads a few
//    points LOWER than Chess.com's full Game Review (CAPS2). So accuracy is shown as a
//    DIRECTIONAL reference, not a "you're behind" verdict.
//  - Raw blunder COUNT barely changes with rating (a weak differentiator). What actually
//    separates levels is WHEN your first big mistake happens — so first-blunder timing is
//    the headline "gap" metric.
// Sources: chess.com/blog/hissha/accuracy-and-ratings-on-chess-com ;
//          chessanalysis.co "The Blunder Curve" (160k+ Lichess rapid games).

export const BENCHMARKS = {
  disclaimer:
    'Directional guide from public Chess.com & Lichess data — not a precise grade. Accuracy here uses a stricter engine method than Chess.com\'s Game Review, so your in-app % reads a little lower; focus on your own trend and on first-blunder timing.',
  curves: [
    {
      metric: 'move_number_of_first_blunder',
      label: 'First blunder (move #)',
      unit: '',
      higherIsBetter: true,
      mode: 'gap', // the most rating-discriminating, method-robust signal
      byRating: [
        { rating: 600, value: 16 }, { rating: 800, value: 18 }, { rating: 1000, value: 21 },
        { rating: 1200, value: 24 }, { rating: 1400, value: 28 }, { rating: 1600, value: 30 },
        { rating: 1800, value: 32 }, { rating: 2000, value: 34 }, { rating: 2200, value: 36 },
      ],
      note: 'Holding out longer before your first big mistake is the clearest sign of climbing. (Lichess rapid study, chessanalysis.co.)',
      source: 'chessanalysis.co — The Blunder Curve',
    },
    {
      metric: 'accuracy_percent',
      label: 'Game accuracy',
      unit: '%',
      higherIsBetter: true,
      mode: 'reference', // method/scale differs from this app's number — show, don't grade
      byRating: [
        { rating: 400, value: 68.8 }, { rating: 600, value: 71.5 }, { rating: 800, value: 73.8 },
        { rating: 1000, value: 75.7 }, { rating: 1200, value: 77.4 }, { rating: 1400, value: 79 },
        { rating: 1600, value: 80.6 }, { rating: 1800, value: 81.9 }, { rating: 2000, value: 83.9 }, { rating: 2200, value: 85.6 },
      ],
      note: 'Chess.com Game Review accuracy by rapid rating. Computed differently from this app, so treat as a reference, not a target.',
      source: 'chess.com/blog/hissha',
    },
    // Note: raw blunders/game is intentionally NOT benchmarked here. Public blunder-count
    // data uses a strict ≥300cp definition that isn't comparable to this app's win%-based
    // blunder count, so a side-by-side would mislead. First-blunder TIMING (above) is the
    // honest, comparable signal — and the research shows count barely changes with rating anyway.
  ],
  levelUpGaps: [
    {
      ratingBand: '1000 → 1200', minRating: 1000,
      theGapToNextLevel: 'Mostly cutting self-inflicted disasters in already-good positions and surviving longer before the first blunder. At this level a striking share of blunders happen when you\'re already winning — losing won games is the dominant leak.',
      actionableAdvice: 'Drill basic tactics (pins, forks, back-rank, hanging pieces) to near-automatic, and practice winning-position discipline: simplify, check the opponent\'s threats every move, and don\'t grab greedy material.',
    },
    {
      ratingBand: '1200 → 1400', minRating: 1200,
      theGapToNextLevel: 'Opening soundness and not collapsing under early pressure. Your first blunder needs to move later (toward move ~28) — you hold the position together longer and stop hanging pieces in the early middlegame.',
      actionableAdvice: 'Build a small, repeatable opening repertoire so you reach a playable middlegame without early disasters. Keep doing tactics daily, start basic endgames (K+P, opposition), and stop losing on time or rushing the critical move.',
    },
    {
      ratingBand: '1400 → 1600', minRating: 1400,
      theGapToNextLevel: 'Endgame technique and converting/holding. By here you\'re middlegame-stable; the remaining blunders cluster in sharper, time-pressured positions and complex endgames. Calculation depth and positional understanding start to matter more than raw tactics.',
      actionableAdvice: 'Shift from one-move tactics to 2–3 move calculation and candidate moves. Study pawn structures and typical plans, sharpen rook endgames, and review your own losses to find which phase your blunders cluster in.',
    },
    {
      ratingBand: '1600 → 1800+', minRating: 1600,
      theGapToNextLevel: 'Squeezing out the rarer, subtler errors — inaccuracies and small mistakes, not gross blunders — plus cleaner conversion and endgame precision. Each accuracy point now costs ~90+ rating points, so gains get expensive.',
      actionableAdvice: 'Reduce inaccuracies and mistakes (the 50–200cp band), deepen opening prep, master common endgames cold, and train calculation/visualization. Consistency and stamina across the whole game — avoiding the one late lapse — is the lever.',
    },
  ],
};
