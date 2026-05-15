/**
 * Translation core. Two functions:
 *
 *   t(key, params?)  → string         — for placeholders, aria-labels, alt
 *   tx(key, params?) → ReactNode[]    — for inline JSX (`<strong>name</strong>`)
 *
 * Both walk the active dict by dotted key, then fall back to the en-US
 * dict, then to the key itself (a dev-bug signal — never a user-facing
 * fallthrough as long as en-US is complete).
 *
 * Interpolation uses simple `{slot}` syntax. `tx` allows a slot value to
 * be a `ReactNode`, which lands as-is in the result array; React renders
 * mixed string/element arrays without complaint.
 *
 * For non-React callers (WS listeners, `transforms.ts`, store actions),
 * `tStatic` reads `useLocaleStore.getState()` directly — same semantics,
 * no hook required.
 */

import { FALLBACK_DICT } from './loader';
import type { Translations } from './types';
import type { ReactNode } from 'react';

/** Walk a dotted key like `auth.login.title` through a nested dict. */
function walk(dict: Translations | undefined, key: string): string | undefined {
  if (!dict) return undefined;
  const parts = key.split('.');
  let node: string | Translations | undefined = dict;
  for (const part of parts) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Translations)[part];
    if (node === undefined) return undefined;
  }
  return typeof node === 'string' ? node : undefined;
}

/** Resolve a key against active dict → en-US fallback → key-as-literal. */
function resolve(dict: Translations | undefined, key: string): string {
  return walk(dict, key) ?? walk(FALLBACK_DICT, key) ?? key;
}

/** Interpolate `{slot}` placeholders with primitive params. */
export function translate(
  dict: Translations | undefined,
  key: string,
  params?: Record<string, string | number>,
): string {
  const raw = resolve(dict, key);
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = params[name];
    return v === undefined ? `{${name}}` : String(v);
  });
}

/** Interpolate `{slot}` placeholders, allowing ReactNode values. Returns
 *  an array because React-element interleaving can't be a single string. */
export function translateJsx(
  dict: Translations | undefined,
  key: string,
  params?: Record<string, ReactNode>,
): ReactNode[] {
  const raw = resolve(dict, key);
  if (!params) return [raw];

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  const re = /\{(\w+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    if (match.index > lastIndex) parts.push(raw.slice(lastIndex, match.index));
    const slot = match[1];
    const v = params[slot];
    parts.push(v === undefined ? match[0] : v);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < raw.length) parts.push(raw.slice(lastIndex));
  return parts;
}

/**
 * Plural-key resolver. Reads the `Intl.PluralRules` tag for `count` in
 * the active locale (e.g. `'one'`, `'other'`, `'few'` in Polish), then
 * looks up `${baseKey}.${tag}` in the dict — falls back to `${baseKey}.other`
 * if the tag-specific key is missing. Always interpolates `{count}`.
 */
export function translatePlural(
  dict: Translations | undefined,
  locale: string,
  baseKey: string,
  count: number,
  extraParams?: Record<string, string | number>,
): string {
  const tag = new Intl.PluralRules(locale).select(count);
  const key = walk(dict, `${baseKey}.${tag}`) !== undefined
    ? `${baseKey}.${tag}`
    : `${baseKey}.other`;
  return translate(dict, key, { count, ...extraParams });
}
