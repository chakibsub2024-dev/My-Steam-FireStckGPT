// DOM helpers. Text is always inserted as text nodes (never innerHTML), so
// metadata from TMDB or add-ons cannot inject markup.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function mount(target, ...children) {
  target.replaceChildren();
  return append(target, children);
}

export function toast(message, kind = 'info') {
  const host = document.getElementById('toasts');
  const el = h('div', { class: `toast toast-${kind}`, role: 'status' }, message);
  host.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 4200);
}

export function spinner(label = 'Loading') {
  return h('div', { class: 'spinner', role: 'progressbar', 'aria-label': label });
}

export function emptyState(title, text, ...actions) {
  return h('div', { class: 'empty' }, h('h2', {}, title), text ? h('p', { class: 'muted' }, text) : null, actions.length ? h('div', { class: 'btn-row center' }, actions) : null);
}

export function errorState(err, retry) {
  return emptyState('Something went wrong', err?.message || String(err), retry ? h('button', { class: 'btn', onclick: retry }, 'Try again') : null);
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}

export function fmtRuntime(min) {
  if (!min) return '';
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`;
}

/** Disable a button while an async action runs; report errors as toasts. */
export function busy(button, fn) {
  return async (...args) => {
    if (button.disabled) return;
    button.disabled = true;
    button.classList.add('is-busy');
    try {
      await fn(...args);
    } catch (err) {
      toast(err.message || String(err), 'error');
    } finally {
      button.disabled = false;
      button.classList.remove('is-busy');
    }
  };
}

/** Accessible modal dialog; restores focus to the opener when closed. */
export function modal(title, body, { onClose, wide = false } = {}) {
  const opener = document.activeElement;
  const close = () => {
    overlay.remove();
    document.body.classList.remove('modal-open');
    removeEventListener('keydown', onKey, true);
    onClose?.();
    if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
  };
  const onKey = (e) => {
    if (isBackKey(e)) { e.preventDefault(); e.stopPropagation(); close(); }
  };
  const overlay = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, onclick: (e) => { if (e.target === overlay) close(); } },
    h('div', { class: `modal-card ${wide ? 'wide' : ''}` },
      h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '✕')),
      body));
  document.body.append(overlay);
  document.body.classList.add('modal-open');
  addEventListener('keydown', onKey, true);
  (overlay.querySelector('[autofocus]') || overlay.querySelector('input, select, button:not(.icon-btn), a') || overlay.querySelector('button'))?.focus();
  return { close, overlay };
}

/** Back on keyboards, Android TV, Fire TV, Samsung Tizen (10009) and LG webOS (461). */
export function isBackKey(e) {
  return e.key === 'Escape' || e.key === 'GoBack' || e.key === 'BrowserBack' || e.keyCode === 10009 || e.keyCode === 461
    || (e.key === 'Backspace' && !/^(INPUT|TEXTAREA)$/.test(e.target?.tagName));
}

export function avatarColor(name) {
  return { red: '#e50914', blue: '#2f6fed', green: '#1f9d55', yellow: '#e0a800', purple: '#7b3fe4', teal: '#0f9e9e', orange: '#ef6c00', pink: '#d63384' }[name] || '#2f6fed';
}

export function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* private mode */ }
  return null;
}
