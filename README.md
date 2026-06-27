# Chess Trainer

A personal-growth chess platform that pulls your Chess.com games, runs full **Stockfish**
analysis in the browser, explains every move in plain English, and turns the patterns you
miss most into saved-progress training — for yourself, your students, and your tournaments.

Everything runs **client-side** (no backend, no accounts). Game data comes from the public
Chess.com API; the engine is Stockfish 18 compiled to WebAssembly and runs on your own machine.

## Three roles

- **Personal** — Import your games → review any game move-by-move with engine grades
  (Brilliant / Best / Inaccuracy / Mistake / Blunder…), a plain-English "why" for each move, a
  clickable eval graph, and a "next slip" jump → **deep-scan** a batch of games for an Improve
  dashboard: accuracy trend, blunder timing, phase strengths, opening leaks, winning-position
  conversion, time-trouble, and a **peer comparison** (you vs your rating band and the level
  ~150 above, from cited public data) with a prioritized **improvement plan** → drill puzzles
  built from *your own blunders* plus curated themed puzzles, with spaced-repetition progress saved.
  Optional **Claude commentary** (your API key) adds coach-written notes on moves and your plan.
- **Class** — A teacher enters a roster of Chess.com usernames (students never log in — their
  games are public), sees each student's rating and recent form, assigns drills, and opens any
  student in the full Personal review.
- **Tournament** — Build an event from a roster and generate suggested pairings
  (Swiss / round-robin / strength-balanced) from current ratings, enter results, and track live
  standings with Buchholz / Sonneborn-Berger tie-breaks.

## Running it

It's a static site — any static host works.

**Locally:**
```
python -m http.server 8150 --directory .
# then open http://localhost:8150
```

**GitHub Pages:** push this folder to a repo and enable Pages (serve from root). The single-threaded
Stockfish build runs without the COOP/COEP headers Pages can't send, and Pages serves `.wasm` with
the correct MIME type. The `.nojekyll` file keeps Pages from touching the `engine/` files.

## How it works

| Concern | Approach |
|---|---|
| Engine | `engine/stockfish-18-lite-single.{js,wasm}` — Stockfish 18, single-threaded WASM, in a Web Worker |
| Game data | Chess.com public Published-Data API (no auth, CORS-open) |
| Rules / PGN | [chess.js](https://github.com/jhlywa/chess.js) 1.4.0 |
| Board | [Chessground](https://github.com/lichess-org/chessground) 9.2.1 (MIT) |
| Accuracy & grades | Lichess's verified Win% / accuracy formulas (`js/analysis.js`) |
| Explanations | Heuristic detectors over chess.js + engine eval (`js/explain.js`) |
| Puzzles | Your blunders → engine line; plus curated themed shards in `puzzles/` (15 themes × ~160, from the CC0 Lichess DB) with the live Lichess API as fallback |
| Peer data | Cited public benchmarks in `js/benchmarks.js` (Chess.com accuracy curve, Lichess blunder-timing study) — framed as directional, not a grade |
| Storage | localStorage (profile, roster, SRS, weakness trend) + IndexedDB (per-game analysis cache) |

### Regenerating puzzle shards

`puzzles/*.json` are pre-generated. To rebuild from the latest Lichess DB:
```
curl -L -o db.csv.zst https://database.lichess.org/lichess_db_puzzle.csv.zst
# Lichess prepends a 12-byte zstd "skippable frame"; strip it so Node's built-in zstd reads it:
tail -c +13 db.csv.zst > db.stripped.zst
node scripts/generate-shards.mjs db.stripped.zst --per 160 --out ./puzzles
```
(Or, if you have the `zstd` CLI: `zstd -dc db.csv.zst | node scripts/generate-shards.mjs -`.)

Source layout: `index.html` (shell + import map) · `js/` (modules) · `engine/` (Stockfish) · `css/`.
No build step — plain ES modules loaded from CDN via an import map.

## Tuning

Open **⚙ Settings** to set your username, default time control, **engine depth** (10–20; higher is
slower but more accurate — depth 14 is a good balance, lower it for faster scans), and an optional
Anthropic API key for richer move commentary.

## Licensing

Stockfish is **GPLv3**, so this bundled app inherits GPLv3 when distributed (source is public here,
which satisfies it). chess.js is BSD-2, Chessground is MIT. See `NOTICE.md`.
