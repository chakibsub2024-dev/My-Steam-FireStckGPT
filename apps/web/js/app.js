// MyStream web client: router, app shell, sign-in and profile gating.
import { get, post } from './api.js';
import { changePasswordView } from './views/password.js';
import { detectTv, installSpatialNav } from './spatial.js';
import { avatarColor, errorState, h, isBackKey, mount, spinner, toast } from './ui.js';
import { loginView } from './views/login.js';
import { profilesView } from './views/profiles.js';
import { homeView } from './views/home.js';
import { browseView } from './views/browse.js';
import { searchView } from './views/search.js';
import { titleView } from './views/title.js';
import { myListView } from './views/mylist.js';
import { addonsView } from './views/addons.js';
import { settingsView } from './views/settings.js';
import { playerView } from './views/player.js';

export const state = { user: null, profile: null, tmdbConfigured: true, version: '', mustChangePassword: false, networkExposed: false };

const NAV = [
  ['/', 'Home'], ['/movies', 'Movies'], ['/series', 'Series'], ['/documentaries', 'Documentaries'],
  ['/anime', 'Anime'], ['/animation', 'Animation'], ['/mylist', 'My List'], ['/addons', 'Add-ons', true], ['/settings', 'Settings'],
];

const routes = [
  [/^\/$/, homeView],
  [/^\/(movies|series|documentaries|anime|animation|category\/\w+)$/, browseView, ['section']],
  [/^\/search$/, searchView],
  [/^\/title\/(movie|tv)\/(\d+)$/, titleView, ['type', 'id']],
  [/^\/watch\/(movie|tv)\/(\d+)$/, playerView, ['type', 'id']],
  [/^\/mylist$/, myListView],
  [/^\/addons$/, addonsView],
  [/^\/settings$/, settingsView],
];

let cleanup = null;
let token = 0;

export function navigate(path, { replace = false } = {}) {
  const target = '#' + path;
  if (location.hash === target) return render();
  if (replace) history.replaceState(null, '', target);
  else location.hash = path;
  if (replace) render();
  return undefined;
}

function parse() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, q = ''] = raw.split('?');
  return { path, query: new URLSearchParams(q) };
}

function shell(path) {
  const p = state.profile;
  const searchBox = h('input', { type: 'search', placeholder: 'Titles, people, genres', 'aria-label': 'Search', class: 'search-input' });
  const form = h('form', { class: 'search-form', role: 'search', onsubmit: (e) => { e.preventDefault(); if (searchBox.value.trim()) navigate(`/search?q=${encodeURIComponent(searchBox.value.trim())}`); } },
    h('span', { class: 'search-icon', 'aria-hidden': 'true' }, '⌕'), searchBox);
  const links = NAV.filter(([, , admin]) => !admin || state.user?.role === 'admin')
    .map(([href, label]) => h('a', { href: '#' + href, class: `nav-link ${path === href || (href !== '/' && path.startsWith(href)) ? 'active' : ''}` }, label));
  const header = h('header', { class: 'topbar' },
    h('a', { class: 'logo', href: '#/', 'aria-label': 'MyStream home' }, 'MyStream'),
    h('nav', { class: 'mainnav', 'aria-label': 'Main' }, links),
    h('div', { class: 'topbar-right' }, form,
      p ? h('button', { class: 'avatar-btn', title: `Switch profile (${p.name})`, 'aria-label': `Profile ${p.name}: switch`, onclick: () => navigate('/profiles') },
        h('span', { class: 'avatar sm', style: { background: avatarColor(p.avatar) } }, p.name.slice(0, 1).toUpperCase())) : null));
  const onScroll = () => header.classList.toggle('solid', scrollY > 30);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  return header;
}

