#!/usr/bin/env node
// =============================================================================
// Jolkr — Version Bump Helper
// Syncs version between package.json and tauri.conf.json
// Usage: node scripts/bump-version.mjs [version]
//   If no version given, reads from package.json
// =============================================================================

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const version = process.argv[2];

const pkgPath = resolve(root, 'package.json');
const tauriConfPath = resolve(root, 'src-tauri/tauri.conf.json');

const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf-8'));

if (version) {
  // Validate semver format
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    console.error(`Invalid version format: ${version}`);
    console.error('Expected: X.Y.Z (e.g., 0.2.0)');
    process.exit(1);
  }

  pkg.version = version;
  tauriConf.version = version;

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');

  console.log(`Version bumped to ${version}`);
  console.log(`  - package.json: ${version}`);
  console.log(`  - tauri.conf.json: ${version}`);
} else {
  // Sync tauri.conf.json to match package.json
  const currentVersion = pkg.version;
  if (tauriConf.version !== currentVersion) {
    tauriConf.version = currentVersion;
    writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');
    console.log(`Synced tauri.conf.json version to ${currentVersion}`);
  } else {
    console.log(`Versions already in sync: ${currentVersion}`);
  }
}
