# Veeran for Android

The Android shell. It packages the **real** Veeran client — `../client`, built by Vite —
into an installable app; there is no second copy of the UI to keep in step.

```text
veeran-app/
  capacitor.config.ts   appId, app name, webDir -> ../client/dist
  android/              the Gradle project Capacitor generates and syncs into
```

## How the app talks to the server

The app ships the interface, not the data. Every screen still needs the Veeran API, so
one machine on the network runs the server and the phone points at it.

- On first launch the sign-in screen asks for a **server address** (e.g.
  `192.168.1.20:4000`). It is checked against `/api/health` before it is saved, then
  remembered.
- Because the API is then cross-site over plain HTTP, the session cannot ride in a
  cookie. The app sends the same signed session as an `Authorization: Bearer` header
  instead; the browser build still uses its HTTP-only cookie.
- The web view is served from `http://localhost` rather than `https://localhost`, so the
  page and the API share a scheme and the web view does not block the call as mixed
  content.

**Start the server so the phone can see it.** Bind to all interfaces and allow the app's
origin:

```bash
# on the machine running the server
npm run dev
```

Find its LAN address with `ipconfig` (the IPv4 address of your Wi-Fi adapter) and use
that plus port `4000` in the app. Phone and server must be on the same network, and the
firewall must allow inbound TCP 4000.

## Build the APK

### One command, once the toolchain is installed

```bash
cd veeran-app
npm run apk:debug
```

That builds the client, syncs it into the Android project, and runs Gradle. The result:

```text
veeran-app/android/app/build/outputs/apk/debug/app-debug.apk
```

Copy it to the phone and open it — Android will ask you to allow installing from this
source. A debug APK is signed with the local debug key, which is fine for testing and
cannot be published to Play.

### What the toolchain is

| Needs | Version | Why |
| --- | --- | --- |
| JDK | 21 (Temurin or Microsoft) | Gradle runs on it |
| Android SDK platform | 36 | `compileSdkVersion` in `android/variables.gradle` |
| Android SDK build-tools | 36.x | compiles and packages |
| Android platform-tools | any | `adb`, for installing over USB |

`minSdkVersion` is 24, so the app installs on Android 7.0 and later.

Set `JAVA_HOME` and `ANDROID_HOME` (or `sdk.dir` in `android/local.properties`) before
running Gradle.

### Option A — Android Studio (simplest)

1. Install Android Studio. Its setup wizard installs the JDK, SDK 36 and build-tools.
2. `cd veeran-app && npm run sync` — builds the client and copies it in.
3. `npm run open` — opens the `android/` project in Android Studio.
4. **Build → Build Bundle(s) / APK(s) → Build APK(s)**, then use the "locate" link in the
   notification.

To run it straight onto a plugged-in phone with USB debugging on, press ▶ instead.

### Option B — command-line tools only (no IDE)

```bash
# 1. JDK 21 — install Temurin, then:
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21..."

# 2. Android command-line tools: unzip to e.g. C:\Android\cmdline-tools\latest
export ANDROID_HOME="/c/Android"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

# 3. SDK packages (accepts the SDK licence)
sdkmanager --install "platforms;android-36" "build-tools;36.0.0" "platform-tools"

# 4. Build
cd veeran-app && npm run apk:debug
```

### Option C — GitHub Actions (nothing installed locally)

`.github/workflows/android.yml` builds the APK on every push and on demand, and uploads
it as a downloadable artifact. Push the repo, open **Actions → Build Android APK → Run
workflow**, then download `veeran-debug-apk` from the finished run.

## Install on the phone

| Route | Steps |
| --- | --- |
| File transfer | Copy `app-debug.apk` to the phone, tap it in Files, allow "install unknown apps" for that app |
| USB | `adb install -r android/app/build/outputs/apk/debug/app-debug.apk` |

Then open **Veeran**, enter the server address, and sign in with the UID you would use in
the browser.

## A release build

`npm run apk:release` produces an unsigned release APK. To install or publish it you need
your own keystore:

```bash
keytool -genkey -v -keystore veeran.keystore -alias veeran \
        -keyalg RSA -keysize 2048 -validity 10000
```

Reference it from `android/app/build.gradle` in a `signingConfigs` block, or sign the
output with `apksigner`. Keep the keystore and its passwords out of the repository — an
app can never be updated on Play with a different key.

## Notes

- Re-run `npm run sync` after any change to `client/` — the APK carries a snapshot of the
  build, not a live link to it.
- Bump `versionCode` and `versionName` in `android/app/build.gradle` for each build you
  hand to someone, or you will not be able to tell two APKs apart on a phone.
- The Create React App files this folder started as (`src/`, `public/`, `build/`) are no
  longer used by the build and can be deleted.
