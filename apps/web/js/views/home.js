import { del, get } from '../api.js';
import { card, hero, row, watchHref } from '../components.js';
import { emptyState, h, toast } from '../ui.js';

const MORE = { trending: '#/category/trending', popular_movies: '#/movies', popular_series: '#/series', documentaries: '#/documentaries', anime: '#/anime', animation: '#/animation', new_releases: '#/category/new_releases', top_rated: '#/category/top_rated', action: '#/category/action', comedy: '#/category/comedy', horror: '#/category/horror', scifi: '#/category/scifi' };

function continueCard(c) {
  const item = { ...c, tmdbId: c.tmdbId, type: c.type };
  const next = c.next;
  const href = c.type === 'tv' ? watchHref(item, next ? next.season : c.season, next ? next.episode : c.episode) : watchHref(item);
  const sub = c.type === 'tv' ? (next ? `Next: S${next.season} E${next.episode}` : `S${c.season} E${c.episode}${c.episodeName ? ` · ${c.episodeName}` : ''}`) : 'Resume';
  const el = card(item, { progress: next ? 0 : (c.duration ? c.position / c.duration : 0), sub });
  el.href = href;
  el.classList.add('continue');
  el.append(h('button', { class: 'card-x', 'aria-label': `Remove ${c.title} from Continue Watching`, title: 'Remove', onclick: async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { await del(`/history/${c.type}/${c.tmdbId}`); el.remove(); } catch (err) { toast(err.message, 'error'); }
  } }, '✕'));
  return el;
}

export async function homeView() {
  const [home, cont, list] = await Promise.all([get('/catalog/home'), get('/history/continue'), get('/mylist')]);
  if (!home.rows.length) return emptyState('Nothing to show yet', 'TMDB returned no titles. Check the server log.');
  const rows = home.rows.map((r) => row(r.title, r.items, { id: r.id, more: MORE[r.id] }));
  const extra = [
    cont.length ? row('Continue Watching', cont, { id: 'continue', render: continueCard }) : null,
    list.length ? row('My List', list, { id: 'mylist', more: '#/mylist' }) : null,
  ];
  // Continue Watching first, then Trending, then My List, then the rest.
  return h('div', { class: 'home' }, hero(home.hero), h('div', { class: 'rows' }, extra[0], rows[0], extra[1], rows.slice(1)));
}
