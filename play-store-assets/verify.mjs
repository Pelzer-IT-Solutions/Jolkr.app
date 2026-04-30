import sharp from 'sharp';
import { existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CHECKS = [
  { path: 'icon-512.png', width: 512, height: 512 },
  { path: 'feature-graphic.png', width: 1024, height: 500 },
  ...Array.from({ length: 4 }, (_, i) => ({
    path: `screenshots/screenshot-${i + 1}.png`,
    width: 1080,
    height: 1920
  }))
];

let failed = 0;

for (const check of CHECKS) {
  const fullPath = resolve(__dirname, check.path);
  if (!existsSync(fullPath)) {
    console.error(`FAIL  ${check.path}: file missing`);
    failed++;
    continue;
  }
  const size = statSync(fullPath).size;
  if (size === 0) {
    console.error(`FAIL  ${check.path}: zero bytes`);
    failed++;
    continue;
  }
  const meta = await sharp(fullPath).metadata();
  if (meta.width !== check.width || meta.height !== check.height) {
    console.error(`FAIL  ${check.path}: expected ${check.width}x${check.height}, got ${meta.width}x${meta.height}`);
    failed++;
    continue;
  }
  console.log(`OK    ${check.path}  ${meta.width}x${meta.height}  ${(size / 1024).toFixed(1)}kb`);
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll assets verified.');
