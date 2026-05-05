import { useEffect, useState } from 'react';

/**
 * Returns a debounced copy of `value` that only updates after `ms`
 * milliseconds without further changes. Useful for search inputs that
 * trigger network calls — the call is delayed until the user stops typing.
 *
 * Example:
 *   const debounced = useDebouncedValue(query, 300);
 *   useEffect(() => { fetch(...debounced...) }, [debounced]);
 */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);

  return debounced;
}
