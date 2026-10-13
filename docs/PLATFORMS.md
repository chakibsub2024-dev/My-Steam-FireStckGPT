# Platform status

| Platform | Status in 12.1.0 | How to use MyStream there today |
|---|---|---|
| Web (Chrome, Edge, Firefox, Safari) | **Built and tested in Chromium** (Playwright). Not tested in Firefox or Safari. | Open the server address. Installable as a PWA (Add to Home Screen / Install app). |
| Windows x64 desktop | **Built** as a portable zip from the official Electron 38.2.0 release. **Not launched** (no Windows machine available). | Unzip and run `MyStream.exe`. |
| Linux x64 desktop | **Built, launched and tested**: tar.gz + .deb. The packaged app was run under Xvfb (start-up, sign-in, playback, pop-up/redirect guard, ad blocking, admin reset, Share on my network, shutdown). The .deb was built but **not installed**. | `./mystream` or `sudo apt install ./mystream_12.1.0_amd64.deb` |
| Windows/Linux ARM64, macOS | Build script supports `win32-arm64`, `linux-arm64`, `darwin-arm64`, `darwin-x64`. **Not built here.** Unsigned macOS builds need right-click → Open; signing and notarisation need an Apple Developer ID. | Run `node scripts/build-desktop.mjs --targets darwin-arm64` on a Mac (or use the CI workflow). |
| Windows installer (NSIS) | **Not produced.** It needs electron-builder from npm, which wasn't available here. The portable zip needs no installation. | Use the portable zip. |
| Android TV / Google TV / Fire TV / phones / tablets | **Source + build workflow provided, APK not built here** (the Android SDK and Google's Maven repo are blocked in this environment). The Java was type-checked against API stubs, and the web side of the remote/bridge was tested in Chromium. Not run on a device. | Build with GitHub Actions (*Android APK* workflow) or Android Studio. See `apps/android/README.md`. Phones can also use the PWA. |
| Samsung Tizen / LG webOS | **Not built** (vendor SDKs and certificates needed). | Use the TV's built-in browser with the server address. Back keys 10009 (Tizen) and 461 (webOS) are handled; HLS plays natively there if MSE is unavailable. |
| iOS / iPadOS | **Not built** (needs a Mac, Xcode and an Apple developer account). | Safari → server address → Share → *Add to Home Screen*. HLS plays natively in Safari. |

## Sharing from the PC
In the desktop app, open **Server settings… → Share on my network**, then Save. The PC serves MyStream on port 8787 (configurable) to phones and TVs on the same Wi-Fi, and the window lists the addresses to type, e.g. `http://192.168.1.20:8787`. On Windows, allow the firewall prompt for **Private networks** only. A temporary admin password must be changed before anything else works over the network. The PC must stay on with the app open. For an always-on server, use Docker on a Pi/NAS (see DEPLOYMENT.md).

## What a fully native TV app would add
The Android app is a WebView wrapper around the same web client, so there is one UI to maintain. A native ExoPlayer (Media3) or AVPlayer integration would improve codec coverage (e.g. MKV/HEVC) and fit the platform's media controls better. These need their SDKs, signing keys and physical devices to test, and none were available for this build.
