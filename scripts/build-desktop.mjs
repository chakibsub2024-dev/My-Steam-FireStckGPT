#!/usr/bin/env node
// Builds portable MyStream desktop apps from official Electron release zips.
//   node scripts/build-desktop.mjs [--targets linux-x64,win32-x64,darwin-arm64] [--electron 38.2.0] [--cache DIR] [--deb]
// Electron zips are downloaded from GitHub releases (or read from --cache) and
// verified against the release SHASUMS256.txt before use.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const ELECTRON = opt('electron', '38.2.0');
const TARGETS = opt('targets', 'linux-x64,win32-x64').split(',').map((s) => s.trim()).filter(Boolean);
const CACHE = path.resolve(opt('cache', path.join(ROOT, '.cache', 'electron')));
const OUT = path.join(ROOT, 'dist');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const BUILD_DEB = args.includes('--deb');
const run = (cmd, a, o = {}) => execFileSync(cmd, a, { stdio: 'inherit', ...o });

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

async function electronZip(target) {
  fs.mkdirSync(CACHE, { recursive: true });
  const name = `electron-v${ELECTRON}-${target}.zip`;
  const file = path.join(CACHE, name);
  const sums = path.join(CACHE, `SHASUMS256-${ELECTRON}.txt`);
  const base = `https://github.com/electron/electron/releases/download/v${ELECTRON}`;
  if (!fs.existsSync(sums)) await download(`${base}/SHASUMS256.txt`, sums);
  if (!fs.existsSync(file)) { console.log(`Downloading ${name}…`); await download(`${base}/${name}`, file); }
  const want = fs.readFileSync(sums, 'utf8').split('\n').find((l) => l.endsWith(` *${name}`) || l.endsWith(`  ${name}`))?.split(' ')[0];
  const got = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (!want || want !== got) throw new Error(`Checksum mismatch for ${name}`);
  return file;
}

function copyDir(src, dst, filter = () => true) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (!filter(s, e)) continue;
    if (e.isDirectory()) copyDir(s, d, filter);
    else fs.copyFileSync(s, d);
  }
}

/** Assemble resources/app: the desktop shell + backend + web client. */
function stageApp(appDir) {
  fs.rmSync(appDir, { recursive: true, force: true });
  fs.mkdirSync(appDir, { recursive: true });
  const desk = path.join(ROOT, 'apps/desktop');
  for (const f of ['electron.cjs', 'preload.cjs', 'setup.html', 'setup.js', 'setup.css', 'ad-domains.json', 'icon.png']) fs.copyFileSync(path.join(desk, f), path.join(appDir, f));
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: 'mystream', productName: 'MyStream', version: VERSION, main: 'electron.cjs', private: true }, null, 2));
  copyDir(path.join(ROOT, 'services/api'), path.join(appDir, 'services/api'), (s) => !s.includes(`${path.sep}node_modules`));
  copyDir(path.join(ROOT, 'apps/web'), path.join(appDir, 'apps/web'));
  for (const f of ['.env.example', 'README.md', 'THIRD_PARTY_NOTICES.md']) if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(appDir, f));
  // Integrity check (MyStream V11 shipped without its entry file).
  const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  for (const f of [pkg.main, 'preload.cjs', 'services/api/package.json', 'services/api/src/app.js', 'apps/web/index.html', 'apps/web/vendor/hls.min.js', 'apps/web/vendor/dash.all.min.js']) {
    if (!fs.existsSync(path.join(appDir, f))) throw new Error(`Packaging check failed: ${f} missing from app`);
  }
  if (JSON.parse(fs.readFileSync(path.join(appDir, 'services/api/package.json'), 'utf8')).type !== 'module') throw new Error('services/api must be an ES module package');
}

