// "Who can use this?" control shared by servers and add-ons (admin only).
import { h, mount } from './ui.js';

export const ACCESS_LABEL = { all: 'Everyone', admins: 'Admins only', users: 'Chosen accounts' };

/** Renders a select + per-account checkboxes; calls onChange({ mode, userIds }). */
export function accessPicker(access, users, onChange) {
  let mode = access?.mode || 'all';
  let ids = new Set(access?.userIds || []);
  const members = users.filter((u) => u.role !== 'admin');
  const box = h('div', { class: 'access-users' });
  const select = h('select', { class: 'access-select', 'aria-label': 'Who can use this' },
    Object.entries(ACCESS_LABEL).map(([v, t]) => h('option', { value: v }, t)));
  select.value = mode;
  const emit = () => onChange({ mode, userIds: [...ids] });
  const drawUsers = () => mount(box, mode !== 'users' ? null
    : members.length ? members.map((u) => h('label', { class: 'check small' },
      h('input', { type: 'checkbox', checked: ids.has(u.id), onchange: (e) => { if (e.target.checked) ids.add(u.id); else ids.delete(u.id); emit(); } }), ` ${u.username}`))
      : h('span', { class: 'muted small' }, 'No family accounts yet (Settings → Accounts).'));
  select.addEventListener('change', () => { mode = select.value; if (mode !== 'users') ids = new Set(); drawUsers(); emit(); });
  drawUsers();
  return h('div', { class: 'access' }, h('span', { class: 'muted small' }, 'Who can use it:'), select, box);
}

/** Turns a pasted example link into a pattern: numbers/ids become placeholders. */
export function toPattern(link, kind) {
  let s = String(link || '').trim();
  if (!s || /\{(tmdb|imdb)\}/.test(s)) return s;
  s = s.replace(/\btt\d{5,}\b/, '{imdb}');
  if (kind === 'tv') {
    if (/[?&](season|s)=\d+/.test(s) || /[?&](episode|e)=\d+/.test(s)) {
      s = s.replace(/([?&](?:season|s)=)\d+/, '$1{season}').replace(/([?&](?:episode|e)=)\d+/, '$1{episode}');
      if (!s.includes('{imdb}')) s = s.replace(/([/=])\d+(?=([/?&#]|$))/, '$1{tmdb}');
      return s;
    }
    const m = s.match(/\/(\d+)([/-])(\d+)([/-])(\d+)(?=([/?#]|$))/);
    if (m) return s.replace(m[0], `/{tmdb}${m[2]}{season}${m[4]}{episode}`);
    const m2 = s.match(/\/\{imdb\}([/-])(\d+)([/-])(\d+)(?=([/?#]|$))/);
    if (m2) return s.replace(m2[0], `/{imdb}${m2[1]}{season}${m2[3]}{episode}`);
  }
  if (!s.includes('{imdb}')) {
    // last number in the path (or an id-like query parameter) is the TMDB id
    const q = s.match(/([?&](?:tmdb|tmdb_id|id)=)\d+/);
    if (q) return s.replace(q[0], `${q[1]}{tmdb}`);
    const parts = s.split('?');
    const path = parts[0].replace(/\/(\d+)(?!.*\/\d+)/, '/{tmdb}');
    s = [path, ...parts.slice(1)].join('?');
  }
  return s;
}
