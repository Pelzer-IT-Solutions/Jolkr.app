/**
 * Type definitions for the locale layer.
 *
 * `LocaleCode` is the union of every code we ship; the backend whitelist
 * (`SUPPORTED_LOCALES` in `routes/users.rs`) is kept in sync by hand —
 * adding a language is a one-line change in both places + a new JSON file.
 *
 * `Translations` is recursive so namespaces can nest (`auth.login.title`).
 * We don't typecheck individual keys against the dictionary — that would
 * couple the type system to one specific JSON file, which is more pain
 * than payoff for a 600-key catalog. The runtime `t()` falls back to the
 * `en-US` dict on misses, which catches typos at runtime.
 */

export type LocaleCode =
  | 'en-US'
  | 'nl'
  | 'fr'
  | 'de'
  | 'es'
  | 'it'
  | 'ja'
  | 'ko'
  | 'zh-CN';

/**
 * Ordered list — matches the dropdown in `Settings.tsx` and the BCP-47
 * codes the backend accepts. Default sits at index 0.
 */
export const SUPPORTED_LOCALES: readonly LocaleCode[] = [
  'en-US', 'nl', 'fr', 'de', 'es', 'it', 'ja', 'ko', 'zh-CN',
] as const;

export const DEFAULT_LOCALE: LocaleCode = 'en-US';

/** Recursive dictionary: leaves are strings, branches are nested objects. */
export interface Translations {
  [key: string]: string | Translations;
}

/** Display label for the language picker (shown in the Settings dropdown). */
export const LOCALE_LABELS: Record<LocaleCode, string> = {
  'en-US': 'English (US)',
  'nl':    'Nederlands',
  'fr':    'Français',
  'de':    'Deutsch',
  'es':    'Español',
  'it':    'Italiano',
  'ja':    '日本語',
  'ko':    '한국어',
  'zh-CN': '中文 (简体)',
};

/** Type-narrowing helper: `'foo'` is not assignable to `LocaleCode`. */
export function isLocaleCode(v: unknown): v is LocaleCode {
  return typeof v === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(v);
}
