// board.js — Chessground (v9.2.1, MIT) helpers: legal-move dests, eval bar, arrows.
// Chessground is pure UI — it knows no rules — so chess.js stays the source of truth
// and we re-sync the board from chess.fen() after every accepted move.

import { Chessground } from 'chessground';
import { winPercentWhite } from './analysis.js';

export function legalDests(chess) {
  const dests = new Map();
  for (const m of chess.moves({ verbose: true })) {
    if (!dests.has(m.from)) dests.set(m.from, []);
    dests.get(m.from).push(m.to);
  }
  return dests;
}

// Thin constructor. `config` is a Chessground config; returns the ground API.
export function createBoard(el, config = {}) {
  return Chessground(el, {
    animation: { enabled: true, duration: 180 },
    highlight: { lastMove: true, check: true },
    drawable: { enabled: true, visible: true },
    ...config,
  });
}

// Re-sync an interactive board from authoritative chess.js state after a move.
export function syncBoard(ground, chess, lastMove, movableColor) {
  ground.set({
    fen: chess.fen(),
    turnColor: chess.turn() === 'w' ? 'white' : 'black',
    lastMove,
    check: chess.isCheck(),
    movable: {
      color: movableColor || (chess.turn() === 'w' ? 'white' : 'black'),
      dests: legalDests(chess),
    },
  });
}

export const uciToFromTo = (uci) => [uci.slice(0, 2), uci.slice(2, 4)];

// White's share of the eval bar [0,100], from a White-POV eval object {type,value}.
export function evalToWhitePct(ev) {
  if (!ev) return 50;
  if (ev.type === 'mate') return ev.value > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, winPercentWhite(ev)));
}

// Numeric eval label, always from White's POV ('+1.2', '-0.4', 'M3').
export function evalText(ev) {
  if (!ev) return '0.0';
  if (ev.type === 'mate') return (ev.value > 0 ? 'M' : '-M') + Math.abs(ev.value);
  const v = ev.value / 100;
  return (v >= 0 ? '+' : '') + v.toFixed(1);
}

// Draw the engine's recommended move as a green arrow.
export function showArrow(ground, uci, brush = 'green') {
  if (!uci) { ground.setAutoShapes([]); return; }
  const [from, to] = uciToFromTo(uci);
  ground.setAutoShapes([{ orig: from, dest: to, brush }]);
}
export function clearArrows(ground) { ground.setAutoShapes([]); }
