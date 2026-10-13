// MyStream desktop (Electron). Entry point referenced by package.json "main".
// - Starts the MyStream backend inside the app (local mode) or opens a remote server.
// - Hardened window: context isolation, sandbox, no Node in pages.
// - Blocks pop-ups, unwanted top-level navigation and known ad/tracker hosts,
//   which matters for optional embedded third-party players.
'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_ROOT = __dirname; // resources/app (packaged) or repo/apps/desktop when run from source
const FROM_SOURCE = fs.existsSync(path.join(APP_ROOT, '..', '..', 'services', 'api'));
const CODE_ROOT = FROM_SOURCE ? path.resolve(APP_ROOT, '..', '..') : APP_ROOT;
const AD_HOSTS = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'ad-domains.json'), 'utf8')).domains;
const SELFTEST = process.env.MYSTREAM_SELFTEST === '1';

let win = null;
let backend = null;
let appOrigin = null;

app.setName('MyStream');
// Embedded players often refuse to play for user agents that mention Electron
// or an unknown app; present the standard Chrome user agent instead.
app.userAgentFallback = app.userAgentFallback.replace(/ (MyStream|mystream|Electron)\/\S+/g, '');
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

const userFile = (...p) => path.join(app.getPath('userData'), ...p);

/** LAN addresses phones/TVs can use, e.g. http://192.168.1.20:8787 */
function lanUrls(port) {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${port}`);
  }
  return out;
}

function readSettings() {
  try { return JSON.parse(fs.readFileSync(userFile('desktop.json'), 'utf8')); } catch { return {}; }
}

function writeSettings(s) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(userFile('desktop.json'), JSON.stringify(s, null, 2), { mode: 0o600 });
}

/** Load KEY=VALUE pairs (user .env, then the bundled one) without overriding real env vars. */
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

async function startLocalBackend(settings) {
  loadEnv(userFile('.env'));
  if (settings.tmdbKey && !process.env.TMDB_API_KEY) process.env.TMDB_API_KEY = settings.tmdbKey;
  process.env.MYSTREAM_DATA_DIR ||= userFile('data');
  process.env.MYSTREAM_WEB_DIR ||= path.join(CODE_ROOT, 'apps', 'web');
  process.env.APP_ENV ||= 'production';
  process.env.COOKIE_SECURE = 'false'; // served over http://127.0.0.1 inside the app
  const { loadConfig } = await import(pathToFileURL(path.join(CODE_ROOT, 'services/api/src/config.js')).href);
  const { createApp } = await import(pathToFileURL(path.join(CODE_ROOT, 'services/api/src/app.js')).href);
  const { createLogger } = await import(pathToFileURL(path.join(CODE_ROOT, 'services/api/src/log.js')).href);
  // "Share on my network": listen on all interfaces at a fixed port so phones/TVs
  // can connect. The server then also enforces changing a temporary admin password.
  const share = !!settings.shareLan;
  const cfg = loadConfig(process.env, { host: share ? '0.0.0.0' : '127.0.0.1' });
  const logFile = fs.createWriteStream(userFile('mystream.log'), { flags: 'a' });
  const log = createLogger(cfg.logLevel, (line) => { logFile.write(line + '\n'); if (SELFTEST) process.stdout.write(line + '\n'); });
  backend = createApp(cfg, { log });
  const port = Number(process.env.MYSTREAM_DESKTOP_PORT || (share ? settings.port || 8787 : 0));
  let addr;
  try {
    addr = await backend.listen(port, share ? '0.0.0.0' : '127.0.0.1');
  } catch (err) {
    if (err.code === 'EADDRINUSE') throw new Error(`Port ${port} is already in use. Close the other program using it, or change the port in Server settings.`);
    throw err;
  }
  return `http://127.0.0.1:${addr.port}`;
}

function hardenSession(ses) {
  // Block known ad/tracker hosts everywhere in the app (incl. embedded players).
  const patterns = AD_HOSTS.flatMap((h) => [`*://${h}/*`, `*://*.${h}/*`]);
  ses.webRequest.onBeforeRequest({ urls: patterns }, (_details, cb) => cb({ cancel: true }));
  // Only allow fullscreen (video) from MyStream itself; deny camera, mic, notifications, etc.
  // Fullscreen is allowed (MyStream's player and embedded players need it);
  // everything else (camera, microphone, location, notifications, …) is denied.
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'fullscreen'));
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen');
  ses.setUserAgent(app.userAgentFallback);
}

function guardWebContents(wc) {
  // No pop-ups or new windows from anything (pages, ads, embedded players).
  wc.setWindowOpenHandler(({ url }) => {
    if (SELFTEST) process.stdout.write(`[guard] blocked window.open ${url}\n`);
    return { action: 'deny' };
  });
  // The main frame may only show MyStream; ads cannot redirect the window.
  const stayHome = (event, url) => {
    let origin = '';
    try { origin = new URL(url).origin; } catch { /* invalid */ }
    if (origin === appOrigin || url.startsWith('file:')) return;
    event.preventDefault();
    if (SELFTEST) process.stdout.write(`[guard] blocked navigation ${url}\n`);
  };
  wc.on('will-navigate', stayHome);
  wc.on('will-redirect', (e, url, _inPlace, isMainFrame) => { if (isMainFrame) stayHome(e, url); });
  // Never attach <webview> tags.
  wc.on('will-attach-webview', (e) => e.preventDefault());
}

