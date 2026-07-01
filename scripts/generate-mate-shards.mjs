#!/usr/bin/env node
/*
 * generate-mate-shards.mjs — build curated shards for the CLASSIC NAMED checkmates
 * (Anastasia's, Boden's, Arabian, hook, dovetail, …) from the Lichess puzzle DB.
 *
 * The DB ships as a MULTI-FRAME (pzstd) .zst that Node's streaming zstd can't read past the
 * first frame, so we walk the frames manually: each pzstd data frame is preceded by a 12-byte
 * skippable frame whose 4-byte payload is the next frame's compressed size.
 *
 * Usage: node scripts/generate-mate-shards.mjs <path-to-lichess_db_puzzle.csv.zst> [--per 120]
 * Writes puzzles/<theme>.json — array of { id, fen, moves, rating, themes }.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const THEMES = [
  'anastasiaMate', 'arabianMate', 'bodenMate', 'hookMate', 'dovetailMate', 'doubleBishopMate',
  'epauletteMate', 'operaMate', 'pillsburysMate', 'morphysMate', 'swallowstailMate',
  'smotheredMate', 'backRankMate', 'cornerMate', 'killBoxMate', 'vukovicMate',
];
const THEME_SET = new Set(THEMES);
const BUCKET_EDGES = [600, 900, 1100, 1300, 1500, 1700, 1900, 2100, 2400, 2700];

const IN = process.argv[2];
const perArgIdx = process.argv.indexOf('--per');
const PER = perArgIdx > 0 ? parseInt(process.argv[perArgIdx + 1], 10) : 120;
const OUT = path.join(process.cwd(), 'puzzles');
const MIN_PLAYS = 100, MAX_DEV = 110;
if (!IN) { console.error('Usage: node generate-mate-shards.mjs <db.zst> [--per N]'); process.exit(1); }

const nBuckets = BUCKET_EDGES.length - 1;
const perBucket = Math.ceil(PER / nBuckets);
const collected = {};
for (const t of THEMES) collected[t] = Array.from({ length: nBuckets }, () => []);
const bucketIndex = (r) => { for (let i = 0; i < nBuckets; i++) if (r >= BUCKET_EDGES[i] && r < BUCKET_EDGES[i + 1]) return i; return -1; };

let scanned = 0, kept = 0, partial = '';
function processLine(line) {
  if (!line || line.startsWith('PuzzleId')) return;
  const c = line.split(',');
  if (c.length < 8) return;
  scanned++;
  const rating = +c[3], dev = +c[4], plays = +c[6];
  if (!(dev < MAX_DEV) || !(plays > MIN_PLAYS)) return;
  const bi = bucketIndex(rating);
  if (bi < 0) return;
  const themes = c[7].split(' ');
  let matched = false;
  for (const th of themes) {
    if (!THEME_SET.has(th)) continue;
    const b = collected[th][bi];
    if (b.length < perBucket) { matched = true; b.push({ id: c[0], fen: c[1], moves: c[2], rating, themes }); }
  }
  if (matched) kept++;
}
function processChunk(str) {
  partial += str;
  let nl;
  while ((nl = partial.indexOf('\n')) >= 0) { processLine(partial.slice(0, nl)); partial = partial.slice(nl + 1); }
}

console.error('Reading', IN, '…');
const buf = fs.readFileSync(IN);
let off = 0, frames = 0;
while (off + 8 <= buf.length) {
  const magic = buf.readUInt32LE(off);
  if (magic >= 0x184D2A50 && magic <= 0x184D2A5F) {
    const skipSize = buf.readUInt32LE(off + 4);
    if (skipSize === 4) {
      const comp = buf.readUInt32LE(off + 8); off += 12;
      try { processChunk(zlib.zstdDecompressSync(buf.subarray(off, off + comp)).toString('latin1')); frames++; } catch { /* skip bad frame */ }
      off += comp;
    } else off += 8 + skipSize;
  } else if (magic === 0xFD2FB528) {
    try { processChunk(zlib.zstdDecompressSync(buf.subarray(off)).toString('latin1')); frames++; } catch { /* */ }
    break;
  } else break;
}
if (partial) processLine(partial);

fs.mkdirSync(OUT, { recursive: true });
const summary = [];
for (const t of THEMES) {
  const all = collected[t].flat().sort((a, b) => a.rating - b.rating).slice(0, PER);
  fs.writeFileSync(path.join(OUT, `${t}.json`), JSON.stringify(all, null, 0));
  summary.push(`  ${t.padEnd(18)} ${String(all.length).padStart(3)} puzzles  (buckets ${collected[t].map((b) => b.length).join('/')})`);
}
console.error(`\nFrames ${frames}, scanned ${scanned.toLocaleString()} rows, kept ${kept.toLocaleString()}.`);
console.error('Shards written to ' + OUT + ':\n' + summary.join('\n'));
