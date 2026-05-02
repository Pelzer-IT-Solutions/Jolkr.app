/**
 * Generic TTL cache helper. Replaces several ad-hoc cache implementations
 * (friendship, E2EE prekey bundles, etc.) with a single typed surface.
 *
 * Stores values together with their write-timestamp; reads enforce the TTL
 * and return `undefined` once stale. Optional `nullTtl` allows shorter
 * caching of "missing" results so the next call retries quickly.
 *
 * Insertion-order LRU eviction kicks in when `maxEntries` is set: once the
 * cache exceeds the limit, the oldest entries are dropped on the next write.
 */

export interface TtlCacheOptions<V> {
  /** TTL in milliseconds for non-empty values. */
  ttl: number;
  /** Optional shorter TTL for "empty" values (defaults to `ttl`). */
  nullTtl?: number;
  /** Optional max entries; oldest are evicted on the next `set()`. */
  maxEntries?: number;
  /** Predicate that decides whether `nullTtl` applies. Defaults to `v == null`. */
  isEmpty?: (value: V) => boolean;
}

export interface TtlCache<K, V> {
  /** Get the cached value if still fresh, otherwise `undefined`. */
  get(key: K): V | undefined;
  /** Get the cached value regardless of TTL. */
  peek(key: K): V | undefined;
  /** Cache the value with the current timestamp. */
  set(key: K, value: V): void;
  /** Remove one entry. */
  delete(key: K): boolean;
  /** Empty the entire cache. */
  clear(): void;
  /** Whether a fresh entry exists for the key. */
  has(key: K): boolean;
  /** Number of entries currently stored (including stale). */
  readonly size: number;
}

interface Entry<V> {
  value: V;
  /** Epoch ms when the entry was written. */
  writtenAt: number;
}

export function createTtlCache<K, V>(opts: TtlCacheOptions<V>): TtlCache<K, V> {
  const { ttl, nullTtl, maxEntries, isEmpty } = opts;
  const store = new Map<K, Entry<V>>();
  const emptyTtl = nullTtl ?? ttl;
  const isEmptyVal = isEmpty ?? ((v: V) => v == null);

  function isFresh(entry: Entry<V>): boolean {
    const limit = isEmptyVal(entry.value) ? emptyTtl : ttl;
    return Date.now() - entry.writtenAt < limit;
  }

  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (!isFresh(entry)) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },
    peek(key) {
      return store.get(key)?.value;
    },
    set(key, value) {
      // Re-insert at the tail (Map preserves insertion order).
      if (store.has(key)) store.delete(key);
      store.set(key, { value, writtenAt: Date.now() });
      if (maxEntries !== undefined) {
        while (store.size > maxEntries) {
          const oldestKey = store.keys().next().value;
          if (oldestKey === undefined) break;
          store.delete(oldestKey);
        }
      }
    },
    delete(key) {
      return store.delete(key);
    },
    clear() {
      store.clear();
    },
    has(key) {
      const entry = store.get(key);
      return !!entry && isFresh(entry);
    },
    get size() {
      return store.size;
    },
  };
}
