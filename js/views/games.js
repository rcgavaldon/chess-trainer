// views/games.js — the Games tab (replaced Openings in the nav): the full games list + the
// move-by-move engine review, on its own tab. All the machinery lives in personal.js; this is a
// thin entry point so "back" returns to the games list (not the report) and scroll is preserved.
import { renderGames } from './personal.js';

export function render(container, ctx) { renderGames(container, ctx); }
