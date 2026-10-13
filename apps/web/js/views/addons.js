// Stremio add-on manager (administrators).
import { del, get, patch, post } from '../api.js';
import { card, row } from '../components.js';
import { busy, emptyState, h, mount, toast } from '../ui.js';
import { accessPicker } from '../access.js';

export async function addonsView({ state }) {
  if (state.user.role !== 'admin') return emptyState('Administrators only', 'Ask the household administrator to manage add-ons.');
  const list = h('div', { class: 'addon-list' });
  const catalogs = h('div', {});
  const url = h('input', { type: 'url', placeholder: 'https://example.com/manifest.json', required: true, 'aria-label': 'Add-on manifest URL' });
  const install = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Install');
  const form = h('form', { class: 'addon-form', onsubmit: (e) => e.preventDefault() }, url, install);

  const load = async () => {
    const [addons, users] = await Promise.all([get('/addons'), get('/users')]);
    mount(list, addons.length ? addons.map((a, i) => {
      const toggle = h('button', { class: `btn btn-small ${a.enabled ? '' : 'btn-ghost'}` }, a.enabled ? 'Enabled' : 'Disabled');
      toggle.addEventListener('click', busy(toggle, async () => { await patch(`/addons/${a.id}`, { enabled: !a.enabled }); await load(); }));
      const check = h('button', { class: 'btn btn-small btn-ghost' }, 'Check');
      check.addEventListener('click', busy(check, async () => {
        const hlt = await post(`/addons/${a.id}/check`);
        toast(hlt.ok ? `${a.name} is healthy (${hlt.ms} ms)` : `${a.name}: ${hlt.error}`, hlt.ok ? 'info' : 'error');
        await load();
      }));
      const up = h('button', { class: 'btn btn-small btn-ghost', disabled: i === 0, 'aria-label': `Move ${a.name} up` }, '↑');
      up.addEventListener('click', busy(up, async () => {
        await patch(`/addons/${a.id}`, { priority: addons[i - 1].priority - 1 });
        await load();
      }));
      const rm = h('button', { class: 'btn btn-small btn-danger' }, 'Remove');
      rm.addEventListener('click', busy(rm, async () => {
        if (!confirm(`Remove ${a.name}?`)) return;
        await del(`/addons/${a.id}`);
        await load();
      }));
      return h('div', { class: 'addon' },
        a.logo ? h('img', { src: a.logo, alt: '', class: 'addon-logo', referrerPolicy: 'no-referrer' }) : h('div', { class: 'addon-logo ph' }, a.name.slice(0, 1)),
        h('div', { class: 'addon-body' },
          h('strong', {}, a.name, h('span', { class: 'muted small' }, ` v${a.version} · ${a.host}`)),
          h('p', { class: 'muted small' }, a.description || ''),
          h('p', { class: 'small' }, `Provides: ${a.resources.join(', ')} · Types: ${a.types.join(', ')}`,
            a.p2p ? h('span', { class: 'tag warn' }, 'P2P / torrent results are not playable in MyStream') : null),
          a.health ? h('p', { class: `small ${a.health.ok ? 'ok' : 'form-error'}` }, a.health.ok ? `Healthy${a.health.ms ? ` · ${a.health.ms} ms` : ''}` : `Last error: ${a.health.error}`) : null,
          accessPicker(a.access, users, (acc) => patch(`/addons/${a.id}`, { access: acc }).then(() => toast(`Access for ${a.name} saved`)).catch((e) => toast(e.message, 'error')))),
        h('div', { class: 'addon-actions' }, up, toggle, check, rm));
    }) : emptyState('No add-ons yet', 'Paste the manifest URL of a Stremio-compatible add-on that provides direct video links.'));

    // Add-on catalogues as rows (mapped to TMDB titles).
    mount(catalogs);
    for (const a of addons.filter((x) => x.enabled)) {
      for (const c of a.catalogs.slice(0, 4)) {
        get(`/addons/${a.id}/catalog/${c.type}/${encodeURIComponent(c.id)}`)
          .then((r) => { if (r.items.length) catalogs.append(row(`${a.name}: ${c.name}`, r.items, { render: (x) => card(x) })); })
          .catch(() => {});
      }
    }
  };

  install.addEventListener('click', busy(install, async () => {
    if (!form.reportValidity()) return;
    const a = await post('/addons', { url: url.value.trim() });
    toast(`Installed ${a.name}`);
    url.value = '';
    await load();
  }));
  await load();
  return h('div', { class: 'page narrow' },
    h('h1', { class: 'page-title' }, 'Add-ons'),
    h('p', { class: 'muted' }, 'Install Stremio-compatible add-ons by their manifest URL. MyStream asks enabled add-ons for streams and subtitles when you press Play. Results are checked for compatibility: direct HLS, DASH and MP4 links play in MyStream; torrent results and links that need special headers are listed but not played. Only use sources you have the right to watch.'),
    form, list,
    h('h2', { class: 'section-title' }, 'Add-on catalogues'), catalogs);
}
