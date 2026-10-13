import { post } from '../api.js';
import { h } from '../ui.js';

export async function loginView({ onSignedIn }) {
  const user = h('input', { name: 'username', autocomplete: 'username', required: true, autofocus: true, 'aria-label': 'Username', placeholder: 'Username' });
  const pass = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true, 'aria-label': 'Password', placeholder: 'Password' });
  const err = h('p', { class: 'form-error', role: 'alert' });
  const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Sign in');
  const form = h('form', { class: 'auth-card', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    btn.disabled = true;
    try {
      await post('/auth/login', { username: user.value.trim(), password: pass.value });
      onSignedIn();
    } catch (ex) {
      err.textContent = ex.message;
      pass.select();
    } finally {
      btn.disabled = false;
    }
  } },
  h('div', { class: 'logo big' }, 'MyStream'),
  h('h1', {}, 'Sign in'),
  h('label', {}, h('span', {}, 'Username'), user),
  h('label', {}, h('span', {}, 'Password'), pass),
  err, btn,
  h('p', { class: 'muted small' }, 'First run? The administrator password is ADMIN_BOOTSTRAP_PASSWORD from .env, or the one written to data/initial-admin-password.txt.'));
  return h('div', { class: 'auth-page' }, form);
}
