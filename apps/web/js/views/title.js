// Movie / series details: backdrop, synopsis, cast, trailer, sources, seasons and episodes.
import { get } from '../api.js';
import { listButton, row, watchHref } from '../components.js';
import { fmtRuntime, fmtTime, h, modal, mount, spinner } from '../ui.js';

const LANG = new Intl.DisplayNames(['en'], { type: 'language' });
const langName = (c) => { try { return c === 'multi' ? 'Multi-audio' : LANG.of(c); } catch { return c; } };

function trailer(key, title) {
  modal(`Trailer: ${title}`, h('div', { class: 'trailer' }, h('iframe', {
    src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(key)}?autoplay=1&rel=0`, title: `Trailer: ${title}`,
    allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowFullscreen: true, referrerPolicy: 'strict-origin-when-cross-origin',
  })), { wide: true });
}

/** Source list (provider, quality, codec, languages, type, compatibility). */
export function sourcesTable(sources, onPick) {
  if (!sources.length) return h('p', { class: 'muted' }, 'No sources found. An administrator can install Stremio add-ons under Add-ons.');
  return h('div', { class: 'sources' }, sources.map((s) => h('button', {
    class: `source ${s.compatible ? '' : 'incompatible'}`, disabled: !s.compatible, onclick: () => onPick?.(s),
    title: s.reason || s.title,
  },
  h('span', { class: `fmt fmt-${s.format}` }, s.format.toUpperCase()),
  h('span', { class: 'source-main' }, h('strong', {}, s.provider), h('span', { class: 'muted small source-title' }, s.title || '')),
  h('span', { class: 'source-tags' }, [s.quality, s.codec, s.languages.map(langName).join('/'), s.subtitles.length ? `${s.subtitles.length} subs` : '']
    .filter(Boolean).map((t) => h('span', { class: 'tag' }, t))),
  h('span', { class: 'source-note small' }, s.compatible ? (s.reason || 'Plays in MyStream') : s.reason))));
}

function episodeList(type, tmdbId, item, season, resume) {
  const box = h('div', { class: 'episodes' }, spinner());
  get(`/media/tv/${tmdbId}/season/${season}`).then((s) => {
    mount(box, s.episodes.map((e) => {
      const p = e.progress;
      const current = resume && resume.season === season && resume.episode === e.number;
      return h('a', { class: `episode ${current ? 'current' : ''}`, href: watchHref(item, season, e.number) },
        h('div', { class: 'ep-still' },
          e.still ? h('img', { src: e.still, alt: '', loading: 'lazy' }) : null,
          h('span', { class: 'ep-play', 'aria-hidden': 'true' }, '▶'),
          p ? h('div', { class: 'card-progress' }, h('span', { style: { width: `${p.completed ? 100 : Math.min(100, (p.position / (p.duration || 1)) * 100)}%` } })) : null),
        h('div', { class: 'ep-body' },
          h('div', { class: 'ep-head' }, h('strong', {}, `${e.number}. ${e.name}`), h('span', { class: 'muted small' }, [e.runtime ? `${e.runtime}m` : '', e.airDate].filter(Boolean).join(' · '))),
          e.overview ? h('p', { class: 'muted small ep-overview' }, e.overview) : null,
          p && !p.completed ? h('span', { class: 'small accent' }, `Resume at ${fmtTime(p.position)}`) : p?.completed ? h('span', { class: 'small muted' }, 'Watched') : null));
    }));
  }).catch((err) => mount(box, h('p', { class: 'form-error' }, err.message)));
  return box;
}

export async function titleView({ params }) {
  const d = await get(`/media/${params.type}/${params.id}`);
  const item = { key: d.key, type: d.type, tmdbId: d.tmdbId, title: d.title, poster: d.poster, backdrop: d.backdrop, year: d.year };
  const r = d.resume;
  const playLabel = r && !r.completed && r.position > 30
    ? (d.type === 'tv' ? `▶ Resume S${r.season} E${r.episode}` : `▶ Resume ${fmtTime(r.position)}`)
    : (d.type === 'tv' && r ? `▶ Play S${r.season} E${r.completed ? r.episode + 1 : r.episode}` : '▶ Play');
  const playHref = d.type === 'tv' ? watchHref(item, r?.season || d.seasons[0]?.number || 1, r ? (r.completed ? r.episode + 1 : r.episode) : 1) : watchHref(item);

  const srcBox = h('div', {});
  const srcBtn = h('button', { class: 'btn btn-ghost', type: 'button' }, '☰ Sources');
  srcBtn.addEventListener('click', async () => {
    const m = modal('Choose a source', srcBox, { wide: true });
    mount(srcBox, spinner());
    try {
      const q = d.type === 'tv' ? `?season=${r?.season || 1}&episode=${r?.episode || 1}` : '';
      const res = await get(`/media/${d.type}/${d.tmdbId}/streams${q}`);
      mount(srcBox,
        d.type === 'tv' ? h('p', { class: 'muted small' }, `Sources for S${r?.season || 1} E${r?.episode || 1}`) : null,
        sourcesTable(res.sources, (s) => { m.close(); location.hash = `${playHref.slice(1)}${playHref.includes('?') ? '&' : '?'}src=${s.id}`; }),
        res.addons.filter((a) => a.error).map((a) => h('p', { class: 'small form-error' }, `${a.addon}: ${a.error}`)));
    } catch (err) {
      mount(srcBox, h('p', { class: 'form-error' }, err.message));
    }
  });

  const meta = [d.year, d.certification ? h('span', { class: 'cert' }, d.certification) : null, d.runtime ? fmtRuntime(d.runtime) : null,
    d.type === 'tv' ? `${d.seasons.length} season${d.seasons.length === 1 ? '' : 's'}` : null, d.rating ? `★ ${d.rating}` : null].filter(Boolean);
  const metaLine = h('p', { class: 'detail-meta' });
  meta.forEach((m, i) => { if (i) metaLine.append(' · '); metaLine.append(m); });

  let seasonsSection = null;
  if (d.type === 'tv' && d.seasons.length) {
    let current = r?.season && d.seasons.some((s) => s.number === r.season) ? r.season : d.seasons[0].number;
    const host = h('div', {});
    const select = h('select', { 'aria-label': 'Season', class: 'season-select' }, d.seasons.map((s) => h('option', { value: String(s.number) }, `${s.name} (${s.episodes})`)));
    select.value = String(current);
    const draw = () => mount(host, episodeList(d.type, d.tmdbId, item, current, r));
    select.addEventListener('change', () => { current = Number(select.value); draw(); });
    draw();
    seasonsSection = h('section', { class: 'seasons' }, h('div', { class: 'seasons-head' }, h('h2', {}, 'Episodes'), select), host);
  }

  return h('div', { class: 'detail' },
    h('div', { class: 'detail-bg', style: { backgroundImage: d.backdrop ? `url("${encodeURI(d.backdrop)}")` : 'none' } }),
    h('div', { class: 'detail-body' },
      h('div', { class: 'detail-poster' }, d.poster ? h('img', { src: d.poster, alt: '' }) : null),
      h('div', { class: 'detail-info' },
        h('h1', {}, d.title),
        d.tagline ? h('p', { class: 'tagline' }, d.tagline) : null,
        metaLine,
        h('p', { class: 'genres' }, d.genres.join(' · ')),
        h('div', { class: 'btn-row' },
          h('a', { class: 'btn btn-primary btn-lg', href: playHref, autofocus: true }, playLabel),
          d.trailer ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => trailer(d.trailer, d.title) }, '▶ Trailer') : null,
          listButton(item, d.inList), srcBtn),
        h('p', { class: 'overview' }, d.overview),
        h('dl', { class: 'facts' },
          d.cast.length ? [h('dt', {}, 'Cast'), h('dd', {}, d.cast.slice(0, 6).map((c) => c.name).join(', '))] : null,
          d.crew.length ? [h('dt', {}, 'Director / writers'), h('dd', {}, d.crew.map((c) => c.name).join(', '))] : null,
          d.createdBy?.length ? [h('dt', {}, 'Created by'), h('dd', {}, d.createdBy.join(', '))] : null,
          d.spokenLanguages.length ? [h('dt', {}, 'Original audio'), h('dd', {}, d.spokenLanguages.join(', '))] : null,
          [h('dt', {}, 'Audio & subtitles'), h('dd', {}, 'Depend on the source; shown in the player and in Sources')],
          d.nextEpisode ? [h('dt', {}, 'Next episode'), h('dd', {}, `S${d.nextEpisode.season} E${d.nextEpisode.episode} · ${d.nextEpisode.airDate}`)] : null)),
    ),
    seasonsSection,
    d.cast.length ? h('section', { class: 'row cast-row' }, h('div', { class: 'row-head' }, h('h2', { class: 'row-title' }, 'Cast')),
      h('div', { class: 'row-track' }, d.cast.map((c) => h('div', { class: 'cast', tabindex: '0' },
        c.photo ? h('img', { src: c.photo, alt: '', loading: 'lazy' }) : h('div', { class: 'cast-ph' }, c.name.slice(0, 1)),
        h('strong', {}, c.name), h('span', { class: 'muted small' }, c.character))))) : null,
    d.recommendations.length ? row('More like this', d.recommendations) : null,
    d.similar.length ? row('You might also like', d.similar) : null);
}
