// coach-worker.js — Cloudflare Worker that proxies the chess app's AI-coach requests to Anthropic.
// It holds the API key SERVER-SIDE (env.ANTHROPIC_KEY), so the public app never ships a key.
// Deploy it in the Cloudflare dashboard (see proxy/DEPLOY.md) and set ANTHROPIC_KEY as a secret.

const ALLOWED_ORIGINS = ['https://rcgavaldon.github.io']; // only the app may call the proxy
const MAX_TOKENS_CAP = 800;   // cost guard: never let a single call exceed this
const MAX_MESSAGES = 16;      // trim conversation length

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    const cors = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    // ---- GET /uscf/… — US Chess tournament-history proxy (ratings-api.uschess.org sends no CORS
    // headers, so the app can't call it directly). Whitelisted paths only, cached at the edge.
    if (request.method === 'GET') {
      const m = new URL(request.url).pathname.match(/^\/uscf\/(\d{8,9})(\/(events|sections|game-stats))?$/);
      if (!m) return json({ error: 'Not found' }, 404, cors);
      const qs = new URL(request.url).search || '';
      const upstream = await fetch(`https://ratings-api.uschess.org/api/v1/members/${m[1]}${m[2] || ''}${qs}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'chess-trainer (rgautomations)' },
        cf: { cacheTtl: 21600, cacheEverything: true }, // 6h edge cache — history changes slowly
      });
      const body = await upstream.text();
      return new Response(body, { status: upstream.status, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=21600', ...cors } });
    }

    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, cors);
    // Basic origin allow-list — deters casual abuse from other sites (not spoof-proof; add a
    // Cloudflare Rate Limiting rule for real per-IP protection, see DEPLOY.md).
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: 'Forbidden origin' }, 403, cors);
    if (!env.ANTHROPIC_KEY) return json({ error: 'Proxy missing ANTHROPIC_KEY' }, 500, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'Bad JSON' }, 400, cors); }
    // cost guards
    body.max_tokens = Math.min(Number(body.max_tokens) || 600, MAX_TOKENS_CAP);
    if (Array.isArray(body.messages)) body.messages = body.messages.slice(-MAX_MESSAGES);

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });
    // stream/pass the response straight through, adding CORS
    const headers = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...cors } });
}
