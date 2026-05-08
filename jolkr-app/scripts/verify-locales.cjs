#!/usr/bin/env node
/**
 * Verifies that every locale file has the exact same key-set as en-US.json.
 *
 * Exit codes:
 *   0 — all locales match the master baseline
 *   1 — one or more locales have missing or extra keys
 *
 * Run: `node scripts/verify-locales.cjs` or `npm run verify:locales`.
 */

const fs   = require('node:fs');
const path = require('node:path');

const LOCALES_DIR = path.join(__dirname, '..', 'src', 'i18n', 'locales');
const MASTER = 'en-US';
const TARGETS = ['nl', 'fr', 'de', 'es', 'it', 'ja', 'ko', 'zh-CN'];

function loadJson(file) {
  return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${file}.json`), 'utf8'));
}

/** Walk a nested dict and emit dot-separated key paths to leaves. */
function flatten(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flatten(v, key));
    } else {
      out.push(key);
    }
  }
  return out;
}

const masterKeys = new Set(flatten(loadJson(MASTER)));
let failures = 0;

for (const code of TARGETS) {
  const dict = loadJson(code);
  const keys = new Set(flatten(dict));
  const missing = [...masterKeys].filter(k => !keys.has(k));
  const extra   = [...keys].filter(k => !masterKeys.has(k));

  if (missing.length === 0 && extra.length === 0) {
    console.log(`✓ ${code} — ${keys.size} keys match`);
    continue;
  }

  failures++;
  console.error(`✗ ${code}`);
  if (missing.length) {
    console.error(`  missing (${missing.length}):`);
    for (const k of missing) console.error(`    - ${k}`);
  }
  if (extra.length) {
    console.error(`  extra (${extra.length}):`);
    for (const k of extra) console.error(`    + ${k}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} locale${failures === 1 ? '' : 's'} out of sync with ${MASTER}.json`);
  process.exit(1);
}

console.log(`\nAll ${TARGETS.length} locales match ${MASTER}.json (${masterKeys.size} keys).`);
