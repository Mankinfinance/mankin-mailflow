# Mailflow mobile app

Mailflow for Android and iPhone. A native shell (Capacitor 8) around the
live site: it opens `https://mankin-mailflow.vercel.app/marketing`, so
every screen and every update comes from the web app, and the app itself
rarely needs rebuilding. It adds the app icon, splash screen, status-bar
handling, an offline screen, and Microsoft sign-in inside the app.

Rebuild the app only when this folder changes: the icon, the name, the
address it opens, or a new native feature.

## What is where

| Path | What |
| --- | --- |
| `capacitor.config.json` | App id `au.com.mankinfinance.mailflow`, the address it opens, which sign-in domains stay inside the app |
| `assets/` | Source images for icons and splash. Regenerate with `npm run assets` |
| `www/` | The offline screen, and a page that hands over to the live site |
| `android/` | Android Studio project |
| `ios/` | Xcode project (Swift Package Manager, no CocoaPods) |
| `../.github/workflows/mobile-android.yml` | Builds the Android app on GitHub |

Links to anywhere else (LoanFlow, a published landing page, a client's
form) open in the phone's browser, not inside the app.

The web app recognises the app by `MailflowApp/` in its user agent and
hides "Install Mailflow" there.

## Android

GitHub builds it whenever this folder changes, or on demand: repository
> **Actions** > **Mobile - Android** > **Run workflow**. Each build is
published as a release, **Mailflow for Android 1.0.N**, with the APK
attached: on an Android phone, open
`https://github.com/Mankinfinance/mankin-mailflow/releases/latest`
(signed in to GitHub, as the repository is private) and tap the `.apk`.

- **Test builds** (no signing secrets): install directly on a phone. A
  newer test build needs the old one uninstalled first.
- **Signed builds**: add four repository secrets - `ANDROID_KEYSTORE_BASE64`,
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
  Then each build installs over the last, and the `.aab` it also makes is
  what Google Play takes.

Make the keystore once, keep it and its passwords safe (every future
update must be signed with it), and never commit it:

```
keytool -genkeypair -v -keystore mailflow.keystore -alias mailflow \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 mailflow.keystore   # paste the output into ANDROID_KEYSTORE_BASE64
```

Installing an APK directly: open it on the phone and allow "Install
unknown apps" for the browser or Files app when Android asks.

Google Play: a Play Console developer account (one-off US$25). Upload the
`.aab`; for staff only, use **Internal testing** and add their emails.

## iPhone

Needs a Mac with Xcode, and an Apple Developer Program membership
(A$149 a year).

```
cd mobile
npm ci
npx cap sync ios
npx cap open ios
```

In Xcode: select the **App** target > **Signing & Capabilities** > choose
the team. Then **Product > Archive** and **Distribute App**:

- **TestFlight**, for staff: invite them by email; they install with the
  TestFlight app. Builds last 90 days, then upload a new one.
- **App Store**, if it is ever public. Apple may refuse an app that is
  only a website in a frame, so a public listing would need app-only
  features first; TestFlight and custom apps do not have this problem.

## Changing things

- Address it opens: `server.url` in `capacitor.config.json`, then rebuild.
- Icon or splash: replace the files in `assets/`, `npm run assets`, rebuild.
- Version: Android takes it from the GitHub run number; on iPhone set
  **Version** and **Build** in Xcode before archiving.
