/**
 * Locale dictionary loader.
 *
 * `en-US` is eager-imported — it's the fallback for missing keys and the
 * pre-login default, so it must be in the initial bundle. The other 8
 * locales are lazy-loaded via Vite's dynamic-import code-splitting:
 * each becomes its own JS chunk that's only fetched when the user
 * actually picks that language. Loaded dicts are cached so repeated
 * `setLocale()` calls don't re-fetch.
 */

import enUS from './locales/en-US.json';
import type { LocaleCode, Translations } from './types';

const cache: Partial<Record<LocaleCode, Translations>> = {
  'en-US': enUS as Translations,
};

/**
 * Resolve a locale's dictionary. `en-US` returns synchronously from the
 * eager import; everything else takes one round-trip the first time and
 * is then served from the cache.
 */
export async function loadLocale(code: LocaleCode): Promise<Translations> {
  const cached = cache[code];
  if (cached) return cached;

  // Vite analyzes this template literal and emits one chunk per match. The
  // `?? throw`-style fallback would mask import errors — we'd rather the
  // promise rejects and the caller's try/catch decides what to do.
  const mod = await import(`./locales/${code}.json`);
  const dict = (mod.default ?? mod) as Translations;
  cache[code] = dict;
  return dict;
}

/** Synchronous fallback dict — always available, used by `t()` when a
 *  key misses in the active locale. */
export const FALLBACK_DICT: Translations = enUS as Translations;
