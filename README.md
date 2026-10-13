# MyStream 12

A private, Netflix-style streaming app for your household: TMDB catalogue, family profiles, a real built-in player (HLS, DASH, MP4) with subtitles, audio-language and quality selection, Stremio-compatible add-ons, automatic source failover, and a desktop app that blocks pop-ups and ad redirects.

> Use MyStream only with sources you have the right to watch. TMDB provides information and artwork, never video.

## What's inside

| Part | Where | Tech |
|---|---|---|
| Server (API + web app) | `services/api` | Node.js 22, zero npm dependencies (built-in `http`, `crypto`) |
| Web app / PWA | `apps/web` | Plain ES modules, hls.js 1.6, dash.js 4.7 |
| Desktop app | `apps/desktop` | Electron 38 (portable builds via `scripts/build-desktop.mjs`) |
| Tests | `tests/` | `node:test` (backend), Playwright (browser + packaged desktop) |
| Docker | `infrastructure/docker`, `docker-compose.yml` | node:22-alpine |

## Quick start (Windows PC)

1. Install **Node.js 22 or newer** from <https://nodejs.org>.
2. Unzip MyStream, open the folder, double-click **`start-mystream.cmd`**.
   The first time it creates `.env` and opens it in Notepad.
3. In `.env` set:
   - `TMDB_API_KEY=` your key (themoviedb.org → Settings → API)
   - `ADMIN_BOOTSTRAP_PASSWORD=` a password for the `admin` account
4. Save, double-click `start-mystream.cmd` again. Your browser opens <http://localhost:8787>.
5. Sign in as **admin**, choose the **Admin** profile, then go to **Add-ons** to install sources.

Linux/macOS: `./start-mystream.sh` (same steps). Developers: `npm run dev` (auto-restart on backend changes).

### Other devices in your home
**Desktop app:** Server settings… → tick **Share on my network** → Save. The window shows the address to use, e.g. `http://192.168.1.20:8787`. **Server/Docker:** set `MYSTREAM_HOST=0.0.0.0`. Then use that address in the **Android TV / phone app** (`apps/android`, see its README), in a phone browser (PWA), or in a TV browser. For access away from home, use **Tailscale** or HTTPS (see `docs/DEPLOYMENT.md`).

## Desktop app (Windows / Linux)

Download the portable build for your system, unzip, and run **`MyStream.exe`** (Windows) or **`./mystream`** (Linux), or install `mystream_12.1.0_amd64.deb`.
On first start a setup window asks for your TMDB key (server on this PC), or for the address of a MyStream server elsewhere. Menu → *MyStream → Server settings…* changes it later. Data lives in `%APPDATA%\MyStream` / `~/.config/MyStream`.

Desktop protections (they matter for the optional embedded players):
- every `window.open` / pop-up is refused;
- the window can't be navigated away from MyStream (ad redirects are blocked);
- ~40 known ad/tracker hosts are blocked at the network layer;
- pages get no Node.js access (context isolation + sandbox); only fullscreen permission is granted.

Build it yourself: `node scripts/build-desktop.mjs --targets linux-x64,win32-x64 --deb` (downloads and checksum-verifies official Electron releases).

## Docker / server

```bash
cp .env.example .env          # set TMDB_API_KEY, ADMIN_BOOTSTRAP_PASSWORD, APP_ENV=production
docker compose up -d --build
```
Data is kept in the `mystream_data` volume. Health check: `GET /api/health`. API docs: `GET /api/openapi.json`.

## Using MyStream

- **Profiles:** up to 8, with avatar colour, optional 4-digit PIN, and *Kids* mode (rating limit: U, PG, 12A, 12, 15). Each profile has its own My List, history, Continue Watching, and audio/subtitle preferences.
- **Accounts:** the administrator can add family accounts (*Settings → Accounts*). Only administrators manage add-ons, profiles and source settings.
- **Add-ons:** *Add-ons* → paste a Stremio add-on manifest URL (`https://…/manifest.json` or `stremio://…`). MyStream validates it, stores the URL encrypted, and asks it for streams and subtitles when you press Play. Add-on catalogues appear on the Add-ons page.
- **Sources:** each title's **☰ Sources** list shows provider, format, quality, codec, languages, subtitles and whether it can play. The player tries them in order and fails over automatically. Change the order (HLS, DASH, MP4, …, embedded players) in *Settings*.
- **Player keys:** Space/K play-pause · ←/→ seek 10 s · ↑/↓ volume · F fullscreen · M mute · C subtitles · N next episode · 0–9 jump · Esc/Back exit. TV remotes: D-pad, OK, Back, Play/Pause, FF/RW.