function createWindow(url) {
  win = new BrowserWindow({
    width: 1400, height: 860, minWidth: 360, minHeight: 480, backgroundColor: '#0b0b0f', show: false, title: 'MyStream',
    icon: path.join(APP_ROOT, 'icon.png'),
    webPreferences: {
      contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true,
      preload: path.join(APP_ROOT, 'preload.cjs'), spellcheck: false, autoplayPolicy: 'no-user-gesture-required',
    },
  });
  guardWebContents(win.webContents);
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
  win.loadURL(url);
}

function createSetupWindow() {
  const setup = new BrowserWindow({
    width: 560, height: 860, resizable: true, backgroundColor: '#0b0b0f', title: 'MyStream setup',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(APP_ROOT, 'preload.cjs') },
  });
  guardWebContents(setup.webContents);
  setup.loadFile(path.join(APP_ROOT, 'setup.html'));
  return setup;
}

ipcMain.handle('mystream:get-settings', () => {
  const s = readSettings();
  return {
    mode: s.mode || 'local', remoteUrl: s.remoteUrl || '', hasTmdbKey: Boolean(s.tmdbKey || process.env.TMDB_API_KEY),
    shareLan: !!s.shareLan, port: s.port || 8787, lanUrls: s.shareLan && backend ? lanUrls(s.port || 8787) : [],
  };
});

// Only the local setup window (a file:// page) may change settings or reset passwords.
const fromSetup = (e) => String(e.senderFrame?.url || '').startsWith('file:');

ipcMain.handle('mystream:save-settings', (e, input) => {
  if (!fromSetup(e)) return { ok: false, error: 'Not allowed' };
  const s = readSettings();
  const mode = input?.mode === 'remote' ? 'remote' : 'local';
  if (mode === 'remote') {
    let u;
    try { u = new URL(String(input.remoteUrl || '')); } catch { return { ok: false, error: 'Enter a full server address, e.g. https://stream.example.com' }; }
    if (!['http:', 'https:'].includes(u.protocol)) return { ok: false, error: 'Use http:// or https://' };
    s.remoteUrl = u.origin;
  }
  if (input?.tmdbKey) {
    const key = String(input.tmdbKey).trim();
    if (!/^[A-Za-z0-9._-]{20,400}$/.test(key)) return { ok: false, error: 'That does not look like a TMDB API key' };
    s.tmdbKey = key;
  }
  if (input?.shareLan !== undefined) s.shareLan = !!input.shareLan;
  if (input?.port !== undefined && input.port !== '') {
    const p = Number(input.port);
    if (!Number.isInteger(p) || p < 1024 || p > 65535) return { ok: false, error: 'Port must be a number from 1024 to 65535' };
    s.port = p;
  }
  s.mode = mode;
  writeSettings(s);
  app.relaunch();
  app.exit(0);
  return { ok: true };
});

ipcMain.handle('mystream:open-setup', () => { createSetupWindow(); return true; });

// Local recovery: whoever sits at this computer can reset the admin password of
// the server that runs inside this app (not available for remote servers).
ipcMain.handle('mystream:reset-admin', async (e, password) => {
  if (!fromSetup(e)) return { ok: false, error: 'Not allowed' };
  if (!backend) return { ok: false, error: 'Only available when the server runs on this computer.' };
  const pw = String(password || '');
  if (pw.length < 8) return { ok: false, error: 'Use at least 8 characters.' };
  const { hashSecret } = await import(pathToFileURL(path.join(CODE_ROOT, 'services/api/src/auth.js')).href);
  const admin = backend.store.find('users', (u) => u.username === 'admin') || backend.store.find('users', (u) => u.role === 'admin');
  if (!admin) return { ok: false, error: 'No administrator account found.' };
  admin.passwordHash = hashSecret(pw);
  admin.mustChange = true; // temporary until changed in Settings → Account
  backend.store.remove('sessions', (x) => x.userId === admin.id);
  backend.store.flush();
  try { fs.rmSync(path.join(process.env.MYSTREAM_DATA_DIR, 'initial-admin-password.txt'), { force: true }); } catch { /* ignore */ }
  if (win) win.reload();
  return { ok: true, username: admin.username };
});

async function main() {
  await app.whenReady();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'MyStream', submenu: [
      { label: 'Server settings…', click: () => createSetupWindow() },
      { label: 'Open data folder', click: () => shell.openPath(app.getPath('userData')) },
      { type: 'separator' }, { role: 'quit' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }])] },
  ]));
  const settings = readSettings();
  let url;
  try {
    if (settings.mode === 'remote' && settings.remoteUrl) {
      url = settings.remoteUrl;
    } else {
      url = await startLocalBackend(settings);
      if (!process.env.TMDB_API_KEY && !SELFTEST) createSetupWindow();
    }
  } catch (err) {
    dialog.showErrorBox('MyStream could not start', `${err.message}\n\nLog: ${userFile('mystream.log')}`);
    app.exit(1);
    return;
  }
  appOrigin = new URL(url).origin;
  hardenSession(session.defaultSession);
  app.on('web-contents-created', (_e, wc) => guardWebContents(wc));
  createWindow(url);
  if (SELFTEST) process.stdout.write(`[selftest] window loading ${url}\n`);
}

let quitting = false;
app.on('before-quit', async (e) => {
  if (quitting || !backend) return;
  e.preventDefault();
  quitting = true;
  try { await Promise.race([backend.close(), new Promise((r) => setTimeout(r, 4000))]); } catch { /* ignore */ }
  app.quit();
});
app.on('window-all-closed', () => app.quit());

main();
