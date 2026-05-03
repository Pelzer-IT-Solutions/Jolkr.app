import { useCallback, useEffect, useState } from 'react';

/**
 * Read/write a boolean setting in `localStorage`.
 *
 * Reads synchronously on mount via the `useState` initializer so the first
 * render reflects the persisted value. Writes back through the returned
 * setter and broadcasts a custom event so other consumers of the same key
 * in the same tab stay in sync (the native `storage` event only fires for
 * other tabs).
 */
export function useLocalStorageBoolean(
  key: string,
  defaultValue: boolean,
): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => readBoolean(key, defaultValue));

  useEffect(() => {
    const onChange = (e: Event) => {
      if (e instanceof CustomEvent && e.detail?.key !== key) return;
      setValue(readBoolean(key, defaultValue));
    };
    window.addEventListener(LOCAL_PREF_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(LOCAL_PREF_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, [key, defaultValue]);

  const set = useCallback((v: boolean) => {
    try { localStorage.setItem(key, v ? 'true' : 'false'); } catch { /* quota / disabled */ }
    setValue(v);
    notifyLocalPrefChange(key);
  }, [key]);

  return [value, set];
}

/** Custom-event name used to fan out same-tab `localStorage` changes. */
export const LOCAL_PREF_EVENT = 'jolkr:local-pref-change';

/** Dispatch a same-tab change notification for the given storage key. */
export function notifyLocalPrefChange(key: string): void {
  window.dispatchEvent(new CustomEvent(LOCAL_PREF_EVENT, { detail: { key } }));
}

function readBoolean(key: string, defaultValue: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return raw !== 'false';
  } catch {
    return defaultValue;
  }
}
