import { get } from '../api.js';
import { card } from '../components.js';
import { emptyState, h } from '../ui.js';

export async function myListView() {
  const list = await get('/mylist');
  return h('div', { class: 'page' },
    h('h1', { class: 'page-title' }, 'My List'),
    list.length ? h('div', { class: 'grid' }, list.map((i) => card(i)))
      : emptyState('Your list is empty', 'Use “+ My List” on any title to save it here.', h('a', { class: 'btn', href: '#/' }, 'Browse titles')));
}
