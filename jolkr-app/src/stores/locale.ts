/**
 * Active-locale store.
 *
 * Holds the current `LocaleCode` and the loaded `Translations` dictionary.
 * Acts as the single source of truth for every consumer:
 *   - `useT()` / `tx()` read `dict` to translate
 *   - `useLocaleFormatters()` reads `code` to localise dates/numbers
 *   - `<html lang>` is mirrored from `code` via an AppShell subscription
 *
 * Boot resolution (ladder, executed in the AppShell on first mount):
 *   1) `me.preferred_language` (after auth-store hydrates)
 *   2) `localStorage[STORAGE_KEYS.LOCALE]`
 *   3) `'en-US'` (hard default)
 *
 * `setLocale(code)` is the one write path: load dict → swap state →
 * persist to localStorage. Persistence to the backend (`PATCH /users/@me`)
 * is the caller's responsibility — the store stays decoupled from the API
 * so it can run pre-login (where there's no `me`).
 *
 * The store is module-scoped (no React provider) — same shape as
 * `stores/auth.ts` and `stores/users.ts` so non-React modules
 * (`adapters/transforms.ts`, store actions) can read via `getState()`.
 */

import { create } from 'zustand';
import { FALLBACK_DICT, loadLocale } from '../i18n/loader';
import { DEFAULT_LOCALE, isLocaleCode, SUPPORTED_LOCALES } from '../i18n/types';
import { STORAGE_KEYS } from '../utils/storageKeys';
import type { LocaleCode, Translations } from '../i18n/types';

interface LocaleState {
  /** Active locale tag (e.g. `'en-US'`, `'fr'`). */
  code: LocaleCode;
  /** Loaded dictionary for `code`. Always populated — defaults to the
   *  eager-imported en-US bundle so `t()` never sees `undefined`. */
  dict: Translations;
  /** Switch to a different locale. Loads the JSON, persists to
   *  localStorage. No-op if the code is already active. Caller decides
   *  whether to also `PATCH /users/@me`. */
  setLocale: (code: LocaleCode) => Promise<void>;
  /**
   * Apply a locale value coming from the backend (`me.preferred_language`
   * or a WS `UserUpdate` payload). Tolerates `null`/`undefined` and
   * unknown codes — both are no-ops, leaving the existing locale intact
   * (the FE-side fallback ladder already chose something sensible).
   */
  applyMeProfile: (raw: string | null | undefined) => void;
}

/** Resolve which locale to boot with — runs once at module load. */
function resolveBootLocale(): LocaleCode {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.LOCALE);
    if (isLocaleCode(stored)) return stored;
  } catch { /* localStorage disabled — fall through */ }
  return DEFAULT_LOCALE;
}

const bootLocale = resolveBootLocale();

export const useLocaleStore = create<LocaleState>((set, get) => ({
  code: bootLocale,
  dict: FALLBACK_DICT,

  setLocale: async (code) => {
    if (!SUPPORTED_LOCALES.includes(code)) return;
    // Always resolve through the loader (cached after first hit) so the
    // boot path — where `code` is restored from localStorage but `dict`
    // is still the eager-loaded en-US fallback — actually swaps the dict.
    // The earlier `if (get().code === code) return` short-circuited that
    // boot dict-load, leaving the UI on English even when the user had
    // already chosen a different language.
    const dict = await loadLocale(code);
    const state = get();
    if (state.code === code && state.dict === dict) return;
    set({ code, dict });
    try { localStorage.setItem(STORAGE_KEYS.LOCALE, code); } catch { /* best-effort */ }
  },

  applyMeProfile: (raw) => {
    if (!isLocaleCode(raw)) return;
    if (get().code === raw) return;
    // Fire-and-forget — the store updates itself when the dict resolves.
    void get().setLocale(raw);
  },
}));

// If the boot resolution picked a non-default locale (from localStorage),
// kick off the dict load in the background. Until it resolves, `dict` stays
// on the en-US fallback — the user briefly sees English on a hard refresh,
// which is acceptable and matches the pre-login UX rule.
if (bootLocale !== DEFAULT_LOCALE) {
  void useLocaleStore.getState().setLocale(bootLocale);
}

/**
 * Synchronous helpers for non-React callers (WS listeners, hot paths in
 * `adapters/transforms.ts`, etc.). They read straight from the store —
 * no hooks, no subscription churn.
 */
export const getLocaleCode = (): LocaleCode => useLocaleStore.getState().code;
export const getLocaleDict = (): Translations => useLocaleStore.getState().dict;
