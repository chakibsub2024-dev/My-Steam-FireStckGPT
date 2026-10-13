# MyStream for Android TV, Google TV, Fire TV and phones

A small native Android app (plain Java, no extra libraries) that opens **your own MyStream server** full-screen and makes it work with a TV remote. The app has no server, accounts or passwords of its own. It connects to the MyStream server you already run: the desktop app with **Share on my network**, Docker, or a Raspberry Pi.

One APK works on TVs (it appears in the Android TV / Google TV home screen) and on phones and tablets.

## Build the APK

### Option A: GitHub, nothing to install (recommended)
1. Put the MyStream folder in a GitHub repository (it can be private).
2. Go to **Actions → "Android APK" → Run workflow**. It also runs on every push that changes `apps/android`.
3. When it's done (about 3–5 minutes), open the run and download the **MyStream-android** artifact. Inside are:
   - `MyStream-12.1.0-android.apk` (install this one)
   - `MyStream-12.1.0-android-debug.apk`
   - `SHA256SUMS.txt`

### Option B: Android Studio
1. Install Android Studio (Ladybug 2024.2 or newer).
2. **Open** the `apps/android` folder. Let Android Studio sync; it downloads Gradle 8.10.2 and the Android 15 SDK.
3. **Build → Build App Bundle(s) / APK(s) → Build APK(s).** The APK is in `app/build/outputs/apk/`.

From a terminal with the SDK and Gradle 8.10+ installed, run `gradle assembleRelease` inside `apps/android`.

The release APK is signed with the standard Android debug key, so it installs with no keystore setup. That's fine for a private family app. To publish it anywhere, sign it with your own key.

## Install on a TV

**Android TV / Google TV (Chromecast with Google TV, Sony, TCL, Philips, Nvidia Shield…)**
1. On the TV: Settings → System → About → click **Android TV OS build** 7 times to enable Developer options.
2. Install **Downloader** (by AFTVnews) from the Play Store, then allow it under Settings → Apps → Security & restrictions → Unknown sources.
3. Put the APK somewhere the TV can download it. For example, drop it in a cloud drive and use the share link. Or put it in MyStream's web folder (`apps/web/MyStream.apk`) and open `http://<PC-address>:8787/MyStream.apk` in Downloader.
4. Open the downloaded APK and install. MyStream appears in the Apps row.

**Fire TV:** Settings → My Fire TV → Developer options → Install unknown apps → Downloader: **On**. Then follow steps 3–4.

**With ADB from a PC:** `adb connect <tv-ip>:5555` and then `adb install MyStream-12.1.0-android.apk`.

## Install on a phone
Copy the APK to the phone and open it. Allow "Install unknown apps" for the app you opened it with (Files or Chrome).

Not installing anything? Open `http://<PC-address>:8787` in Chrome and choose **Add to Home screen**. That's the PWA, and it works too.

## First start
The app asks for the server address, for example `http://192.168.1.20:8787`. The MyStream PC app shows this under **Server settings… → Share on my network**. The app checks `/api/health` before saving the address. To change it later, use Settings → This device → **Change server**, or press **Menu** on the remote.

## Remote control

| Remote button | What it does |
|---|---|
| D-pad ↑ ↓ ← → | Move between rows, cards, buttons and menus. In the player: ← → skip 10 s, ↑ shows the controls |
| OK / Select | Open, press, or play/pause in the player |
| Back | Closes the open menu, then exits full screen, then leaves the player, then goes back a page. At Home, press twice to exit |
| ⏯ Play/Pause, ▶ Play, ⏸ Pause | Play / pause |
| ⏩ Fast-forward, ⏪ Rewind | +10 s / −10 s |
| ⏭ Next | Next episode |
| CC / Captions | Subtitles on/off |
| Menu / Settings | MyStream Settings |
| Search / 🎤 | Search page (type with the on-screen keyboard) |
| 0–9 | Jump to 0 %–90 % of the video |

The screen stays on while a video plays and can sleep again when paused.

## What the app protects against
- **Pop-ups:** blocked (`window.open` never opens anything).
- **Redirects:** if an embedded player or ad tries to take over the screen, the app refuses any page other than your MyStream server.
- **Ads and trackers:** requests to the same ad and tracker hosts as the desktop app are blocked (`assets/ad-domains.txt`).
- **Permissions:** camera, microphone and similar requests are always denied. The app uses no storage permissions.
- **No credentials inside the APK:** you sign in with your MyStream account, exactly as in a browser.
