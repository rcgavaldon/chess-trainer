// engine.js — Stockfish 18 lite-single wrapper for GitHub Pages (single-threaded,
// no COOP/COEP needed). Self-hosted engine files in /engine/. No build step.
//
// evaluate() returns scores normalized to WHITE's point of view (Stockfish reports
// from side-to-move). Mate is exposed both as a raw `mate` value and folded into
// `cp` via a finite sentinel so downstream math/sorting stays well-defined.

const ENGINE_URL = new URL('../engine/stockfish-18-lite-single.js', import.meta.url);
export const MATE_CP = 100000;

export function createEngine() {
  let worker = null;
  let multipv = 1;

  const listeners = new Set();
  function onLine(line) { for (const l of listeners) l(line); }

  function handleRaw(e) {
    const text = typeof e === 'string' ? e : e.data; // some builds post a string, others {data}
    if (typeof text !== 'string') return;
    for (let line of text.split('\n')) {
      line = line.replace(/\r$/, '');
      if (line.length) onLine(line);
    }
  }

  const send = (cmd) => worker.postMessage(cmd);

  function waitFor(predicate) {
    return new Promise((resolve) => {
      const fn = (line) => { if (predicate(line)) { listeners.delete(fn); resolve(line); } };
      listeners.add(fn);
    });
  }

  // strict serial queue: UCI streams must never interleave.
  let chain = Promise.resolve();
  function run(task) {
    const next = chain.then(task, task);
    chain = next.catch(() => {});
    return next;
  }

  async function init() {
    if (worker) return;
    worker = new Worker(ENGINE_URL); // same-origin → engine's locateFile finds the sibling .wasm
    worker.onmessage = handleRaw;
    // A failed worker/wasm load (or a build that never answers) must REJECT, not hang forever behind
    // waitFor — otherwise ensureEngine() sits on a stuck "Loading engine…" toast with no recovery.
    let onErr;
    const failed = new Promise((_, reject) => { onErr = reject; });
    worker.onerror = (err) => { console.error('[stockfish] worker error', err.message || err); onErr(new Error('Engine failed to load')); };
    const ready = run(async () => {
      send('uci'); await waitFor((l) => l === 'uciok');
      send('isready'); await waitFor((l) => l === 'readyok');
    });
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Engine load timed out')), 30000));
    try {
      await Promise.race([ready, failed, timeout]);
    } catch (e) {
      try { worker.terminate(); } catch {}
      worker = null; listeners.clear(); chain = Promise.resolve(); // reset so a retry can re-init cleanly
      throw e;
    }
  }

  function setMultiPV(n) {
    multipv = Math.max(1, n | 0);
    return run(async () => {
      send(`setoption name MultiPV value ${multipv}`);
      send('isready');
      await waitFor((l) => l === 'readyok');
    });
  }

  function stop() { if (worker) send('stop'); }

  function quit() {
    if (!worker) return;
    try { send('quit'); } catch {}
    worker.terminate();
    worker = null;
    listeners.clear();
  }

  function parseInfo(line, whiteToMove) {
    if (!line.startsWith('info ') || !line.includes(' pv ')) return null;
    const t = line.split(/\s+/);
    const rec = { depth: 0, multipv: 1, cp: null, mate: null, pv: [], bestMove: null };
    for (let i = 1; i < t.length; i++) {
      switch (t[i]) {
        case 'depth': rec.depth = +t[++i]; break;
        case 'multipv': rec.multipv = +t[++i]; break;
        case 'score':
          if (t[i + 1] === 'cp') { rec.cp = +t[i + 2]; i += 2; }
          else if (t[i + 1] === 'mate') { rec.mate = +t[i + 2]; i += 2; }
          break;
        case 'pv': rec.pv = t.slice(i + 1); i = t.length; break;
        default: break;
      }
    }
    rec.bestMove = rec.pv[0] || null;
    if (!whiteToMove) { // normalize to White POV
      if (rec.cp != null) rec.cp = -rec.cp;
      if (rec.mate != null) rec.mate = -rec.mate;
    }
    return rec;
  }

  const mateToCp = (mate) => (mate > 0 ? MATE_CP - mate : -MATE_CP - mate);

  // evaluate(fen, {depth, multipv, movetime}) -> {cp, mate, bestMove, pv, depth, lines?}
  function evaluate(fen, { depth = 14, multipv: mpv = multipv, movetime = null } = {}) {
    const whiteToMove = fen.split(/\s+/)[1] === 'w';
    return run(() => new Promise((resolve) => {
      const wantMpv = Math.max(1, mpv | 0);
      const best = new Map(); // multipv index -> latest record
      let terminalMate = false; // a checkmated position emits "score mate 0" with no pv

      const collector = (line) => {
        if (line.startsWith('info ')) {
          const rec = parseInfo(line, whiteToMove);
          if (rec && rec.pv.length) best.set(rec.multipv, rec);
          else if (/\bscore mate 0\b/.test(line)) terminalMate = true;
          return;
        }
        if (line.startsWith('bestmove')) {
          listeners.delete(collector);
          const bm = line.split(/\s+/)[1] || null;
          const lines = [...best.values()]
            .sort((a, b) => a.multipv - b.multipv)
            .map((r) => ({
              cp: r.mate != null ? mateToCp(r.mate) : r.cp,
              mate: r.mate,
              rawCp: r.cp,
              bestMove: r.bestMove,
              pv: r.pv,
              depth: r.depth,
            }));
          // Terminal position (no legal moves → no pv). Checkmate is decisive for the OTHER side;
          // stalemate is a draw. Without this, a game-ending mate scored cp 0 → the mating move got
          // graded a Blunder and the winner's accuracy was dragged down.
          const top = lines[0] || (terminalMate
            ? { cp: whiteToMove ? -MATE_CP : MATE_CP, mate: whiteToMove ? -1 : 1, bestMove: null, pv: [], depth }
            : { cp: 0, mate: null, bestMove: bm, pv: bm ? [bm] : [], depth });
          resolve({
            cp: top.cp,
            mate: top.mate,
            bestMove: bm || top.bestMove,
            pv: top.pv,
            depth: top.depth,
            ...(wantMpv >= 2 ? { lines } : {}),
          });
        }
      };

      listeners.add(collector);
      if (wantMpv !== multipv) { multipv = wantMpv; send(`setoption name MultiPV value ${wantMpv}`); }
      send('ucinewgame');
      send(`position fen ${fen}`);
      send(movetime ? `go movetime ${movetime}` : `go depth ${depth}`);
    }));
  }

  return { init, evaluate, setMultiPV, stop, quit, MATE_CP };
}
