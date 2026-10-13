import { get } from '../api.js';
import { card } from '../components.js';
import { emptyState, h, mount, spinner } from '../ui.js';

export async function searchView({ query, navigate }) {
  const q = query.get('q') || '';
  const input = h('input', { type: 'search', value: q, autofocus: true, placeholder: 'Search movies and series', 'aria-label': 'Search', class: 'search-big' });
  const results = h('div', {});
  let timer;
  let ctrl;
  const run = async (term) => {
    ctrl?.abort();
    if (term.trim().length < 2) return mount(results, emptyState('Search MyStream', 'Type at least two letters.'));
    ctrl = new AbortController();
    mount(results, spinner());
    try {
      const r = await get(`/search?q=${encodeURIComponent(term.trim())}`, { signal: ctrl.signal });
      mount(results, r.items.length ? h('div', { class: 'grid' }, r.items.map((i) => card(i))) : emptyState('No results', `Nothing matched “${term}”.`));
    } catch (err) {
      if (err.name !== 'AbortError') mount(results, emptyState('Search failed', err.message));
    }
    return undefined;
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      history.replaceState(null, '', `#/search?q=${encodeURIComponent(input.value)}`);
      run(input.value);
    }, 300);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); run(input.value); } });
  run(q);
  void navigate;
  return h('div', { class: 'page' }, h('h1', { class: 'page-title' }, 'Search'), input, results);
}
