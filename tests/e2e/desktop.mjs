// Launch test for the PACKAGED desktop app (Linux build) under Xvfb using
// Playwright's Electron driver. Verifies: entry file + backend start from the
// package, sign-in, real playback, pop-up/redirect guard, ad-host blocking,
// and graceful shutdown.
//   xvfb-run -a node tests/e2e/desktop.mjs dist/MyStream-12.1.0-linux-x64/mystream
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startMocks } from '../fixtures/mock-servers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(HERE, 'artifacts');
fs.mkdirSync(ART, { recursive: true });
const exe = path.resolve(process.argv[2] || 'dist/MyStream-12.1.0-linux-x64/mystream');
const pwPath = process.env.PLAYWRIGHT_MODULE || '/opt/npm-tools/node_modules/playwright/index.mjs';
const { _electron: electron } = await import(fs.existsSync(pwPath) ? pathToFileURL(pwPath).href : 'playwright');

const mocks = await startMocks();
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mystream-desktop-'));
// The app only frames https:// pages, so the hostile test page is served over
// HTTPS with a throwaway self-signed certificate (Electron runs with
// --ignore-certificate-errors for this test only).
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
  '-keyout', path.join(home, 'k.pem'), '-out', path.join(home, 'c.pem')], { stdio: 'ignore' });
const evilHtml = await (await fetch(`${mocks.base}/evil.html`)).text();
const evil = https.createServer({ key: fs.readFileSync(path.join(home, 'k.pem')), cert: fs.readFileSync(path.join(home, 'c.pem')) },
  (_q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(evilHtml); });
await new Promise((r) => evil.listen(0, '127.0.0.1', r));
const evilUrl = `https://127.0.0.1:${evil.address().port}/evil.html`;
const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); console.log(`  ✔ ${name}`); }
  catch (err) { results.push({ name, ok: false, error: err.message }); console.log(`  ✘ ${name}\n      ${err.message}`); }
};

console.log(`Launching ${exe}`);
const t0 = Date.now();
const app = await electron.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--ignore-certificate-errors'], // container runs as root; the .deb sets up chrome-sandbox for normal users
  env: {
    ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), MYSTREAM_SELFTEST: '1',
    TMDB_API_KEY: 'test-key', TMDB_BASE_URL: mocks.tmdbUrl, TMDB_IMAGE_BASE: mocks.imgBase,
    ADMIN_BOOTSTRAP_PASSWORD: 'desk-pass-1', ADDON_ALLOW_PRIVATE: 'true', LOG_LEVEL: 'info',
  },
  timeout: 60000,
});
const lines = [];
app.process().stdout.on('data', (d) => lines.push(...d.toString().split('\n').filter(Boolean)));
const win = await app.firstWindow();
const base = new URL(win.url()).origin;

await step('Packaged app starts its backend and shows the sign-in page', async () => {
  await win.waitForSelector('form.auth-card', { timeout: 30000 });
  assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
  console.log(`      started in ${Date.now() - t0} ms at ${base}`);
  const pkg = await app.evaluate(({ app: a }) => ({ name: a.getName(), packaged: a.isPackaged, version: a.getVersion() }));
  assert.equal(pkg.packaged, true);
  assert.equal(pkg.version, JSON.parse(fs.readFileSync(path.join(HERE, '../../package.json'), 'utf8')).version);
  await win.screenshot({ path: path.join(ART, 'desktop-01-login.png') });
});

