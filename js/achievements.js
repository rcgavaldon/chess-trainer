// achievements.js — motivating, school-appropriate badges (no dark patterns). Computed from
// data we already have: training streak, puzzles tackled, lessons finished, rating climb,
// win streak. Newly-earned badges are detected for a one-time celebration.

export const BADGES = [
  { id: 'streak3', icon: '🔥', name: 'On a roll', desc: '3-day training streak', test: (d) => d.streak >= 3 },
  { id: 'streak7', icon: '🔥', name: 'Week warrior', desc: '7-day training streak', test: (d) => d.streak >= 7 },
  { id: 'streak30', icon: '🏅', name: 'Unstoppable', desc: '30-day training streak', test: (d) => d.streak >= 30 },
  { id: 'puz50', icon: '🧩', name: 'Puzzler', desc: 'Tackled 50 puzzles', test: (d) => d.puzzles >= 50 },
  { id: 'puz250', icon: '🧠', name: 'Tactician', desc: 'Tackled 250 puzzles', test: (d) => d.puzzles >= 250 },
  { id: 'lessons3', icon: '📚', name: 'Student', desc: 'Finished 3 lessons', test: (d) => d.lessons >= 3 },
  { id: 'lessonsAll', icon: '🎓', name: 'Graduate', desc: 'Finished every lesson', test: (d) => d.lessonsTotal > 0 && d.lessons >= d.lessonsTotal },
  { id: 'climb50', icon: '📈', name: 'Climbing', desc: '+50 rating across recent games', test: (d) => d.ratingGain >= 50 },
  { id: 'climb100', icon: '🚀', name: 'Surging', desc: '+100 rating across recent games', test: (d) => d.ratingGain >= 100 },
  { id: 'win3', icon: '⚔️', name: 'Hat trick', desc: '3 wins in a row', test: (d) => d.winStreak >= 3 },
  { id: 'win5', icon: '👑', name: 'On fire', desc: '5 wins in a row', test: (d) => d.winStreak >= 5 },
];

export function computeBadges(data) {
  return BADGES.map((b) => ({ id: b.id, icon: b.icon, name: b.name, desc: b.desc, earned: !!b.test(data) }));
}

// Returns the badge objects that are earned now but weren't seen before (for a celebration),
// and a function to mark them seen. seen is a plain array (caller persists it).
export function newlyEarned(badges, seen) {
  const set = new Set(seen || []);
  return badges.filter((b) => b.earned && !set.has(b.id));
}
