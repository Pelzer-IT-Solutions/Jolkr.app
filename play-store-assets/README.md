# Play Store Assets — Jolkr

Generates all visual assets for the Google Play Store listing.

## One-time setup

```bash
cd play-store-assets
npm install
npx playwright install chromium
```

## Capture raw app screenshots

Connect an Android device with USB debugging enabled and the Jolkr v0.10.0 APK installed:

```bash
adb devices  # confirm device is listed
```

Walk through the app to each of these states and capture a screenshot via ADB:

1. Server view with sidebar + channels + active chat → `raw/raw-1.png`
2. Active voice channel with participants → `raw/raw-2.png`
3. DM with lock icon header → `raw/raw-3.png`
4. Chat with GIF + reactions + emoji + attachment → `raw/raw-4.png`
5. Roles & permissions panel → `raw/raw-5.png`
6. Mobile single-pane focused chat → `raw/raw-6.png`

For each capture:

```bash
adb exec-out screencap -p > raw/raw-1.png
```

## Render final assets

```bash
npm run render        # all assets
npm run render:screenshots  # just the 6 phone screenshots
npm run render:feature      # just the feature graphic
npm run verify              # check dimensions + integrity
```

Outputs to `screenshots/screenshot-1.png` ... `screenshot-6.png`, `feature-graphic.png`, `icon-512.png`.