async function build(target) {
  const [platform, arch] = target.split('-');
  const zip = await electronZip(target);
  const name = `MyStream-${VERSION}-${target}`;
  const dir = path.join(OUT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  run('unzip', ['-q', zip, '-d', dir]);
  let resources;
  if (platform === 'darwin') {
    const appPath = path.join(dir, 'MyStream.app');
    fs.renameSync(path.join(dir, 'Electron.app'), appPath);
    resources = path.join(appPath, 'Contents/Resources');
  } else {
    resources = path.join(dir, 'resources');
    if (platform === 'win32') fs.renameSync(path.join(dir, 'electron.exe'), path.join(dir, 'MyStream.exe'));
    else fs.renameSync(path.join(dir, 'electron'), path.join(dir, 'mystream'));
  }
  fs.rmSync(path.join(resources, 'default_app.asar'), { force: true });
  stageApp(path.join(resources, 'app'));
  fs.writeFileSync(path.join(dir, 'README-FIRST.txt'), platform === 'win32'
    ? 'Run MyStream.exe. On first start, enter your TMDB API key (or a server address).\r\nData is stored in %APPDATA%\\MyStream.\r\nThis is a portable build: no installer, nothing written outside %APPDATA%\\MyStream.\r\n'
    : 'Run ./mystream. On first start, enter your TMDB API key (or a server address).\nData is stored in ~/.config/MyStream.\n');
  // Archives
  const archive = platform === 'win32' || platform === 'darwin' ? `${name}.zip` : `${name}.tar.gz`;
  fs.rmSync(path.join(OUT, archive), { force: true });
  if (archive.endsWith('.zip')) run('zip', ['-qry', archive, name], { cwd: OUT });
  else run('tar', ['-czf', archive, name], { cwd: OUT });
  console.log(`Built ${archive}`);
  if (platform === 'linux' && BUILD_DEB) buildDeb(dir, arch);
  return dir;
}

function buildDeb(dir, arch) {
  const debArch = arch === 'x64' ? 'amd64' : arch;
  const root = path.join(OUT, `deb-${debArch}`);
  fs.rmSync(root, { recursive: true, force: true });
  copyDir(dir, path.join(root, 'opt/MyStream'));
  fs.mkdirSync(path.join(root, 'usr/share/applications'), { recursive: true });
  fs.mkdirSync(path.join(root, 'usr/share/icons/hicolor/512x512/apps'), { recursive: true });
  fs.mkdirSync(path.join(root, 'usr/bin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'DEBIAN'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'apps/desktop/icon.png'), path.join(root, 'usr/share/icons/hicolor/512x512/apps/mystream.png'));
  fs.symlinkSync('/opt/MyStream/mystream', path.join(root, 'usr/bin/mystream'));
  fs.writeFileSync(path.join(root, 'usr/share/applications/mystream.desktop'),
    '[Desktop Entry]\nName=MyStream\nComment=Family streaming\nExec=/opt/MyStream/mystream %U\nIcon=mystream\nTerminal=false\nType=Application\nCategories=AudioVideo;Video;Player;\n');
  const size = Math.ceil(Number(execFileSync('du', ['-sk', root]).toString().split('\t')[0]));
  fs.writeFileSync(path.join(root, 'DEBIAN/control'), [
    'Package: mystream', `Version: ${VERSION}`, `Architecture: ${debArch}`, 'Maintainer: MyStream household <admin@localhost>',
    `Installed-Size: ${size}`, 'Depends: libgtk-3-0, libnss3, libxss1, libasound2 | libasound2t64, libgbm1',
    'Section: video', 'Priority: optional', 'Description: MyStream private family streaming app', ' Desktop client with built-in MyStream server.', '',
  ].join('\n'));
  // chrome-sandbox needs setuid root for the Chromium sandbox on Linux.
  fs.writeFileSync(path.join(root, 'DEBIAN/postinst'), '#!/bin/sh\nset -e\nchown root:root /opt/MyStream/chrome-sandbox 2>/dev/null || true\nchmod 4755 /opt/MyStream/chrome-sandbox 2>/dev/null || true\n', { mode: 0o755 });
  const out = path.join(OUT, `mystream_${VERSION}_${debArch}.deb`);
  run('dpkg-deb', ['--build', '--root-owner-group', root, out]);
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`Built ${path.basename(out)}`);
}

fs.mkdirSync(OUT, { recursive: true });
for (const t of TARGETS) await build(t);
