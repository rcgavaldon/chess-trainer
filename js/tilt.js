// tilt.js — live tilt detection from a player's recent Chess.com games (result + cadence
// based, so it needs no engine and works for any rostered student). Thresholds are
// rating-band-specific (beginners are inherently streakier). Pairs detection with a graded
// rest recommendation — the qualitative "take a break" advice, finally triggered.

const band = (rating) => (rating < 1000 ? { stop: 50, label: 'beginner' } : rating < 1500 ? { stop: 35, label: 'intermediate' } : { stop: 25, label: 'advanced' });
const SESSION_GAP = 3 * 3600; // games within 3h of each other = one session

// games: array of { userResult, endTime, userRating } (any order). Returns
// { level: 'clear'|'amber'|'red', signals:[...], consecLosses, sessionDrop, sessionGames }.
export function tiltSignals(games, { rating } = {}) {
  const list = (games || []).filter((g) => g && g.endTime).sort((a, b) => b.endTime - a.endTime); // newest first
  if (list.length < 2) return { level: 'clear', signals: [], consecLosses: 0, sessionDrop: 0, sessionGames: list.length };

  // current session = the run of games clustered to the most recent one
  const session = [list[0]];
  for (let i = 1; i < list.length; i++) {
    if (list[i - 1].endTime - list[i].endTime <= SESSION_GAP) session.push(list[i]);
    else break;
  }
  const chron = [...session].reverse(); // oldest → newest
  const signals = [];

  // consecutive losses at the very end (most recent)
  let consec = 0;
  for (const g of list) { if (g.userResult === 'loss') consec++; else break; }
  if (consec >= 2) signals.push(`${consec} losses in a row`);

  // session rating drop vs a rating-band stop-loss
  const rs = chron.map((g) => g.userRating).filter((x) => x != null);
  const drop = rs.length >= 2 ? rs[0] - rs[rs.length - 1] : 0;
  const b = band(rating || rs[rs.length - 1] || 1000);
  if (drop >= b.stop) signals.push(`down ${drop} points this session`);

  // grinding it back: many games in the last hour
  const lastHour = list.filter((g) => list[0].endTime - g.endTime <= 3600).length;
  if (lastHour >= 6) signals.push(`${lastHour} games in the last hour`);

  // long marathon session
  if (session.length >= 12) signals.push(`${session.length}-game session — that's a lot`);

  // recent collapse
  const last6 = list.slice(0, 6);
  if (last6.length >= 6 && last6.filter((g) => g.userResult === 'loss').length >= 5) signals.push('lost 5 of your last 6');

  let level = 'clear';
  if (consec >= 3 || signals.length >= 2) level = 'red';
  else if (signals.length >= 1) level = 'amber';
  return { level, signals, consecLosses: consec, sessionDrop: drop, sessionGames: session.length };
}

export function restAdvice(t) {
  if (!t || t.level === 'clear') return null;
  if (t.level === 'red') {
    if (t.consecLosses >= 4 || t.sessionDrop >= 70) {
      return { title: '🛑 Step away for a day or two', text: 'That\'s a rough run. More games right now usually means more losses. Rest 1–2 days and do a few puzzles instead — you\'ll come back sharper.' };
    }
    return { title: '🛑 Stop for today', text: 'Two or more tilt signs are showing. Close it for the day — review your last loss tomorrow with fresh eyes. Protecting your rating now is the smart move.' };
  }
  return { title: '⚠️ Take a breather', text: 'One warning sign. Take ~30 minutes, look at where your last game went wrong, then decide if you\'re calm enough to keep playing. A slower time control helps too.' };
}

export const tiltColor = (level) => (level === 'red' ? 'var(--bad)' : level === 'amber' ? 'var(--warn)' : 'var(--good)');
