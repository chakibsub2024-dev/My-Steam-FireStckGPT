// Category grids with infinite scroll: Movies, Series, Documentaries, Anime, Animation, …
import { get } from '../api.js';
import { card } from '../components.js';
import { busy, emptyState, h, spinner } from '../ui.js';

const SECTION = { movies: 'movies', series: 'series', documentaries: 'documentaries', anime: 'anime', animation: 'animation' };

export async function browseView({ params, setCleanup }) {
  const name = params.section.startsWith('category/') ? params.section.slice('category/'.length) : SECTION[params.section];
  let page = 1;
  const first = await get(`/catalog/category/${name}?page=1`);
  if (!first.items.length) return emptyState('Nothing here', 'No titles found.');
  const grid = h('div', { class: 'grid' }, first.items.map((i) => card(i)));
  let total = first.totalPages;
  const more = h('button', { class: 'btn load-more', hidden: total <= 1 }, 'Show more');
  const loadMore = busy(more, async () => {
    page += 1;
    const r = await get(`/catalog/category/${name}?page=${page}`);
    grid.append(...r.items.map((i) => card(i)));
    total = r.totalPages;
    more.hidden = page >= total;
  });
  more.addEventListener('click', loadMore);
  // Infinite scroll when the button scrolls into view (mouse/touch); TV users press it.
  const io = new IntersectionObserver((entries) => { if (entries[0].isIntersecting && !more.hidden && !more.disabled && !document.documentElement.classList.contains('tv')) loadMore(); }, { rootMargin: '600px' });
  io.observe(more);
  setCleanup(() => io.disconnect());
  return h('div', { class: 'page' }, h('h1', { class: 'page-title' }, first.title), grid, more, h('div', { hidden: true }, spinner()));
}
