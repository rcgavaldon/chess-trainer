#!/usr/bin/env node
/*
 * generate-shards.mjs
 * --------------------
 * Build curated, themed tactics-puzzle shards from the Lichess open puzzle DB
 * for a static client-side chess app (offline, instant themed training).
 *
 * SOURCE (CC0):
 *   https://database.lichess.org/lichess_db_puzzle.csv.zst   (~300 MB compressed)
 *   CSV columns:
 *     PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
 *
 * OUTPUT:
 *   puzzles/<theme>.json   — array of { id, fen, moves, rating, themes }
 *   ~150 puzzles per theme, quality-filtered, spread across rating bands.
 *
 * QUALITY FILTER (per requirements):
 *   - RatingDeviation < 100   (well-established rating)
 *   - NbPlays > 500           (battle-tested)
 *   - sampled across rating 800..2000 in buckets so each shard has an
 *     easy->hard spread instead of clustering at one rating.
 *
 * ZSTD HANDLING (in priority order):
 *   1. Node built-in zlib.createZstdDecompress  (Node >= 22.15 / 23+; this
 *      machine has Node 24 -> used automatically, ZERO external deps).
 *   2. `zstd` CLI on PATH                         (zstd -dc file | node ...).
 *   3. Already-decompressed .csv passed directly.
 *   See "RUN INSTRUCTIONS" at the bottom of this file.
 *
 * USAGE:
 *   node generate-shards.mjs <input>            [--out DIR] [--per N] [--minPlays N] [--maxDev N]
 *     <input> may be:
 *       path/to/lichess_db_puzzle.csv.zst   (auto-decompressed via Node zstd)
 *       path/to/lichess_db_puzzle.csv       (plain CSV)
 *       -                                   (read CSV from stdin, e.g. piped from `zstd -dc`)
 *
 * EXAMPLES:
 *   node generate-shards.mjs lichess_db_puzzle.csv.zst
 *   zstd -dc lichess_db_puzzle.csv.zst | node generate-shards.mjs -
 *   node generate-shards.mjs lichess_db_puzzle.csv --per 200 --out ./puzzles
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';

// ---- config ---------------------------------------------------------------

const THEMES = [
  // core tactics
  'fork', 'pin', 'skewer', 'hangingPiece', 'backRankMate',
  'discoveredAttack', 'doubleCheck', 'deflection', 'sacrifice',
  'mateIn1', 'mateIn2', 'mateIn3', 'advancedPawn', 'trappedPiece',
  // more tactical motifs (variety)
  'attraction', 'clearance', 'interference', 'intermezzo', 'quietMove',
  'xRayAttack', 'capturingDefender', 'defensiveMove', 'promotion', 'zugzwang',
  'kingsideAttack', 'exposedKing', 'smotheredMate',
  // endgames (Robert's weakness — give them depth)
  'endgame', 'rookEndgame', 'pawnEndgame', 'queenEndgame', 'bishopEndgame', 'knightEndgame', 'queenRookEndgame',
  // phase
  'opening', 'middlegame',
];
const THEME_SET = new Set(THEMES);

// rating buckets: wider spread (600..2400) so adaptive difficulty + storm ramping have range
const BUCKET_EDGES = [600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400];

function parseArgs(argv) {
  const a = { input: null, out: null, per: 150, minPlays: 500, maxDev: 100 };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--out') a.out = argv[++i];
    else if (t === '--per') a.per = parseInt(argv[++i], 10);
    else if (t === '--minPlays') a.minPlays = parseInt(argv[++i], 10);
    else if (t === '--maxDev') a.maxDev = parseInt(argv[++i], 10);
    else if (!a.input) a.input = t;
  }
  if (!a.out) a.out = path.join(process.cwd(), 'puzzles');
  return a;
}

// ---- input stream (handles .zst via Node built-in, plain .csv, or stdin) --

function openInput(input) {
  if (input === '-' || input == null) {
    // stdin: assume already-decompressed CSV (e.g. `zstd -dc file | node ...`)
    return process.stdin;
  }
  const raw = fs.createReadStream(input);
  if (input.endsWith('.zst') || input.endsWith('.zstd')) {
    if (typeof zlib.createZstdDecompress !== 'function') {
      console.error(
        '\nERROR: input is .zst but this Node build lacks zlib.createZstdDecompress.\n' +
        'Decompress first with the zstd CLI and pipe it in:\n' +
        '  zstd -dc ' + input + ' | node generate-shards.mjs -\n'
      );
      process.exit(2);
    }
    return raw.pipe(zlib.createZstdDecompress());
  }
  if (input.endsWith('.gz')) return raw.pipe(zlib.createGunzip());
  return raw; // plain .csv
}

// ---- CSV parsing ----------------------------------------------------------
// The Lichess puzzle CSV is simple: no embedded commas/quotes in the fields we
// use (FEN has spaces but no commas; Moves space-separated; Themes space-sep).
// A plain split(',') is correct and fast for this dataset. We still guard
// against short/garbage lines.

function bucketIndex(rating) {
  for (let i = 0; i < BUCKET_EDGES.length - 1; i++) {
    if (rating >= BUCKET_EDGES[i] && rating < BUCKET_EDGES[i + 1]) return i;
  }
  return -1;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.input) {
    console.error('Usage: node generate-shards.mjs <input.csv|.zst|-> [--out DIR] [--per N] [--minPlays N] [--maxDev N]');
    process.exit(1);
  }
  fs.mkdirSync(args.out, { recursive: true });

  const nBuckets = BUCKET_EDGES.length - 1;
  const perBucket = Math.ceil(args.per / nBuckets);

  // collected[theme][bucket] = array of puzzle objects (capped at perBucket)
  const collected = {};
  for (const t of THEMES) collected[t] = Array.from({ length: nBuckets }, () => []);

  // how many themes still need at least one bucket filled (for early exit)
  const isThemeFull = (t) =>
    collected[t].every((b) => b.length >= perBucket);

  const rl = readline.createInterface({ input: openInput(args.input), crlfDelay: Infinity });

  let lineNo = 0, kept = 0, scanned = 0;
  const t0 = Date.now();

  for await (const line of rl) {
    lineNo++;
    if (lineNo === 1 && line.startsWith('PuzzleId')) continue; // header
    if (!line) continue;
    scanned++;

    // PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
    const c = line.split(',');
    if (c.length < 8) continue;

    const rating = +c[3];
    const ratingDev = +c[4];
    const nbPlays = +c[6];
    if (!(ratingDev < args.maxDev)) continue;
    if (!(nbPlays > args.minPlays)) continue;

    const bi = bucketIndex(rating);
    if (bi < 0) continue;

    const themes = c[7].split(' ');
    let matchedAny = false;
    for (const th of themes) {
      if (!THEME_SET.has(th)) continue;
      const bucket = collected[th][bi];
      if (bucket.length < perBucket) {
        matchedAny = true;
        bucket.push({
          id: c[0],
          fen: c[1],
          moves: c[2],
          rating,
          themes, // full theme list from the DB
        });
      }
    }
    if (matchedAny) kept++;

    // early-exit: stop scanning once every theme's every bucket is full
    if ((scanned & 0x3ffff) === 0) {
      if (THEMES.every(isThemeFull)) break;
    }
  }

  // ---- write shards -------------------------------------------------------
  const summary = [];
  for (const t of THEMES) {
    // flatten buckets, then sort by rating so the shard reads easy -> hard
    const all = collected[t].flat().sort((a, b) => a.rating - b.rating);
    const trimmed = all.slice(0, args.per);
    const file = path.join(args.out, `${t}.json`);
    fs.writeFileSync(file, JSON.stringify(trimmed, null, 0));
    const bucketCounts = collected[t].map((b) => b.length).join('/');
    summary.push({ theme: t, count: trimmed.length, buckets: bucketCounts });
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.error(`\nScanned ${scanned.toLocaleString()} rows, kept ${kept.toLocaleString()} matches in ${dt}s.`);
  console.error('Shards written to ' + args.out + ':');
  for (const s of summary) {
    console.error(`  ${s.theme.padEnd(18)} ${String(s.count).padStart(3)} puzzles  (buckets 800-2000: ${s.buckets})`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

/* ===========================================================================
 * RUN INSTRUCTIONS
 * ---------------------------------------------------------------------------
 * 1. Download the DB (~300 MB, CC0):
 *      curl -L -o lichess_db_puzzle.csv.zst https://database.lichess.org/lichess_db_puzzle.csv.zst
 *
 * 2a. EASIEST on this machine (Node 24 has built-in zstd, no zstd CLI needed):
 *      node generate-shards.mjs lichess_db_puzzle.csv.zst
 *
 * 2b. If your Node lacks built-in zstd, install the zstd CLI and pipe it:
 *      Windows:  winget install Facebook.Zstandard   (or: choco install zstandard)
 *      then:     zstd -dc lichess_db_puzzle.csv.zst | node generate-shards.mjs -
 *
 * 2c. Or decompress once to plain CSV (~1 GB) and pass the .csv:
 *      zstd -d lichess_db_puzzle.csv.zst
 *      node generate-shards.mjs lichess_db_puzzle.csv
 *
 * 3. Copy the puzzles/ folder into your GitHub Pages repo. In the app, fetch
 *    `puzzles/<theme>.json` instead of hitting /api/puzzle/next. Each entry is
 *    { id, fen, moves, rating, themes }. `moves` is space-separated UCI; per the
 *    Lichess convention the FIRST move is the opponent's setup move played from
 *    `fen`, and the solver responds from the second move onward.
 *
 * Tweak knobs:  --per 150  --minPlays 500  --maxDev 100  --out ./puzzles
 * =========================================================================== */
