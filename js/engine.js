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
    worker.onerror = (err) => console.error('[stockfish] worker error', err.message || err);
    await run(async () => {
      send('uci');
      await waitFor((l) => l === 'uciok');
      send('isready');
      await waitFor((l) => l === 'readyok');
    });
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

      const collector = (line) => {
        if (line.startsWith('info ')) {
          const rec = parseInfo(line, whiteToMove);
          if (rec && rec.pv.length) best.set(rec.multipv, rec);
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
          const top = lines[0] || { cp: 0, mate: null, bestMove: bm, pv: bm ? [bm] : [], depth };
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
