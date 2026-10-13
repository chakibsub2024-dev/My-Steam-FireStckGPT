# MyStream Fire TV test package

## What is included

- Android-based Fire OS client source under `apps/android`.
- Large-screen interface served from the same MyStream backend used by Windows.
- D-pad, OK, Back, Play/Pause, skip, subtitles and fullscreen handling.
- Better WebView hardware rendering and fallback focus for the remote.
- A GitHub Actions workflow that builds an installable APK.

## Build the Fire Stick APK without installing development tools

1. Upload this project into a GitHub repository (private is fine).
2. Open **Actions** → **Android APK (phone + Android TV + Fire TV)** → **Run workflow**.
3. After the build succeeds, download the **MyStream-android** artifact.
4. Extract `MyStream-12.1.0-android.apk` and copy it to the Fire Stick with Downloader, Send Files to TV, or ADB.

## Installation

Fire OS: Settings → My Fire TV → Developer options → Install unknown apps. Enable the application used to open the APK, then install it. Some versions require enabling developer options first.

On first launch, enter your PC's MyStream server address, e.g. `http://192.168.1.20:8787`. Start the MyStream server and enable network sharing on the Windows application. The Fire Stick and PC should be on the same network.

## Critical limitations

This is an Android-based **Fire OS** APK, not an Amazon **Vega OS** application. Certain newer Fire TV devices may not accept APKs. No physical Fire Stick testing has been performed in this environment. Embedded third-party video players may ignore remote control input or block video playback; this build cannot guarantee they work.

## Test checklist

- Fire Stick sees and installs the APK.
- Server setup can be completed using only the remote.
- TMDB catalogue and search work.
- Watch Now opens a player and a permitted test stream shows picture and sound.
- D-pad controls are visible and focusable; Back works.
- Buffering label disappears when playback is active.
- Subtitle and server options are navigable.
- App reconnects after network/server interruption.
