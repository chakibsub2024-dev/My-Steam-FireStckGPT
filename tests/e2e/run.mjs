// End-to-end test: real backend + web app + mock TMDB/add-on, driven in Chromium.
// Usage: node tests/e2e/run.mjs   (needs Playwright; set PLAYWRIGHT_MODULE to its path if not resolvable)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApp } from '../../services/api/src/app.js';
import { loadConfig } from '../../services/api/src/config.js';
import { startMocks } from '../fixtures/mock-servers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(HERE, 'artifacts');
fs.mkdirSync(ART, { recursive: true });
const pwPath = process.env.PLAYWRIGHT_MODULE || '/opt/npm-tools/node_modules/playwright/index.mjs';
const { chromium } = await import(fs.existsSync(pwPath) ? pathToFileURL(pwPath).href : 'playwright');

const results = [];
async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✔ ${name} (${Date.now() - t0} ms)`);
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
    console.log(`  ✘ ${name}\n      ${err.message.split('\n').join('\n      ')}`);
    await page?.screenshot({ path: path.join(ART, `FAIL-${name.replace(/\W+/g, '_')}.png`) }).catch(() => {});
  }
}

const quiet = { debug() {}, info() {}, warn() {}, error: (m, f) => console.error('[server]', m, f?.error || '') };
const mocks = await startMocks();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mystream-e2e-'));
const app = createApp(loadConfig({
  APP_ENV: 'test', MYSTREAM_DATA_DIR: dataDir, TMDB_API_KEY: 'test-key', TMDB_BASE_URL: mocks.tmdbUrl, TMDB_IMAGE_BASE: mocks.imgBase,
  ADMIN_BOOTSTRAP_PASSWORD: 'admin-pass-1', ADDON_ALLOW_PRIVATE: 'true', STREAM_TIMEOUT_MS: '4000',
}), { log: quiet });
const addr = await app.listen(0, '127.0.0.1');
const BASE = `http://127.0.0.1:${addr.port}`;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
// Embedded third-party players are not contacted in tests.
await ctx.route(/vidking|videasy|vsembed|vidsrc\.sh|youtube/, (r) => r.fulfill({ contentType: 'text/html', body: `<body style="background:#222;color:#fff;font:24px sans-serif;display:grid;place-items:center;height:100vh">Embedded player stub: ${new URL(r.request().url()).host}</body>` }));
let page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
const shot = (n) => page.screenshot({ path: path.join(ART, `${n}.png`) });

async function waitPlaying(minTime = 1.5, timeout = 20000) {
  await page.waitForFunction((t) => { const v = document.querySelector('video'); return v && !v.paused && v.currentTime > t && v.readyState >= 3; }, minTime, { timeout });
}

console.log(`MyStream e2e against ${BASE}`);

await step('Sign-in page and wrong password message', async () => {
  await page.goto(BASE + '/');
  await page.waitForSelector('form.auth-card');
  await page.fill('input[name=username]', 'admin');
  await page.fill('input[name=password]', 'wrong');
  await page.click('button[type=submit]');
  await page.waitForSelector('.form-error:text("Wrong username or password")');
  await shot('01-login');
});

await step('Sign in and pick a profile', async () => {
  await page.fill('input[name=password]', 'admin-pass-1');
  await page.click('button[type=submit]');
  await page.waitForSelector('.who');
  await shot('02-profiles');
  await page.click('.profile >> nth=0');
  await page.waitForSelector('.hero');
});

await step('Home: hero banner and catalogue rows', async () => {
  await page.waitForSelector('.row .card');
  const rows = await page.$$eval('.row-title', (els) => els.map((e) => e.textContent));
  for (const r of ['Trending Now', 'Popular Movies', 'Popular Series', 'Documentaries', 'Anime']) assert.ok(rows.includes(r), `row ${r} missing (have: ${rows.join(', ')})`);
  await page.waitForFunction(() => [...document.querySelectorAll('.poster img')].some((i) => i.complete && i.naturalWidth > 0));
  await shot('03-home');
});

await step('Install the Stremio add-on from the Add-ons page', async () => {
  await page.click('.mainnav >> text=Add-ons');
  await page.fill('input[type=url]', mocks.addonUrl);
  await page.click('button:text("Install")');
  await page.waitForSelector('.addon strong:has-text("Test Add-on")');
  await page.waitForSelector('.row-title:has-text("Test Add-on: Test Picks")');
  await shot('04-addons');
});

