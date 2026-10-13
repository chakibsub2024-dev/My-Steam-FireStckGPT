# MyStream 12.0.0: build and verification report

Built 10 Oct 2026 in a Linux x64 container (Node 22.22, Chromium 141 via Playwright, ffmpeg, Xvfb). No npm registry access and no Docker daemon. No Android, Apple, Samsung or LG SDKs.

## Test results (final run)
| Suite | Command | Result |
|---|---|---|
| Backend unit + integration (mock TMDB, mock Stremio add-on) | `npm test` | **21/21 passed** |
| Browser end-to-end (real backend + web app, Chromium) | `node tests/e2e/run.mjs` | **18/18 passed** |
| Packaged desktop app (Linux build under Xvfb, Playwright Electron driver) | `xvfb-run -a node tests/e2e/desktop.mjs …/mystream` | **6/6 passed** |

Automated playback uses generated test media (test pattern + tones, VP9/Opus), so no third-party sites are involved. Open-source Chromium has no H.264/AAC decoder. Chrome, Edge, Safari and Electron do decode H.264/AAC, but that was not exercised by these tests.

## Features: implemented and how they were verified
| Requirement | Status | Evidence |
|---|---|---|
| Netflix-style UI: hero, rows (Trending, Popular Movies/Series, New Releases, Top Rated, Documentaries, Anime, Animation, Action, Comedy, Horror, Sci-Fi), Continue Watching, My List | Implemented | e2e "Home", screenshots in `tests/e2e/artifacts` |
| Navigation: Home, Movies, Series, Documentaries, Anime, Animation, My List, Add-ons, Settings | Implemented | e2e |
| Details: poster, backdrop, synopsis, year, rating, runtime, genres, cast, crew, certification, trailer, sources, My List | Implemented | e2e "Movie details" |
| Series: season selector, episode titles, descriptions, durations, thumbnails, progress, Next Episode | Implemented | e2e "Series" |
| TMDB: trending, popular, top rated, new releases, search, genres, seasons/episodes, cast, recommendations, similar, IMDb/TVDB ids, kids filtering | Implemented | unit "TMDB catalogue", "parental" |
| TMDB key server-side only; clear error when missing | Implemented | unit "TMDB not configured" |
| Normalised stream model (provider, format, quality, codec, languages, subtitles, headers, compatibility, priority) | Implemented | unit "stream normalisation", "ranking" |
| Format detection and routing: HLS (hls.js / native), DASH (dash.js), MP4/WebM (native), MKV (capability check), embed (iframe) | Implemented | e2e HLS, DASH and MP4 playback |
| Torrent / header-dependent / external results never passed to `<video>` | Implemented | unit + e2e sources list |
| Stremio add-ons: manifest URL (https/stremio://), validation, install, enable/disable, reorder, remove, health check, persistence, encrypted URL at rest, stream + subtitle + catalogue resources, IMDb/tmdb id mapping, dedupe, timeouts | Implemented | unit "Stremio add-ons" (incl. restart persistence) |
| SSRF protection: private/reserved IPs, DNS-rebinding pinning, redirect re-validation, size/time caps | Implemented | unit "SSRF" |
| Player: play/pause, seek, volume, fullscreen, quality, speed, audio tracks, subtitles (WebVTT, SRT→VTT, embedded HLS/DASH tracks), subtitle styling, PiP, resume, Next Episode, keyboard shortcuts, TV remote keys | Implemented | e2e "HLS playback… multi-audio… subtitles", "controls", "Series" |
| Automatic failover with retry limit, error classification, position restore and a final error listing tried sources | Implemented | e2e "Automatic failover" |
| Configurable source priority, embed toggle, failover toggle | Implemented | unit "source settings" |
| Accounts, scrypt passwords, sessions, CSRF header, rate limits, profiles (8), avatars, PIN, kids rating limit, per-profile lists/history/preferences | Implemented | unit "profiles", e2e "Kids profile with PIN" |
| Admin-only add-ons/settings/accounts | Implemented | unit (member gets 403) |
| D-pad spatial navigation, TV mode, Back keys (Esc, Backspace, Tizen 10009, webOS 461) | Implemented | e2e "TV remote" |
| Responsive: desktop, tablet, phone | Implemented | e2e "Mobile layout" (390 px, no overflow) |
| OpenAPI document | Implemented | unit "health/OpenAPI" |
| Structured JSON logs with secret redaction | Implemented | unit "log redaction" |
| Desktop: backend auto-start, pop-up blocking, navigation lock, ad-host blocking, sandbox/context isolation, graceful shutdown, setup window (TMDB key or remote server) | Implemented | desktop 6/6 (setup window not driven by the test) |
| V11 bug "index.js not found in app.asar" | Fixed by design: `main` is `electron.cjs`, and the build script fails if the entry file or backend/web files are missing | build integrity check + packaged launch test |
| Docker image + Compose (non-root, read-only, healthcheck, volume) | Written | `docker compose config` valid; **image not built** (no Docker daemon) |
| CI workflow (tests + desktop builds on Linux/Windows/macOS) | Written | **not executed** |
| Admin password reset CLI | Implemented | manually verified |

## Artifacts
| Artifact | Built | Launched | Functionally tested | Physical device |
|---|---|---|---|---|
| Source + web app (`MyStream-12.0.0-source.zip`) | yes | yes (server) | yes (21 + 18 tests) | n/a |
| Linux x64 portable `MyStream-12.0.0-linux-x64.tar.gz` | yes | **yes** (Xvfb) | **yes** (6 checks) | not on a desktop PC |
| Linux `mystream_12.0.0_amd64.deb` | yes | no (not installed) | contents inspected | no |
| Windows x64 portable `MyStream-12.0.0-win32-x64.zip` | yes (official Electron 38.2.0, SHA-256 verified; same app files as Linux) | **no** | **no** | no |
| Windows NSIS installer | **no** (needs electron-builder from npm; unavailable) | | | |
| macOS DMG/app | **no** (script supports `darwin-*`; needs a Mac for signing) | | | |
| Android / Android TV / Fire TV APK | **no** (no Android SDK) | | | |
| Tizen / webOS packages | **no** (vendor SDKs) | | | |
| iOS / iPadOS | **no** (needs Xcode) | | | |
| Docker image | **no** (no daemon); Dockerfile/Compose provided | | | |

## Not implemented (deliberately)
- **Torrent playback engine (spec Phase 3) and Torrentio-specific integration.** Torrent results from any add-on are labelled "not supported" and never played. The `TORRENT_ENGINE_ENABLED` setting is fixed to false.
- **Stream extraction from embedded players.** Embedded providers stay optional third-party pages.

## Known limitations
- Data store is a single JSON file (atomic writes + `.bak`), suited to a household, not PostgreSQL. Multiple server processes must not share one data folder.
- Continue Watching for embedded players is saved when the player opens; position inside third-party pages can't be read.
- Browsers can't send custom headers on media requests, so `proxyHeaders` streams are not playable (no stream proxy is included).
- MKV/HEVC/AC-3 playback depends on the device's decoders.
- Windows build uses Electron's default executable icon (changing it needs `rcedit` on Windows).

## Update 12.1 (server management, subtitles, permissions)
| Requirement | Status | Evidence |
|---|---|---|
| Subtitle On/Off switch, disabled when no subtitles, language list, choice remembered per profile | Done | e2e "Subtitle On/Off switch", "Subtitle choice is remembered between sessions" |
| Unified Server Management (add-ons + player servers): add by link (auto-detect), edit, delete with confirmation, enable/disable, shared/private/selected accounts, order, default, Test with real status | Done | e2e "Settings → Server Management…", unit "Server Management…" |
| Disabled servers never offered or used for failover; unauthorized servers never offered; admin APIs refused to members (403) | Done | unit (scenarios A–D, direct API calls) |
| TMDB catalogue independent of servers | Done | unit (all player servers disabled → Home still loads) |
| Settings persist across restart | Done | unit "server settings survive a restart" |
| Temporary admin password, change enforced when network-exposed; hashes only | Done | unit "temporary admin password…" (scrypt, not Argon2id: Node 22 has no built-in Argon2) |
| Desktop: reset admin password locally only | Done | desktop "Reset admin password from the setup window" |
| Smart Server Scanner (crawl a free-streaming directory) | **Not implemented** (declined: its purpose is finding unlicensed streaming sites) | n/a |
| Windows dev mode / packaged app | Packaged Windows build produced, **not launched** (no Windows here); Linux build launched and tested | desktop suite on Linux |

## Update 12.1 (Android TV / phone app, remote control, Share on my network)
Final run of all suites after this update: backend **26/26**, browser e2e **22/22**, packaged Linux desktop **9/9**.

| Requirement | Status | Evidence |
|---|---|---|
| Android app (TV + phone, one APK): WebView wrapper, first-run server setup with `/api/health` check, Change server, leanback launcher + banner, TV mode (`?tv=1`) on TVs | Source written (`apps/android`), CI workflow `.github/workflows/android.yml` | Java **type-checked with `javac` against hand-written Android API stubs** (catches typos and wrong signatures, not real API behaviour); manifest/resources validated with xmllint. **APK not built or run here**: the Android SDK, Gradle distribution and Google Maven are blocked |
| Remote keys: D-pad/OK, Back (menu → fullscreen → player → page → press twice to exit), Play/Pause/FF/Rew/Next, Captions, Menu, Search, digits | Implemented | e2e "Android TV app bridge" runs the **same JavaScript** the app injects (media keys, `msHandleBack`) against the real web app; native key mapping is unverified on hardware |
| Keep the screen on during playback | Implemented (`MyStreamAndroid.keepScreenOn`) | e2e: true on play, false on pause and on leaving the player |
| Pop-up, redirect and ad-host blocking in the Android app | Implemented (same host list as desktop) | Code only; not exercised on a device |
| TV layout at Android TV's 960×540 CSS viewport | Fixed (nav no longer clipped, temp-password banner moved to the bottom, Cast heading gutter) | Screenshot check at 960×540 @2x: nav overflow 0, page overflow 0 |
| Desktop **Share on my network**: fixed port (default 8787), listens on all interfaces, shows LAN addresses, temporary admin password must be changed first | Implemented | desktop "Share on my network…": reachable via the LAN IP, 403 `must_change_password` until changed, then 200 |
| Windows firewall prompt / real TVs and phones on a home network | **Not verified** (no Windows or devices here) | n/a |
