// "Who's watching?" profile picker, with PIN entry and (admin) profile management.
import { del, get, patch, post } from '../api.js';
import { avatarColor, busy, h, modal, mount, toast } from '../ui.js';
import { signOut } from '../app.js';

const AVATARS = ['red', 'blue', 'green', 'yellow', 'purple', 'teal', 'orange', 'pink'];

export function profileForm(existing, onSaved) {
  const name = h('input', { value: existing?.name || '', maxLength: 24, required: true, autofocus: true, 'aria-label': 'Name' });
  let avatar = existing?.avatar || 'blue';
  const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Avatar colour' });
  const paint = () => mount(swatches, AVATARS.map((a) => h('button', {
    type: 'button', class: `swatch ${a === avatar ? 'on' : ''}`, role: 'radio', 'aria-checked': String(a === avatar), 'aria-label': a,
    style: { background: avatarColor(a) }, onclick: () => { avatar = a; paint(); },
  })));
  paint();
  const kids = h('input', { type: 'checkbox', checked: !!existing?.kids });
  const rating = h('select', { 'aria-label': 'Maximum rating' }, ['U', 'PG', '12A', '12', '15'].map((r) => h('option', { value: r }, `Up to ${r}`)));
  rating.value = existing?.maxRating || 'PG';
  const pin = h('input', { inputMode: 'numeric', pattern: '\\d{4}', maxLength: 4, placeholder: existing?.hasPin ? '•••• (unchanged)' : 'No PIN', 'aria-label': 'PIN' });
  const removePin = existing?.hasPin ? h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'removePin' }), ' Remove PIN') : null;
  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save');
  const form = h('form', { class: 'stack', onsubmit: (e) => e.preventDefault() },
    h('label', {}, h('span', {}, 'Name'), name),
    h('div', {}, h('span', { class: 'label' }, 'Avatar'), swatches),
    h('label', { class: 'check' }, kids, ' Kids profile (filters titles by rating)'),
    h('label', {}, h('span', {}, 'Maximum rating for kids'), rating),
    h('label', {}, h('span', {}, '4-digit PIN (optional)'), pin), removePin,
    h('div', { class: 'btn-row' }, save));
  save.addEventListener('click', busy(save, async () => {
    if (!form.reportValidity()) return;
    const body = { name: name.value, avatar, kids: kids.checked, maxRating: kids.checked ? rating.value : null };
    if (pin.value) body.pin = pin.value;
    if (removePin?.querySelector('input').checked) body.pin = null;
    const saved = existing ? await patch(`/profiles/${existing.id}`, body) : await post('/profiles', body);
    onSaved(saved);
  }));
  return form;
}

function askPin(profile) {
  return new Promise((resolve) => {
    const input = h('input', { inputMode: 'numeric', type: 'password', maxLength: 4, pattern: '\\d{4}', autofocus: true, class: 'pin-input', 'aria-label': 'PIN', autocomplete: 'off' });
    const err = h('p', { class: 'form-error', role: 'alert' });
    let done = false;
    const m = modal(`Enter PIN for ${profile.name}`, h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      try {
        const p = await post(`/profiles/${profile.id}/select`, { pin: input.value });
        done = true;
        m.close();
        resolve(p);
      } catch (ex) {
        err.textContent = ex.message;
        input.value = '';
      }
    } }, input, err, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Continue')), { onClose: () => { if (!done) resolve(null); } });
  });
}

export async function profilesView({ state, onChosen }) {
  let profiles = await get('/profiles');
  const isAdmin = state.user.role === 'admin';
  let managing = false;
  const grid = h('div', { class: 'profiles' });
  const choose = async (p) => {
    try {
      const chosen = p.hasPin ? await askPin(p) : await post(`/profiles/${p.id}/select`, {});
      if (chosen) onChosen(chosen);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const edit = (p) => {
    const m = modal(p ? `Edit ${p.name}` : 'Add profile', h('div', {},
      profileForm(p, async () => { m.close(); await refresh(); }),
      p ? h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => {
        if (!confirm(`Delete ${p.name} and its My List and history?`)) return;
        try { await del(`/profiles/${p.id}`); m.close(); await refresh(); } catch (e) { toast(e.message, 'error'); }
      } }, 'Delete profile') : null));
  };
  const draw = () => mount(grid,
    profiles.map((p) => h('button', { class: `profile ${managing ? 'managing' : ''}`, onclick: () => (managing ? edit(p) : choose(p)) },
      h('span', { class: 'avatar xl', style: { background: avatarColor(p.avatar) } }, p.name.slice(0, 1).toUpperCase(), managing ? h('span', { class: 'edit-badge' }, '✎') : null),
      h('span', { class: 'profile-name' }, p.name),
      h('span', { class: 'profile-tags' }, [p.kids ? 'Kids' : null, p.hasPin ? '🔒' : null].filter(Boolean).join(' · ')))),
    isAdmin && profiles.length < 8 ? h('button', { class: 'profile add', onclick: () => edit(null) }, h('span', { class: 'avatar xl add' }, '+'), h('span', { class: 'profile-name' }, 'Add profile')) : null);
  const refresh = async () => { profiles = await get('/profiles'); draw(); };
  draw();
  const manageBtn = isAdmin ? h('button', { class: 'btn btn-ghost', onclick: () => { managing = !managing; manageBtn.textContent = managing ? 'Done' : 'Manage profiles'; draw(); } }, 'Manage profiles') : null;
  return h('div', { class: 'who' },
    h('div', { class: 'logo big' }, 'MyStream'),
    h('h1', {}, managing ? 'Manage profiles' : 'Who\'s watching?'),
    grid,
    h('div', { class: 'btn-row center' }, manageBtn, h('button', { class: 'btn btn-ghost', onclick: signOut }, 'Sign out')));
}
