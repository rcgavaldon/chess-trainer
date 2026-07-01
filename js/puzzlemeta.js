// puzzlemeta.js — friendly names + coaching hints for puzzle themes, plus a lightweight,
// engine-free "why that move is wrong" so the puzzle player can coach chess-review style
// (explain + let them retry) instead of just revealing the answer.
import { Chess } from 'chess.js';

export const THEME_LABEL = {
  fork: '🍴 Fork', pin: '📌 Pin', skewer: '🍢 Skewer', hangingPiece: '🎁 Hanging piece',
  discoveredAttack: '💥 Discovered attack', doubleCheck: '⚡ Double check', deflection: '↩️ Deflection',
  sacrifice: '⚔️ Sacrifice', attraction: '🧲 Attraction', clearance: '🚪 Clearance', interference: '🚧 Interference',
  intermezzo: '⏸️ In-between move', quietMove: '🤫 Quiet move', xRayAttack: '🔎 X-ray attack', capturingDefender: '🎯 Remove the defender',
  defensiveMove: '🛡️ Defense', promotion: '👑 Promotion', advancedPawn: '⬆️ Passed pawn', zugzwang: '🔒 Zugzwang',
  kingsideAttack: '⚔️ Kingside attack', exposedKing: '🚨 Exposed king', trappedPiece: '🪤 Trapped piece',
  mateIn1: '① Mate in 1', mateIn2: '② Mate in 2', mateIn3: '③ Mate in 3', backRankMate: '⬛ Back-rank mate', smotheredMate: '♞ Smothered mate',
  endgame: '🏁 Endgame', rookEndgame: '♜ Rook endgame', pawnEndgame: '♙ Pawn endgame', queenEndgame: '♛ Queen endgame',
  knightEndgame: '♞ Knight endgame', bishopEndgame: '♝ Bishop endgame', opening: '📖 Opening', middlegame: '🎯 Middlegame',
  blunder: '🩹 From your game', crushing: '💪 Winning tactic', advantage: '📈 Win the advantage', mate: '♛ Checkmate',
};
export const themeLabel = (t) => THEME_LABEL[t] || (t ? '🧩 ' + t : '🧩 Tactic');

const HINT = {
  fork: 'Look for one move that attacks two things at once.',
  pin: 'Look for a pin — freeze a piece against something more valuable behind it.',
  skewer: 'Look for a skewer — hit a valuable piece so it must move and expose the one behind.',
  hangingPiece: 'Something is undefended — find the move that wins it.',
  discoveredAttack: 'Move one piece to unleash the attack of the piece behind it.',
  deflection: 'Drag a defender away from what it\'s guarding, then strike.',
  sacrifice: 'A sacrifice may be the key — give up material to win more.',
  attraction: 'Lure a piece (often the king) onto a bad square, usually with a sacrifice.',
  intermezzo: 'Look for an in-between move — a bigger threat they must answer first.',
  capturingDefender: 'Take or chase away the piece that\'s defending the target.',
  backRankMate: 'The enemy king is stuck behind its own pawns on the back rank — exploit it.',
  mateIn1: 'There is checkmate in one — find the finishing blow.',
  mateIn2: 'Force mate in two — start with the most forcing move.',
  mateIn3: 'Force mate in three — every move should be a check or an unstoppable threat.',
  smotheredMate: 'The king is boxed in by its own pieces — a knight can finish it.',
  promotion: 'Push or support a pawn all the way to a queen.',
  advancedPawn: 'Your passed pawn is the star — push it toward promotion.',
  endgame: 'Few pieces left — activity and precise king moves decide it.',
  blunder: 'You had a stronger move here in your own game — find what you missed.',
};
export const themeHint = (t) => HINT[t] || 'Look for the most forcing move — a check, a capture, or a real threat.';

const NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
// Quick, engine-free reason a tried move is wrong. `fen` is the position BEFORE the move.
export function whyWrong(fen, uci, theme) {
  try {
    const c = new Chess(fen);
    const me = c.turn();
    const mv = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
    if (!mv) return null;
    const opp = me === 'w' ? 'b' : 'w';
    if (typeof c.isAttacked === 'function') {
      const attacked = c.isAttacked(mv.to, opp), defended = c.isAttacked(mv.to, me);
      if (attacked && !defended && mv.piece !== 'p') return `That leaves your ${NAME[mv.piece]} on ${mv.to} hanging — it can just be taken.`;
    }
    if (mv.san.endsWith('+') && /mate/i.test(theme || '')) return 'Close — that\'s a check, but the king slips away. Find the move it can\'t answer.';
    return null; // no obvious material flaw → caller falls back to a theme hint
  } catch { return null; }
}