await step('Sign in, choose profile, install add-on', async () => {
  await win.fill('input[name=username]', 'admin');
  await win.fill('input[name=password]', 'desk-pass-1');
  await win.click('button[type=submit]');
  await win.click('.profile >> nth=0');
  await win.waitForSelector('.row .card');
  const r = await win.evaluate(async (url) => (await fetch('/api/addons', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MyStream': '1' }, body: JSON.stringify({ url }) })).status, mocks.addonUrl);
  assert.equal(r, 200);
});

await step('Browser-like user agent (no Electron/app token) for embedded players', async () => {
  const ua = await win.evaluate(() => navigator.userAgent);
  assert.doesNotMatch(ua, /Electron|MyStream/i, ua);
  assert.match(ua, /Chrome\/\d+/);
});

await step('Video plays in the desktop player (HLS)', async () => {
  await win.evaluate(() => { location.hash = '#/watch/movie/550'; });
  await win.waitForFunction(() => { const v = document.querySelector('video'); return v && !v.paused && v.currentTime > 1.5; }, null, { timeout: 30000 });
  await win.screenshot({ path: path.join(ART, 'desktop-02-player.png') });
});

await step('Pop-ups and redirects from embedded pages are blocked', async () => {
  await win.evaluate((src) => {
    const f = document.createElement('iframe');
    f.src = src;
    f.id = 'evil';
    Object.assign(f.style, { position: 'fixed', top: '0', left: '0', width: '400px', height: '200px', zIndex: '999', background: '#fff' });
    document.body.append(f);
  }, evilUrl);
  await win.frameLocator('#evil').locator('#play').click(); // real click = user activation
  await win.waitForTimeout(1500);
  assert.equal(app.windows().length, 1, 'no new window opened');
  assert.equal(new URL(win.url()).origin, base, 'main window still on MyStream');
  const own = await win.evaluate(() => window.open('https://example.org/'));
  assert.equal(own, null);
  assert.ok(lines.some((l) => l.includes('[guard] blocked window.open https://ads.example.org/popup')), 'guard logged the pop-up');
  assert.ok(lines.some((l) => l.includes('[guard] blocked navigation https://ads.example.org/hijack')), 'guard logged the redirect');
});

await step('Known ad/tracker hosts are blocked by the app', async () => {
  const err = await app.evaluate(async ({ session }) => {
    try { await session.defaultSession.fetch('https://doubleclick.net/pixel.gif'); return 'loaded'; } catch (e) { return String(e.message || e); }
  });
  assert.match(err, /ERR_BLOCKED_BY_CLIENT/);
});

await step('Reset admin password from the setup window (and only from there)', async () => {
  const denied = await win.evaluate(() => window.mystreamDesktop.resetAdmin('Hacked12345'));
  assert.equal(denied.ok, false, 'main window may not reset passwords');
  const setupPromise = app.waitForEvent('window');
  await win.evaluate(() => window.mystreamDesktop.openSetup());
  const setup = await setupPromise;
  await setup.waitForSelector('#newpw');
  await setup.fill('#newpw', 'Passw0rd');
  await setup.click('#reset button');
  await setup.waitForSelector('#resetMsg.ok');
  await setup.screenshot({ path: path.join(ART, 'desktop-03-setup-reset.png') });
  await setup.close();
  await win.waitForSelector('form.auth-card', { timeout: 15000 });
  await win.fill('input[name=username]', 'admin');
  await win.fill('input[name=password]', 'Passw0rd');
  await win.click('button[type=submit]');
  await win.waitForSelector('.who');
});

await step('Graceful shutdown saves data', async () => {
  await app.close();
  const store = path.join(home, '.config', 'MyStream', 'data', 'mystream.json');
  assert.ok(fs.existsSync(store), 'data file written in the user profile');
  assert.equal(JSON.parse(fs.readFileSync(store, 'utf8')).addons.length, 1);
});

await step('Share on my network: PC hosts MyStream for phones/TVs on the LAN', async () => {
  // Free port for the shared server
  const port = await new Promise((r) => { const s = net.createServer().listen(0, '0.0.0.0', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const cfgFile = path.join(home, '.config', 'MyStream', 'desktop.json');
  fs.writeFileSync(cfgFile, JSON.stringify({ ...JSON.parse(fs.existsSync(cfgFile) ? fs.readFileSync(cfgFile, 'utf8') : '{}'), shareLan: true, port }));
  const app2 = await electron.launch({
    executablePath: exe, args: ['--no-sandbox'],
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), MYSTREAM_SELFTEST: '1',
      TMDB_API_KEY: 'test-key', TMDB_BASE_URL: mocks.tmdbUrl, TMDB_IMAGE_BASE: mocks.imgBase, ADDON_ALLOW_PRIVATE: 'true' },
    timeout: 60000,
  });
  try {
    const w = await app2.firstWindow();
    await w.waitForSelector('form.auth-card', { timeout: 30000 });
    assert.equal(new URL(w.url()).port, String(port), 'fixed port when sharing');
    // Reachable from another device: use the machine's LAN address, not loopback.
    const lan = Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal);
    assert.ok(lan, 'this machine has a LAN IPv4 address');
    const health = await (await fetch(`http://${lan.address}:${port}/api/health`)).json();
    assert.equal(health.ok, true);
    // A temporary admin password (set by the reset in the previous step) must be changed
    // before anything else works over the network.
    const lr = await fetch(`http://${lan.address}:${port}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MyStream': '1' }, body: JSON.stringify({ username: 'admin', password: 'Passw0rd' }) });
    assert.equal(lr.status, 200);
    const cookie = lr.headers.get('set-cookie').split(';')[0];
    const H = { cookie, 'X-MyStream': '1', 'Content-Type': 'application/json' };
    const pr = await fetch(`http://${lan.address}:${port}/api/users`, { headers: H });
    assert.equal(pr.status, 403, 'blocked until the temporary password is changed');
    assert.match(await pr.text(), /must_change_password/);
    const ch = await fetch(`http://${lan.address}:${port}/api/account/password`, { method: 'POST', headers: H, body: JSON.stringify({ current: 'Passw0rd', next: 'Family-Strong-2026' }) });
    assert.equal(ch.status, 200, await ch.text());
    const ok = await fetch(`http://${lan.address}:${port}/api/users`, { headers: H });
    assert.equal(ok.status, 200, 'works after the password is changed');
    // The setup window shows the addresses to type on the TV/phone.
    const setupPromise = app2.waitForEvent('window');
    await w.evaluate(() => window.mystreamDesktop.openSetup());
    const setup = await setupPromise;
    await setup.waitForFunction((p) => document.getElementById('lan').textContent.includes(':' + p), port);
    assert.equal(await setup.isChecked('#shareLan'), true);
    console.log('      ' + (await setup.textContent('#lan')));
    await setup.screenshot({ path: path.join(ART, 'desktop-04-share-lan.png') });
  } finally {
    await app2.close();
  }
});

evil.close();
await mocks.close();
fs.rmSync(home, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok).length;
fs.writeFileSync(path.join(ART, 'desktop-results.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed}/${results.length} desktop checks passed`);
process.exit(failed ? 1 : 0);
