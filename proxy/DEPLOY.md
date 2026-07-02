# Turn on the AI coach for everyone (~5 min, free)

The app calls Anthropic to power the "Ask the coach" chat and richer move commentary. To give
**every** student/teacher the coach without exposing your API key, a tiny Cloudflare Worker holds
your key server-side and forwards requests. Your key never reaches anyone's browser.

## 1. Create the Worker
1. Go to **https://dash.cloudflare.com** → sign up (free) → **Workers & Pages**.
2. **Create application → Create Worker.** Name it e.g. `chess-coach`. Click **Deploy**.
3. Click **Edit code**. Delete the sample, paste the entire contents of
   [`proxy/coach-worker.js`](./coach-worker.js), then **Deploy**.

## 2. Add your Anthropic key as a secret
1. In the Worker → **Settings → Variables and Secrets → Add**.
2. Name: `ANTHROPIC_KEY`  · Value: your `sk-ant-…` key · **Encrypt** it · **Save/Deploy**.

## 3. Give me the URL
Copy the Worker's URL (looks like `https://chess-coach.YOURNAME.workers.dev`) and send it to me.
I paste it into `js/coach.js` (`COACH_PROXY`) and push — the coach then turns on for everyone,
no key needed on their end.

## Cost protection (recommended)
- The worker already caps `max_tokens` per call and only accepts requests from the app's domain.
- For a hard ceiling, add a **Rate Limiting** rule: Worker → **Settings → (or your zone) Security →
  Rate limiting rules** → e.g. limit to ~30 requests/minute per IP. Free tier covers modest use.
- Anthropic also lets you set a **monthly spend cap** in your Anthropic console — worth setting.

## Notes
- Only the coach chat + optional move commentary use this. Everything else (analysis, puzzles,
  ratings) runs without any key.
- `sk-ant-…` keys are secrets — only ever paste yours into the Cloudflare secret field above, never
  into the app or the repo.