### What plays and what doesn't
| Source type | Web/desktop player |
|---|---|
| HLS `.m3u8` | ✅ hls.js (native on Safari/Tizen) |
| DASH `.mpd` | ✅ dash.js |
| MP4 / WebM | ✅ native |
| MKV | ⚠️ only if the device decodes its codecs |
| Links needing custom headers (`notWebReady`, `proxyHeaders`) | ❌ listed, not played (browsers can't set those headers) |
| Torrent / magnet results | ❌ listed as unsupported. MyStream has no torrent engine |
| Embedded players (Vidking, Videasy, VidSrc) | ✅ optional last resort; third-party pages, ads possible, protected in the desktop app |


## Server Management (Settings → Server Management, administrators only)

One list of every playback server (Stremio add-ons and embedded player servers) in the order MyStream tries them:
- **Add a server:** paste a player link for any film (`https://site/embed/movie/550`, optionally an episode link) or a Stremio manifest URL. MyStream detects which it is. Player links become patterns (`{tmdb}`, `{imdb}`, `{season}`, `{episode}`).
- **Enabled** switch: disabled servers are never offered, auto-selected or used for failover; they stay in the list to re-enable.
- **Shared** switch: on = every family account; off = administrators plus any accounts you tick ("Also allow").
- **↑ ↓ / ★ Make default:** the first enabled server is the default; the rest are failover order.
- **Test:** real reachability check (status, redirect, CAPTCHA/challenge, timeout). It does not prove a film plays.
- **Edit / Delete** (custom servers and add-ons; built-ins can be disabled, not deleted).
TMDB metadata is independent: the catalogue keeps working with every server disabled. Permissions are enforced by the backend for streams, subtitles and catalogues.

**Subtitles** in the player: an On/Off switch plus language list; the choice (language or off) is saved to the profile and used next time.

**Temporary admin password:** passwords set at first start or via a reset (desktop: *MyStream → Server settings… → Reset admin password*; server: `npm run cli -- reset-password admin <pw>`) are marked temporary. On this PC you get a reminder; if the server listens on the network (`MYSTREAM_HOST` not 127.0.0.1) the admin must choose a new password before using MyStream. Passwords are stored as scrypt hashes.

## Tests

```bash
npm test                      # 26 backend unit + integration tests (mock TMDB + mock add-on)
node tests/e2e/run.mjs        # 21-step browser test (needs Playwright + ffmpeg)
xvfb-run -a node tests/e2e/desktop.mjs dist/MyStream-12.1.0-linux-x64/mystream   # packaged desktop test
```

See **VERIFICATION.md** for what was built and tested, and **docs/PLATFORMS.md** for TV/mobile status.

## Troubleshooting

| Problem | Fix |
|---|---|
| "TMDB is not configured" | Set `TMDB_API_KEY` in `.env` and restart. |
| "TMDB rejected the API key" | Copy the key again (v3 key or v4 read token). |
| Forgot the admin password | Stop MyStream, run `node services/api/src/cli.js reset-password admin NewPassword123`, start again. |
| "No playable source" | Install an add-on that returns direct HLS/DASH/MP4 links, or enable embedded players in Settings. |
| A source stays black | Open ☰ in the player and pick another; check the add-on with *Add-ons → Check*. |
| Add-on on your LAN refused | Set `ADDON_ALLOW_PRIVATE=true` (private addresses are blocked by default to prevent SSRF). |
| Phones/TV can't connect | Turn on Share on my network (or `MYSTREAM_HOST=0.0.0.0`), allow MyStream on **Private** networks in Windows Firewall, use the PC's LAN IP, and keep both devices on the same Wi-Fi (not a guest network). |
| Desktop app logs | `%APPDATA%\MyStream\mystream.log` / `~/.config/MyStream/mystream.log` |
