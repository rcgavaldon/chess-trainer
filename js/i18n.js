// i18n.js — full-site English↔Spanish. The app renders English at the source; when the language is
// Spanish we translate the rendered DOM in place from a dictionary of exact English→Spanish strings,
// and a MutationObserver keeps translating content that views render asynchronously. Switching
// language reloads once (English is simply restored from the source render — nothing to reverse).
//
// Coverage: static UI text, plus `placeholder`/`title`/button `value` attributes. Strings with
// interpolated values (numbers, names) won't dictionary-match and stay as-is; the AI coach handles
// its own output language via the prompt (see llm.js / chatcoach.js).
import * as store from './storage.js';
import { ES } from './i18n-es.js';

export const getLang = () => store.get('profile.lang', 'en');
export function setLang(lang) {
  store.set('profile.lang', lang);
  location.reload(); // re-render from English source, then translate on the way back if 'es'
}

// Translate one string, preserving its surrounding whitespace; returns it unchanged if no entry.
// Internal whitespace is collapsed for the lookup (so a string that renders across two lines still
// matches its single-line dictionary key).
function tr(s) {
  if (s == null) return s;
  const trimmed = s.trim();
  if (!trimmed) return s;
  const norm = trimmed.replace(/\s+/g, ' ');
  const es = ES[norm] != null ? ES[norm] : ES[trimmed];
  if (es == null) return s;
  const lead = s.slice(0, s.length - s.trimStart().length);
  const trail = s.slice(s.trimEnd().length);
  return lead + es + trail;
}

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE']);

function translateAttrs(el) {
  if (el.nodeType !== 1) return;
  if (el.placeholder) { const t = tr(el.placeholder); if (t !== el.placeholder) el.placeholder = t; }
  if (el.title) { const t = tr(el.title); if (t !== el.title) el.title = t; }
  if (el.tagName === 'INPUT' && (el.type === 'button' || el.type === 'submit') && el.value) { const t = tr(el.value); if (t !== el.value) el.value = t; }
}

function translateText(node) {
  const t = node.nodeValue;
  if (!t || !t.trim()) return;
  const es = tr(t);
  if (es !== t) node.nodeValue = es; // idempotent: Spanish text isn't a dict key, so re-runs are no-ops
}

// Walk a subtree, translating text nodes + relevant attributes. Safe to call repeatedly.
export function translateTree(root) {
  if (getLang() !== 'es' || !root) return;
  if (root.nodeType === 3) { translateText(root); return; }
  if (root.nodeType !== 1) return;
  if (SKIP.has(root.tagName)) return;
  translateAttrs(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (n.nodeType === 1 && SKIP.has(n.tagName)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const texts = [];
  let n;
  while ((n = walker.nextNode())) {
    if (n.nodeType === 1) translateAttrs(n);
    else texts.push(n);
  }
  texts.forEach(translateText);
}

let _observer = null;
// Begin translating: the chrome + current view now, and anything rendered later via a MutationObserver.
export function startI18n() {
  if (getLang() !== 'es' || _observer) return;
  translateTree(document.body);
  _observer = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') { translateText(m.target); continue; }
      m.addedNodes.forEach((node) => {
        if (node.nodeType === 1) translateTree(node);
        else if (node.nodeType === 3) translateText(node);
      });
    }
  });
  _observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}
