#!/usr/bin/env node
// =============================================================================
// Jolkr — Version Bump Helper
//
// Updates the version in every place it's tracked across the repo:
//   - jolkr-app/package.json
//   - jolkr-app/src-tauri/tauri.conf.json
//   - jolkr-app/src-tauri/Cargo.toml         ([package] version)
//   - jolkr-app/src-tauri/Cargo.lock         ([[package]] name = "jolkr-app")
//   - jolkr-server/Cargo.toml                ([workspace.package] version)
//
// Usage:
//   node scripts/bump-version.mjs <version>   → bump to <version>
//   node scripts/bump-version.mjs             → sync all files to package.json
// =============================================================================

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const appRoot = resolve(__dirname, '..');

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

const pkgPath        = resolve(appRoot,  'package.json');
const tauriConfPath  = resolve(appRoot,  'src-tauri/tauri.conf.json');
const tauriCargoPath = resolve(appRoot,  'src-tauri/Cargo.toml');
const tauriLockPath  = resolve(appRoot,  'src-tauri/Cargo.lock');
const serverCargoPath = resolve(repoRoot, 'jolkr-server/Cargo.toml');

const arg = process.argv[2];
const targetVersion = arg ?? JSON.parse(readFileSync(pkgPath, 'utf-8')).version;

if (!SEMVER_RE.test(targetVersion)) {
  console.error(`Invalid version: "${targetVersion}". Expected: X.Y.Z (e.g. 0.10.4)`);
  process.exit(1);
}

let totalChanged = 0;

function bumpJson(path, label) {
  if (!existsSync(path)) { console.warn(`  - ${label}: SKIP (missing)`); return; }
  const json = JSON.parse(readFileSync(path, 'utf-8'));
  if (json.version === targetVersion) { console.log(`  ✓ ${label}: already ${targetVersion}`); return; }
  const old = json.version;
  json.version = targetVersion;
  writeFileSync(path, JSON.stringify(json, null, 2) + '\n');
  console.log(`  ✓ ${label}: ${old} → ${targetVersion}`);
  totalChanged++;
}

function bumpRegex(path, label, regex, replacement) {
  if (!existsSync(path)) { console.warn(`  - ${label}: SKIP (missing)`); return; }
  const content = readFileSync(path, 'utf-8');
  const match = content.match(regex);
  if (!match) {
    console.error(`  ✗ ${label}: pattern not found — file format changed?`);
    process.exit(1);
  }
  if (match[1] === targetVersion) { console.log(`  ✓ ${label}: already ${targetVersion}`); return; }
  const old = match[1];
  const updated = content.replace(regex, replacement);
  writeFileSync(path, updated);
  console.log(`  ✓ ${label}: ${old} → ${targetVersion}`);
  totalChanged++;
}

console.log(`\nBumping all files to ${targetVersion}\n`);

bumpJson(pkgPath,       'jolkr-app/package.json');
bumpJson(tauriConfPath, 'jolkr-app/src-tauri/tauri.conf.json');

// jolkr-app/src-tauri/Cargo.toml — match version under [package] block.
// Captures the current version so we can report old → new.
bumpRegex(
  tauriCargoPath,
  'jolkr-app/src-tauri/Cargo.toml',
  /(?<=\[package\][^[]*?\nversion = ")([^"]+)(?=")/,
  targetVersion,
);

// jolkr-app/src-tauri/Cargo.lock — match the jolkr-app package entry.
// Cargo.lock blocks look like: [[package]]\nname = "X"\nversion = "Y"
bumpRegex(
  tauriLockPath,
  'jolkr-app/src-tauri/Cargo.lock',
  /(?<=\[\[package\]\]\nname = "jolkr-app"\nversion = ")([^"]+)(?=")/,
  targetVersion,
);

// jolkr-server/Cargo.toml — match version under [workspace.package] block.
bumpRegex(
  serverCargoPath,
  'jolkr-server/Cargo.toml',
  /(?<=\[workspace\.package\][^[]*?\nversion = ")([^"]+)(?=")/,
  targetVersion,
);

console.log(`\n${totalChanged === 0 ? 'Nothing to change — all files already match.' : `Done — ${totalChanged} file(s) updated.`}\n`);
