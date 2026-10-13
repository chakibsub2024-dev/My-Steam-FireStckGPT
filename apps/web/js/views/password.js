// Change-password form; shown full-screen when a temporary password must be replaced.
import { post } from '../api.js';
import { h } from '../ui.js';

export function changePasswordView({ forced = false, onDone }) {
  const cur = h('input', { type: 'password', autocomplete: 'current-password', required: true, autofocus: true, 'aria-label': 'Current password' });
  const next = h('input', { type: 'password', autocomplete: 'new-password', required: true, minLength: 8, 'aria-label': 'New password' });
  const again = h('input', { type: 'password', autocomplete: 'new-password', required: true, minLength: 8, 'aria-label': 'Repeat new password' });
  const err = h('p', { class: 'form-error', role: 'alert' });
  const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Change password');
  return h('div', { class: 'auth-page' }, h('form', { class: 'auth-card', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (next.value !== again.value) { err.textContent = 'The new passwords do not match'; return; }
    btn.disabled = true;
    try {
      await post('/account/password', { current: cur.value, next: next.value });
      onDone?.();
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  } },
  h('div', { class: 'logo big' }, 'MyStream'),
  h('h1', {}, forced ? 'Choose a new password' : 'Change password'),
  forced ? h('p', { class: 'muted small' }, 'This account still uses its temporary password and MyStream is reachable from other devices. Choose a new password to continue.') : null,
  h('label', {}, h('span', {}, 'Current (temporary) password'), cur),
  h('label', {}, h('span', {}, 'New password (8+ characters)'), next),
  h('label', {}, h('span', {}, 'Repeat new password'), again),
  err, btn));
}
