'use strict';
const f = document.getElementById('f');
const err = document.getElementById('err');
const tmdb = document.getElementById('tmdb');
const url = document.getElementById('url');

function sync() {
  const remote = f.mode.value === 'remote';
  document.getElementById('urlRow').hidden = !remote;
  document.getElementById('keyRow').hidden = remote;
  document.getElementById('shareRow').hidden = remote;
}

window.mystreamDesktop.getSettings().then((s) => {
  f.mode.value = s.mode;
  url.value = s.remoteUrl || '';
  if (!s.hasTmdbKey) tmdb.placeholder = 'Paste your TMDB API key';
  document.getElementById('shareLan').checked = s.shareLan;
  document.getElementById('port').value = s.port || '';
  document.getElementById('lan').textContent = s.lanUrls.length
    ? `On other devices open: ${s.lanUrls.join('  or  ')}` : (s.shareLan ? 'Sharing turns on after Save and restart.' : '');
  sync();
});
f.addEventListener('change', sync);
f.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  const r = await window.mystreamDesktop.saveSettings({
    mode: f.mode.value, remoteUrl: url.value, tmdbKey: tmdb.value,
    shareLan: document.getElementById('shareLan').checked, port: document.getElementById('port').value,
  });
  if (r && !r.ok) err.textContent = r.error;
});

const reset = document.getElementById('reset');
const resetMsg = document.getElementById('resetMsg');
reset.addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await window.mystreamDesktop.resetAdmin(document.getElementById('newpw').value);
  resetMsg.textContent = r.ok ? `Password for ${r.username} changed. Sign in with the new password.` : r.error;
  resetMsg.className = r.ok ? 'ok' : 'err';
  if (r.ok) document.getElementById('newpw').value = '';
});
