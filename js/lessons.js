// lessons.js — interactive, book-style "choose the move" lessons. You're shown a position
// and a situation, you PICK from a few candidate moves, then every option is explained —
// including why the plausible-but-wrong ones fall short. Branching partial credit, not
// binary right/wrong. All positions verified legal; no API key needed.

export const LESSONS = [
  {
    id: 'first-moves', title: 'Your first moves', theme: 'Openings', icon: '📖',
    blurb: 'How to start a game the right way — own the center and get your pieces out.',
    steps: [
      { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        ask: 'It\'s the very first move. Which one best follows the opening principles — fight for the center and free your pieces?',
        options: [
          { san: 'e4', credit: 1, why: 'Yes! 1.e4 grabs a center square and opens lines for both your bishop and your queen. The most popular first move in chess for good reason.' },
          { san: 'Nf3', credit: 0.5, why: 'A good developing move that eyes the center — but a pawn move like e4 claims more space right away.' },
          { san: 'a3', credit: 0, why: 'This does nothing for the center or your development. A whole turn spent and your pieces are still at home.' },
          { san: 'Nh3', credit: 0, why: 'Knights belong toward the center. On the rim it controls fewer squares — remember, "a knight on the rim is dim."' },
        ] },
      { fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
        ask: 'Black answered 1...e5. Develop a piece AND put a question to Black. What\'s the classic move?',
        options: [
          { san: 'Nf3', credit: 1, why: 'Perfect — it develops your knight and attacks the e5 pawn at the same time. Develop with a threat whenever you can.' },
          { san: 'Bc4', credit: 0.5, why: 'A fine bishop move aiming at f7. But Nf3 also hits e5, so it does two jobs in one move.' },
          { san: 'Qh5', credit: 0, why: 'The early queen looks scary near f7, but she\'s easily chased — ...Nc6 and ...g6 gain time by kicking her around.' },
          { san: 'f4', credit: 0, why: 'That\'s the King\'s Gambit — playable, but it loosens the squares around your king. As you\'re learning, finish developing first.' },
        ] },
      { fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
        ask: 'After 2...Nc6, a bishop wants to come out and pressure Black. Which move starts one of chess\'s most respected openings?',
        options: [
          { san: 'Bb5', credit: 1, why: 'The Ruy López! The bishop pressures the knight that defends e5. Played at the very top level for 150+ years.' },
          { san: 'Bc4', credit: 0.5, why: 'The Italian Game — also excellent, aiming at f7. Totally sound; this lesson just highlights the Ruy.' },
          { san: 'h3', credit: 0, why: 'A slow move with much better available. Get your pieces out and your king safe first.' },
          { san: 'Qe2', credit: 0, why: 'This blocks in your own f1-bishop. Develop the bishop before the queen gets in its way.' },
        ] },
    ],
  },
  {
    id: 'spot-fork', title: 'Spot the fork', theme: 'Tactics', icon: '⚔️',
    blurb: 'A fork hits two things at once. Learn to see the knight\'s favorite trick.',
    steps: [
      { fen: 'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1',
        ask: 'White to move. Your knight can win material in one move — find the fork.',
        options: [
          { san: 'Nc7+', credit: 1, why: 'A royal fork! The knight checks the king and attacks the rook on a8 at the same time. The king must move, then Nxa8 wins the rook.' },
          { san: 'Nd6+', credit: 0, why: 'It\'s only a check — it forks nothing, and the knight can be kicked away. A fork has to hit TWO targets at once.' },
          { san: 'Na3', credit: 0, why: 'Retreating does nothing. There was a free rook on the board.' },
          { san: 'Kf2', credit: 0, why: 'A quiet king move misses the moment. Knight forks like Nc7+ don\'t wait around.' },
        ] },
    ],
  },
  {
    id: 'back-rank', title: 'Back-rank mate', theme: 'Checkmates', icon: '♛',
    blurb: 'The most common way games end at every level — and how to deliver it.',
    steps: [
      { fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
        ask: 'Black\'s king is boxed in by its own pawns. End the game in one move.',
        options: [
          { san: 'Ra8#', credit: 1, why: 'Checkmate! The rook slides to the back rank and the king has no escape — its own f7/g7/h7 pawns trap it. This is the back-rank mate.' },
          { san: 'Ra7', credit: 0, why: 'Close, but this doesn\'t even give check — the king is fine and can make luft with ...h6 next move.' },
          { san: 'Rd1', credit: 0, why: 'Passive. You had mate in one and walked away from it.' },
          { san: 'Kf2', credit: 0, why: 'No reason to move your king when checkmate was sitting right there.' },
        ] },
    ],
  },
  {
    id: 'two-rook-mate', title: 'The two-rook ladder', theme: 'Endgame', icon: '♜',
    blurb: 'Two rooks vs a lone king — a mate you should be able to do in your sleep.',
    steps: [
      { fen: '6k1/R7/8/8/8/8/8/1R5K w - - 0 1',
        ask: 'Two rooks mate with a "ladder": one rook fences off a rank while the other checks. The a7-rook already cuts the 7th. Deliver mate.',
        options: [
          { san: 'Rb8#', credit: 1, why: 'Checkmate! The a7-rook fences the king off the 7th rank, and Rb8 covers the 8th. Two rooks climbing the ladder — know this one cold.' },
          { san: 'Ra8+', credit: 0, why: 'A check, but you abandoned the 7th-rank fence — the king escapes to g7. Keep one rook on the fence and check with the OTHER.' },
          { san: 'Rab7', credit: 0, why: 'This gives up the fence and doesn\'t even check. Mate was in one.' },
          { san: 'Kg2', credit: 0, why: 'No need — the mate was on the board.' },
        ] },
    ],
  },
  {
    id: 'win-trade', title: 'Winning? Simplify', theme: 'Strategy', icon: '🏁',
    blurb: 'The skill that wins the most "should-have-won" games: trade down when you\'re ahead.',
    steps: [
      { fen: '6k1/2p2ppp/3q4/3Q4/8/8/5PPP/4R1K1 w - - 0 1',
        ask: 'You\'re up a whole rook and the queens are facing off. What\'s the smart move?',
        options: [
          { san: 'Qxd6', credit: 1, why: 'Trade queens! When you\'re ahead in material, swapping pieces removes your opponent\'s chances. ...cxd6 recaptures, and you\'re up a rook in an easy endgame.' },
          { san: 'Qa5', credit: 0, why: 'Keeping queens on leaves swindle chances for your opponent. Ahead? Simplify — don\'t keep the most dangerous piece around.' },
          { san: 'Qd2', credit: 0, why: 'Retreating dodges the very trade you want. When you\'re up material, offer trades, don\'t avoid them.' },
          { san: 'Kh1', credit: 0, why: 'A waiting move wastes your advantage. Trade queens and convert the win.' },
        ] },
    ],
  },
];

// progress: { [lessonId]: { best, completedAt } } in the storage root under lessons.done
export function bestOption(step) {
  return step.options.reduce((a, b) => (b.credit > a.credit ? b : a), step.options[0]);
}
export function lessonMaxScore(lesson) { return lesson.steps.length; }
