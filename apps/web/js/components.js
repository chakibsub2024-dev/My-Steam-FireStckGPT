// Shared UI pieces: poster cards, carousels, hero banner, My List toggle.
import { del, put } from './api.js';
import { busy, h, toast } from './ui.js';

export const titleHref = (item) => `#/title/${item.type}/${item.tmdbId}`;
export const watchHref = (item, season, episode) => `#/watch/${item.type}/${item.tmdbId}${item.type === 'tv' ? `?s=${season || 1}&e=${episode || 1}` : ''}`;

export function poster(item, cls = 'poster') {
  const box = h('div', { class: cls });
  if (item.poster) {
    const img = h('img', { src: item.poster, alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => { img.remove(); box.classList.add('no-art'); box.dataset.title = item.title || ''; });
    box.append(img);
  } else {
    box.classList.add('no-art');
    box.dataset.title = item.title || '';
  }
  return box;
}

export function card(item, { progress, sub } = {}) {
  return h('a', { class: 'card', href: titleHref(item), title: item.title, dataset: { key: item.key } },
    poster(item),
    progress ? h('div', { class: 'card-progress' }, h('span', { style: { width: `${Math.min(100, progress * 100)}%` } })) : null,
    h('div', { class: 'card-caption' },
      h('span', { class: 'card-title' }, item.title),
      h('span', { class: 'card-sub' }, sub || [item.year, item.rating ? `★ ${item.rating}` : null, item.type === 'tv' ? 'Series' : null].filter(Boolean).join(' · ') || ' ')));
}

export function row(title, items, { render = (i) => card(i), id = '', more } = {}) {
  const track = h('div', { class: 'row-track', role: 'list' }, items.map((i) => {
    const el = render(i);
    el.setAttribute('role', 'listitem');
    return el;
  }));
  // "See all" is the last tile of the row so remote/D-pad navigation stays card-to-card.
  if (more) track.append(h('a', { class: 'card more-card', href: more, role: 'listitem', 'aria-label': `See all ${title}` }, h('span', {}, 'See all'), h('span', { class: 'more-arrow' }, '›')));
  const scroll = (dir) => track.scrollBy({ left: dir * track.clientWidth * 0.85, behavior: 'smooth' });
  return h('section', { class: 'row', dataset: { row: id } },
    h('div', { class: 'row-head' }, h('h2', { class: 'row-title' }, title)),
    h('div', { class: 'row-wrap' },
      h('button', { class: 'row-arrow left', tabindex: '-1', 'aria-label': `Scroll ${title} left`, onclick: () => scroll(-1) }, '‹'),
      track,
      h('button', { class: 'row-arrow right', tabindex: '-1', 'aria-label': `Scroll ${title} right`, onclick: () => scroll(1) }, '›')));
}

export function listButton(item, inList) {
  let on = !!inList;
  const btn = h('button', { class: `btn btn-ghost ${on ? 'on' : ''}`, type: 'button' });
  const paint = () => { btn.textContent = on ? '✓ My List' : '+ My List'; btn.setAttribute('aria-pressed', String(on)); };
  paint();
  btn.addEventListener('click', busy(btn, async () => {
    const path = `/mylist/${item.type}/${item.tmdbId}`;
    if (on) await del(path);
    else await put(path, { title: item.title, poster: item.poster, backdrop: item.backdrop, year: item.year });
    on = !on;
    btn.classList.toggle('on', on);
    paint();
    toast(on ? 'Added to My List' : 'Removed from My List');
  }));
  return btn;
}

export function hero(item) {
  if (!item) return null;
  return h('section', { class: 'hero', style: { backgroundImage: `url("${encodeURI(item.backdrop)}")` } },
    h('div', { class: 'hero-shade' }),
    h('div', { class: 'hero-body' },
      h('p', { class: 'hero-kicker' }, item.type === 'tv' ? 'SERIES' : 'FILM'),
      h('h1', { class: 'hero-title' }, item.title),
      h('p', { class: 'hero-meta' }, [item.year, item.rating ? `★ ${item.rating}` : null].filter(Boolean).join(' · ')),
      item.overview ? h('p', { class: 'hero-overview' }, item.overview) : null,
      h('div', { class: 'btn-row' },
        h('a', { class: 'btn btn-primary btn-lg', href: watchHref(item) }, '▶ Play'),
        h('a', { class: 'btn btn-ghost btn-lg', href: titleHref(item) }, 'ⓘ More info'),
        listButton(item, item.inList))));
}