export async function render() {
  const my = ++token;
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  document.querySelectorAll('.modal').forEach((m) => m.remove());
  document.body.classList.remove('modal-open');
  const app = document.getElementById('app');
  const { path, query } = parse();

  if (!state.user) {
    if (path !== '/login') return navigate('/login', { replace: true });
    return mount(app, await loginView({ onSignedIn: boot }));
  }
  if (path === '/login') return navigate('/', { replace: true });
  // Temporary password + server reachable from other devices: change it first.
  if (state.mustChangePassword && state.networkExposed) {
    return mount(app, changePasswordView({ forced: true, onDone: () => { state.mustChangePassword = false; navigate('/', { replace: true }); } }));
  }
  if (path === '/profiles' || !state.profile) {
    return mount(app, await profilesView({ state, onChosen: (p) => { state.profile = p; navigate(path === '/profiles' ? '/' : path, { replace: true }); } }));
  }

  let match = null;
  for (const [re, view, keys = []] of routes) {
    const m = path.match(re);
    if (m) { match = { view, params: Object.fromEntries(keys.map((k, i) => [k, m[i + 1]])) }; break; }
  }
  const isPlayer = path.startsWith('/watch/');
  const main = h('main', { id: 'main', class: isPlayer ? 'main player-main' : 'main' });
  const banner = !isPlayer && state.mustChangePassword
    ? h('div', { class: 'temp-pw-banner', role: 'status' }, 'You are using a temporary password. ', h('a', { href: '#/settings' }, 'Change it in Settings → Account'), ' before sharing MyStream on your network.')
    : null;
  mount(app, isPlayer ? null : shell(path), banner, main);
  if (!match) return mount(main, h('div', { class: 'empty' }, h('h2', {}, 'Page not found'), h('a', { class: 'btn', href: '#/' }, 'Go home')));
  if (!state.tmdbConfigured && !['/settings', '/addons'].includes(path)) {
    mount(main, h('div', { class: 'empty' }, h('h2', {}, 'TMDB is not configured'),
      h('p', { class: 'muted' }, 'Set TMDB_API_KEY in the server\'s .env file and restart MyStream. TMDB provides titles, posters and episode data.')));
    return undefined;
  }
  mount(main, spinner());
  try {
    const node = await match.view({ params: match.params, query, state, navigate, setCleanup: (fn) => { cleanup = fn; } });
    if (my !== token) return undefined;
    mount(main, node);
    if (!isPlayer) {
      scrollTo(0, 0);
      (main.querySelector('[autofocus]') || main.querySelector('.hero .btn, .card, .btn, input'))?.focus({ preventScroll: true });
    }
  } catch (err) {
    if (my !== token || err.status === 401 || err.code === 'no_profile') return undefined;
    mount(main, errorState(err, () => render()));
  }
  return undefined;
}

async function boot() {
  try {
    const me = await get('/auth/me');
    Object.assign(state, { user: me.user, profile: me.profile, tmdbConfigured: me.tmdbConfigured, version: me.version, mustChangePassword: !!me.mustChangePassword, networkExposed: !!me.networkExposed });
  } catch (err) {
    state.user = null;
    if (err.status !== 401) {
      mount(document.getElementById('app'), errorState(err, () => boot()));
      return;
    }
  }
  render();
}

export async function signOut() {
  try { await post('/auth/logout'); } catch { /* ignore */ }
  Object.assign(state, { user: null, profile: null });
  navigate('/login');
}

addEventListener('hashchange', () => render());
addEventListener('ms:unauthenticated', () => {
  if (!state.user) return;
  state.user = null;
  state.profile = null;
  toast('Please sign in again');
  navigate('/login');
});
addEventListener('ms:no-profile', () => { state.profile = null; render(); });
addEventListener('ms:must-change', () => { state.mustChangePassword = true; state.networkExposed = true; render(); });
// Global Back: history back (TV remotes), unless a modal or the player handles it.
addEventListener('keydown', (e) => {
  if (!isBackKey(e) || e.defaultPrevented || document.querySelector('.modal') || e.target.closest?.('[data-own-keys]')) return;
  if (e.key === 'Backspace' && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if (location.hash && location.hash !== '#/') { e.preventDefault(); history.back(); }
});

// Native apps (Android TV/phone) call this for the remote's/phone's Back button.
// Returns true if MyStream handled it (closed a menu/dialog, left the player or
// went back a page); false at Home so the app can decide to exit.
window.msHandleBack = () => {
  let target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.getElementById('app');
  const player = document.querySelector('.player');
  if (player && !player.contains(target) && !document.querySelector('.modal')) target = player;
  const ev = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
  target.dispatchEvent(ev);
  return ev.defaultPrevented;
};

detectTv();
installSpatialNav();
mount(document.getElementById('app'), spinner());
boot();
