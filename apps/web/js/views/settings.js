// Settings: profile playback preferences; admin: sources, failover, accounts, password.
import { del, get, patch, post, put } from '../api.js';
import { signOut } from '../app.js';
import { busy, h, modal, mount, toast } from '../ui.js';
import { toPattern } from '../access.js';

const LANGS = [['', 'Off / source default'], ['en', 'English'], ['ar', 'Arabic'], ['fr', 'French'], ['es', 'Spanish'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['tr', 'Turkish'], ['hi', 'Hindi'], ['ja', 'Japanese'], ['ko', 'Korean'], ['ru', 'Russian'], ['nl', 'Dutch'], ['pl', 'Polish']];
const FORMAT_LABEL = { hls: 'HLS (.m3u8)', dash: 'DASH (.mpd)', mp4: 'MP4', webm: 'WebM', mkv: 'MKV (codec-dependent)', embed: 'Embedded players (third-party pages)' };

const select = (label, options, value) => {
  const s = h('select', { 'aria-label': label }, options.map(([v, t]) => h('option', { value: v }, t)));
  s.value = value ?? '';
  return s;
};

export async function settingsView({ state }) {
  const p = state.profile;
  const isAdmin = state.user.role === 'admin';
  const audio = select('Preferred audio language', LANGS, p.audioLang);
  const subs = select('Preferred subtitle language', LANGS, p.subtitleLang);
  const size = select('Subtitle size', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'], ['xl', 'Extra large']], p.subtitleStyle?.size || 'medium');
  const bg = select('Subtitle background', [['shadow', 'Outline/shadow'], ['box', 'Dark box'], ['none', 'None']], p.subtitleStyle?.background || 'shadow');
  const savePrefs = h('button', { class: 'btn btn-primary' }, 'Save preferences');
  savePrefs.addEventListener('click', busy(savePrefs, async () => {
    state.profile = await patch('/profiles/me/preferences', { audioLang: audio.value, subtitleLang: subs.value, subtitleStyle: { size: size.value, background: bg.value } });
    toast('Preferences saved');
  }));

  const sections = [
    h('section', { class: 'panel' }, h('h2', {}, `Playback for ${p.name}`),
      h('div', { class: 'form-grid' },
        h('label', {}, h('span', {}, 'Audio language'), audio),
        h('label', {}, h('span', {}, 'Subtitles'), subs),
        h('label', {}, h('span', {}, 'Subtitle size'), size),
        h('label', {}, h('span', {}, 'Subtitle background'), bg)),
      h('p', { class: 'muted small' }, 'Used when the chosen source offers that language. Sources only list languages they actually contain.'),
      savePrefs),
  ];

  // Password
  const cur = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Current password' });
  const next = h('input', { type: 'password', autocomplete: 'new-password', minLength: 8, 'aria-label': 'New password' });
  const pw = h('button', { class: 'btn' }, 'Change password');
  pw.addEventListener('click', busy(pw, async () => {
    await post('/account/password', { current: cur.value, next: next.value });
    cur.value = ''; next.value = '';
    state.mustChangePassword = false;
    document.querySelector('.temp-pw-banner')?.remove();
    toast('Password changed');
  }));
  sections.push(h('section', { class: 'panel' }, h('h2', {}, `Account: ${state.user.username}`),
    h('div', { class: 'form-grid' }, h('label', {}, h('span', {}, 'Current password'), cur), h('label', {}, h('span', {}, 'New password (8+ characters)'), next)),
    h('div', { class: 'btn-row' }, pw, h('button', { class: 'btn btn-ghost', onclick: signOut }, 'Sign out'))));

  if (isAdmin) {
    const st = await get('/settings');
    let order = [...st.sourceOrder];
    const orderList = h('ol', { class: 'order-list' });
    const drawOrder = () => mount(orderList, order.map((f, i) => h('li', {},
      h('span', {}, FORMAT_LABEL[f] || f),
      h('span', { class: 'btn-row tight' },
        h('button', { class: 'btn btn-small btn-ghost', disabled: i === 0, 'aria-label': `Move ${f} up`, onclick: () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; drawOrder(); } }, '↑'),
        h('button', { class: 'btn btn-small btn-ghost', disabled: i === order.length - 1, 'aria-label': `Move ${f} down`, onclick: () => { [order[i + 1], order[i]] = [order[i], order[i + 1]]; drawOrder(); } }, '↓')))));
    drawOrder();
    const failover = h('input', { type: 'checkbox', checked: st.failover });
    const embedOn = h('input', { type: 'checkbox', checked: st.embedEnabled });
    const saveSrc = h('button', { class: 'btn btn-primary' }, 'Save source settings');
    saveSrc.addEventListener('click', busy(saveSrc, async () => {
      await put('/settings', {
        sourceOrder: order, failover: failover.checked, embedEnabled: embedOn.checked,
      });
      toast('Source settings saved');
    }));
    sections.push(h('section', { class: 'panel' }, h('h2', {}, 'Sources (all profiles)'),
      h('p', { class: 'muted small' }, 'Order in which source types are tried. Within a type, add-on order and quality decide. Torrent sources are never played.'),
      orderList,
      h('label', { class: 'check' }, failover, ' Automatic failover: if a source fails, try the next one'),
      h('label', { class: 'check' }, embedOn, ' Use servers (embedded players, configured below)'),
      saveSrc));
    sections.push(await serversPanel());

    // Accounts
    const users = h('div', {});
    const drawUsers = async () => {
      const list = await get('/users');
      mount(users, list.map((u) => h('div', { class: 'user-row' }, h('span', {}, u.username, h('span', { class: 'muted small' }, ` · ${u.role}`)),
        u.id !== state.user.id ? h('button', { class: 'btn btn-small btn-danger', onclick: async () => {
          if (!confirm(`Delete account ${u.username}?`)) return;
          try { await del(`/users/${u.id}`); drawUsers(); } catch (e) { toast(e.message, 'error'); }
        } }, 'Delete') : null)));
    };
    await drawUsers();
    const nu = h('input', { placeholder: 'username', 'aria-label': 'New username' });
    const np = h('input', { type: 'password', placeholder: 'password (8+)', 'aria-label': 'New account password' });
    const role = select('Role', [['member', 'Family member'], ['admin', 'Administrator']], 'member');
    const add = h('button', { class: 'btn' }, 'Add account');
    add.addEventListener('click', busy(add, async () => {
      await post('/users', { username: nu.value.trim(), password: np.value, role: role.value });
      nu.value = ''; np.value = '';
      toast('Account created');
      await drawUsers();
    }));
    sections.push(h('section', { class: 'panel' }, h('h2', {}, 'Accounts'),
      h('p', { class: 'muted small' }, 'Accounts sign in on a device; family members then pick their profile. Only administrators manage add-ons, profiles and settings.'),
      users, h('div', { class: 'form-inline' }, nu, np, role, add)));
  }

  const health = await get('/health');
  if (window.MyStreamAndroid) {
    sections.push(h('section', { class: 'panel' }, h('h2', {}, 'This device'),
      h('p', { class: 'muted small' }, `Connected to ${location.origin}`),
      h('button', { class: 'btn', onclick: () => window.MyStreamAndroid.changeServer() }, 'Change server')));
  }
  sections.push(h('section', { class: 'panel' }, h('h2', {}, 'About'),
    h('p', { class: 'small muted' }, `MyStream ${health.version} · TMDB ${health.tmdb ? 'configured' : 'NOT configured'} · ${health.addons} add-on(s) enabled · Torrent engine: not available`),
    h('p', { class: 'small muted' }, 'This product uses the TMDB API but is not endorsed or certified by TMDB.')));
  return h('div', { class: 'page narrow' }, h('h1', { class: 'page-title' }, 'Settings'), sections);
}

// ---------------------------------------------------------------- server management (admin)
const isManifest = (u) => /^stremio:\/\//i.test(u.trim()) || /manifest\.json(\?|$)/i.test(u.trim());

function sharedOf(access) {
  return (access?.mode || 'all') === 'all';
}

function statusText(item) {
  const hl = item.health;
  if (!hl) return { text: 'Not tested yet', cls: 'muted' };
  const when = hl.checkedAt ? new Date(hl.checkedAt).toLocaleString() : '';
  if (item.kind === 'stremio') {
    return hl.ok ? { text: `Add-on responding${hl.ms ? ` (${hl.ms} ms)` : ''} · ${when}`, cls: 'ok' } : { text: `Add-on error: ${hl.error} · ${when}`, cls: 'form-error' };
  }
  const cls = hl.status === 'reachable' ? 'ok' : hl.status === 'redirected' || hl.status === 'challenge' ? 'warn' : 'form-error';
  return { text: `${hl.label}${hl.ms ? ` · ${hl.ms} ms` : ''} · ${when}`, cls };
}

async function serversPanel() {
  const panel = h('section', { class: 'panel', id: 'servers' });
  const draw = async () => {
    const [mgmt, users] = await Promise.all([get('/server-management'), get('/users')]);
    const items = mgmt.items;
    const keys = items.map((i) => i.key);
    const saveOrder = async (next) => { await put('/server-management/order', { keys: next }); await draw(); };
    const api = (it) => (it.kind === 'stremio' ? `/addons/${it.id}` : `/servers/${it.id}`);
    const row = (it, i) => {
      const toggle = (on, label, onChange) => {
        const b = h('button', { class: `switch ${on ? 'on' : ''}`, role: 'switch', 'aria-checked': String(on), 'aria-label': `${it.name}: ${label}` },
          h('span', { class: 'switch-knob' }), h('span', { class: 'switch-label' }, `${label} ${on ? 'On' : 'Off'}`));
        b.addEventListener('click', busy(b, onChange));
        return b;
      };
      const enabled = toggle(it.enabled, 'Enabled', async () => { await patch(api(it), { enabled: !it.enabled }); toast(`${it.name} ${it.enabled ? 'disabled' : 'enabled'}`); await draw(); });
      const shared = sharedOf(it.access);
      const share = toggle(shared, 'Shared', async () => {
        await patch(api(it), { access: shared ? { mode: 'admins' } : { mode: 'all' } });
        toast(shared ? `${it.name} is now private (admins only)` : `${it.name} is shared with everyone`);
        await draw();
      });
      const members = users.filter((u) => u.role !== 'admin');
      const allowed = new Set(it.access?.mode === 'users' ? it.access.userIds : []);
      const allowedBox = !shared ? h('div', { class: 'access-users' },
        h('span', { class: 'muted small' }, members.length ? 'Also allow:' : 'Private: only administrators.'),
        members.map((u) => h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: allowed.has(u.id), onchange: async (e) => {
          if (e.target.checked) allowed.add(u.id); else allowed.delete(u.id);
          try {
            await patch(api(it), { access: allowed.size ? { mode: 'users', userIds: [...allowed] } : { mode: 'admins' } });
            toast(`Access for ${it.name} saved`);
          } catch (err) { toast(err.message, 'error'); }
        } }), ` ${u.username}`))) : null;
      const btn = (label, fn, cls = 'btn btn-small btn-ghost', extra = {}) => { const b = h('button', { class: cls, ...extra }, label); b.addEventListener('click', busy(b, fn)); return b; };
      const up = btn('↑', () => { const k = [...keys]; [k[i - 1], k[i]] = [k[i], k[i - 1]]; return saveOrder(k); }, 'btn btn-small btn-ghost', { disabled: i === 0, 'aria-label': `Move ${it.name} up` });
      const down = btn('↓', () => { const k = [...keys]; [k[i + 1], k[i]] = [k[i], k[i + 1]]; return saveOrder(k); }, 'btn btn-small btn-ghost', { disabled: i === keys.length - 1, 'aria-label': `Move ${it.name} down` });
      const makeDefault = it.isDefault ? null : btn('★ Make default', async () => {
        if (!it.enabled) await patch(api(it), { enabled: true });
        await saveOrder([it.key, ...keys.filter((k) => k !== it.key)]);
        toast(`${it.name} is now the default server`);
      });
      const test = btn('Test', async () => {
        const r = await post(it.kind === 'stremio' ? `/addons/${it.id}/check` : `/servers/${it.id}/check`);
        const ok = it.kind === 'stremio' ? r.ok : r.status === 'reachable';
        toast(it.kind === 'stremio' ? (r.ok ? `${it.name}: add-on responding` : `${it.name}: ${r.error}`) : `${it.name}: ${r.label}`, ok ? 'info' : 'error');
        await draw();
      });
      const edit = it.kind === 'embed' && !it.builtin ? btn('Edit', async () => editServer(it, draw)) : null;
      const remove = (it.kind === 'stremio' || !it.builtin) ? btn('Delete', async () => {
        if (!confirm(`Delete ${it.name}? It will no longer be available to anyone.`)) return;
        await del(api(it));
        toast(`${it.name} deleted`);
        await draw();
      }, 'btn btn-small btn-danger') : null;
      const st = statusText(it);
      return h('div', { class: `server ${it.enabled ? '' : 'off'}` },
        h('div', { class: 'server-main' },
          h('strong', {}, `${i + 1}. ${it.name}`,
            h('span', { class: 'tag' }, it.type), it.builtin ? h('span', { class: 'tag' }, 'built-in') : null,
            it.isDefault ? h('span', { class: 'tag default' }, '★ Default') : null),
          it.kind === 'embed' ? h('span', { class: 'muted small server-url' }, it.movieUrl) : h('span', { class: 'muted small server-url' }, `${it.host} · ${it.resources.join(', ')}`),
          h('span', { class: `small ${st.cls}` }, st.text),
          allowedBox),
        h('div', { class: 'server-actions' }, enabled, share, h('span', { class: 'btn-row tight' }, up, down), makeDefault, test, edit, remove));
    };
    mount(panel,
      h('h2', {}, 'Server Management'),
      h('p', { class: 'muted small' }, 'Playback servers in the order MyStream tries them: the first enabled one is the default, the rest are used for automatic failover. Disabled servers are never offered or used. "Shared" lets every family account use a server; when off, only administrators and the accounts you tick can. TMDB (titles, posters, episodes) is separate and always stays on. "Test" checks that a server answers; it cannot prove a film will play.'),
      addServerForm(draw),
      h('div', { class: 'server-list' }, items.map(row)));
  };
  await draw();
  return panel;
}

