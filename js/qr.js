// js/qr.js — render a QR code as an inline <svg> string via the tiny qrcode-generator lib (CDN,
// same jsDelivr source the app already uses for chess.js/chessground). Returns null on any failure
// so callers can gracefully fall back to just showing the link.
let _lib = null;
async function load() {
  if (!_lib) _lib = (await import('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm')).default;
  return _lib;
}

export async function qrSvg(text, { cellSize = 4, margin = 2 } = {}) {
  try {
    const qrcode = await load();
    const qr = qrcode(0, 'M'); // auto version, medium error-correction (survives a bit of print smudge)
    qr.addData(String(text));
    qr.make();
    return qr.createSvgTag({ cellSize, margin });
  } catch {
    return null;
  }
}
