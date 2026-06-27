// dom.js — minimal DOM helpers shared by views.

// h('div', {class:'x', onclick:fn}, child, child...) -> HTMLElement
export function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false) e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return e;
}

export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

export function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }); }
  catch { return ''; }
}

export function pct(x) { return x == null ? '—' : Math.round(x) + '%'; }