function addServerForm(onAdded) {
  const link = h('input', { placeholder: 'Paste a player link (https://…/movie/550) or a Stremio add-on manifest URL', 'aria-label': 'Server link' });
  const name = h('input', { placeholder: 'Name (player links)', maxLength: 40, 'aria-label': 'Server name' });
  const tv = h('input', { placeholder: 'Series link (optional), e.g. https://…/tv/1399/1/1', 'aria-label': 'Series link' });
  const preview = h('p', { class: 'small muted pattern-preview' });
  const update = () => {
    const u = link.value.trim();
    const manifest = isManifest(u);
    name.hidden = manifest;
    tv.hidden = manifest;
    if (!u) preview.textContent = '';
    else if (manifest) preview.textContent = 'Detected: Stremio add-on. MyStream will validate its manifest and ask it for streams and subtitles.';
    else preview.textContent = `Detected: player link → Movies: ${toPattern(u, 'movie')}   ·   Series: ${toPattern(tv.value, 'tv') || 'not supported'}`;
  };
  link.addEventListener('input', update);
  tv.addEventListener('input', update);
  const add = h('button', { class: 'btn btn-primary' }, '+ Add server');
  add.addEventListener('click', busy(add, async () => {
    const u = link.value.trim();
    if (!u) throw new Error('Paste a link first');
    if (isManifest(u)) {
      const a = await post('/addons', { url: u });
      toast(`Installed ${a.name}. It is enabled and shared; change that below.`);
    } else {
      const s = await post('/servers', { name: name.value || new URL(u).hostname, movieUrl: toPattern(u, 'movie'), tvUrl: toPattern(tv.value, 'tv') });
      toast(`Added ${s.name}. Press Test to check it answers.`);
    }
    link.value = ''; name.value = ''; tv.value = ''; update();
    await onAdded();
  }));
  return h('div', { class: 'add-server' }, h('h3', {}, 'Add a server'),
    h('div', { class: 'form-grid' }, link, name, tv), preview, add);
}

function editServer(it, onSaved) {
  const name = h('input', { value: it.name, maxLength: 40, 'aria-label': 'Name' });
  const movie = h('input', { value: it.movieUrl, 'aria-label': 'Movie link pattern' });
  const tv = h('input', { value: it.tvUrl || '', 'aria-label': 'Series link pattern' });
  const save = h('button', { class: 'btn btn-primary' }, 'Save');
  const m = modal(`Edit ${it.name}`, h('div', { class: 'stack' },
    h('label', {}, h('span', {}, 'Name'), name),
    h('label', {}, h('span', {}, 'Movie link ({tmdb} or {imdb})'), movie),
    h('label', {}, h('span', {}, 'Series link ({tmdb}/{imdb}, {season}, {episode}); empty = movies only'), tv),
    save));
  save.addEventListener('click', busy(save, async () => {
    await patch(`/servers/${it.id}`, { name: name.value, movieUrl: toPattern(movie.value, 'movie'), tvUrl: toPattern(tv.value, 'tv') });
    toast(`${name.value} saved`);
    m.close();
    await onSaved();
  }));
}
