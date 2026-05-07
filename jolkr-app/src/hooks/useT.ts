/**
 * Main translation hook. Returns memoised `t` and `tx` bound to the
 * active locale's dictionary.
 *
 *   const { t, tx } = useT()
 *   <input placeholder={t('chat.composer.placeholderChannel', { channelName })} />
 *   <span>{tx('chat.typing.one', { name: <strong>{users[0]}</strong> })}</span>
 *
 * The hook subscribes to `useLocaleStore.dict` so swapping the locale
 * triggers a re-render in every consumer. `t` returns `string`; `tx`
 * returns `ReactNode[]` (for slot-values that are React elements).
 */

import { useMemo, type ReactNode } from 'react';
import { useLocaleStore } from '../stores/locale';
import { translate, translateJsx, translatePlural } from '../i18n/t';

export interface T {
  /** String-context translate. Use for placeholders, aria-labels, alt, title. */
  t: (key: string, params?: Record<string, string | number>) => string;
  /** JSX-context translate. Slot values may be `ReactNode` (e.g. `<strong>…`). */
  tx: (key: string, params?: Record<string, ReactNode>) => ReactNode[];
  /** Plural-aware translate. Looks up `${baseKey}.${pluralTag}` for the active
   *  locale; always interpolates `{count}`. */
  tn: (baseKey: string, count: number, params?: Record<string, string | number>) => string;
}

export function useT(): T {
  const dict = useLocaleStore((s) => s.dict);
  const code = useLocaleStore((s) => s.code);

  return useMemo<T>(() => ({
    t:  (key, params) => translate(dict, key, params),
    tx: (key, params) => translateJsx(dict, key, params),
    tn: (baseKey, count, params) => translatePlural(dict, code, baseKey, count, params),
  }), [dict, code]);
}

/**
 * Synchronous translate for non-React callers (WS listeners, store
 * actions, `adapters/transforms.ts`). Reads `useLocaleStore.getState()`
 * each call so it always sees the latest dict.
 */
export function tStatic(key: string, params?: Record<string, string | number>): string {
  return translate(useLocaleStore.getState().dict, key, params);
}
