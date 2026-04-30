import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = resolve(__dirname, 'template');
const SCREENSHOTS_DIR = resolve(__dirname, 'screenshots');
const ICON_SRC = resolve(__dirname, '..', 'jolkr-app', 'src-tauri', 'icons', 'icon.png');
const ICON_DST = resolve(__dirname, 'icon-512.png');

const target = process.argv[2] || 'all';

async function main() {
  if (!existsSync(SCREENSHOTS_DIR)) mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  if (!existsSync(ICON_DST)) {
    if (!existsSync(ICON_SRC)) throw new Error(`Icon source missing: ${ICON_SRC}`);
    copyFileSync(ICON_SRC, ICON_DST);
    console.log(`Copied icon: ${ICON_SRC} -> ${ICON_DST}`);
  }

  const launchOptions = {};
  const cachedChromium = process.env.PLAYWRIGHT_CHROMIUM_PATH ||
    'C:/Users/philp/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe';
  if (existsSync(cachedChromium)) {
    launchOptions.executablePath = cachedChromium;
  }
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ deviceScaleFactor: 1 });

  try {
    if (target === 'all' || target === 'screenshots') {
      await renderScreenshots(context);
    }
    if (target === 'all' || target === 'feature-graphic') {
      await renderFeatureGraphic(context);
    }
  } finally {
    await browser.close();
  }

  console.log('Done.');
}

async function renderScreenshots(context) {
  for (let n = 1; n <= 4; n++) {
    const rawPath = resolve(__dirname, 'raw', `raw-${n}.png`);
    if (!existsSync(rawPath)) {
      console.warn(`SKIP slot ${n}: raw screenshot missing at ${rawPath}`);
      continue;
    }

    const page = await context.newPage();
    await page.setViewportSize({ width: 1080, height: 1920 });
    const url = `file://${TEMPLATE_DIR.replace(/\\/g, '/')}/screenshot.html?slot=${n}`;
    await page.goto(url, { waitUntil: 'networkidle' });

    await page.waitForFunction(() => {
      const img = document.getElementById('phone-screen');
      return img && img.complete && img.naturalWidth > 0;
    }, { timeout: 5000 });

    await page.evaluate(() => document.fonts.ready);

    const out = resolve(SCREENSHOTS_DIR, `screenshot-${n}.png`);
    await page.screenshot({ path: out, type: 'png', clip: { x: 0, y: 0, width: 1080, height: 1920 } });
    console.log(`Rendered: ${out}`);
    await page.close();
  }
}

async function renderFeatureGraphic(context) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1024, height: 500 });
  const url = `file://${TEMPLATE_DIR.replace(/\\/g, '/')}/feature-graphic.html`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => {
    const img = document.querySelector('.icon');
    return img && img.complete && img.naturalWidth > 0;
  }, { timeout: 5000 });
  await page.evaluate(() => document.fonts.ready);

  const out = resolve(__dirname, 'feature-graphic.png');
  await page.screenshot({ path: out, type: 'png', clip: { x: 0, y: 0, width: 1024, height: 500 } });
  console.log(`Rendered: ${out}`);
  await page.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
