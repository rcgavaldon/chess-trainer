// checkmates.js — "Bobby Fischer Teaches Chess" style checkmate-pattern trainer.
// Show a position from real games, deliver the mate on the board, then name the pattern.
// Content comes from the hosted mate-pattern puzzle shards (mateIn1/2, backRankMate, smotheredMate).

export const MATE_PATTERNS = [
  { key: 'mix', name: 'Mixed mates', icon: '♚', shards: ['backRankMate', 'smotheredMate', 'mateIn1', 'mateIn2'],
    blurb: 'Deliver the mate, then name the pattern — the real Fischer drill.',
    teach: 'A mix of the classic finishes. Play the mating move, then guess what it\'s called.' },
  { key: 'mateIn1', name: 'Mate in one', icon: '①', shards: ['mateIn1'],
    blurb: 'One move ends it. Train the eye to spot the finish instantly.',
    teach: 'The purest pattern: a single move checkmates. Fischer drilled these until the finish jumped off the board.' },
  { key: 'backRankMate', name: 'Back-rank mate', icon: '⬛', shards: ['backRankMate'],
    blurb: 'The king trapped on its home rank by its own pawns.',
    teach: 'The king is boxed in on its back rank by its own pawns. A rook or queen lands on that rank — check, no escape, no block.' },
  { key: 'smotheredMate', name: 'Smothered mate', icon: '♞', shards: ['smotheredMate'],
    blurb: 'A lone knight mates a king buried by its own pieces.',
    teach: 'Philidor\'s Legacy: the king is smothered by its own men and a knight gives mate. Nothing can block a knight\'s check.' },
  { key: 'mateIn2', name: 'Mate in two', icon: '②', shards: ['mateIn2'],
    blurb: 'A short forced sequence — the first move sets the trap.',
    teach: 'Find the forcing first move, picture the only reply, then the finish. Two moves, fully forced.' },
];

export const THEME_NAME = { mateIn1: 'Mate in one', mateIn2: 'Mate in two', mateIn3: 'Mate in three', backRankMate: 'Back-rank mate', smotheredMate: 'Smothered mate' };

// The three buttons in the mixed-mode "name the mate" quiz.
export const IDENTIFY_OPTIONS = [
  { key: 'backRankMate', label: 'Back-rank mate' },
  { key: 'smotheredMate', label: 'Smothered mate' },
  { key: 'basic', label: 'Basic checkmate' },
];

// Which of the three quiz answers is correct for this puzzle (named mate wins over plain mateInN).
export function correctIdentify(puzzle) {
  const th = puzzle.themes || [];
  if (th.includes('backRankMate')) return 'backRankMate';
  if (th.includes('smotheredMate')) return 'smotheredMate';
  return 'basic';
}

// Friendly name for a "basic" mate, taken from its mateInN theme.
export function basicName(puzzle) {
  const th = puzzle.themes || [];
  return THEME_NAME[th.find((t) => THEME_NAME[t] && /^mateIn/.test(t))] || 'Basic checkmate';
}
