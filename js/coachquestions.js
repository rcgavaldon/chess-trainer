// coachquestions.js — turn the student's OWN mistakes into choose-an-option questions:
// "this is from your game — you played X and it slipped, what's stronger?". Built from the
// analyzed plies (fenBefore + the move played + the engine's move + why it was bad), then
// dressed as lesson steps the Learn player can run. The single most personalized drill.
import { Chess } from 'chess.js';
import { explainMove } from './explain.js';

const BAD = new Set(['Blunder', 'Mistake', 'Miss']);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Pull the worst, deduped mistakes a player made (their move, the better move, and why).
export function blunderQuestions(analyses, max = 12) {
  const out = [];
  for (const a of analyses || []) {
    for (const p of a.plies || []) {
      if (p.color !== a.userColor || !BAD.has(p.label)) continue;
      if (!p.bestSan || !p.fenBefore || p.bestSan === p.san) continue;
      out.push({ fen: p.fenBefore, played: p.san, bestSan: p.bestSan, why: p.explanation || '', label: p.label, winLoss: p.winLoss || 0, opponent: a.game && a.game.opponent });
    }
  }
  const seen = new Set(), uniq = [];
  for (const q of out.sort((x, y) => y.winLoss - x.winLoss)) { if (seen.has(q.fen)) continue; seen.add(q.fen); uniq.push(q); }
  return uniq.slice(0, max);
}

// Dress one mistake as a lesson step: the engine move (best), the move you played (wrong),
// plus a couple of legal distractors — each explained.
export function questionToStep(q) {
  let bestWhy = 'It keeps your position healthy and dodges the slip.';
  try {
    const c = new Chess(q.fen);
    const mv = c.move(q.bestSan);
    if (mv) bestWhy = explainMove({ fenBefore: q.fen, fenAfter: c.fen(), move: mv, label: 'Best', ply: 20, history: c.history({ verbose: true }), bestMoveUci: null }).text;
  } catch { /* fall back to the generic line */ }
  let distractors = [];
  try { distractors = new Chess(q.fen).moves().filter((m) => m !== q.bestSan && m !== q.played); } catch {}
  shuffle(distractors);
  const options = [
    { san: q.bestSan, credit: 1, why: `Yes — the strongest move. ${bestWhy}` },
    { san: q.played, credit: 0, why: `This is what you actually played, and it cost you. ${q.why || 'A stronger move was available here.'}` },
    ...distractors.slice(0, 2).map((d) => ({ san: d, credit: 0, why: 'Legal, but it doesn\'t address what the position really needs.' })),
  ];
  return { fen: q.fen, ask: `From your game vs ${q.opponent || 'an opponent'}: you played ${q.played} here and it slipped. What\'s stronger?`, options: shuffle(options) };
}

// A full dynamic "lesson" from a player's mistakes, for the Learn player.
export function mistakesLesson(questions, n = 8) {
  return { id: 'your-mistakes', title: 'From your own games', theme: 'Your mistakes', icon: '🎯',
    blurb: 'Positions you actually misplayed — get them right this time.',
    steps: (questions || []).slice(0, n).map(questionToStep) };
}