await step('Search finds a series', async () => {
  await page.goto(BASE + '/#/search?q=robots');
  await page.waitForSelector('.grid .card:has-text("Tiny Robots")');
});

await step('Movie details: cast, trailer button, sources list with compatibility', async () => {
  await page.goto(BASE + '/#/title/movie/550');
  await page.waitForSelector('.detail-info h1:has-text("Harbour Lights")');
  assert.ok(await page.isVisible('button:has-text("Trailer")'));
  assert.ok(await page.isVisible('.cast strong:has-text("Ada Stone")'));
  await page.click('button:has-text("Sources")');
  await page.waitForSelector('.source');
  const formats = await page.$$eval('.source .fmt', (e) => e.map((x) => x.textContent));
  assert.deepEqual(formats.slice(0, 3), ['HLS', 'DASH', 'MP4']);
  assert.ok(formats.includes('TORRENT'));
  assert.equal(await page.$eval('.source:has(.fmt-torrent)', (e) => e.disabled), true);
  await shot('05-sources');
  await page.keyboard.press('Escape');
});

await step('HLS playback in the MyStream player (hls.js), multi-audio switch, subtitles', async () => {
  await page.goto(BASE + '/#/watch/movie/550');
  await waitPlaying();
  assert.equal(await page.$eval('.source-label', (e) => e.textContent.includes('HLS')), true);
  await page.mouse.move(600, 400);
  await page.click('button[aria-label="Audio"]');
  const audio = await page.$$eval('.menu .menu-item', (e) => e.map((x) => x.textContent));
  assert.equal(audio.length, 2, `audio tracks: ${audio.join(' | ')}`);
  await page.click('.menu .menu-item >> nth=1');
  await page.waitForFunction(() => document.querySelectorAll('.menu').length && document.querySelector('.menu').hidden);
  await page.click('button[aria-label^="Subtitles"]');
  const subs = await page.$$eval('.menu .menu-item', (e) => e.map((x) => x.textContent));
  assert.ok(subs.some((s) => /English/.test(s)), `subtitles: ${subs.join(' | ')}`);
  await page.click('.menu .menu-item:has-text("English") >> nth=0');
  await page.waitForFunction(() => [...document.querySelector('video').textTracks].some((t) => t.mode === 'showing' && t.cues && t.cues.length > 0), null, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('video').currentTime > 2.2);
  await shot('06-player-hls');
});

await step('Player controls: speed, seek, keyboard', async () => {
  await page.mouse.move(500, 300);
  await page.click('button[aria-label="Speed"]');
  await page.click('.menu .menu-item:has-text("1.5×")');
  assert.equal(await page.$eval('video', (v) => v.playbackRate), 1.5);
  const t0 = await page.$eval('video', (v) => v.currentTime);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction((t) => document.querySelector('video').currentTime > t + 5, t0);
  await page.keyboard.press(' ');
  await page.waitForFunction(() => document.querySelector('video').paused);
  await page.keyboard.press(' ');
  await page.waitForFunction(() => !document.querySelector('video').paused);
});

await step('Subtitle On/Off switch in the player', async () => {
  await page.mouse.move(500, 300);
  await page.click('button[aria-label^="Subtitles"]');
  const sw = page.locator('.menu .switch');
  assert.equal(await sw.getAttribute('aria-checked'), 'true', 'subtitles on (English chosen earlier)');
  await sw.click();
  await page.waitForFunction(() => ![...document.querySelector('video').textTracks].some((t) => t.mode === 'showing'));
  assert.equal(await page.locator('.menu .switch').getAttribute('aria-checked'), 'false');
  await page.click('.menu .switch');
  await page.waitForFunction(() => [...document.querySelector('video').textTracks].some((t) => t.mode === 'showing' && t.language === 'en'));
  await page.screenshot({ path: path.join(ART, '06b-subtitle-switch.png') });
  await page.keyboard.press('Escape');
});

await step('Switch source to DASH (dash.js) from the player', async () => {
  await page.mouse.move(400, 300);
  await page.click('button[aria-label="Sources"]');
  await page.click('.menu .source:has(.fmt-dash)');
  await page.waitForFunction(() => document.querySelector('.source-label').textContent.includes('DASH'));
  await waitPlaying(1);
  const audio = await page.evaluate(() => document.querySelectorAll('button[aria-label="Audio"]:not([hidden])').length);
  assert.equal(audio, 1, 'DASH exposes two audio languages');
  await shot('07-player-dash');
});

