// opening-notes.js — hand-written, properly-licensed commentary for the most popular opening
// in each category (the "Listudy has none to grab, so we write our own" set). Keyed by the
// exact SAN move-sequence ending at the move being explained, so it layers onto ANY line the
// guided trainer walks through these positions. Falls back to generated commentary elsewhere.
// All sequences are legal main lines; verified against chess.js.

export const OPENING_NOTES = {
  // ---- 1.e4 e5 : Italian Game (most popular open game) ----
  'e4': 'Stake a claim in the center and open lines for your bishop and queen at once — the most popular first move in chess.',
  'e4 e5': 'Black answers symmetrically, fighting for the same central squares.',
  'e4 e5 Nf3': 'Develop with a threat: the knight hits the e5-pawn, so Black must respond.',
  'e4 e5 Nf3 Nc6': 'Black defends e5 and develops a piece — two jobs in one move.',
  'e4 e5 Nf3 Nc6 Bc4': 'The Italian Game. The bishop eyes f7 — Black\'s weakest square, defended only by the king.',
  'e4 e5 Nf3 Nc6 Bc4 Bc5': 'The Giuoco Piano ("quiet game"). Black copies the idea, aiming at your f2.',
  'e4 e5 Nf3 Nc6 Bc4 Bc5 c3': 'Prepare d4: with the c-pawn supporting it, you\'ll build a big pawn center.',
  'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6': 'Black develops and pressures e4 — the main line of the Giuoco Piano.',
  'e4 e5 Nf3 Nc6 Bc4 Nf6': 'The Two Knights Defense — Black invites sharp play instead of mirroring.',
  'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5': 'The Fried Liver attack: you go straight for f7. Aggressive, but Black has resources with ...d5.',

  // ---- 1.e4 e5 : Ruy López ----
  'e4 e5 Nf3 Nc6 Bb5': 'The Ruy López — pin-and-pressure on the knight defending e5. One of the most respected openings at every level.',
  'e4 e5 Nf3 Nc6 Bb5 a6': 'The Morphy Defense: Black puts the question to the bishop right away.',
  'e4 e5 Nf3 Nc6 Bb5 a6 Ba4': 'Keep the bishop on the a2–g8 diagonal — it still bears down on f7.',
  'e4 e5 Nf3 Nc6 Bb5 a6 Bxc6': 'The Exchange Variation — trade for the knight, damage Black\'s pawns, and head for a good endgame.',

  // ---- 1.e4 e5 : Vienna Game (Robert plays this) ----
  'e4 e5 Nc3': 'The Vienna Game. Develop the knight first and keep options open — often with a quick f4 to attack.',
  'e4 e5 Nc3 Nf6': 'Black mirrors, defending e5 indirectly and eyeing e4.',
  'e4 e5 Nc3 Nf6 f4': 'The Vienna Gambit — strike at e5 and open the f-file for your rook after castling.',
  'e4 e5 Nc3 Nc6': 'Black develops naturally; you can still go Bc4 or f4 for an attack.',

  // ---- 1.e4 c5 : Sicilian Defense (most popular reply to 1.e4) ----
  'e4 c5': 'The Sicilian Defense — Black fights for the center from the side, unbalancing the game. The most popular answer to 1.e4.',
  'e4 c5 Nf3': 'Develop and prepare d4, opening the position for your pieces.',
  'e4 c5 Nf3 d6': 'Black supports a future ...e5 and prepares to develop the kingside.',
  'e4 c5 Nf3 d6 d4': 'The Open Sicilian — strike in the center; after the trade your pieces get free rein.',
  'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6': 'The Najdorf — Black\'s most popular and respected Sicilian, making luft for the bishop and preparing ...e5 or ...e6.',

  // ---- 1.e4 e6 : French Defense ----
  'e4 e6': 'The French Defense — Black prepares ...d5 to challenge your center. Solid, but the c8-bishop can get hemmed in.',
  'e4 e6 d4 d5': 'Black hits e4. How you defend it defines the whole game.',
  'e4 e6 d4 d5 Nc3': 'Defend e4 and develop. Black\'s main tries are ...Nf6 and ...Bb4.',
  'e4 e6 d4 d5 e5': 'The Advance Variation — grab space and lock the center; Black will chip at your chain with ...c5.',

  // ---- 1.e4 c6 : Caro-Kann ----
  'e4 c6': 'The Caro-Kann — like the French, Black plays ...d5, but keeps the c8-bishop free. Very solid.',
  'e4 c6 d4 d5': 'Black challenges the center immediately, with no bishop problems.',
  'e4 c6 d4 d5 Nc3': 'Develop and defend e4; after ...dxe4 you recapture and enjoy easy development.',

  // ---- 1.e4 d6 / Pirc (Robert plays this as Black) ----
  'e4 d6': 'The Pirc setup — Black lets you build a center, planning to attack it later with pieces and ...e5 or ...c5.',
  'e4 d6 d4 Nf6': 'Develop the knight and pressure e4 — the flexible Pirc move order.',
  'e4 d6 d4 Nf6 Nc3 g6': 'Prepare to fianchetto the bishop on g7, where it rakes the long diagonal through your center.',
  'e4 d6 d4 Nf6 Nc3 g6 Nf3 Bg7': 'The Classical Pirc. The g7-bishop is the soul of Black\'s position — everything supports its diagonal.',

  // ---- 1.d4 d5 : Queen's Gambit ----
  'd4': 'Claim the center with the queen\'s pawn — a slightly slower, more positional start than 1.e4.',
  'd4 d5': 'Black stakes an equal claim in the center.',
  'd4 d5 c4': 'The Queen\'s Gambit — offer the c-pawn to deflect Black\'s d5-pawn and dominate the center. It\'s not a real sacrifice; you usually win it back.',
  'd4 d5 c4 e6': 'The Queen\'s Gambit Declined — rock-solid, but it shuts in the c8-bishop for now.',
  'd4 d5 c4 c6': 'The Slav — defend d5 with a pawn and keep the c8-bishop\'s diagonal open.',
  'd4 d5 c4 dxc4': 'The Queen\'s Gambit Accepted — Black grabs the pawn but won\'t hold it; you\'ll regain it and take the center.',

  // ---- 1.d4 Nf6 : Indian defenses ----
  'd4 Nf6 c4 g6': 'A King\'s Indian / Grünfeld setup — Black fianchettoes and lets you build a center to strike at it later.',
  'd4 Nf6 c4 e6 Nc3 Bb4': 'The Nimzo-Indian — pin the knight to fight for e4 and saddle you with doubled pawns if you take.',

  // ---- 1.Nf3 / d4 : London System (popular, easy to learn) ----
  'd4 d5 Nf3': 'A quiet, reliable setup — develop and aim for the London with Bf4.',
  'd4 d5 Nf3 Nf6 Bf4': 'The London System — the same easy, solid setup against almost anything: Bf4, e3, Bd3, c3, Nbd2. Great for learning sound development.',
};

export const noteFor = (sanSeq) => OPENING_NOTES[sanSeq] || null;
