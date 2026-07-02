// coach.js — where the AI coach's Anthropic calls go.
//
// To give EVERYONE the AI coach without exposing an API key, deploy the Cloudflare Worker in
// /proxy (it holds the key server-side) and paste its URL into COACH_PROXY below. While COACH_PROXY
// is '', the app falls back to each user's own key from Settings — so behavior is unchanged until
// the proxy is live.
import * as store from './storage.js';

export const COACH_PROXY = ''; // e.g. 'https://chess-coach.rgautomations.workers.dev'

export const coachKey = () => store.get('profile.llmKey', '');
export const coachEnabled = () => !!COACH_PROXY || !!coachKey();

// The URL + headers to POST an Anthropic Messages request to. Via the proxy the browser sends NO
// key (the worker adds it); direct mode uses the user's own key. Returns headers:null when neither
// a proxy nor a user key is available (coach unavailable).
export function coachEndpoint() {
  if (COACH_PROXY) return { url: COACH_PROXY.replace(/\/$/, ''), headers: { 'content-type': 'application/json' }, proxy: true };
  const key = coachKey();
  if (!key) return { url: null, headers: null, proxy: false };
  return {
    url: 'https://api.anthropic.com/v1/messages', proxy: false,
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
  };
}