await step('Switch to direct MP4', async () => {
  await page.mouse.move(400, 300);
  await page.click('button[aria-label="Sources"]');
  await page.click('.menu .source:has(.fmt-mp4)');
  await page.waitForFunction(() => document.querySelector('.source-label').textContent.includes('MP4'));
  await waitPlaying(1);
});

await step('Progress is saved and appears in Continue Watching', async () => {
  await page.waitForFunction(() => document.querySelector('video').currentTime > 6);
  await page.keyboard.press('Escape'); // back: saves progress
  await page.waitForFunction(() => !location.hash.includes('/watch/'));
  await page.goto(BASE + '/#/');
  await page.waitForSelector('.row[data-row="continue"] .card');
  const resume = await (await fetch(BASE + '/api/playback/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MyStream': '1', Cookie: (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join('; ') }, body: JSON.stringify({ key: 'movie:550' }) })).json();
  assert.ok(resume.resumeAt > 3, `resumeAt=${resume.resumeAt}`);
  await shot('08-continue-watching');
});

await step('Automatic failover: broken HLS source → next working source', async () => {
  await page.goto(BASE + '/#/watch/movie/551');
  await waitPlaying(1, 30000);
  const label = await page.$eval('.source-label', (e) => e.textContent);
  assert.match(label, /MP4/, `playing: ${label}`);
  await shot('09-failover');
});

await step('Series: season/episode list, play episode, Next Episode', async () => {
  await page.goto(BASE + '/#/title/tv/1399');
  await page.waitForSelector('.episode');
  assert.equal(await page.$$eval('.episode', (e) => e.length), 3);
  await page.selectOption('.season-select', '2');
  await page.waitForSelector('.episode strong:has-text("2. Chapter 2")');
  await shot('10-series');
  await page.goto(BASE + '/#/watch/tv/1399?s=1&e=3');
  await waitPlaying(1);
  assert.match(await page.$eval('.player-title strong', (e) => e.textContent), /S1 E3/);
  await page.mouse.move(400, 300);
  await page.click('button[aria-label^="Next episode"]');
  await page.waitForFunction(() => location.hash.includes('s=2&e=1'));
  await page.waitForFunction(() => /S2 E1/.test(document.querySelector('.player-title strong')?.textContent || ''));
});

await step('Embedded player fallback is shown when chosen', async () => {
  await page.mouse.move(400, 300);
  await page.click('button[aria-label="Sources"]');
  await page.click('.menu .source:has(.fmt-embed) >> nth=0');
  await page.waitForSelector('.embed-host iframe');
  assert.match(await page.getAttribute('.embed-host iframe', 'src'), /vsembed\.su\/embed\/tv\/1399\/2\/1/);
});

