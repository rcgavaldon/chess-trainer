// puzzleplay.js — reusable interactive puzzle solver (board + move checking).
// mountPuzzle(el, puzzle, opts) renders the position and drives solving.
import { Chess } from 'chess.js';
import { createBoard, syncBoard, legalDests, showArrow } from './board.js';
import { checkMove, toMoveObj } from './puzzles.js';

// opts: { onSolved(p), onWrong(p, firstWrong), onProgress(idx), autoReplyMs, allowRetry }
export function mountPuzzle(el, puzzle, opts = {}) {
  const chess = new Chess(puzzle.fen);
  const side = chess.turn() === 'w' ? 'white' : 'black';
  let idx = 0, done = false, wrongOnce = false;

  const ground = createBoard(el, {
    fen: puzzle.fen, orientation: side, turnColor: side, coordinates: true,
    movable: { free: false, color: side, dests: legalDests(chess), showDests: true, events: { after: onMove } },
  });

  function onMove(orig, dest) {
    if (done) return;
    const piece = chess.get(orig);
    const isPromo = piece && piece.type === 'p' && (dest[1] === '8' || dest[1] === '1');
    // Default to queen, but if the puzzle's solution move here is an UNDER-promotion, honor it —
    // otherwise a knight/rook/bishop-promotion puzzle would be impossible to input.
    const expected = puzzle.solutionMoves[idx] || '';
    const promo = isPromo ? (expected.slice(0, 4) === orig + dest && /[nrbq]/i.test(expected[4] || '') ? expected[4].toLowerCase() : 'q') : undefined;
    const uci = orig + dest + (promo || '');
    if (checkMove(puzzle, idx, uci)) {
      chess.move({ from: orig, to: dest, promotion: promo });
      idx++;
      syncBoard(ground, chess, [orig, dest], side);
      opts.onProgress && opts.onProgress(idx);
      if (idx >= puzzle.solutionMoves.length) { done = true; opts.onSolved && opts.onSolved(puzzle); return; }
      const reply = puzzle.solutionMoves[idx];
      setTimeout(() => {
        if (done) return;
        chess.move(toMoveObj(reply));
        idx++;
        syncBoard(ground, chess, [reply.slice(0, 2), reply.slice(2, 4)], side);
        ground.set({ movable: { color: side, dests: legalDests(chess) } });
      }, opts.autoReplyMs ?? 240);
    } else {
      const first = !wrongOnce; wrongOnce = true;
      opts.onWrong && opts.onWrong(puzzle, first, { orig, dest, uci, fen: chess.fen() });
      // Reset for the retry. turnColor MUST come back to the solver: chessground flipped it after
      // the (wrong) move, and with it flipped a new drag registers as a queued PREMOVE instead of a
      // move — which read as "it won't let me try again".
      ground.set({ fen: chess.fen(), turnColor: side, lastMove: undefined, movable: { color: side, dests: opts.allowRetry === false ? new Map() : legalDests(chess) } });
      ground.cancelPremove && ground.cancelPremove();
    }
  }

  return {
    ground, side,
    hint() { const u = puzzle.solutionMoves[idx]; if (u) { showArrow(ground, u, 'blue'); setTimeout(() => ground.setAutoShapes([]), 1100); } },
    solved() { return done; },
    lock() { done = true; ground.set({ movable: { color: undefined, dests: new Map() } }); },
  };
}
