// valtown-coach — paste this into a new val.town HTTP val. It proxies the chess app's AI-coach
// requests to Anthropic, keeping your key server-side as the ANTHROPIC_KEY env var. val.town gives
// the val a public URL instantly, so there's no subdomain/route setup like Cloudflare.
export default async function (req: Request): Promise<Response> {
  const cors: Record<string, string> = {
    "Access-Control-Allow-Origin": "https://rcgavaldon.github.io",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Vary": "Origin",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return new Response("POST only", { status: 405, headers: cors });

  const key = Deno.env.get("ANTHROPIC_KEY");
  if (!key) return new Response(JSON.stringify({ error: "missing ANTHROPIC_KEY env var" }), { status: 500, headers: { "content-type": "application/json", ...cors } });

  let body: any;
  try { body = await req.json(); } catch { return new Response("bad json", { status: 400, headers: cors }); }
  body.max_tokens = Math.min(Number(body.max_tokens) || 600, 800);      // cost guard
  if (Array.isArray(body.messages)) body.messages = body.messages.slice(-16);

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  const headers = new Headers(upstream.headers);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(upstream.body, { status: upstream.status, headers });
}
