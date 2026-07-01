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

// The classic NAMED checkmates for the Advanced Mates trainer. `key` matches the puzzle shard.
export const ADVANCED_MATES = [
  { key: 'backRankMate', name: 'Back-rank Mate', icon: '⬛', blurb: 'The king trapped on its home rank by its own pawns.',
    teach: 'A rook or queen lands on the back rank. The king can\'t escape because its own pawns block the way out — which is exactly why strong players make "luft" (a little pawn move) for their king.' },
  { key: 'smotheredMate', name: 'Smothered Mate', icon: '♞', blurb: 'A lone knight mates a king buried by its own pieces.',
    teach: 'Philidor\'s Legacy. The king is hemmed in by its own men and a knight gives check — and nothing can block or capture a knight. It\'s often forced with a queen sacrifice that shoves the king into the corner.' },
  { key: 'anastasiaMate', name: "Anastasia's Mate", icon: '♘', blurb: 'Knight and rook pin the king against the edge.',
    teach: 'A knight (classically on e7 or e2) covers the king\'s only flight square while a rook or queen delivers mate along the edge file. Named after a 19th-century novel.' },
  { key: 'arabianMate', name: 'Arabian Mate', icon: '🕌', blurb: 'Rook and knight corner the king — one of the oldest mates known.',
    teach: 'The rook checks the king in the corner while the knight sits a knight\'s-move away, guarding the escape square and defending the rook. Chess players have known this one for over a thousand years.' },
  { key: 'bodenMate', name: "Boden's Mate", icon: '✝️', blurb: 'Two bishops crisscross to mate a castled king.',
    teach: 'Two bishops on intersecting diagonals catch a king boxed in by its own pieces — usually one that castled queenside. It\'s typically set up with a sacrifice that rips open the diagonals.' },
  { key: 'hookMate', name: 'Hook Mate', icon: '🪝', blurb: 'Rook, knight and pawn interlock around the king.',
    teach: 'The pieces hook together: the rook checks, the knight guards the rook and the escape square, a pawn supports the knight, and the king\'s own piece blocks its last exit.' },
  { key: 'dovetailMate', name: 'Dovetail Mate', icon: '🕊️', blurb: 'A supported queen mates a king flanked by its own pieces.',
    teach: 'Also called Cozio\'s Mate. The queen mates right next to the king; its two diagonal escape squares are blocked by its own pieces, and another piece defends the queen.' },
  { key: 'doubleBishopMate', name: 'Double Bishop Mate', icon: '♝', blurb: 'Two bishops on parallel diagonals sweep the king in.',
    teach: 'Two bishops rake neighboring diagonals — one checks, the other seals the escape — and the king is trapped on the edge, often after a sacrifice clears the path.' },
  { key: 'epauletteMate', name: 'Epaulette Mate', icon: '🎖️', blurb: 'The king flanked by its own rooks, mated head-on.',
    teach: 'The king\'s two escape squares are plugged by its own pieces — the "epaulettes," like shoulder pads — and a queen delivers mate directly in front.' },
  { key: 'operaMate', name: 'Opera Mate', icon: '🎭', blurb: 'A rook mates on the back rank, backed by a bishop.',
    teach: 'From Morphy\'s famous "Opera Game." A rook checks along the back rank, a bishop defends it from long range, and the king is blocked by one of its own pieces.' },
  { key: 'pillsburysMate', name: "Pillsbury's Mate", icon: '♜', blurb: 'Rook and bishop combine down the file and diagonal.',
    teach: 'A rook swings to the g- or h-file to check the castled king while a bishop on the long diagonal cuts off every escape.' },
  { key: 'morphysMate', name: "Morphy's Mate", icon: '👑', blurb: 'A bishop on the long diagonal, a rook seals the corner.',
    teach: 'A bishop delivers mate on the long diagonal near the corner while a rook — or the king itself — takes away the escape square.' },
  { key: 'swallowstailMate', name: 'Swallowtail Mate', icon: '🐦', blurb: 'A queen mates a king boxed in by its own pieces.',
    teach: 'Also called the Guéridon Mate. The king\'s diagonal escapes are blocked by its own pieces and a supported queen mates from in front — the blocked squares form a swallowtail shape.' },
  { key: 'cornerMate', name: 'Corner Mate', icon: '📐', blurb: 'A knight mates the king in the corner, rook in support.',
    teach: 'A knight delivers mate to a king stuck in the corner while a rook covers the escape square — a close cousin of the Arabian mate.' },
  { key: 'killBoxMate', name: 'Kill Box Mate', icon: '📦', blurb: 'Rook and queen build a box the king can\'t leave.',
    teach: 'The rook checks and the queen sits a knight\'s-move away, together forming a 3×3 "box" that covers every square the king could run to.' },
  { key: 'vukovicMate', name: "Vuković's Mate", icon: '♖', blurb: 'Rook and knight on the edge, backed by a pawn or king.',
    teach: 'A rook checks the king on the edge, a knight covers the flight squares, and a pawn or the king defends the rook.' },
];
export const mateByKey = (k) => ADVANCED_MATES.find((m) => m.key === k) || null;

