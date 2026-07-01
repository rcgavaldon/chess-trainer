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
    const promo = piece && piece.type === 'p' && (dest[1] === '8' || dest[1] === '1') ? 'q' : undefined;
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
      ground.set({ fen: chess.fen(), movable: { color: side, dests: opts.allowRetry === false ? new Map() : legalDests(chess) } });
    }
  }

  return {
    ground, side,
    hint() { const u = puzzle.solutionMoves[idx]; if (u) { showArrow(ground, u, 'blue'); setTimeout(() => ground.setAutoShapes([]), 1100); } },
    solved() { return done; },
    lock() { done = true; ground.set({ movable: { color: undefined, dests: new Map() } }); },
  };
}