await step('Settings → Server Management: disable VidSrc, add server from links, private, default, test', async () => {
  await page.goto(BASE + '/#/settings');
  await page.waitForSelector('#servers .server');
  const rowOf = (re) => page.locator('#servers .server').filter({ has: page.locator('.server-main > strong', { hasText: re }) });
  const vid = rowOf(/^\d+\. VidSrc(?! \()/);
  await vid.locator('button[role=switch]', { hasText: 'Enabled' }).click();
  await page.waitForSelector('#servers .server.off');
  assert.equal(await rowOf(/^\d+\. VidSrc(?! \()/).locator('button[role=switch]', { hasText: 'Enabled' }).getAttribute('aria-checked'), 'false');
  await page.fill('#servers input[aria-label="Server link"]', 'https://player.example/embed/movie/550');
  await page.fill('#servers input[aria-label="Server name"]', 'My Server');
  await page.fill('#servers input[aria-label="Series link"]', 'https://player.example/embed/tv/1399/1/1');
  assert.match(await page.textContent('.pattern-preview'), /player link.*movie\/\{tmdb\}.*tv\/\{tmdb\}\/\{season\}\/\{episode\}/);
  await page.click('#servers button:has-text("+ Add server")');
  await rowOf(/My Server/).waitFor();
  assert.match(await rowOf(/My Server/).textContent(), /Not tested yet/);
  await rowOf(/My Server/).locator('button[role=switch]', { hasText: 'Shared' }).click();
  await page.waitForSelector('.toast:has-text("is now private")');
  await rowOf(/My Server/).locator('button:has-text("Make default")').click();
  await page.waitForSelector('#servers .server:first-child:has-text("My Server")');
  assert.match(await page.textContent('#servers .server:first-child'), /★ Default/);
  await rowOf(/My Server/).locator('button:has-text("Test")').click();
  await page.waitForFunction(() => !/Not tested yet/.test([...document.querySelectorAll('#servers .server')].find((x) => x.textContent.includes('My Server')).textContent));
  await page.screenshot({ path: path.join(ART, '14-server-management.png'), fullPage: true });
  await page.goto(BASE + '/#/title/tv/1399');
  await page.click('button:has-text("Sources")');
  await page.waitForSelector('.source');
  const providers = await page.$$eval('.source .source-main strong', (e) => e.map((x) => x.textContent));
  assert.equal(providers[0], 'My Server', providers.join(','));
  assert.ok(!providers.includes('VidSrc'), providers.join(','));
  await page.keyboard.press('Escape');
  // Make the add-on (direct streams) the default again.
  await page.goto(BASE + '/#/settings');
  await rowOf(/Test Add-on/).locator('button:has-text("Make default")').click();
  await page.waitForSelector('#servers .server:first-child:has-text("Test Add-on")');
});

await step('Subtitle choice is remembered between sessions', async () => {
  await page.goto(BASE + '/#/watch/movie/550');
  await waitPlaying(1);
  await page.waitForFunction(() => [...document.querySelector('video').textTracks].some((t) => t.mode === 'showing' && t.language === 'en'), null, { timeout: 8000 });
  await page.mouse.move(500, 300);
  await page.click('button[aria-label^="Subtitles"]');
  await page.click('.menu .menu-item:has-text("French")');
  await page.reload();
  await waitPlaying(1);
  await page.waitForFunction(() => [...document.querySelector('video').textTracks].some((t) => t.mode === 'showing' && t.language === 'fr'), null, { timeout: 8000 });
  await page.mouse.move(500, 300);
  await page.click('button[aria-label^="Subtitles"]');
  await page.click('.menu .switch');
  await page.reload();
  await waitPlaying(1);
  await page.waitForTimeout(2000);
  assert.equal(await page.evaluate(() => [...document.querySelector('video').textTracks].some((t) => t.mode === 'showing')), false, 'off is remembered');
});

await step('Kids profile with PIN: rating filter and parental block', async () => {
  await page.goto(BASE + '/#/profiles');
  await page.click('button:has-text("Manage profiles")');
  await page.click('.profile.add');
  await page.fill('.modal input >> nth=0', 'Sami');
  await page.check('.modal input[type=checkbox] >> nth=0');
  await page.fill('.modal input[inputmode=numeric]', '4321');
  await page.click('.modal button:has-text("Save")');
  await page.waitForSelector('.profile:has-text("Sami")');
  await page.click('button:has-text("Done")');
  await page.click('.profile:has-text("Sami")');
  await page.fill('.modal .pin-input', '0000');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.modal .form-error:has-text("Wrong PIN")');
  await page.fill('.modal .pin-input', '4321');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.hero, .rows');
  const popular = await page.$$eval('.row[data-row="popular_movies"] .card-title', (e) => e.map((x) => x.textContent));
  assert.deepEqual(popular.sort(), ['Deep Blue Atlas', 'Paper Kites']);
  await page.goto(BASE + '/#/title/movie/553');
  await page.waitForSelector('.empty p:has-text("Not available on this profile")');
  await shot('11-kids');
});

await step('TV remote / D-pad navigation moves focus between cards', async () => {
  const tv = await ctx.newPage();
  page = tv;
  await tv.goto(BASE + '/?tv=1#/');
  await tv.waitForSelector('.row .card');
  assert.equal(await tv.evaluate(() => document.documentElement.classList.contains('tv')), true);
  await tv.evaluate(() => document.querySelector('.row .card').focus());
  const before = await tv.evaluate(() => document.activeElement.dataset.key);
  await tv.keyboard.press('ArrowRight');
  const after = await tv.evaluate(() => document.activeElement.dataset.key);
  assert.ok(after && after !== before, `focus moved ${before} -> ${after}`);
  await tv.keyboard.press('ArrowDown');
  const down = await tv.evaluate(() => document.activeElement.closest('.row')?.dataset.row);
  assert.ok(down, 'focus moved to another row');
  await tv.keyboard.press('Enter');
  await tv.waitForSelector('.detail-info h1');
  await tv.screenshot({ path: path.join(ART, '12-tv-focus.png') });
});

await step('Android TV app bridge: remote media keys, Back button, keep-screen-on, Change server', async () => {
  // Simulates the Android WebView wrapper (apps/android): a fake window.MyStreamAndroid
  // and the exact JavaScript MainActivity injects for media keys and Back.
  const a = await ctx.newPage();
  page = a;
  a.on('pageerror', (e) => pageErrors.push(e.message));
  await a.addInitScript(() => {
    window.__android = [];
    window.MyStreamAndroid = {
      keepScreenOn: (on) => window.__android.push('keepScreenOn:' + on),
      changeServer: () => window.__android.push('changeServer'),
      isTv: () => true, retry() {}, version: () => '12.1.0',
    };
  });
  // Same code as MainActivity.sendKey(...)
  const sendKey = (key) => a.evaluate((k) => {
    const p = document.querySelector('.player');
    let t = document.activeElement && document.activeElement !== document.body ? document.activeElement : (p || document.body);
    if (p && !p.contains(t)) t = p;
    t.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  }, key);
  // Same code as MainActivity.handleBack(): window.msHandleBack()
  const back = () => a.evaluate(() => (window.msHandleBack ? window.msHandleBack() : false));
  const calls = () => a.evaluate(() => window.__android.slice());

  // Back to the main (adult) profile; the previous step left the Kids profile active.
  await a.goto(BASE + '/?tv=1#/profiles');
  await a.click('.profile:not(.add) >> nth=0');
  await a.waitForSelector('.row .card');
  assert.equal(await a.evaluate(() => document.documentElement.classList.contains('tv')), true, 'TV mode from ?tv=1');
  assert.equal(await back(), false, 'Back at Home is left to the app (press again to exit)');

  await a.evaluate(() => { location.hash = '#/watch/movie/550'; });
  page = a; await waitPlaying(1);
  assert.ok((await calls()).includes('keepScreenOn:true'), 'screen kept on while playing');

  await sendKey('MediaPlayPause');
  await a.waitForFunction(() => document.querySelector('video').paused);
  assert.equal((await calls()).at(-1), 'keepScreenOn:false', 'screen may sleep when paused');
  await sendKey('MediaPlayPause');
  await a.waitForFunction(() => !document.querySelector('video').paused);
  const t0 = await a.$eval('video', (v) => v.currentTime);
  await sendKey('MediaFastForward');
  await a.waitForFunction((t) => document.querySelector('video').currentTime > t + 5, t0);
  await sendKey('MediaRewind');
  await a.waitForFunction((t) => document.querySelector('video').currentTime < t + 6, t0);
  await sendKey('MediaPause');
  await a.waitForFunction(() => document.querySelector('video').paused);
  await sendKey('MediaPlay');
  await a.waitForFunction(() => !document.querySelector('video').paused);

  // Back closes an open player menu first, then leaves the player.
  await a.mouse.move(600, 400);
  await a.click('button[aria-label="Speed"]');
  await a.waitForSelector('.menu:not([hidden])');
  assert.equal(await back(), true);
  assert.equal(await a.$eval('.menu', (m) => m.hidden), true, 'menu closed');
  assert.ok(await a.$('.player'), 'still in the player');
  assert.equal(await back(), true);
  await a.waitForFunction(() => !document.querySelector('.player'));
  assert.equal((await calls()).at(-1), 'keepScreenOn:false', 'screen released after leaving the player');

  // Back from a page goes back; Settings shows "This device → Change server".
  await a.evaluate(() => { location.hash = '#/settings'; });
  await a.waitForSelector('button:has-text("Change server")');
  await a.click('button:has-text("Change server")');
  assert.ok((await calls()).includes('changeServer'));
  assert.equal(await back(), true, 'Back from Settings is handled by MyStream');
  await a.screenshot({ path: path.join(ART, '12b-android-bridge.png') });
});

await step('Mobile layout renders without horizontal overflow', async () => {
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState() });
  page = m;
  await m.goto(BASE + '/#/');
  await m.waitForSelector('.row .card');
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `overflow ${overflow}px`);
  await m.screenshot({ path: path.join(ART, '13-mobile.png') });
});

await step('No uncaught page errors', async () => {
  assert.deepEqual(pageErrors.filter((e) => !/play\(\) request was interrupted|AbortError/.test(e)), []);
});

await browser.close();
await app.close();
await mocks.close();
fs.rmSync(dataDir, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(ART, 'results.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} e2e steps passed`);
process.exit(failed.length ? 1 : 0);
